import { id, now, addDays } from '../utils.js';
import { AppError } from '../errors.js';
import { required, optional, positive, isoDate } from '../validation.js';
import {
  withTenantWrite,
  assertPermission,
  assertTenantWritable,
  assertEntitlement,
} from '../tenancy.js';
import { audit } from '../domain.js';
import { roundMoney, moneyAmount, tenantCurrency } from '../money.js';
import { assertTransition } from '../workflow.js';
import { queueNotification } from '../notifications.js';
import { allocateNumber } from './document-sequences.js';
import { startOfLocalDate } from '../time.js';

const quantityTotal = (value) => Math.round(Number(value) * 1e9) / 1e9;
const actor = (context, meta = {}) => ({
  tenantId: context.tenant.id,
  actorUserId: context.user.user_id,
  impersonatorUserId: context.isImpersonating ? context.user.user_id : null,
  ip: meta.ip,
  requestId: meta.requestId,
});
async function transaction(db, action) {
  try {
    return await db.transaction(async () => {
      const result = await action();

      return result;
    }, {});
  } catch (error) {
    throw error;
  }
}
async function row(db, table, recordId, tenantId) {
  if (!['purchase_requests', 'purchase_orders', 'inventory_items', 'suppliers'].includes(table))
    throw new Error('Repositorio no permitido');
  const record = await db
    .prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`)
    .get(recordId, tenantId);
  if (!record) throw new AppError('Registro de compra no encontrado.', { status: 404 });
  return record;
}
async function writable(db, context, permission = 'purchases.manage') {
  assertPermission(context, permission);
  assertTenantWritable(context);
  await assertEntitlement(db, context.tenant.id, 'inventory');
}
export async function purchaseRequestProgress(db, tenantId, requestId) {
  const request = await row(db, 'purchase_requests', requestId, tenantId);
  const delivered = quantityTotal(
    (
      await db
        .prepare(
          `SELECT COALESCE(SUM(l.received_quantity),0) quantity FROM purchase_order_items l JOIN purchase_orders p ON p.id=l.purchase_order_id AND p.tenant_id=l.tenant_id WHERE p.tenant_id=? AND p.purchase_request_id=?`,
        )
        .get(tenantId, requestId)
    ).quantity,
  );
  const active = (
    await db
      .prepare(
        "SELECT COUNT(*) n FROM purchase_orders WHERE tenant_id=? AND purchase_request_id=? AND status IN ('DRAFT','SENT','PARTIAL')",
      )
      .get(tenantId, requestId)
  ).n;
  return {
    request,
    delivered,
    remaining: Math.max(0, quantityTotal(Number(request.quantity) - delivered)),
    active,
  };
}
async function refreshRequest(db, context, requestId, meta = {}) {
  if (!requestId) return;
  const { request, remaining, active } = await purchaseRequestProgress(
    db,
    context.tenant.id,
    requestId,
  );
  const status =
    request.status === 'CANCELED'
      ? 'CANCELED'
      : remaining === 0
        ? 'RECEIVED'
        : active
          ? 'ORDERED'
          : 'REQUESTED';
  await db
    .prepare('UPDATE purchase_requests SET status=? WHERE id=? AND tenant_id=?')
    .run(status, requestId, context.tenant.id);
  if (request.work_order_id) {
    const pending = (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM purchase_requests WHERE tenant_id=? AND work_order_id=? AND status NOT IN ('RECEIVED','CANCELED')",
        )
        .get(context.tenant.id, request.work_order_id)
    ).n;
    const order = await db
      .prepare("SELECT * FROM work_orders WHERE tenant_id=? AND id=? AND status='WAITING_PARTS'")
      .get(context.tenant.id, request.work_order_id);
    if (order && !pending) {
      assertTransition(order.status, 'IN_PROGRESS');
      await db
        .prepare("UPDATE work_orders SET status='IN_PROGRESS' WHERE tenant_id=? AND id=?")
        .run(context.tenant.id, order.id);
      await audit(db, {
        ...actor(context, meta),
        branchId: order.branch_id,
        action: 'PARTS_REQUESTS_RESOLVED',
        entityType: 'work_order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'IN_PROGRESS', requestId },
      });
    }
  }
}

export async function createPurchaseOrder(db, context, requestId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    await writable(db, context);
    return await transaction(db, async () => {
      const { request, remaining, active } = await purchaseRequestProgress(
        db,
        context.tenant.id,
        requestId,
      );
      if (!['REQUESTED', 'QUOTING'].includes(request.status) || active || !remaining)
        throw new AppError('La solicitud ya tiene una compra abierta o fue completada.', {
          status: 409,
        });
      const supplier = await row(db, 'suppliers', input.supplierId, context.tenant.id);
      const item = await row(
        db,
        'inventory_items',
        request.inventory_item_id || input.inventoryItemId,
        context.tenant.id,
      );
      if (!item.active || !supplier.active)
        throw new AppError('El proveedor y el artículo deben estar activos.');
      if (item.branch_id !== request.branch_id)
        throw new AppError('El artículo pertenece a otra sucursal.', { status: 409 });
      const quantity = positive(
        input.quantity === undefined || input.quantity === '' ? remaining : input.quantity,
        'La cantidad',
      );
      if (quantity - remaining > 1e-9)
        throw new AppError('La compra supera la cantidad pendiente de la solicitud.', {
          status: 409,
        });
      const currency = await tenantCurrency(db, context.tenant.id),
        unitCost = moneyAmount(input.unitCost, currency, 'El costo', { allowZero: true });
      const subtotal = roundMoney(quantity * unitCost, currency),
        rate = Number(
          (
            await db
              .prepare('SELECT tax_rate FROM tenant_settings WHERE tenant_id=?')
              .get(context.tenant.id)
          )?.tax_rate || 0,
        );
      const tax = roundMoney((subtotal * rate) / 100, currency),
        total = roundMoney(subtotal + tax, currency);
      const poId = id(),
        number = await allocateNumber(db, context.tenant.id, 'PURCHASE_ORDER');
      await db
        .prepare(
          "INSERT INTO purchase_orders(id,tenant_id,branch_id,supplier_id,purchase_request_id,number,status,subtotal,tax,total,expected_at,created_by,created_at,currency) VALUES (?,?,?,?,?,?,'SENT',?,?,?,?,?,?,?)",
        )
        .run(
          poId,
          context.tenant.id,
          request.branch_id,
          supplier.id,
          request.id,
          number,
          subtotal,
          tax,
          total,
          input.expectedAt ? isoDate(input.expectedAt) : null,
          context.user.user_id,
          now(),
          currency,
        );
      await db
        .prepare(
          'INSERT INTO purchase_order_items(id,tenant_id,purchase_order_id,inventory_item_id,description,quantity,received_quantity,unit_cost,total) VALUES (?,?,?,?,?,?,0,?,?)',
        )
        .run(
          id(),
          context.tenant.id,
          poId,
          item.id,
          request.description,
          quantity,
          unitCost,
          subtotal,
        );
      await refreshRequest(db, context, request.id, meta);
      await audit(db, {
        ...actor(context, meta),
        branchId: request.branch_id,
        action: 'PURCHASE_ORDER_CREATED',
        entityType: 'purchase_order',
        entityId: poId,
        after: { requestId, total, quantity, currency },
      });
      return poId;
    });
  });
}

function receiptInput(input) {
  let lines = input.lines;
  const fields = Object.entries(input).filter(([name]) => name.startsWith('quantity_'));
  if (lines !== undefined && fields.length)
    throw new AppError('Envía una sola lista de cantidades a recibir.');
  if (fields.length)
    lines = fields.map(([name, value]) => ({ lineId: name.slice(9), quantity: value }));
  if (lines !== undefined && (!Array.isArray(lines) || lines.length > 500))
    throw new AppError('Revisa los conceptos de la recepción.');
  const seen = new Set();
  const normalized =
    lines === undefined
      ? null
      : lines
          .map((line) => {
            const lineId = required(line?.lineId, 'El concepto de compra');
            if (seen.has(lineId))
              throw new AppError('Un concepto aparece repetido en la recepción.');
            seen.add(lineId);
            return {
              lineId,
              quantity: positive(line.quantity, 'La cantidad recibida', { allowZero: true }),
            };
          })
          .sort((a, b) => a.lineId.localeCompare(b.lineId));
  return {
    lines: normalized,
    reference: optional(input.reference, { max: 200 }),
    notes: optional(input.notes, { max: 2000 }),
    dueAt: input.dueAt ? String(input.dueAt) : null,
  };
}
export async function receivePurchaseOrder(db, context, purchaseOrderId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    await writable(db, context);
    const key = required(input.idempotencyKey, 'La clave de recepción', { max: 200 }),
      normalized = receiptInput(input);
    const fingerprint = JSON.stringify({ purchaseOrderId, ...normalized });
    return await transaction(db, async () => {
      const po = await row(db, 'purchase_orders', purchaseOrderId, context.tenant.id);
      const duplicate = await db
        .prepare(
          "SELECT * FROM idempotency_keys WHERE tenant_id=? AND operation='PURCHASE_RECEIVE' AND key=?",
        )
        .get(context.tenant.id, key);
      if (duplicate) {
        const previous = duplicate.response_json ? JSON.parse(duplicate.response_json) : null;
        if (
          duplicate.resource_id !== po.id ||
          (previous && previous.fingerprint !== fingerprint) ||
          (!previous && (normalized.lines !== null || normalized.reference))
        )
          throw new AppError('La referencia de recepción ya se utilizó con otros datos.', {
            status: 409,
          });
        const payableId =
          previous?.payableId ||
          (
            await db
              .prepare('SELECT id FROM accounts_payable WHERE tenant_id=? AND purchase_order_id=?')
              .get(context.tenant.id, po.id)
          )?.id;
        return {
          purchaseOrderId: po.id,
          receiptId: previous?.receiptId,
          payableId,
          duplicate: true,
        };
      }
      if (!['SENT', 'PARTIAL'].includes(po.status))
        throw new AppError('La compra ya está cerrada o no puede recibirse.', { status: 409 });
      const lines = await db
        .prepare(
          'SELECT * FROM purchase_order_items WHERE tenant_id=? AND purchase_order_id=? ORDER BY id',
        )
        .all(context.tenant.id, po.id);
      for (const submitted of normalized.lines || [])
        if (!lines.some((line) => line.id === submitted.lineId))
          throw new AppError('Concepto de compra no encontrado.', { status: 404 });
      const received = lines
        .map((line) => {
          const remaining = quantityTotal(
            Number(line.quantity) - Number(line.received_quantity) - Number(line.canceled_quantity),
          );
          const quantity =
            normalized.lines === null
              ? remaining
              : normalized.lines.find((submitted) => submitted.lineId === line.id)?.quantity || 0;
          if (quantity - remaining > 1e-9)
            throw new AppError('La cantidad recibida supera lo pendiente de la compra.', {
              status: 409,
            });
          return { line, quantity };
        })
        .filter(({ quantity }) => quantity > 0);
      if (!received.length)
        throw new AppError('Indica al menos una cantidad recibida mayor que cero.');
      const currency = po.currency || (await tenantCurrency(db, context.tenant.id));
      const newSubtotal = roundMoney(
        lines.reduce(
          (sum, line) =>
            sum +
            roundMoney(
              quantityTotal(
                Number(line.received_quantity) +
                  (received.find((item) => item.line.id === line.id)?.quantity || 0),
              ) * Number(line.unit_cost),
              currency,
            ),
          0,
        ),
        currency,
      );
      const newTax = roundMoney(
        Number(po.subtotal) ? (Number(po.tax) * newSubtotal) / Number(po.subtotal) : 0,
        currency,
      );
      const newTotal = roundMoney(newSubtotal + newTax, currency);
      if (newTotal > Number(po.total) || newTotal < Number(po.received_total))
        throw new AppError(
          'El importe recibido no coincide con la compra. Revisa sus cantidades y costos.',
          { status: 409 },
        );
      const receiptId = id(),
        timestamp = now();
      await db
        .prepare(
          'INSERT INTO purchase_receipts(id,tenant_id,branch_id,purchase_order_id,reference,notes,subtotal,tax,amount,currency,received_by,received_at,idempotency_key,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          receiptId,
          context.tenant.id,
          po.branch_id,
          po.id,
          normalized.reference,
          normalized.notes,
          roundMoney(newSubtotal - Number(po.received_subtotal), currency),
          roundMoney(newTax - Number(po.received_tax), currency),
          roundMoney(newTotal - Number(po.received_total), currency),
          currency,
          context.user.user_id,
          timestamp,
          key,
          fingerprint,
        );
      for (const { line, quantity } of received) {
        const item = await row(db, 'inventory_items', line.inventory_item_id, context.tenant.id);
        if (item.branch_id !== po.branch_id)
          throw new AppError('El repuesto no corresponde a la sucursal de la compra.', {
            status: 409,
          });
        const resulting = quantityTotal(Number(item.quantity) + quantity),
          movementId = id();
        if (resulting <= Number(item.quantity))
          throw new AppError('La cantidad es demasiado pequeña para registrarse con precisión.');
        await db
          .prepare('UPDATE inventory_items SET quantity=?,cost=? WHERE id=? AND tenant_id=?')
          .run(
            resulting,
            (Number(item.quantity) * Number(item.cost) + quantity * Number(line.unit_cost)) /
              resulting,
            item.id,
            context.tenant.id,
          );
        await db
          .prepare(
            "INSERT INTO inventory_movements(id,tenant_id,branch_id,inventory_item_id,movement_type,quantity,previous_quantity,resulting_quantity,unit_cost,reference_type,reference_id,reason,actor_user_id,idempotency_key,created_at) VALUES (?,?,?,?,'PURCHASE',?,?,?,?,'PURCHASE_ORDER',?,?,?,?,?)",
          )
          .run(
            movementId,
            context.tenant.id,
            po.branch_id,
            item.id,
            quantity,
            item.quantity,
            resulting,
            line.unit_cost,
            po.id,
            normalized.notes,
            context.user.user_id,
            `purchase:${key}:${line.id}`,
            timestamp,
          );
        await db
          .prepare(
            'INSERT INTO purchase_receipt_lines(id,tenant_id,receipt_id,purchase_order_item_id,inventory_item_id,quantity,unit_cost,inventory_movement_id) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(
            id(),
            context.tenant.id,
            receiptId,
            line.id,
            item.id,
            quantity,
            line.unit_cost,
            movementId,
          );
        await db
          .prepare('UPDATE purchase_order_items SET received_quantity=? WHERE id=? AND tenant_id=?')
          .run(
            Math.min(
              Number(line.quantity) - Number(line.canceled_quantity),
              quantityTotal(Number(line.received_quantity) + quantity),
            ),
            line.id,
            context.tenant.id,
          );
      }
      const pending = (
        await db
          .prepare(
            'SELECT COUNT(*) n FROM purchase_order_items WHERE tenant_id=? AND purchase_order_id=? AND quantity-received_quantity-canceled_quantity>0.000000001',
          )
          .get(context.tenant.id, po.id)
      ).n;
      const status = pending ? 'PARTIAL' : 'RECEIVED';
      await db
        .prepare(
          'UPDATE purchase_orders SET status=?,received_at=?,received_subtotal=?,received_tax=?,received_total=? WHERE id=? AND tenant_id=?',
        )
        .run(
          status,
          status === 'RECEIVED' ? timestamp : null,
          newSubtotal,
          newTax,
          newTotal,
          po.id,
          context.tenant.id,
        );
      const existing = await db
        .prepare('SELECT * FROM accounts_payable WHERE tenant_id=? AND purchase_order_id=?')
        .get(context.tenant.id, po.id);
      const paid = Number(existing?.paid_amount || 0),
        balance = roundMoney(newTotal - paid, currency),
        payableId = existing?.id || id();
      if (balance < 0 || (existing && Number(existing.amount) !== Number(po.received_total)))
        throw new AppError(
          'La deuda no coincide con las recepciones anteriores. Revisa la conciliación.',
          { status: 409 },
        );
      const payableStatus = balance === 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING';
      if (existing)
        await db
          .prepare(
            'UPDATE accounts_payable SET amount=?,balance=?,status=? WHERE id=? AND tenant_id=?',
          )
          .run(newTotal, balance, payableStatus, payableId, context.tenant.id);
      else {
        const timezone = (
          await db
            .prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?')
            .get(context.tenant.id)
        )?.timezone;
        const dueAt = normalized.dueAt
          ? /^\d{4}-\d{2}-\d{2}$/.test(normalized.dueAt)
            ? startOfLocalDate(normalized.dueAt, timezone)
            : isoDate(normalized.dueAt)
          : addDays(timestamp, 30);
        await db
          .prepare(
            'INSERT INTO accounts_payable(id,tenant_id,branch_id,supplier_id,purchase_order_id,amount,paid_amount,balance,status,due_at,created_at) VALUES (?,?,?,?,?,?,0,?,?,?,?)',
          )
          .run(
            payableId,
            context.tenant.id,
            po.branch_id,
            po.supplier_id,
            po.id,
            newTotal,
            balance,
            payableStatus,
            dueAt,
            timestamp,
          );
      }
      await refreshRequest(db, context, po.purchase_request_id, meta);
      const result = { purchaseOrderId: po.id, receiptId, payableId, status, duplicate: false };
      await db
        .prepare(
          "INSERT INTO idempotency_keys(tenant_id,operation,key,resource_id,response_json,created_at) VALUES (?,'PURCHASE_RECEIVE',?,?,?,?)",
        )
        .run(context.tenant.id, key, po.id, JSON.stringify({ ...result, fingerprint }), timestamp);
      await queueNotification(db, {
        tenantId: context.tenant.id,
        eventType: 'PURCHASE_RECEIVED',
        title: `Repuestos recibidos · compra #${po.number}`,
        message:
          status === 'PARTIAL'
            ? 'Se registró una entrega parcial. Hay cantidades pendientes del proveedor.'
            : 'La compra fue recibida y el inventario está actualizado.',
        payload: { purchaseOrderId: po.id, receiptId },
        idempotencyKey: `purchase-receipt:${receiptId}`,
      });
      await audit(db, {
        ...actor(context, meta),
        branchId: po.branch_id,
        action: 'PURCHASE_ORDER_RECEIVED',
        entityType: 'purchase_order',
        entityId: po.id,
        before: {
          status: po.status,
          receivedTotal: po.received_total,
          payable: existing?.amount || 0,
        },
        after: {
          status,
          receiptId,
          receivedTotal: newTotal,
          payable: newTotal,
          lines: received.map(({ line, quantity }) => ({ lineId: line.id, quantity })),
        },
      });
      return result;
    });
  });
}

