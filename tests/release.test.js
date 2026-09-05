import test from 'node:test';
import { archiveCatalog, restoreCatalog, updateCatalog } from '../src/services/catalog.js';
import { catalogEditPage } from '../src/pages/catalog.js';
import { safeUploadName } from '../src/security.js';
import { layout, money } from '../src/ui.js';
import { pagedRows } from '../src/pagination.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase } from './helpers/postgres.js';
import { provisionWorkshop, createEmployee } from '../src/domain.js';
import { createSession, readSession } from '../src/auth.js';
import { resolveContext, can } from '../src/tenancy.js';
import { now, addMonths, csvCell } from '../src/utils.js';
import { roundMoney, moneyAmount } from '../src/money.js';
import * as ops from '../src/services/workshop-operations.js';
import {
  reviseEstimate,
  removeEstimateItem,
  requestRestock,
  returnUnusedPart,
  warrantyClaim,
  resolveWarrantyClaim,
} from '../src/services/operational-closure.js';
import { assertTransition } from '../src/workflow.js';
import { printableOrder } from '../src/pages/print-documents.js';
import { reserveStock, adjustStock, transferStock } from '../src/services/inventory.js';
import { globalSearchPage, reportsPage, reportPeriod } from '../src/pages/workshop-operations.js';
import { customerDetailPage, vehicleDetailPage } from '../src/pages/customer-360.js';
import {
  queueNotification,
  markNotificationRead,
  notificationsForContext,
} from '../src/notifications.js';
import { processNotificationQueue } from '../src/notification-delivery.js';
import { config, productionIssues } from '../src/config.js';
import {
  platformMetrics,
  refreshSubscriptionStates,
  recordManualPayment,
  setTenantStatus,
} from '../src/billing.js';
import { localDateTime, calendarDate, startOfLocalDate, paymentTimestamp } from '../src/time.js';
import { configureWorkshop, updateRole, toggleEmployee } from '../src/services/organization.js';
import {
  reverseCustomerPayment,
  reverseSupplierPayment,
} from '../src/services/payment-reversals.js';
import { orderDetailPage, purchasesPage } from '../src/pages/workshop-operations.js';
import { financialIntegrityIssues } from '../src/services/financial-integrity.js';

async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, {
    superadminEmail: 'root@example.test',
    superadminPassword: 'SafeTestPassword123!',
  });
  const tenant = await provisionWorkshop(db, {
    ownerName: 'Propietario',
    workshopName: 'Taller de pruebas',
    email: 'owner@example.test',
    password: 'SafeTestPassword123!',
    planId: 'plan-pro',
  });
  const session = await readSession(db, (await createSession(db, tenant.userId)).id),
    context = await resolveContext(db, session);
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('customer', tenant.tenantId, tenant.branchId, 'Cliente visible', now());
  await db
    .prepare(
      'INSERT INTO vehicles (id,tenant_id,customer_id,plate,odometer,created_at) VALUES (?,?,?,?,?,?)',
    )
    .run('vehicle', tenant.tenantId, 'customer', 'QA100', 100, now());
  await db
    .prepare(
      'INSERT INTO inventory_items (id,tenant_id,branch_id,name,quantity,cost,sale_price,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run('part', tenant.tenantId, tenant.branchId, 'Repuesto privado', 5, 30000, 90000, now());
  await db
    .prepare('INSERT INTO suppliers (id,tenant_id,name,created_at) VALUES (?,?,?,?)')
    .run('supplier', tenant.tenantId, 'Proveedor', now());
  return { db, tenant, context, session };
}
async function estimate(db, context) {
  const { orderId } = await ops.receiveVehicle(db, context, {
    branchId: context.membership.branch_id,
    customerId: 'customer',
    vehicleId: 'vehicle',
    complaint: 'Ruido',
    odometer: 100,
    fuelLevel: 50,
  });
  await ops.completeInspection(db, context, orderId, {
    findings: 'Revisar motor',
    checklist: 'fluidos',
  });
  await ops.completeDiagnosis(db, context, orderId, { summary: 'Cambiar repuesto' });
  await ops.addEstimateItem(db, context, orderId, {
    itemType: 'PART',
    inventoryItemId: 'part',
    description: 'Repuesto privado',
    quantity: 1,
    unitPrice: 90000,
    unitCost: 30000,
  });
  await ops.addEstimateItem(db, context, orderId, {
    itemType: 'LABOR',
    description: 'Cambio',
    quantity: 1,
    unitPrice: 100000,
    unitCost: 20000,
  });
  return orderId;
}
async function authorized(db, context) {
  const order = await estimate(db, context);
  await ops.sendEstimate(db, context, order);
  await ops.approveEstimate(db, context, order, { approvedBy: 'Cliente visible' });
  return order;
}

async function readyInvoice(db, context, tenant, key) {
  const orderId = await authorized(db, context);
  const assignment = await ops.assignTechnician(db, context, orderId, {
    technicianId: tenant.userId,
    description: 'Reparación',
  });
  await ops.updateAssignment(db, context, assignment, 'START');
  await ops.consumePart(db, context, orderId, {
    inventoryItemId: 'part',
    quantity: 1,
    idempotencyKey: key + '-part',
  });
  await ops.updateAssignment(db, context, assignment, 'COMPLETE');
  await ops.sendToQuality(db, context, orderId);
  await ops.recordQualityCheck(db, context, orderId, { result: 'PASSED' });
  return { orderId, ...(await ops.invoiceOrder(db, context, orderId, { idempotencyKey: key })) };
}

