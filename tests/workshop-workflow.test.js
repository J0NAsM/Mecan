import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase } from './helpers/postgres.js';
import { provisionWorkshop } from '../src/domain.js';
import { createSession, readSession } from '../src/auth.js';
import { resolveContext } from '../src/tenancy.js';
import { id, now } from '../src/utils.js';
import {
  receiveVehicle,
  completeInspection,
  completeDiagnosis,
  addEstimateItem,
  sendEstimate,
  approveEstimate,
  assignTechnician,
  updateAssignment,
  consumePart,
  sendToQuality,
  recordQualityCheck,
  invoiceOrder,
  recordCustomerPayment,
  deliverVehicle,
  requestPart,
  createPurchaseOrder,
  receivePurchaseOrder,
  paySupplier,
  orderProfitability,
  voidInvoice,
  cancelOrder,
} from '../src/services/workshop-operations.js';

async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, {
    superadminEmail: 'root@workflow.local',
    superadminPassword: 'Strong123!',
  });
  const tenant = await provisionWorkshop(db, {
    ownerName: 'Owner',
    workshopName: 'Workflow Shop',
    email: 'owner@workflow.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  const session = await createSession(db, tenant.userId),
    context = await resolveContext(db, await readSession(db, session.id)),
    created = now();
  await db
    .prepare(
      'INSERT INTO customers (id,tenant_id,branch_id,name,phone,created_at) VALUES (?,?,?,?,?,?)',
    )
    .run('customer', tenant.tenantId, tenant.branchId, 'Cliente Uno', '0991000000', created);
  await db
    .prepare(
      'INSERT INTO vehicles (id,tenant_id,customer_id,plate,make,model,odometer,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run('vehicle', tenant.tenantId, 'customer', 'TEST100', 'Toyota', 'Hilux', 10000, created);
  await db
    .prepare(
      'INSERT INTO inventory_items (id,tenant_id,branch_id,sku,name,quantity,minimum_stock,cost,sale_price,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run('part', tenant.tenantId, tenant.branchId, 'FLT-1', 'Filtro', 5, 1, 50000, 90000, created);
  await db
    .prepare('INSERT INTO suppliers (id,tenant_id,name,created_at) VALUES (?,?,?,?)')
    .run('supplier', tenant.tenantId, 'Repuestos S.A.', created);
  return { db, tenant, context };
}

async function prepareAuthorized(db, context) {
  const reception = await receiveVehicle(db, context, {
    branchId: context.tenant.id === 'none' ? '' : context.membership.branch_id,
    customerId: 'customer',
    vehicleId: 'vehicle',
    complaint: 'Ruido de motor',
    odometer: 10100,
    fuelLevel: 50,
  });
  await completeInspection(db, context, reception.orderId, {
    findings: 'Filtro obstruido',
    checklist: 'luces, frenos, fluidos',
  });
  await completeDiagnosis(db, context, reception.orderId, {
    summary: 'Filtro requiere cambio',
    recommendations: 'Reemplazar filtro',
  });
  await addEstimateItem(db, context, reception.orderId, {
    itemType: 'LABOR',
    description: 'Diagnóstico y cambio',
    quantity: 1,
    unitCost: 30000,
    unitPrice: 100000,
  });
  await addEstimateItem(db, context, reception.orderId, {
    itemType: 'PART',
    description: 'Filtro',
    inventoryItemId: 'part',
    quantity: 1,
    unitCost: 50000,
    unitPrice: 90000,
  });
  await sendEstimate(db, context, reception.orderId);
  await approveEstimate(db, context, reception.orderId, { approvedBy: 'Cliente Uno' });
  return reception.orderId;
}

test('flujo de taller completo preserva estados, stock, factura, caja y garantía', async () => {
  const { db, context } = await fixture();
  const orderId = await prepareAuthorized(db, context);
  const assignmentId = await assignTechnician(db, context, orderId, {
    technicianId: context.user.user_id,
    description: 'Cambiar filtro',
    priority: 'HIGH',
  });
  await updateAssignment(db, context, assignmentId, 'START');
  await consumePart(db, context, orderId, {
    inventoryItemId: 'part',
    quantity: 1,
    idempotencyKey: 'consume-1',
  });
  const duplicate = await consumePart(db, context, orderId, {
    inventoryItemId: 'part',
    quantity: 1,
    idempotencyKey: 'consume-1',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    (await db.prepare("SELECT quantity FROM inventory_items WHERE id='part'").get()).quantity,
    4,
  );
  await updateAssignment(db, context, assignmentId, 'COMPLETE', { notes: 'Trabajo realizado' });
  await sendToQuality(db, context, orderId);
  await recordQualityCheck(db, context, orderId, {
    result: 'PASSED',
    checklist: 'sin fugas, prueba de ruta',
  });
  const invoice = await invoiceOrder(db, context, orderId, { idempotencyKey: 'invoice-1' });
  const invoiceRow = await db
    .prepare('SELECT * FROM workshop_invoices WHERE id=?')
    .get(invoice.invoiceId);
  assert.equal(invoiceRow.balance, 209000);
  await assert.rejects(
    async () =>
      await recordCustomerPayment(db, context, invoice.invoiceId, {
        amount: invoiceRow.balance + 1,
        method: 'CASH',
        idempotencyKey: 'too-much',
      }),
    /supera el saldo/,
  );
  await recordCustomerPayment(db, context, invoice.invoiceId, {
    amount: 100000,
    method: 'CASH',
    reference: 'REC-1',
    idempotencyKey: 'pay-1',
  });
  await recordCustomerPayment(db, context, invoice.invoiceId, {
    amount: 109000,
    method: 'CARD',
    reference: 'REC-2',
    idempotencyKey: 'pay-2',
  });
  const deliveryId = await deliverVehicle(db, context, orderId, {
    receivedBy: 'Cliente Uno',
    odometer: 10105,
    warrantyDays: 90,
    warrantyTerms: '90 días sobre mano de obra',
  });
  assert.ok(deliveryId);
  assert.equal(
    (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(orderId)).status,
    'DELIVERED',
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) total FROM workshop_payments WHERE tenant_id=?')
        .get(context.tenant.id)
    ).total,
    2,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) total FROM cash_movements WHERE category='CUSTOMER_PAYMENT'")
        .get()
    ).total,
    2,
  );
  assert.equal(
    (await db.prepare('SELECT status FROM warranties WHERE work_order_id=?').get(orderId)).status,
    'ACTIVE',
  );
  const profit = await orderProfitability(db, context.tenant.id, orderId);
  assert.equal(profit.revenue, 190000);
  assert.equal(profit.cost, 80000);
  assert.equal(profit.margin, 110000);
  await db.close();
});