export async function cancelPurchaseOrder(db, context, purchaseOrderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    await writable(db, context, 'purchases.cancel');
    const reason = required(input.reason, 'El motivo de cancelación', { max: 1500 }),
      key = required(input.idempotencyKey, 'La referencia de cancelación', { max: 200 });
    return await transaction(db, async () => {
      const po = await row(db, 'purchase_orders', purchaseOrderId, context.tenant.id);
      const duplicate = await db
        .prepare(
          "SELECT * FROM idempotency_keys WHERE tenant_id=? AND operation='PURCHASE_CANCEL' AND key=?",
        )
        .get(context.tenant.id, key);
      if (duplicate) {
        if (
          duplicate.resource_id !== po.id ||
          JSON.parse(duplicate.response_json).reason !== reason
        )
          throw new AppError('Esta referencia ya se utilizó con otros datos.', { status: 409 });
        return { purchaseOrderId: po.id, duplicate: true };
      }
      if (!['DRAFT', 'SENT', 'PARTIAL'].includes(po.status))
        throw new AppError('La compra ya está cerrada. No se alteraron sus recepciones ni pagos.', {
          status: 409,
        });
      await db
        .prepare(
          'UPDATE purchase_order_items SET canceled_quantity=quantity-received_quantity WHERE tenant_id=? AND purchase_order_id=?',
        )
        .run(context.tenant.id, po.id);
      await db
        .prepare(
          "UPDATE purchase_orders SET status='CANCELED',canceled_at=?,canceled_by=?,cancel_reason=? WHERE id=? AND tenant_id=?",
        )
        .run(now(), context.user.user_id, reason, po.id, context.tenant.id);
      await refreshRequest(db, context, po.purchase_request_id, meta);
      await db
        .prepare(
          "INSERT INTO idempotency_keys(tenant_id,operation,key,resource_id,response_json,created_at) VALUES (?,'PURCHASE_CANCEL',?,?,?,?)",
        )
        .run(context.tenant.id, key, po.id, JSON.stringify({ reason }), now());
      await audit(db, {
        ...actor(context, meta),
        branchId: po.branch_id,
        action: 'PURCHASE_REMAINDER_CANCELED',
        entityType: 'purchase_order',
        entityId: po.id,
        before: { status: po.status, receivedTotal: po.received_total },
        after: { status: 'CANCELED', receivedTotal: po.received_total, reason },
      });
      return { purchaseOrderId: po.id, duplicate: false };
    });
  });
}
export async function cancelPurchaseRequest(db, context, requestId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    await writable(db, context, 'purchases.cancel');
    const reason = required(input.reason, 'El motivo de cancelación', { max: 1500 }),
      key = required(input.idempotencyKey, 'La referencia de cancelación', { max: 200 });
    return await transaction(db, async () => {
      const { request, active } = await purchaseRequestProgress(db, context.tenant.id, requestId);
      const duplicate = await db
        .prepare(
          "SELECT * FROM idempotency_keys WHERE tenant_id=? AND operation='PURCHASE_REQUEST_CANCEL' AND key=?",
        )
        .get(context.tenant.id, key);
      if (duplicate) {
        if (
          duplicate.resource_id !== requestId ||
          JSON.parse(duplicate.response_json).reason !== reason
        )
          throw new AppError('Esta referencia ya se utilizó con otros datos.', { status: 409 });
        return { requestId, duplicate: true };
      }
      if (active)
        throw new AppError('Cierra primero las cantidades pendientes de la orden de compra.', {
          status: 409,
        });
      if (!['REQUESTED', 'QUOTING'].includes(request.status))
        throw new AppError('La solicitud ya está cerrada.', { status: 409 });
      await db
        .prepare(
          "UPDATE purchase_requests SET status='CANCELED',canceled_at=?,canceled_by=?,cancel_reason=? WHERE id=? AND tenant_id=?",
        )
        .run(now(), context.user.user_id, reason, request.id, context.tenant.id);
      await refreshRequest(db, context, request.id, meta);
      await db
        .prepare(
          "INSERT INTO idempotency_keys(tenant_id,operation,key,resource_id,response_json,created_at) VALUES (?,'PURCHASE_REQUEST_CANCEL',?,?,?,?)",
        )
        .run(context.tenant.id, key, requestId, JSON.stringify({ reason }), now());
      await audit(db, {
        ...actor(context, meta),
        branchId: request.branch_id,
        action: 'PURCHASE_REQUEST_CANCELED',
        entityType: 'purchase_request',
        entityId: requestId,
        before: { status: request.status },
        after: { status: 'CANCELED', reason },
      });
      return { requestId, duplicate: false };
    });
  });
}