test('revertir cobros conserva historial, reabre deuda, compensa caja y respeta una entrega realizada', async () => {
  const { db, tenant, context, session } = await fixture();
  try {
    const invoice = await readyInvoice(db, context, tenant, 'reverse-invoice');
    const first = await ops.recordCustomerPayment(db, context, invoice.invoiceId, {
      amount: 109000,
      method: 'TRANSFER',
      idempotencyKey: 'first',
    });
    const second = await ops.recordCustomerPayment(db, context, invoice.invoiceId, {
      amount: 100000,
      method: 'CASH',
      idempotencyKey: 'second',
    });
    const input = {
      reason: 'Transferencia registrada en el comprobante equivocado',
      idempotencyKey: 'correction',
    };
    await assert.rejects(
      async () =>
        await reverseCustomerPayment(
          db,
          { ...context, permissions: ['billing.collect', 'billing.view'] },
          first.paymentId,
          input,
        ),
      { status: 403 },
    );
    const neighbor = await provisionWorkshop(db, {
      ownerName: 'Vecino',
      workshopName: 'Otro taller',
      email: 'other@example.test',
      password: 'SafeTestPassword123!',
      planId: 'plan-pro',
    });
    const otherContext = await resolveContext(
      db,
      await readSession(db, (await createSession(db, neighbor.userId)).id),
    );
    await assert.rejects(
      async () => await reverseCustomerPayment(db, otherContext, first.paymentId, input),
      {
        status: 404,
      },
    );
    await assert.rejects(
      async () =>
        await db
          .prepare(
            'INSERT INTO payment_reversals(id,tenant_id,branch_id,customer_payment_id,amount,reason,created_by,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            'forged',
            neighbor.tenantId,
            neighbor.branchId,
            first.paymentId,
            109000,
            'Ajeno',
            neighbor.userId,
            now(),
            'forged',
          ),
    );
    // A failure in the compensating cash entry must roll back every preceding write.
    await db.exec(
      "CREATE FUNCTION fail_reversal_cash_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'test_cash_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_reversal_cash BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION fail_reversal_cash_fn();",
    );
    await assert.rejects(
      async () => await reverseCustomerPayment(db, context, first.paymentId, input),
      /test_cash_failure/,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM payment_reversals').get()).n, 0);
    assert.equal(
      (await db.prepare('SELECT balance FROM workshop_invoices WHERE id=?').get(invoice.invoiceId))
        .balance,
      0,
    );
    await db.exec(
      'DROP TRIGGER fail_reversal_cash ON cash_movements; DROP FUNCTION fail_reversal_cash_fn();',
    );
    const result = await reverseCustomerPayment(db, context, first.paymentId, input);
    assert.equal(result.balance, 109000);
    assert.equal(
      (await reverseCustomerPayment(db, context, first.paymentId, input)).duplicate,
      true,
    );
    await assert.rejects(
      async () =>
        await reverseCustomerPayment(db, context, first.paymentId, {
          ...input,
          reason: 'Otro motivo',
        }),
      { status: 409 },
    );
    await assert.rejects(
      async () =>
        await reverseCustomerPayment(db, context, first.paymentId, {
          ...input,
          idempotencyKey: 'retry',
        }),
      { status: 409 },
    );
    assert.equal(
      (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(invoice.orderId)).status,
      'PARTIALLY_PAID',
    );
    assert.throws(() => assertTransition('PAID', 'INVOICED'), { status: 409 });
    await assert.rejects(
      async () => await ops.deliverVehicle(db, context, invoice.orderId, { receivedBy: 'Cliente' }),
      { status: 409 },
    );
    await assert.rejects(
      async () =>
        await db
          .prepare('UPDATE payment_reversals SET reason=? WHERE id=?')
          .run('Alterado', result.reversalId),
    );
    await assert.rejects(
      async () =>
        await db.prepare('DELETE FROM payment_reversals WHERE id=?').run(result.reversalId),
    );
    await assert.rejects(
      async () =>
        await db.prepare('UPDATE workshop_payments SET amount=1 WHERE id=?').run(first.paymentId),
    );
    const req = { context, session, url: '/workshop/orders/' + invoice.orderId };
    assert.match(await orderDetailPage(db, req, invoice.orderId), /Revertido/);
    assert.match(await orderDetailPage(db, req, invoice.orderId), /Transferencia registrada/);
    assert.doesNotMatch(
      await orderDetailPage(
        db,
        { ...req, context: { ...context, permissions: ['orders.view', 'billing.view'] } },
        invoice.orderId,
      ),
      /\/payments\/[^\"]+\/reverse/,
    );
    await reverseCustomerPayment(db, context, second.paymentId, {
      reason: 'Cobro duplicado',
      idempotencyKey: 'second-correction',
    });
    assert.equal(
      (await db.prepare('SELECT balance FROM workshop_invoices WHERE id=?').get(invoice.invoiceId))
        .balance,
      209000,
    );
    assert.equal(
      (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(invoice.orderId)).status,
      'INVOICED',
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT SUM(CASE WHEN type='INCOME' THEN amount ELSE -amount END) net FROM cash_movements",
          )
          .get()
      ).net,
      0,
    );
    const report = await reportsPage(db, req, new URL('http://local'));
    assert.ok(report.includes('Cobros del período'));
    assert.equal(
      (await db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get('part')).quantity,
      4,
    );
    await ops.voidInvoice(db, context, invoice.invoiceId, {
      reason: 'Reemisión tras corregir registros erróneos',
    });
    const reissued = await ops.invoiceOrder(db, context, invoice.orderId, {
      idempotencyKey: 'corrected-invoice',
    });
    const finalPayment = await ops.recordCustomerPayment(db, context, reissued.invoiceId, {
      amount: 209000,
      method: 'CASH',
      idempotencyKey: 'paid-final',
    });
    await ops.deliverVehicle(db, context, invoice.orderId, {
      receivedBy: 'Cliente visible',
      warrantyDays: 90,
    });
    await reverseCustomerPayment(db, context, finalPayment.paymentId, {
      reason: 'El registro de efectivo era incorrecto',
      idempotencyKey: 'after-delivery',
    });
    assert.equal(
      (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(invoice.orderId)).status,
      'DELIVERED',
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM warranties').get()).n, 1);
    assert.match(await orderDetailPage(db, req, invoice.orderId), /Registrar cobro/);
    await ops.recordCustomerPayment(db, context, reissued.invoiceId, {
      amount: 100000,
      method: 'TRANSFER',
      idempotencyKey: 'collected-again-1',
    });
    await ops.recordCustomerPayment(db, context, reissued.invoiceId, {
      amount: 109000,
      method: 'TRANSFER',
      idempotencyKey: 'collected-again-2',
    });
    assert.equal(
      (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(invoice.orderId)).status,
      'DELIVERED',
    );
    assert.equal(
      (await db.prepare('SELECT balance FROM workshop_invoices WHERE id=?').get(reissued.invoiceId))
        .balance,
      0,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM workshop_payments').get()).n, 5);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM payment_reversals').get()).n, 3);
    assert.deepEqual(await financialIntegrityIssues(db), []);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT SUM(CASE WHEN type='INCOME' THEN amount ELSE -amount END) net FROM cash_movements",
          )
          .get()
      ).net,
      209000,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CUSTOMER_PAYMENT_REVERSED'")
          .get()
      ).n,
      3,
    );
  } finally {
    await db.close();
  }
});