test('no permite facturar sin autorización, control de calidad ni contenido', async () => {
  const { db, context } = await fixture();
  const received = await receiveVehicle(db, context, {
    branchId: context.membership.branch_id,
    customerId: 'customer',
    vehicleId: 'vehicle',
    complaint: 'Prueba',
    odometer: 10001,
  });
  await assert.rejects(
    async () => await invoiceOrder(db, context, received.orderId, { idempotencyKey: 'invalid' }),
    /mientras la orden/,
  );
  await assert.rejects(
    async () => await sendToQuality(db, context, received.orderId),
    /mientras la orden/,
  );
  await db.close();
});

test('solo permite consumir repuestos autorizados y exige registrarlos antes de calidad', async () => {
  const { db, context } = await fixture(),
    orderId = await prepareAuthorized(db, context);
  const assignmentId = await assignTechnician(db, context, orderId, {
    technicianId: context.user.user_id,
    description: 'Cambiar filtro',
  });
  await updateAssignment(db, context, assignmentId, 'START');
  await updateAssignment(db, context, assignmentId, 'COMPLETE');
  await assert.rejects(
    async () =>
      await consumePart(db, context, orderId, {
        inventoryItemId: 'part',
        quantity: 2,
        idempotencyKey: 'excess',
      }),
    /excede lo autorizado/,
  );
  await assert.rejects(
    async () => await sendToQuality(db, context, orderId),
    /Falta registrar el consumo/,
  );
  await consumePart(db, context, orderId, {
    inventoryItemId: 'part',
    quantity: 1,
    idempotencyKey: 'authorized-part',
  });
  await assert.doesNotReject(async () => await sendToQuality(db, context, orderId));
  await db.close();
});

