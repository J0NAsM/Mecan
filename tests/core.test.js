import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase } from './helpers/postgres.js';
import { provisionWorkshop, createWorkOrder, createEmployee } from '../src/domain.js';
import { createSession, readSession } from '../src/auth.js';
import {
  resolveContext,
  entitlement,
  assertEntitlement,
  tenantRows,
  can,
  assertTenantWritable,
} from '../src/tenancy.js';
import {
  recordManualPayment,
  setTenantStatus,
  platformMetrics,
  refreshSubscriptionStates,
  billingRows,
} from '../src/billing.js';
import { id, now } from '../src/utils.js';

async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, { superadminEmail: 'root@test.local', superadminPassword: 'Strong123!' });
  const a = await provisionWorkshop(db, {
    ownerName: 'Ana',
    workshopName: 'Taller A',
    email: 'ana@test.local',
    password: 'Strong123!',
    planId: 'plan-basic',
  });
  const b = await provisionWorkshop(db, {
    ownerName: 'Bruno',
    workshopName: 'Taller B',
    email: 'bruno@test.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  const session = await createSession(db, a.userId);
  const context = await resolveContext(db, await readSession(db, session.id));
  return { db, a, b, context };
}

test('aprovisionamiento crea toda la organización de forma coherente', async () => {
  const { db, a } = await fixture();
  assert.equal(
    (await db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId)).status,
    'TRIAL',
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) n FROM branches WHERE tenant_id=?').get(a.tenantId)).n,
    1,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) n FROM memberships WHERE tenant_id=?').get(a.tenantId)).n,
    1,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE tenant_id=?').get(a.tenantId)).n,
    1,
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) n FROM trials WHERE tenant_id=?').get(a.tenantId)).n,
    1,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action='TENANT_PROVISIONED'",
        )
        .get(a.tenantId)
    ).n,
    1,
  );
  await db.close();
});

test('consultas multi-tenant nunca devuelven filas del vecino', async () => {
  const { db, a, b } = await fixture();
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('a-customer', a.tenantId, a.branchId, 'Cliente A', now());
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('b-customer', b.tenantId, b.branchId, 'Cliente B', now());
  const rows = await tenantRows(db, 'customers', a.tenantId);
  assert.deepEqual(
    rows.map((x) => x.name),
    ['Cliente A'],
  );
  assert.equal(
    rows.some((x) => x.tenant_id === b.tenantId),
    false,
  );
  await db.close();
});

test('IDs manipulados de cliente y vehículo de otro tenant son rechazados', async () => {
  const { db, a, b, context } = await fixture();
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('b-customer', b.tenantId, b.branchId, 'Cliente B', now());
  await db
    .prepare('INSERT INTO vehicles (id,tenant_id,customer_id,plate,created_at) VALUES (?,?,?,?,?)')
    .run('b-vehicle', b.tenantId, 'b-customer', 'B123', now());
  await assert.rejects(
    async () =>
      await createWorkOrder(db, context, {
        branchId: a.branchId,
        customerId: 'b-customer',
        vehicleId: 'b-vehicle',
        complaint: 'Intento cruzado',
      }),
    /inválidos/,
  );
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM work_orders').get()).n, 0);
  await db.close();
});

test('entitlements se resuelven centralmente por plan y excepción de tenant', async () => {
  const { db, a } = await fixture();
  assert.equal((await entitlement(db, a.tenantId, 'branches')).limit, 1);
  await assert.rejects(
    async () => await assertEntitlement(db, a.tenantId, 'branches', 1),
    /límite/,
  );
  await db
    .prepare(
      `INSERT INTO tenant_features (tenant_id,feature_id,enabled,limit_value,reason)
    VALUES (?,(SELECT id FROM features WHERE code='branches'),1,3,'Acuerdo comercial')`,
    )
    .run(a.tenantId);
  assert.equal((await entitlement(db, a.tenantId, 'branches')).limit, 3);
  await assert.doesNotReject(async () => await assertEntitlement(db, a.tenantId, 'branches', 1));
  await db.close();
});

test('pago manual es idempotente, genera factura y reactiva sin perder datos', async () => {
  const { db, a } = await fixture();
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('keep-me', a.tenantId, a.branchId, 'Dato conservado', now());
  await setTenantStatus(db, a.tenantId, 'SUSPENDED', 'user-platform-admin', 'mora');
  const input = {
    tenantId: a.tenantId,
    amount: 149000,
    method: 'TRANSFER',
    reference: 'BANK-UNIQUE-1',
  };
  const first = await recordManualPayment(db, input, 'user-platform-admin');
  const second = await recordManualPayment(db, input, 'user-platform-admin');
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) n FROM saas_payments WHERE tenant_id=?').get(a.tenantId)).n,
    1,
  );
  assert.equal(
    (await db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId)).status,
    'ACTIVE',
  );
  assert.equal(
    (await db.prepare('SELECT status FROM saas_invoices WHERE id=?').get(first.invoiceId)).status,
    'PAID',
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) n FROM customers WHERE id='keep-me'").get()).n,
    1,
  );
  await db.close();
});