test('corrección de pago a proveedor es exacta, autorizada y no revierte una recepción física', async () => {
  const { db, tenant, context, session } = await fixture();
  try {
    await db
      .prepare("UPDATE tenant_settings SET currency='USD',tax_rate=0 WHERE tenant_id=?")
      .run(tenant.tenantId);
    const request = await requestRestock(db, context, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'restock-reverse',
    });
    const purchase = await ops.createPurchaseOrder(db, context, request, {
      supplierId: 'supplier',
      unitCost: 0.3,
    });
    const receipt = await ops.receivePurchaseOrder(db, context, purchase, {
      idempotencyKey: 'receive-reverse',
    });
    const first = await ops.paySupplier(db, context, receipt.payableId, {
      amount: 0.1,
      method: 'TRANSFER',
      idempotencyKey: 'first',
    });
    const second = await ops.paySupplier(db, context, receipt.payableId, {
      amount: 0.2,
      method: 'CASH',
      idempotencyKey: 'second',
    });
    const input = {
      reason: 'Pago registrado antes de confirmar el banco',
      idempotencyKey: 'reverse-supplier',
    };
    await assert.rejects(
      async () =>
        await reverseSupplierPayment(
          db,
          { ...context, permissions: ['purchases.pay'] },
          first.paymentId,
          input,
        ),
      { status: 403 },
    );
    await assert.rejects(
      async () => await reverseSupplierPayment(db, context, 'foreign-payment', input),
      {
        status: 404,
      },
    );
    await assert.rejects(
      async () =>
        await reverseSupplierPayment(db, context, first.paymentId, { ...input, reason: '' }),
    );
    assert.equal((await reverseSupplierPayment(db, context, first.paymentId, input)).balance, 0.1);
    assert.equal(
      (await reverseSupplierPayment(db, context, first.paymentId, input)).duplicate,
      true,
    );
    await assert.rejects(
      async () => await reverseSupplierPayment(db, context, second.paymentId, input),
      {
        status: 409,
      },
    );
    assert.equal(
      (
        await db
          .prepare('SELECT paid_amount FROM accounts_payable WHERE id=?')
          .get(receipt.payableId)
      ).paid_amount,
      0.2,
    );
    await reverseSupplierPayment(db, context, second.paymentId, {
      reason: 'Registro duplicado',
      idempotencyKey: 'second-reverse',
    });
    assert.equal(
      (await db.prepare('SELECT balance FROM accounts_payable WHERE id=?').get(receipt.payableId))
        .balance,
      0.3,
    );
    assert.equal(
      (await db.prepare('SELECT status FROM accounts_payable WHERE id=?').get(receipt.payableId))
        .status,
      'PENDING',
    );
    assert.equal(
      (await db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(purchase)).status,
      'RECEIVED',
    );
    assert.equal(
      (await db.prepare('SELECT quantity FROM inventory_items WHERE id=?').get('part')).quantity,
      6,
    );
    assert.equal(
      roundMoney(
        (
          await db
            .prepare(
              "SELECT SUM(CASE WHEN type='INCOME' THEN amount ELSE -amount END) net FROM cash_movements",
            )
            .get()
        ).net,
        'USD',
      ),
      0,
    );
    const page = await purchasesPage(db, { context, session, url: '/workshop/purchases' });
    assert.match(page, /Revertido/);
    assert.match(page, /Historial de pagos a proveedores/);
    assert.match(page, /Pago registrado antes/);
    await ops.paySupplier(db, context, receipt.payableId, {
      amount: 0.3,
      method: 'TRANSFER',
      idempotencyKey: 'real-confirmed-payment',
    });
    assert.equal(
      (await db.prepare('SELECT balance FROM accounts_payable WHERE id=?').get(receipt.payableId))
        .balance,
      0,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_payments').get()).n, 3);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM payment_reversals').get()).n, 2);
    assert.deepEqual(await financialIntegrityIssues(db), []);
  } finally {
    await db.close();
  }
});

test('conciliación detecta saldos y caja incompletos sin modificar datos', async () => {
  const { db, tenant, context } = await fixture();
  try {
    const invoice = await readyInvoice(db, context, tenant, 'integrity-invoice');
    const payment = await ops.recordCustomerPayment(db, context, invoice.invoiceId, {
      amount: 100000,
      method: 'CASH',
      idempotencyKey: 'integrity-payment',
    });
    assert.deepEqual(await financialIntegrityIssues(db), []);
    await db.prepare('UPDATE workshop_invoices SET balance=10 WHERE id=?').run(invoice.invoiceId);
    assert.match((await financialIntegrityIssues(db)).join(' '), /Comprobantes de taller/);
    assert.equal(
      (await db.prepare('SELECT balance FROM workshop_invoices WHERE id=?').get(invoice.invoiceId))
        .balance,
      10,
    );
    await db
      .prepare('UPDATE workshop_invoices SET balance=109000 WHERE id=?')
      .run(invoice.invoiceId);
    await db
      .prepare('DELETE FROM cash_movements WHERE workshop_payment_id=?')
      .run(payment.paymentId);
    assert.match((await financialIntegrityIssues(db)).join(' '), /Cobros: 1 movimiento/);
    await assert.rejects(
      async () =>
        await reverseCustomerPayment(db, context, payment.paymentId, {
          reason: 'No debe corregir datos inconciliables',
          idempotencyKey: 'no-ledger',
        }),
      /conciliación/,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM payment_reversals').get()).n, 0);
    await assert.rejects(
      async () =>
        await db
          .prepare(
            "INSERT INTO cash_movements(id,tenant_id,branch_id,type,category,amount,created_by,created_at,workshop_payment_id) VALUES (?,?,?,'INCOME','CUSTOMER_PAYMENT',1,?,?,?)",
          )
          .run(
            'wrong-ledger',
            tenant.tenantId,
            tenant.branchId,
            tenant.userId,
            now(),
            payment.paymentId,
          ),
      /invalid_payment_cash/,
    );
    const request = await requestRestock(db, context, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'free-supply',
    });
    const purchase = await ops.createPurchaseOrder(db, context, request, {
      supplierId: 'supplier',
      unitCost: 0,
    });
    const receipt = await ops.receivePurchaseOrder(db, context, purchase, {
      idempotencyKey: 'free-receipt',
    });
    assert.equal(
      (await db.prepare('SELECT status FROM accounts_payable WHERE id=?').get(receipt.payableId))
        .status,
      'PAID',
    );
    assert.doesNotMatch((await financialIntegrityIssues(db)).join(' '), /Cuentas por pagar/);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM purchase_payments').get()).n, 0);
  } finally {
    await db.close();
  }
});

test('dinero respeta decimales de moneda y fechas de renovación no saltan meses', () => {
  assert.equal(roundMoney(10.005, 'USD'), 10.01);
  assert.equal(roundMoney(100.5, 'PYG'), 101);
  assert.ok(money(12.345, 'BHD').includes('12,345'));
  assert.ok(!money(12.5, 'JPY').includes(','));
  assert.ok(money(12.34, 'USD').includes('12,34'));
  assert.throws(() => moneyAmount('100.25', 'PYG', 'Importe'));
  assert.equal(addMonths('2026-01-31T12:00:00.000Z', 1), '2026-02-28T12:00:00.000Z');
  assert.equal(localDateTime('2026-09-04T10:30', 'America/Asuncion'), '2026-09-04T13:30:00.000Z');
  assert.throws(() => reportPeriod(new URL('http://local?from=2026-02-30')));
  const current = '2026-09-05T12:00:00.000Z';
  assert.equal(paymentTimestamp('2026-09-04', { current }), '2026-09-04T03:00:00.000Z');
  assert.equal(
    paymentTimestamp('2026-09-04', { current, timezone: 'Asia/Tokyo' }),
    '2026-09-03T15:00:00.000Z',
  );
  assert.equal(
    paymentTimestamp('2026-09-04T17:23:00.000Z', { current }),
    '2026-09-04T17:23:00.000Z',
  );
  assert.throws(() => paymentTimestamp('2026-09-06', { current }), /futura/);
  assert.throws(() => paymentTimestamp('2026-02-30', { current }), /fecha válida/);
});