test('anulación y cancelación solo revierten operaciones seguras y quedan consistentes', async () => {
  const { db, context } = await fixture();
  const cancellable = await receiveVehicle(db, context, {
    branchId: context.membership.branch_id,
    customerId: 'customer',
    vehicleId: 'vehicle',
    complaint: 'Ingreso cancelable',
  });
  await cancelOrder(db, context, cancellable.orderId, { reason: 'El cliente retiró el vehículo' });
  assert.equal(
    (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(cancellable.orderId)).status,
    'CANCELED',
  );
  const orderId = await prepareAuthorized(db, context),
    assignmentId = await assignTechnician(db, context, orderId, {
      technicianId: context.user.user_id,
      description: 'Cambiar filtro',
    });
  await updateAssignment(db, context, assignmentId, 'START');
  await consumePart(db, context, orderId, {
    inventoryItemId: 'part',
    quantity: 1,
    idempotencyKey: 'void-part',
  });
  await updateAssignment(db, context, assignmentId, 'COMPLETE');
  await sendToQuality(db, context, orderId);
  await recordQualityCheck(db, context, orderId, { result: 'PASSED' });
  const invoice = await invoiceOrder(db, context, orderId, { idempotencyKey: 'void-invoice' });
  await voidInvoice(db, context, invoice.invoiceId, { reason: 'Datos fiscales incorrectos' });
  assert.equal(
    (await db.prepare('SELECT status FROM workshop_invoices WHERE id=?').get(invoice.invoiceId))
      .status,
    'VOID',
  );
  assert.equal(
    (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(orderId)).status,
    'READY',
  );
  const replacement = await invoiceOrder(db, context, orderId, {
    idempotencyKey: 'replacement-invoice',
  });
  await recordCustomerPayment(db, context, replacement.invoiceId, {
    amount: 209000,
    method: 'CASH',
    idempotencyKey: 'void-paid',
  });
  await assert.rejects(
    async () => await voidInvoice(db, context, replacement.invoiceId, { reason: 'No permitido' }),
    /cobros/,
  );
  await db.close();
});

test('falta de stock origina compra, recepción trazable, cuenta por pagar y pago único', async () => {
  const { db, context } = await fixture();
  await db.prepare("UPDATE inventory_items SET quantity=0 WHERE id='part'").run();
  const orderId = await prepareAuthorized(db, context);
  const assignmentId = await assignTechnician(db, context, orderId, {
    technicianId: context.user.user_id,
    description: 'Instalar repuesto',
    priority: 'URGENT',
  });
  await updateAssignment(db, context, assignmentId, 'START');
  await assert.rejects(
    async () =>
      await consumePart(db, context, orderId, {
        inventoryItemId: 'part',
        quantity: 1,
        idempotencyKey: 'no-stock',
      }),
    /Stock insuficiente/,
  );
  const requestId = await requestPart(db, context, orderId, {
    inventoryItemId: 'part',
    description: 'Filtro',
    quantity: 2,
    priority: 'URGENT',
  });
  assert.equal(
    (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(orderId)).status,
    'WAITING_PARTS',
  );
  const poId = await createPurchaseOrder(db, context, requestId, {
    supplierId: 'supplier',
    unitCost: 45000,
    quantity: 2,
  });
  const reception = await receivePurchaseOrder(db, context, poId, {
    idempotencyKey: 'receive-po-1',
  });
  assert.equal(
    (await db.prepare("SELECT quantity FROM inventory_items WHERE id='part'").get()).quantity,
    2,
  );
  assert.equal(
    (await db.prepare('SELECT status FROM work_orders WHERE id=?').get(orderId)).status,
    'IN_PROGRESS',
  );
  const payable = await db
    .prepare('SELECT * FROM accounts_payable WHERE id=?')
    .get(reception.payableId);
  assert.equal(payable.balance, 99000);
  await paySupplier(db, context, payable.id, {
    amount: 99000,
    method: 'TRANSFER',
    reference: 'BANK-PO',
    idempotencyKey: 'supplier-pay-1',
  });
  assert.equal(
    (await db.prepare('SELECT status FROM accounts_payable WHERE id=?').get(payable.id)).status,
    'PAID',
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) total FROM cash_movements WHERE category='SUPPLIER_PAYMENT'")
        .get()
    ).total,
    1,
  );
  await db.close();
});
