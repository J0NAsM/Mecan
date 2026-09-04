import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDatabase } from '../src/db.js';
import { provisionWorkshop, createWorkOrder } from '../src/domain.js';
import { createSession, readSession } from '../src/auth.js';
import { resolveContext, entitlement, assertEntitlement, tenantRows, can, assertTenantWritable } from '../src/tenancy.js';
import { recordManualPayment, setTenantStatus, platformMetrics, refreshSubscriptionStates, billingRows } from '../src/billing.js';
import { id, now } from '../src/utils.js';

function fixture() {
  const db=openDatabase(':memory:');
  seedDatabase(db,{superadminEmail:'root@test.local',superadminPassword:'Strong123!'});
  const a=provisionWorkshop(db,{ownerName:'Ana',workshopName:'Taller A',email:'ana@test.local',password:'Strong123!',planId:'plan-basic'});
  const b=provisionWorkshop(db,{ownerName:'Bruno',workshopName:'Taller B',email:'bruno@test.local',password:'Strong123!',planId:'plan-pro'});
  const session=createSession(db,a.userId);const context=resolveContext(db,readSession(db,session.id));
  return {db,a,b,context};
}

test('aprovisionamiento crea toda la organización de forma coherente',()=>{
  const {db,a}=fixture();
  assert.equal(db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId).status,'TRIAL');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM branches WHERE tenant_id=?').get(a.tenantId).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memberships WHERE tenant_id=?').get(a.tenantId).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE tenant_id=?').get(a.tenantId).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM trials WHERE tenant_id=?').get(a.tenantId).n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action='TENANT_PROVISIONED'").get(a.tenantId).n,1);
  db.close();
});

test('consultas multi-tenant nunca devuelven filas del vecino',()=>{
  const {db,a,b}=fixture();
  db.prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)').run('a-customer',a.tenantId,a.branchId,'Cliente A',now());
  db.prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)').run('b-customer',b.tenantId,b.branchId,'Cliente B',now());
  const rows=tenantRows(db,'customers',a.tenantId);
  assert.deepEqual(rows.map(x=>x.name),['Cliente A']);
  assert.equal(rows.some(x=>x.tenant_id===b.tenantId),false);
  db.close();
});

test('IDs manipulados de cliente y vehículo de otro tenant son rechazados',()=>{
  const {db,a,b,context}=fixture();
  db.prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)').run('b-customer',b.tenantId,b.branchId,'Cliente B',now());
  db.prepare('INSERT INTO vehicles (id,tenant_id,customer_id,plate,created_at) VALUES (?,?,?,?,?)').run('b-vehicle',b.tenantId,'b-customer','B123',now());
  assert.throws(()=>createWorkOrder(db,context,{branchId:a.branchId,customerId:'b-customer',vehicleId:'b-vehicle',complaint:'Intento cruzado'}),/inválidos/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM work_orders').get().n,0);
  db.close();
});

test('entitlements se resuelven centralmente por plan y excepción de tenant',()=>{
  const {db,a}=fixture();
  assert.equal(entitlement(db,a.tenantId,'branches').limit,1);
  assert.throws(()=>assertEntitlement(db,a.tenantId,'branches',1),/límite/);
  db.prepare(`INSERT INTO tenant_features (tenant_id,feature_id,enabled,limit_value,reason)
    VALUES (?,(SELECT id FROM features WHERE code='branches'),1,3,'Acuerdo comercial')`).run(a.tenantId);
  assert.equal(entitlement(db,a.tenantId,'branches').limit,3);
  assert.doesNotThrow(()=>assertEntitlement(db,a.tenantId,'branches',1));
  db.close();
});

test('pago manual es idempotente, genera factura y reactiva sin perder datos',()=>{
  const {db,a}=fixture();
  db.prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)').run('keep-me',a.tenantId,a.branchId,'Dato conservado',now());
  setTenantStatus(db,a.tenantId,'SUSPENDED','user-platform-admin','mora');
  const input={tenantId:a.tenantId,amount:149000,method:'TRANSFER',reference:'BANK-UNIQUE-1'};
  const first=recordManualPayment(db,input,'user-platform-admin');
  const second=recordManualPayment(db,input,'user-platform-admin');
  assert.equal(first.duplicate,false); assert.equal(second.duplicate,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saas_payments WHERE tenant_id=?').get(a.tenantId).n,1);
  assert.equal(db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId).status,'ACTIVE');
  assert.equal(db.prepare('SELECT status FROM saas_invoices WHERE id=?').get(first.invoiceId).status,'PAID');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE id='keep-me'").get().n,1);
  db.close();
});

test('cobranza SaaS conserva saldo parcial y reactiva únicamente al cancelar la deuda',()=>{
  const {db,a}=fixture(),due=new Date(Date.now()-2*86400000).toISOString();
  db.prepare("UPDATE subscriptions SET next_charge_at=?,status='ACTIVE' WHERE tenant_id=?").run(due,a.tenantId);
  db.prepare("UPDATE tenants SET status='ACTIVE' WHERE id=?").run(a.tenantId);
  refreshSubscriptionStates(db,new Date());
  const invoice=db.prepare('SELECT * FROM saas_invoices WHERE tenant_id=?').get(a.tenantId);
  assert.equal(invoice.amount,149000);
  const first=recordManualPayment(db,{tenantId:a.tenantId,amount:50000,method:'TRANSFER',reference:'PARTIAL-1'},'user-platform-admin');
  assert.equal(first.balance,99000);assert.equal(first.reactivated,false);
  assert.equal(db.prepare('SELECT status FROM saas_invoices WHERE id=?').get(invoice.id).status,'PARTIAL');
  assert.notEqual(db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId).status,'ACTIVE');
  assert.equal(billingRows(db).find(row=>row.id===a.tenantId).debt,99000);
  const second=recordManualPayment(db,{tenantId:a.tenantId,amount:99000,method:'TRANSFER',reference:'PARTIAL-2'},'user-platform-admin');
  assert.equal(second.balance,0);assert.equal(second.reactivated,true);
  assert.equal(db.prepare('SELECT status FROM tenants WHERE id=?').get(a.tenantId).status,'ACTIVE');
  db.close();
});

test('métricas SaaS no mezclan facturación de talleres',()=>{
  const {db,a}=fixture();
  const before=platformMetrics(db).revenue;
  db.prepare('INSERT INTO cash_movements (id,tenant_id,branch_id,type,category,amount,created_at) VALUES (?,?,?,?,?,?,?)').run(id(),a.tenantId,a.branchId,'INCOME','Reparación',99999999,now());
  assert.equal(platformMetrics(db).revenue,before);
  db.close();
});

test('permisos y suspensión impiden mutaciones sin borrar información',()=>{
  const {db,a,context}=fixture();
  const technician={permissions:['orders.view','orders.update']};
  assert.equal(can(technician,'orders.view'),true);
  assert.equal(can(technician,'employees.manage'),false);
  setTenantStatus(db,a.tenantId,'SUSPENDED','user-platform-admin','mora');
  context.tenant=db.prepare('SELECT * FROM tenants WHERE id=?').get(a.tenantId);
  assert.throws(()=>assertTenantWritable(context),/modo consulta|suscripción/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM branches WHERE tenant_id=?').get(a.tenantId).n,1);
  db.close();
});