test('pago tras suspensión prolongada reactiva un período utilizable, no elimina datos ni ignora bloqueos', async () => {
  const { db, tenant } = await fixture();
  try {
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    await db
      .prepare('UPDATE subscriptions SET next_charge_at=? WHERE tenant_id=?')
      .run(old, tenant.tenantId);
    await refreshSubscriptionStates(db);
    assert.equal(
      (await db.prepare('SELECT status FROM tenants WHERE id=?').get(tenant.tenantId)).status,
      'SUSPENDED',
    );
    const actor = (await db.prepare("SELECT id FROM users WHERE kind='PLATFORM'").get()).id;
    await recordManualPayment(
      db,
      { tenantId: tenant.tenantId, amount: 299000, reference: 'bank-1' },
      actor,
    );
    await refreshSubscriptionStates(db);
    assert.equal(
      (await db.prepare('SELECT status FROM tenants WHERE id=?').get(tenant.tenantId)).status,
      'ACTIVE',
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM customers').get()).n, 1);
    await setTenantStatus(db, tenant.tenantId, 'BLOCKED', actor, 'Revisión administrativa');
    await recordManualPayment(
      db,
      { tenantId: tenant.tenantId, amount: 299000, reference: 'bank-2' },
      actor,
    );
    assert.equal(
      (await db.prepare('SELECT status FROM tenants WHERE id=?').get(tenant.tenantId)).status,
      'BLOCKED',
    );
  } finally {
    await db.close();
  }
});
test('presupuesto versionado conserva rechazo y permite corregir el borrador', async () => {
  const { db, context } = await fixture();
  try {
    const order = await estimate(db, context);
    await ops.sendEstimate(db, context, order);
    const revised = await reviseEstimate(db, context, order, {
      reason: 'Cambio solicitado por el cliente',
    });
    assert.equal(
      (await db.prepare('SELECT version FROM estimates WHERE id=?').get(revised)).version,
      2,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM estimates WHERE status='REJECTED'").get()).n,
      1,
    );
    const line = await db
      .prepare("SELECT id FROM estimate_items WHERE estimate_id=? AND item_type='PART'")
      .get(revised);
    await removeEstimateItem(db, context, line.id);
    assert.equal(
      (await db.prepare('SELECT total FROM estimates WHERE id=?').get(revised)).total,
      110000,
    );
    await ops.sendEstimate(db, context, order);
    await ops.approveEstimate(db, context, order, { approvedBy: 'Cliente' });
    await assert.rejects(
      async () => await reviseEstimate(db, context, order, { reason: 'Cambiar autorizado' }),
    );
  } finally {
    await db.close();
  }
});
test('reservas limitan otras operaciones y consumo/devolución no duplican stock', async () => {
  const { db, context, tenant } = await fixture();
  try {
    const order = await authorized(db, context);
    await reserveStock(db, context, order, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'reserve',
    });
    await assert.rejects(
      async () =>
        await reserveStock(db, context, order, {
          inventoryItemId: 'part',
          quantity: 2,
          idempotencyKey: 'reserve',
        }),
      /referencia/,
    );
    await assert.rejects(
      async () =>
        await reserveStock(db, context, order, {
          inventoryItemId: 'part',
          quantity: 1,
          idempotencyKey: 'extra',
        }),
      /autorizada/,
    );
    await assert.rejects(
      async () =>
        await adjustStock(db, context, 'part', {
          quantity: 0,
          reason: 'conteo',
          idempotencyKey: 'adjust',
        }),
      /reservado/,
    );
    await ops.consumePart(db, context, order, {
      inventoryItemId: 'part',
      quantity: 1,
      unitPrice: 1,
      idempotencyKey: 'use',
    });
    const part = await db.prepare('SELECT * FROM active_work_order_parts').get();
    assert.equal(part.total, 90000);
    assert.equal(
      (await db.prepare('SELECT status FROM stock_reservations').get()).status,
      'CONSUMED',
    );
    await returnUnusedPart(db, context, part.id, {
      reason: 'No instalado',
      idempotencyKey: 'return',
    });
    await returnUnusedPart(db, context, part.id, {
      reason: 'Repetición',
      idempotencyKey: 'return',
    });
    assert.equal(
      (await db.prepare("SELECT quantity FROM inventory_items WHERE id='part'").get()).quantity,
      5,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM stock_returns').get()).n, 1);
    await ops.consumePart(db, context, order, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'use-again',
    });
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM active_work_order_parts').get()).n, 1);
    await db
      .prepare('INSERT INTO branches (id,tenant_id,name,created_at) VALUES (?,?,?,?)')
      .run('branch2', tenant.tenantId, 'Segunda', now());
    await db
      .prepare(
        'INSERT INTO inventory_items (id,tenant_id,branch_id,name,quantity,cost,created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run('part2', tenant.tenantId, 'branch2', 'Repuesto', 0, 0, now());
    await transferStock(db, context, 'part', {
      destinationItemId: 'part2',
      quantity: 2,
      reason: 'Reposición',
      idempotencyKey: 'transfer',
    });
    await assert.rejects(
      async () =>
        await transferStock(db, context, 'part', {
          destinationItemId: 'part2',
          quantity: 1,
          reason: 'Reposición',
          idempotencyKey: 'transfer',
        }),
      /referencia/,
    );
    await adjustStock(db, context, 'part2', {
      quantity: 3,
      reason: 'Conteo',
      idempotencyKey: 'adjust2',
    });
    await adjustStock(db, context, 'part2', {
      quantity: 3,
      reason: 'Conteo',
      idempotencyKey: 'adjust2',
    });
    await assert.rejects(
      async () =>
        await adjustStock(db, context, 'part2', {
          quantity: 4,
          reason: 'Conteo',
          idempotencyKey: 'adjust2',
        }),
      /referencia/,
    );
    await assert.rejects(
      async () => await archiveCatalog(db, context, 'branches', 'branch2'),
      /existencias/,
    );
    assert.equal(
      (await db.prepare("SELECT quantity FROM inventory_items WHERE id='part2'").get()).quantity,
      3,
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=? AND c.contype='f' AND NOT c.convalidated",
          )
          .get(db.schema)
      ).n,
      0,
    );
  } finally {
    await db.close();
  }
});
test('reposición independiente de órdenes, costo promedio y pagos parciales exactos', async () => {
  const { db, context } = await fixture();
  try {
    const request = await requestRestock(db, context, {
      inventoryItemId: 'part',
      quantity: 5,
      idempotencyKey: 'restock',
    });
    assert.equal(
      await requestRestock(db, context, {
        inventoryItemId: 'part',
        quantity: 5,
        idempotencyKey: 'restock',
      }),
      request,
    );
    const po = await ops.createPurchaseOrder(db, context, request, {
      supplierId: 'supplier',
      unitCost: 50000,
    });
    const receipt = await ops.receivePurchaseOrder(db, context, po, { idempotencyKey: 'receive%' });
    assert.equal(
      (await db.prepare("SELECT cost FROM inventory_items WHERE id='part'").get()).cost,
      40000,
    );
    await ops.paySupplier(db, context, receipt.payableId, {
      amount: 100000,
      method: 'CASH',
      idempotencyKey: 'p1',
    });
    await ops.paySupplier(db, context, receipt.payableId, {
      amount: 100000,
      method: 'CASH',
      idempotencyKey: 'p2',
    });
    assert.equal((await db.prepare('SELECT balance FROM accounts_payable').get()).balance, 75000);
    await assert.rejects(
      async () =>
        await ops.paySupplier(
          db,
          { ...context, permissions: ['purchases.manage'] },
          receipt.payableId,
          {
            amount: 1,
            method: 'CASH',
            idempotencyKey: 'denied',
          },
        ),
      /permisos/,
    );
  } finally {
    await db.close();
  }
});
test('reportes, búsqueda y cliente 360 no revelan finanzas a roles operativos', async () => {
  const { db, context, session } = await fixture();
  try {
    const order = await authorized(db, context);
    const restricted = {
        ...context,
        permissions: ['customers.view', 'search.use', 'reports.view'],
      },
      req = { context: restricted, session };
    assert.equal(can({ ...context, permissions: ['purchases.manage'] }, 'purchases.pay'), false);
    assert.ok(
      layout({
        title: 'Caja',
        body: '',
        area: 'workshop',
        context: { ...context, permissions: ['purchases.pay'] },
      }).includes('href="/workshop/purchases"'),
    );
    const search = await globalSearchPage(db, req, 'Repuesto');
    assert.ok(!search.includes('Repuesto privado'));
    const customer = await customerDetailPage(db, req, 'customer');
    assert.ok(!customer.includes('Facturas y pagos'));
    assert.ok(!customer.includes('Facturado'));
    assert.ok(!customer.includes('/workshop/orders/' + order));
    assert.ok(!customer.includes('QA100'));
    assert.ok(!customer.includes('Órdenes e historial'));
    const vehicle = await vehicleDetailPage(
      db,
      { context: { ...context, permissions: ['vehicles.view'] }, session },
      'vehicle',
    );
    assert.ok(!vehicle.includes('Cliente visible'));
    assert.ok(!vehicle.includes('/workshop/orders/' + order));
    const report = await reportsPage(db, req, new URL('http://local'));
    assert.ok(!report.includes('Margen bruto'));
    assert.ok(!report.includes('Ventas netas facturadas'));
    await assert.rejects(
      async () => await ops.invoiceOrder(db, restricted, order, { idempotencyKey: 'denied' }),
      /permisos/,
    );
    assert.equal((await platformMetrics(db)).mrr, 0, 'El trial no es ingreso recurrente');
    await assert.rejects(
      async () => await configureWorkshop(db, context, { currency: 'USD', taxRate: 10 }),
      /cambiar la moneda/,
    );
  } finally {
    await db.close();
  }
});