test('cobranza SaaS conserva saldo parcial y reactiva únicamente al cancelar la deuda', async () => {
  const { db, a } = await fixture(),
    due = new Date(Date.now() - 2 * 86400000).toISOString();
  await db
    .prepare("UPDATE subscriptions SET next_charge_at=?,status='ACTIVE' WHERE tenant_id=?")
    .run(due, a.tenantId);
  await db.prepare("UPDATE tenants SET status='ACTIVE' WHERE id=?").run(a.tenantId);
  await refreshSubscriptionStates(db, new Date());
  const invoice = await db.prepare('SELECT * FROM saas_invoices WHERE tenant_id=?').get(a.tenantId);
  assert.equal(invoice.amount, 149000);
  const first = await recordManualPayment(
    db,
    { tenantId: a.tenantId, amount: 50000, method: 'TRANSFER', reference: 'PARTIAL-1' },
    'user-platform-admin',
  );
  assert.equal(first.balance, 99000);
  assert.equal(first.reactivated, false);
  assert.equal(
    (await db.prepare('SELECT status FROM saas_invoices WHERE id=?').get(invoice.id)).status,
    'PARTIAL',
  );
  assert.notEqual(
    (await db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId)).status,
    'ACTIVE',
  );
  assert.equal((await billingRows(db)).find((row) => row.id === a.tenantId).debt, 99000);
  const second = await recordManualPayment(
    db,
    { tenantId: a.tenantId, amount: 99000, method: 'TRANSFER', reference: 'PARTIAL-2' },
    'user-platform-admin',
  );
  assert.equal(second.balance, 0);
  assert.equal(second.reactivated, true);
  assert.equal(
    (await db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId)).status,
    'ACTIVE',
  );
  await db.close();
});

test('primer pago parcial factura el precio del plan y no reactiva anticipadamente', async () => {
  const { db, a } = await fixture();
  await setTenantStatus(db, a.tenantId, 'SUSPENDED', 'user-platform-admin', 'mora');
  const payment = await recordManualPayment(
    db,
    { tenantId: a.tenantId, amount: 1000, method: 'TRANSFER', reference: 'FIRST-PARTIAL' },
    'user-platform-admin',
  );
  const invoice = await db.prepare('SELECT * FROM saas_invoices WHERE id=?').get(payment.invoiceId);
  assert.equal(invoice.amount, 149000);
  assert.equal(invoice.balance, 148000);
  assert.equal(invoice.status, 'PARTIAL');
  assert.equal(payment.reactivated, false);
  assert.equal(
    (await db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId)).status,
    'SUSPENDED',
  );
  await db.close();
});

test('métricas SaaS no mezclan facturación de talleres', async () => {
  const { db, a } = await fixture();
  const before = (await platformMetrics(db)).revenue;
  await db
    .prepare(
      'INSERT INTO cash_movements (id,tenant_id,branch_id,type,category,amount,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(id(), a.tenantId, a.branchId, 'INCOME', 'Reparación', 99999999, now());
  assert.equal((await platformMetrics(db)).revenue, before);
  await db.close();
});

test('permisos y suspensión impiden mutaciones sin borrar información', async () => {
  const { db, a, context } = await fixture();
  const technician = { permissions: ['orders.view', 'orders.update'] };
  assert.equal(can(technician, 'orders.view'), true);
  assert.equal(can(technician, 'employees.manage'), false);
  await setTenantStatus(db, a.tenantId, 'SUSPENDED', 'user-platform-admin', 'mora');
  context.tenant = await db.prepare('SELECT * FROM tenants WHERE id=?').get(a.tenantId);
  assert.throws(() => assertTenantWritable(context), /modo consulta|suscripción/);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) n FROM branches WHERE tenant_id=?').get(a.tenantId)).n,
    1,
  );
  await db.close();
});

test('roles sensibles aplican mínimo privilegio y protegen al propietario', async () => {
  const { db, a, context } = await fixture();
  const ownerRole = await db
    .prepare("SELECT id FROM roles WHERE tenant_id=? AND code='OWNER'")
    .get(a.tenantId);
  await assert.rejects(
    async () =>
      await createEmployee(db, context, {
        name: 'Segundo dueño',
        email: 'owner2@test.local',
        password: 'Strong123!',
        branchId: a.branchId,
        roleId: ownerRole.id,
      }),
    /propietario no puede asignarse/,
  );
  assert.equal(
    can({ permissions: ['documents.upload', 'documents.view'] }, 'documents.delete'),
    false,
  );
  assert.equal(can({ permissions: ['documents.manage'] }, 'documents.delete'), true);
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) n FROM memberships WHERE tenant_id=? AND user_id<>?')
        .get(a.tenantId, a.userId)
    ).n,
    0,
  );
  await db.close();
});