test('correo usa SMTP real, la cola reclama una sola entrega y protege resets', async () => {
  const { db, tenant, context } = await fixture();
  let received = 0;
  const sockets = new Set(),
    smtp = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.write('220 localhost ESMTP\r\n');
      let buffer = '',
        data = false;
      socket.on('data', (bytes) => {
        buffer += bytes;
        let end;
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (data) {
            if (line === '.') {
              data = false;
              received++;
              socket.write('250 accepted\r\n');
            }
            continue;
          }
          if (/^EHLO|^HELO/.test(line)) socket.write('250 localhost\r\n');
          else if (line === 'DATA') {
            data = true;
            socket.write('354 send data\r\n');
          } else if (line === 'QUIT') {
            socket.end('221 bye\r\n');
          } else socket.write('250 ok\r\n');
        }
      });
    });
  await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  try {
    const message = await queueNotification(db, {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      channel: 'EMAIL',
      eventType: 'PASSWORD_RESET',
      title: 'Recuperar acceso',
      message: 'Restablece tu acceso',
      payload: { to: 'owner@example.test', resetUrl: 'http://localhost/reset?token=one-time' },
      idempotencyKey: 'smtp-reset',
    });
    assert.equal((await markNotificationRead(db, message.id, context)).changes, 0);
    const settings = {
      ...config,
      emailTransport: 'smtp',
      smtpHost: '127.0.0.1',
      smtpPort: smtp.address().port,
      smtpUser: '',
      smtpSecure: false,
      smtpRequireTls: false,
      emailFrom: 'sender@example.test',
    };
    await Promise.all([
      processNotificationQueue(db, settings),
      processNotificationQueue(db, settings),
    ]);
    assert.equal(received, 1);
    const row = await db.prepare('SELECT * FROM notifications WHERE id=?').get(message.id);
    assert.equal(row.status, 'SENT');
    assert.equal(row.payload, '{}');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => smtp.close(resolve));
    await db.close();
  }
});
test('producción rechaza configuración provisional sin revelar secretos', () => {
  const issues = productionIssues({
    ...config,
    seedDemo: true,
    superadminPassword: 'sensitive-value',
    emailTransport: 'disabled',
    appUrl: 'http://localhost:3000',
    companyName: '',
    commercialConfigApproved: false,
  });
  assert.ok(issues.some((x) => x.includes('SEED_DEMO')));
  assert.ok(issues.some((x) => x.includes('EMAIL_TRANSPORT')));
  assert.ok(issues.some((x) => x.includes('COMMERCIAL_CONFIG_APPROVED')));
  assert.ok(!issues.join().includes('sensitive-value'));
});

test('catálogos paginados encuentran registros antiguos y respetan tenant y restauración', async () => {
  const { db, context, tenant } = await fixture();
  try {
    const insert = db.prepare(
      'INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)',
    );
    for (let i = 0; i < 120; i++)
      await insert.run(
        'customer-' + i,
        tenant.tenantId,
        tenant.branchId,
        'Nombre ' + String(i).padStart(3, '0'),
        now(),
      );
    const list = async (url) =>
      await pagedRows(
        db,
        { url },
        'SELECT * FROM customers WHERE tenant_id=? ORDER BY name',
        [tenant.tenantId],
        ['name'],
        { key: 'customers' },
      );
    assert.equal((await list('/workshop/customers')).length, 50);
    assert.equal((await list('/workshop/customers?customers_page=3')).length, 21);
    assert.equal(
      (await list('/workshop/customers?customers_q=Nombre%20119'))[0].id,
      'customer-119',
    );
    assert.equal((await list('/workshop/customers?customers_q=%25')).length, 0);
    await archiveCatalog(db, context, 'customers', 'customer');
    assert.equal(
      (await db.prepare("SELECT active FROM customers WHERE id='customer'").get()).active,
      0,
    );
    await restoreCatalog(db, context, 'customers', 'customer');
    assert.equal(
      (await db.prepare("SELECT active FROM customers WHERE id='customer'").get()).active,
      1,
    );
  } finally {
    await db.close();
  }
});
test('roles y bajas revocan sesiones y no permiten elevar permisos', async () => {
  const { db, context, tenant } = await fixture();
  try {
    const role = await db
      .prepare("SELECT * FROM roles WHERE tenant_id=? AND code='TECHNICIAN'")
      .get(tenant.tenantId);
    await createEmployee(db, context, {
      name: 'Técnico',
      email: 'tecnico@example.test',
      password: 'TemporalSegura123!',
      roleId: role.id,
      branchId: tenant.branchId,
    });
    const member = await db
      .prepare(
        "SELECT m.*,u.must_change_password FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.email='tecnico@example.test'",
      )
      .get(tenant.tenantId);
    assert.equal(member.must_change_password, 1);
    const session = await createSession(db, member.user_id);
    await assert.rejects(
      async () =>
        await updateRole(db, { ...context, permissions: ['employees.manage'] }, role.id, {
          name: 'Superior',
          'perm_billing.void': '1',
        }),
      /superiores|conceder/,
    );
    await updateRole(db, context, role.id, {
      name: 'Técnico personalizado',
      'perm_orders.view': '1',
      'perm_orders.execute': '1',
    });
    assert.equal(await readSession(db, session.id), null);
    const session2 = await createSession(db, member.user_id);
    await toggleEmployee(db, context, member.id);
    assert.equal(await readSession(db, session2.id), null);
    await assert.rejects(
      async () => await toggleEmployee(db, context, context.membership.id),
      /acceso/,
    );
  } finally {
    await db.close();
  }
});

test('métricas SaaS separan monedas y ARPU excluye trials', async () => {
  const { db, tenant } = await fixture();
  try {
    await recordManualPayment(
      db,
      { tenantId: tenant.tenantId, amount: 299000, reference: 'pyg' },
      'user-platform-admin',
    );
    const usd = await provisionWorkshop(db, {
      ownerName: 'USD',
      workshopName: 'USD',
      email: 'usd@example.test',
      password: 'SafeTestPassword123!',
      planId: 'plan-pro',
    });
    const trial = await provisionWorkshop(db, {
      ownerName: 'Trial',
      workshopName: 'Trial',
      email: 'trial@example.test',
      password: 'SafeTestPassword123!',
      planId: 'plan-pro',
    });
    await db
      .prepare("UPDATE subscriptions SET currency='USD',price=30 WHERE tenant_id=?")
      .run(usd.tenantId);
    await recordManualPayment(
      db,
      { tenantId: usd.tenantId, amount: 30, reference: 'usd' },
      'user-platform-admin',
    );
    const metrics = await platformMetrics(db);
    assert.equal(metrics.mrr, null);
    assert.equal(metrics.financials.length, 2);
    const pygRow = metrics.financials.find((r) => r.currency === 'PYG'),
      usdRow = metrics.financials.find((r) => r.currency === 'USD');
    assert.equal(pygRow.mrr, 299000);
    assert.equal(pygRow.arpu, 299000);
    assert.equal(pygRow.payingCustomers, 1);
    assert.equal(usdRow.mrr, 30);
    assert.equal(usdRow.revenue, 30);
    assert.equal(
      (await db.prepare('SELECT status FROM tenants WHERE id=?').get(trial.tenantId)).status,
      'TRIAL',
    );
  } finally {
    await db.close();
  }
});

test('edición y presupuestos protegen costos aunque se manipule el formulario', async () => {
  const { db, context, session } = await fixture();
  try {
    const restricted = {
      ...context,
      permissions: ['inventory.adjust', 'inventory.view', 'orders.estimate'],
    };
    const page = await catalogEditPage(db, { context: restricted, session }, 'inventory', 'part');
    assert.ok(!page.includes('name="cost"'));
    assert.ok(!page.includes('30000'));
    await updateCatalog(db, restricted, 'inventory', 'part', {
      name: 'Repuesto privado',
      minimum_stock: 1,
      sale_price: 91000,
    });
    assert.equal(
      (await db.prepare("SELECT cost FROM inventory_items WHERE id='part'").get()).cost,
      30000,
    );
    await assert.rejects(
      async () =>
        await updateCatalog(db, restricted, 'inventory', 'part', { name: 'Repuesto', cost: 1 }),
      /permisos/,
    );
    const order = await estimate(db, context);
    await assert.rejects(
      async () =>
        await ops.addEstimateItem(db, restricted, order, {
          itemType: 'LABOR',
          description: 'Trabajo',
          quantity: 1,
          unitPrice: 100,
          unitCost: 1,
        }),
      /permisos/,
    );
  } finally {
    await db.close();
  }
});

test('guardar configuración parcial conserva datos existentes y rechaza logos inseguros', async () => {
  const { db, context, tenant } = await fixture();
  try {
    await db
      .prepare(
        "UPDATE tenants SET city='Ciudad registrada',phone='12345',logo_url='https://assets.example.test/logo.png' WHERE id=?",
      )
      .run(tenant.tenantId);
    await db
      .prepare('UPDATE tenant_settings SET opening_hours=? WHERE tenant_id=?')
      .run('{"weekdays":"08:00-18:00"}', tenant.tenantId);
    await configureWorkshop(db, context, {
      currency: 'PYG',
      taxRate: 10,
      timezone: 'America/Asuncion',
    });
    const saved = await db.prepare('SELECT * FROM tenants WHERE id=?').get(tenant.tenantId);
    assert.equal(saved.city, 'Ciudad registrada');
    assert.equal(saved.phone, '12345');
    assert.equal(saved.logo_url, 'https://assets.example.test/logo.png');
    assert.equal(
      (
        await db
          .prepare('SELECT opening_hours FROM tenant_settings WHERE tenant_id=?')
          .get(tenant.tenantId)
      ).opening_hours,
      '{"weekdays":"08:00-18:00"}',
    );
    await assert.rejects(
      async () =>
        await configureWorkshop(db, context, {
          currency: 'PYG',
          taxRate: 10,
          logoUrl: 'javascript:alert(1)',
        }),
      /HTTPS/,
    );
  } finally {
    await db.close();
  }
});

test('exports y nombres de archivos neutralizan fórmulas y extensiones engañosas', () => {
  for (const text of ['=1+1', '\t=HYPERLINK("bad")', ' \r@SUM(1)', '\nmalicioso', '-2+3'])
    assert.ok(csvCell(text).startsWith('"\''));
  assert.equal(csvCell('Cliente normal'), '"Cliente normal"');
  assert.equal(csvCell('Texto "citado"'), '"Texto ""citado"""');
  assert.equal(safeUploadName('../../archivo.exe', 'application/pdf'), 'archivo.pdf');
  assert.equal(safeUploadName('C:\\fakepath\\foto.txt', 'image/png'), 'foto.png');
  assert.throws(() => safeUploadName('archivo', 'text/html'));
});

test('notificaciones aplican permisos y lectura individual sin fugas por referencias repetidas', async () => {
  const { db, tenant, context } = await fixture();
  try {
    const role = await db
      .prepare("SELECT id FROM roles WHERE tenant_id=? AND code='TECHNICIAN'")
      .get(tenant.tenantId);
    await createEmployee(db, context, {
      name: 'Técnico avisos',
      email: 'avisos@example.test',
      password: 'TemporaryAccess123!',
      roleId: role.id,
      branchId: tenant.branchId,
    });
    const user = await db.prepare("SELECT id FROM users WHERE email='avisos@example.test'").get();
    const technician = await resolveContext(
      db,
      await readSession(db, (await createSession(db, user.id)).id),
    );
    const operation = await queueNotification(db, {
      tenantId: tenant.tenantId,
      eventType: 'VEHICLE_READY',
      title: 'Vehículo listo',
      message: 'Aviso operativo',
      idempotencyKey: 'shared',
    });
    const payment = await queueNotification(db, {
      tenantId: tenant.tenantId,
      eventType: 'PAYMENT_RECEIVED',
      title: 'Cobro privado',
      message: 'Importe 987654321',
      idempotencyKey: 'money',
    });
    await queueNotification(db, {
      tenantId: tenant.tenantId,
      eventType: 'SUBSCRIPTION_DUE_SOON',
      title: 'Suscripción privada',
      message: 'Deuda comercial',
      idempotencyKey: 'subscription',
    });
    const assigned = await queueNotification(db, {
      tenantId: tenant.tenantId,
      userId: user.id,
      eventType: 'WORK_ASSIGNED',
      title: 'Trabajo personal',
      message: 'Solo asignado',
      idempotencyKey: 'assigned',
    });
    const visible = await notificationsForContext(db, technician);
    assert.deepEqual(new Set(visible.map((row) => row.id)), new Set([operation.id, assigned.id]));
    assert.ok(visible.every((row) => !Object.hasOwn(row, 'payload')));
    assert.equal((await markNotificationRead(db, payment.id, technician)).found, false);
    assert.equal((await markNotificationRead(db, assigned.id, context)).found, false);
    assert.equal((await markNotificationRead(db, operation.id, technician)).changes, 1);
    assert.equal((await markNotificationRead(db, operation.id, technician)).found, true);
    assert.equal(
      (await notificationsForContext(db, technician)).find((row) => row.id === operation.id).status,
      'READ',
    );
    assert.equal(
      (await notificationsForContext(db, context)).find((row) => row.id === operation.id).status,
      'PENDING',
    );
    assert.equal(
      (await db.prepare('SELECT status FROM notifications WHERE id=?').get(operation.id)).status,
      'PENDING',
    );
    assert.equal((await markNotificationRead(db, operation.id, context)).changes, 1);
    assert.equal(
      (
        await db
          .prepare('SELECT COUNT(*) n FROM notification_reads WHERE notification_id=?')
          .get(operation.id)
      ).n,
      2,
    );

    const other = await provisionWorkshop(db, {
      ownerName: 'Otro',
      workshopName: 'Otro taller',
      email: 'otro-avisos@example.test',
      password: 'SafeTestPassword123!',
      planId: 'plan-pro',
    });
    const otherContext = await resolveContext(
      db,
      await readSession(db, (await createSession(db, other.userId)).id),
    );
    await db
      .prepare('UPDATE notifications SET idempotency_key=? WHERE id=?')
      .run('shared', operation.id);
    assert.equal(
      (
        await queueNotification(db, {
          tenantId: tenant.tenantId,
          eventType: 'VEHICLE_READY',
          title: 'Reintento',
          message: 'Aviso',
          idempotencyKey: 'shared',
        })
      ).id,
      operation.id,
      'Conserva deduplicación de claves anteriores a la migración',
    );
    const otherNotice = await queueNotification(db, {
      tenantId: other.tenantId,
      eventType: 'VEHICLE_READY',
      title: 'Aviso otro taller',
      message: 'Privado B',
      idempotencyKey: 'shared',
    });
    assert.notEqual(otherNotice.id, operation.id);
    assert.equal(otherNotice.tenant_id, other.tenantId);
    assert.equal((await markNotificationRead(db, operation.id, otherContext)).found, false);
    assert.deepEqual(
      (await notificationsForContext(db, otherContext)).map((row) => row.id),
      [otherNotice.id],
    );
    await assert.rejects(
      async () =>
        await queueNotification(db, {
          tenantId: tenant.tenantId,
          userId: other.userId,
          eventType: 'WORK_ASSIGNED',
          title: 'Cruce',
          message: 'No debe salir',
          idempotencyKey: 'bad-recipient',
        }),
      /tenant_mismatch/,
    );
    await assert.rejects(
      async () =>
        await db
          .prepare(
            'INSERT INTO notification_reads(notification_id,tenant_id,user_id,read_at) VALUES(?,?,?,?)',
          )
          .run(operation.id, tenant.tenantId, other.userId, now()),
      /tenant_mismatch/,
    );
  } finally {
    await db.close();
  }
});

test('reportes usan el día local, inclusive cuando cambia el horario de verano', async () => {
  const period = reportPeriod(
    new URL('http://local?from=2026-09-04&to=2026-09-04'),
    'America/Asuncion',
  );
  assert.equal(period.from, '2026-09-04T03:00:00.000Z');
  assert.equal(period.to, '2026-09-05T02:59:59.999Z');
  assert.equal(calendarDate('2026-09-05T02:30:00.000Z', 'America/Asuncion'), '2026-09-04');
  const spring = reportPeriod(
    new URL('http://local?from=2026-03-08&to=2026-03-08'),
    'America/New_York',
  );
  const fall = reportPeriod(
    new URL('http://local?from=2026-11-01&to=2026-11-01'),
    'America/New_York',
  );
  assert.equal(Date.parse(spring.to) + 1 - Date.parse(spring.from), 23 * 3600000);
  assert.equal(Date.parse(fall.to) + 1 - Date.parse(fall.from), 25 * 3600000);
  const midnightJump = startOfLocalDate('2026-09-06', 'America/Santiago');
  assert.equal(calendarDate(midnightJump, 'America/Santiago'), '2026-09-06');
  assert.equal(
    calendarDate(new Date(Date.parse(midnightJump) - 1), 'America/Santiago'),
    '2026-09-05',
  );
  assert.throws(
    () => reportPeriod(new URL('http://local?to=invalid')),
    (error) => error.status === 422,
  );
  const { db, context, tenant, session } = await fixture();
  try {
    await db
      .prepare(
        'INSERT INTO cash_movements(id,tenant_id,branch_id,type,category,amount,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        'late-income',
        tenant.tenantId,
        tenant.branchId,
        'INCOME',
        'OTHER_INCOME',
        43210,
        tenant.userId,
        '2026-09-05T02:30:00.000Z',
      );
    const html = await reportsPage(
      db,
      { context, session },
      new URL('http://local?from=2026-09-04&to=2026-09-04'),
    );
    assert.ok(html.includes('43.210'), 'Incluye el cobro de las 23:30 del día local');
    assert.ok(
      !(
        await reportsPage(
          db,
          { context, session },
          new URL('http://local?from=2026-09-05&to=2026-09-05'),
        )
      ).includes('43.210'),
    );
  } finally {
    await db.close();
  }
});

test('reintentar pagos no permite cambiar método, referencia, fecha ni moneda de un cobro', async () => {
  const { db, context, tenant } = await fixture();
  try {
    const saas = {
      tenantId: tenant.tenantId,
      amount: 299000,
      reference: 'replay-saas',
      method: 'TRANSFER',
    };
    await recordManualPayment(db, saas, 'user-platform-admin');
    await assert.rejects(
      async () => await recordManualPayment(db, { ...saas, method: 'CASH' }, 'user-platform-admin'),
      /otros datos/,
    );
    await assert.rejects(
      async () =>
        await recordManualPayment(db, { ...saas, paidAt: '2000-01-01' }, 'user-platform-admin'),
      /otros datos/,
    );
    await db
      .prepare("UPDATE subscriptions SET currency='USD' WHERE tenant_id=?")
      .run(tenant.tenantId);
    await assert.rejects(
      async () => await recordManualPayment(db, saas, 'user-platform-admin'),
      /otros datos/,
    );
    await db
      .prepare("UPDATE subscriptions SET currency='PYG' WHERE tenant_id=?")
      .run(tenant.tenantId);

    const order = await authorized(db, context);
    const assignment = await ops.assignTechnician(db, context, order, {
      technicianId: tenant.userId,
      description: 'Reparación',
    });
    await ops.updateAssignment(db, context, assignment, 'START');
    await ops.consumePart(db, context, order, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'replay-part',
    });
    await ops.updateAssignment(db, context, assignment, 'COMPLETE');
    await ops.sendToQuality(db, context, order);
    await ops.recordQualityCheck(db, context, order, { result: 'PASSED' });
    const invoice = await ops.invoiceOrder(db, context, order, {
      idempotencyKey: 'replay-invoice',
    });
    const input = {
      amount: 10000,
      method: 'CASH',
      reference: 'REC-10',
      idempotencyKey: 'replay-pay',
    };
    await ops.recordCustomerPayment(db, context, invoice.invoiceId, input);
    assert.equal(
      (await ops.recordCustomerPayment(db, context, invoice.invoiceId, input)).duplicate,
      true,
    );
    for (const changed of [
      { method: 'TRANSFER' },
      { reference: 'REC-11' },
      { paidAt: '2000-01-01' },
    ])
      await assert.rejects(
        async () =>
          await ops.recordCustomerPayment(db, context, invoice.invoiceId, { ...input, ...changed }),
        /otros datos/,
      );
    assert.equal(
      (
        await db
          .prepare('SELECT paid_amount FROM workshop_invoices WHERE id=?')
          .get(invoice.invoiceId)
      ).paid_amount,
      10000,
    );

    const request = await requestRestock(db, context, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'replay-restock',
    });
    const purchase = await ops.createPurchaseOrder(db, context, request, {
      supplierId: 'supplier',
      unitCost: 30000,
    });
    const receipt = await ops.receivePurchaseOrder(db, context, purchase, {
      idempotencyKey: 'replay-receive',
    });
    await ops.paySupplier(db, context, receipt.payableId, input);
    assert.equal((await ops.paySupplier(db, context, receipt.payableId, input)).duplicate, true);
    for (const changed of [
      { method: 'TRANSFER' },
      { reference: 'REC-11' },
      { paidAt: '2000-01-01' },
    ])
      await assert.rejects(
        async () => await ops.paySupplier(db, context, receipt.payableId, { ...input, ...changed }),
        /otro pago/,
      );
    assert.equal(
      (
        await db
          .prepare('SELECT paid_amount FROM accounts_payable WHERE id=?')
          .get(receipt.payableId)
      ).paid_amount,
      10000,
    );
  } finally {
    await db.close();
  }
});

test('garantía permite reparación sin cargo con autorización, stock, calidad y entrega sin cobro ficticio', async () => {
  const { db, context, tenant, session } = await fixture();
  const finishWork = async (order) => {
    const assignment = await ops.assignTechnician(db, context, order, {
      technicianId: tenant.userId,
      description: 'Reparar',
    });
    await ops.updateAssignment(db, context, assignment, 'START');
    await ops.consumePart(db, context, order, {
      inventoryItemId: 'part',
      quantity: 1,
      idempotencyKey: 'part-' + order,
    });
    await ops.updateAssignment(db, context, assignment, 'COMPLETE');
    await ops.sendToQuality(db, context, order);
    await ops.recordQualityCheck(db, context, order, { result: 'PASSED' });
    return await ops.invoiceOrder(db, context, order, { idempotencyKey: 'invoice-' + order });
  };
  try {
    const original = await authorized(db, context),
      originalInvoice = await finishWork(original);
    await ops.recordCustomerPayment(db, context, originalInvoice.invoiceId, {
      amount: 209000,
      method: 'CASH',
      idempotencyKey: 'original-payment',
    });
    await ops.deliverVehicle(db, context, original, { receivedBy: 'Cliente', odometer: 101 });
    const warranty = await db
      .prepare('SELECT id FROM warranties WHERE work_order_id=?')
      .get(original);
    const claim = await warrantyClaim(db, context, warranty.id, {
      description: 'Revisión cubierta por garantía',
    });
    const { orderId: repair } = await ops.receiveVehicle(db, context, {
      branchId: tenant.branchId,
      customerId: 'customer',
      vehicleId: 'vehicle',
      complaint: 'Reparación en garantía',
      odometer: 101,
      fuelLevel: 50,
    });
    await ops.completeInspection(db, context, repair, { findings: 'Verificar reparación' });
    await ops.completeDiagnosis(db, context, repair, { summary: 'Reemplazo en garantía' });
    await assert.rejects(async () => await ops.sendEstimate(db, context, repair), /concepto/);
    await ops.addEstimateItem(db, context, repair, {
      itemType: 'LABOR',
      description: 'Trabajo cubierto',
      quantity: 1,
      unitPrice: 0,
      unitCost: 20000,
    });
    await ops.addEstimateItem(db, context, repair, {
      itemType: 'PART',
      description: 'Repuesto cubierto',
      inventoryItemId: 'part',
      quantity: 1,
      unitPrice: 0,
    });
    await ops.sendEstimate(db, context, repair);
    await assert.rejects(
      async () => await ops.approveEstimate(db, context, repair, { approvedBy: 'Cliente' }),
      /motivo/,
    );
    await assert.rejects(
      async () =>
        await ops.approveEstimate(db, { ...context, permissions: ['orders.approve'] }, repair, {
          approvedBy: 'Cliente',
          notes: 'En garantía',
        }),
      /permisos/,
    );
    await ops.approveEstimate(db, context, repair, {
      approvedBy: 'Cliente',
      notes: 'Cubierto por garantía del trabajo anterior',
    });
    await resolveWarrantyClaim(db, context, claim, {
      status: 'ACCEPTED',
      resolution: 'Reparar sin cargo',
      workOrderId: repair,
    });
    const invoice = await finishWork(repair);
    const row = await db
      .prepare('SELECT * FROM workshop_invoices WHERE id=?')
      .get(invoice.invoiceId);
    assert.equal(row.amount, 0);
    assert.equal(row.status, 'PAID');
    assert.equal(row.paid_at, null);
    assert.equal((await ops.orderProfitability(db, tenant.tenantId, repair)).margin, -50000);
    assert.ok(
      (await printableOrder(db, { context, session }, repair, 'invoice')).includes(
        'No se registró un cobro',
      ),
    );
    await assert.rejects(
      async () =>
        await ops.recordCustomerPayment(db, context, invoice.invoiceId, {
          amount: 1,
          method: 'CASH',
          idempotencyKey: 'invalid-free-payment',
        }),
      /saldo/,
    );
    assert.throws(() => assertTransition('PAID', 'READY'));
    assert.throws(() =>
      assertTransition('PAID', 'READY', { action: 'INVOICE_VOIDED', total: 100 }),
    );
    await ops.voidInvoice(db, context, invoice.invoiceId, {
      reason: 'Reemitir constancia sin cargo',
    });
    await ops.invoiceOrder(db, context, repair, { idempotencyKey: 'reissued-free' });
    await ops.deliverVehicle(db, context, repair, { receivedBy: 'Cliente', odometer: 102 });
    await resolveWarrantyClaim(db, context, claim, {
      status: 'RESOLVED',
      resolution: 'Reparación finalizada y entregada',
    });
    assert.equal(
      (await db.prepare('SELECT work_order_id FROM warranty_claims WHERE id=?').get(claim))
        .work_order_id,
      repair,
    );
    assert.equal(
      (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(repair)).status,
      'DELIVERED',
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM workshop_payments').get()).n, 1);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM cash_movements WHERE category='CUSTOMER_PAYMENT'")
          .get()
      ).n,
      1,
    );
    assert.equal(
      (await db.prepare("SELECT quantity FROM inventory_items WHERE id='part'").get()).quantity,
      3,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='NO_CHARGE_AUTHORIZED'")
          .get()
      ).n,
      1,
    );
  } finally {
    await db.close();
  }
});
