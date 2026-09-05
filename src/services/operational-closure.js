import { id, now, addDays } from '../utils.js';
import { AppError } from '../errors.js';
import { required, positive, oneOf } from '../validation.js';
import {
  withTenantWrite,
  assertPermission,
  assertTenantWritable,
  assertEntitlement,
} from '../tenancy.js';
import { audit } from '../domain.js';
import { roundMoney, tenantCurrency } from '../money.js';
import { assertOrderState, assertTransition } from '../workflow.js';
import { recalculateOrder } from './workshop-operations.js';

const transaction = async (db, fn) => {
  try {
    return await db.transaction(async () => {
      const result = await fn();

      return result;
    }, {});
  } catch (error) {
    throw error;
  }
};
const actor = (context) => ({ tenantId: context.tenant.id, actorUserId: context.user.user_id });
export async function removeEstimateItem(db, context, itemId) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.estimate');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const item = await db
        .prepare(
          'SELECT ei.*,e.status,e.tax_rate FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id WHERE ei.id=? AND ei.tenant_id=?',
        )
        .get(itemId, context.tenant.id);
      if (!item) throw new AppError('Concepto no encontrado.', { status: 404 });
      if (item.status !== 'DRAFT')
        throw new AppError('Solo puedes modificar un presupuesto en preparación.', {
          status: 409,
        });
      await db
        .prepare('DELETE FROM estimate_items WHERE id=? AND tenant_id=?')
        .run(item.id, context.tenant.id);
      const subtotal = (
          await db
            .prepare(
              'SELECT COALESCE(SUM(total),0) n FROM estimate_items WHERE estimate_id=? AND tenant_id=?',
            )
            .get(item.estimate_id, context.tenant.id)
        ).n,
        currency = await tenantCurrency(db, context.tenant.id),
        tax = roundMoney((subtotal * Number(item.tax_rate || 0)) / 100, currency);
      await db
        .prepare(
          'UPDATE estimates SET subtotal=?,tax=?,total=?,updated_at=? WHERE id=? AND tenant_id=?',
        )
        .run(
          subtotal,
          tax,
          roundMoney(subtotal + tax, currency),
          now(),
          item.estimate_id,
          context.tenant.id,
        );
      await audit(db, {
        ...actor(context),
        action: 'ESTIMATE_ITEM_REMOVED',
        entityType: 'estimate',
        entityId: item.estimate_id,
        before: item,
      });
    });
  });
}
export async function reviseEstimate(db, context, orderId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.estimate');
    assertTenantWritable(context);
    const reason = required(input.reason, 'El motivo de revisión', { max: 1500 });
    return await transaction(db, async () => {
      const order = await db
        .prepare('SELECT * FROM work_orders WHERE id=? AND tenant_id=?')
        .get(orderId, context.tenant.id);
      if (!order) throw new AppError('Orden no encontrada.', { status: 404 });
      assertOrderState(order, ['AWAITING_APPROVAL'], 'revisar el presupuesto');
      assertTransition(order.status, 'ESTIMATE');
      const old = await db
        .prepare(
          "SELECT * FROM estimates WHERE work_order_id=? AND tenant_id=? AND status='SENT' ORDER BY version DESC LIMIT 1",
        )
        .get(orderId, context.tenant.id);
      if (!old) throw new AppError('No existe un presupuesto enviado.', { status: 409 });
      const estimateId = id();
      await db
        .prepare(
          "UPDATE estimates SET status='REJECTED',approval_notes=?,updated_at=? WHERE id=? AND tenant_id=?",
        )
        .run(reason, now(), old.id, context.tenant.id);
      await db
        .prepare(
          "INSERT INTO estimates (id,tenant_id,work_order_id,number,version,status,subtotal,tax,discount,total,valid_until,created_by,created_at,updated_at,tax_rate) VALUES (?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?)",
        )
        .run(
          estimateId,
          context.tenant.id,
          orderId,
          old.number,
          old.version + 1,
          old.subtotal,
          old.tax,
          old.discount,
          old.total,
          addDays(now(), 7),
          context.user.user_id,
          now(),
          now(),
          old.tax_rate,
        );
      for (const item of await db
        .prepare('SELECT * FROM estimate_items WHERE estimate_id=? AND tenant_id=?')
        .all(old.id, context.tenant.id))
        await db
          .prepare(
            'INSERT INTO estimate_items (id,tenant_id,estimate_id,item_type,description,inventory_item_id,quantity,unit_cost,unit_price,approved,total) VALUES (?,?,?,?,?,?,?,?,?,1,?)',
          )
          .run(
            id(),
            context.tenant.id,
            estimateId,
            item.item_type,
            item.description,
            item.inventory_item_id,
            item.quantity,
            item.unit_cost,
            item.unit_price,
            item.total,
          );
      await db
        .prepare("UPDATE work_orders SET status='ESTIMATE' WHERE id=? AND tenant_id=?")
        .run(orderId, context.tenant.id);
      await audit(db, {
        ...actor(context),
        action: 'ESTIMATE_REVISED',
        entityType: 'estimate',
        entityId: estimateId,
        before: { estimateId: old.id, version: old.version },
        after: { version: old.version + 1, reason },
      });
      return estimateId;
    });
  });
}
export async function requestRestock(db, context, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'purchases.manage');
    assertTenantWritable(context);
    await assertEntitlement(db, context.tenant.id, 'inventory');
    const key = required(input.idempotencyKey, 'La referencia');
    return await transaction(db, async () => {
      const duplicate = await db
        .prepare(
          "SELECT resource_id FROM idempotency_keys WHERE tenant_id=? AND operation='RESTOCK_REQUEST' AND key=?",
        )
        .get(context.tenant.id, key);
      if (duplicate) return duplicate.resource_id;
      const item = await db
        .prepare('SELECT * FROM inventory_items WHERE id=? AND tenant_id=? AND active=1')
        .get(input.inventoryItemId, context.tenant.id);
      if (!item) throw new AppError('Artículo activo no encontrado.', { status: 404 });
      const requestId = id(),
        quantity = positive(input.quantity, 'La cantidad');
      await db
        .prepare(
          "INSERT INTO purchase_requests (id,tenant_id,branch_id,inventory_item_id,description,quantity,priority,status,requested_by,created_at) VALUES (?,?,?,?,?,?,'NORMAL','REQUESTED',?,?)",
        )
        .run(
          requestId,
          context.tenant.id,
          item.branch_id,
          item.id,
          required(input.description || item.name, 'El motivo', { max: 1000 }),
          quantity,
          context.user.user_id,
          now(),
        );
      await db
        .prepare(
          "INSERT INTO idempotency_keys (tenant_id,operation,key,resource_id,created_at) VALUES (?,'RESTOCK_REQUEST',?,?,?)",
        )
        .run(context.tenant.id, key, requestId, now());
      await audit(db, {
        ...actor(context),
        branchId: item.branch_id,
        action: 'RESTOCK_REQUESTED',
        entityType: 'purchase_request',
        entityId: requestId,
        after: { itemId: item.id, quantity },
      });
      return requestId;
    });
  });
}
export async function returnUnusedPart(db, context, partId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.consume');
    assertTenantWritable(context);
    const reason = required(input.reason, 'El motivo de devolución', { max: 1000 }),
      key = required(input.idempotencyKey, 'La referencia');
    return await transaction(db, async () => {
      const part = await db
        .prepare(
          'SELECT p.*,o.status,o.branch_id FROM work_order_parts p JOIN work_orders o ON o.id=p.work_order_id AND o.tenant_id=p.tenant_id WHERE p.id=? AND p.tenant_id=?',
        )
        .get(partId, context.tenant.id);
      if (!part) throw new AppError('Consumo no encontrado.', { status: 404 });
      if (part.returned_at) return part.work_order_id;
      assertOrderState(
        part,
        ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'],
        'devolver el repuesto no utilizado',
      );
      const item = await db
          .prepare('SELECT * FROM inventory_items WHERE id=? AND tenant_id=?')
          .get(part.inventory_item_id, context.tenant.id),
        quantity = Number(item.quantity) + Number(part.quantity),
        returnId = id();
      const weightedCost =
        (Number(item.quantity) * Number(item.cost) +
          Number(part.quantity) * Number(part.unit_cost)) /
        quantity;
      await db
        .prepare('UPDATE inventory_items SET quantity=?,cost=? WHERE id=? AND tenant_id=?')
        .run(quantity, weightedCost, item.id, context.tenant.id);
      await db
        .prepare('UPDATE work_order_parts SET returned_at=? WHERE id=? AND tenant_id=?')
        .run(now(), part.id, context.tenant.id);
      await db
        .prepare(
          'INSERT INTO stock_returns (id,tenant_id,part_id,quantity,reason,created_by,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          returnId,
          context.tenant.id,
          part.id,
          part.quantity,
          reason,
          context.user.user_id,
          now(),
          key,
        );
      await db
        .prepare(
          "INSERT INTO inventory_movements (id,tenant_id,branch_id,inventory_item_id,movement_type,quantity,previous_quantity,resulting_quantity,unit_cost,reference_type,reference_id,reason,actor_user_id,idempotency_key,created_at) VALUES (?,?,?,?,'RETURN',?,?,?,?,'WORK_ORDER',?,?,?,?,?)",
        )
        .run(
          id(),
          context.tenant.id,
          part.branch_id,
          item.id,
          part.quantity,
          item.quantity,
          quantity,
          part.unit_cost,
          part.work_order_id,
          reason,
          context.user.user_id,
          'return:' + key,
          now(),
        );
      await recalculateOrder(db, context.tenant.id, part.work_order_id);
      await audit(db, {
        ...actor(context),
        branchId: part.branch_id,
        action: 'UNUSED_PART_RETURNED',
        entityType: 'work_order_part',
        entityId: part.id,
        before: part,
        after: { returnId, reason },
      });
      return part.work_order_id;
    });
  });
}
export async function warrantyClaim(db, context, warrantyId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.create');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const warranty = await db
        .prepare(
          "SELECT * FROM warranties WHERE id=? AND tenant_id=? AND status='ACTIVE' AND ends_at>=?",
        )
        .get(warrantyId, context.tenant.id, now());
      if (!warranty)
        throw new AppError('La garantía no está vigente o no pertenece a este taller.', {
          status: 409,
        });
      const claimId = id();
      await db
        .prepare(
          "INSERT INTO warranty_claims (id,tenant_id,warranty_id,description,status,created_by,created_at) VALUES (?,?,?,?,'OPEN',?,?)",
        )
        .run(
          claimId,
          context.tenant.id,
          warranty.id,
          required(input.description, 'El reclamo', { max: 3000 }),
          context.user.user_id,
          now(),
        );
      await audit(db, {
        ...actor(context),
        action: 'WARRANTY_CLAIM_CREATED',
        entityType: 'warranty_claim',
        entityId: claimId,
        after: { warrantyId, description: input.description },
      });
      return claimId;
    });
  });
}
export async function resolveWarrantyClaim(db, context, claimId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.quality');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const claim = await db
        .prepare('SELECT * FROM warranty_claims WHERE id=? AND tenant_id=?')
        .get(claimId, context.tenant.id);
      if (!claim) throw new AppError('Reclamo no encontrado.', { status: 404 });
      if (['REJECTED', 'RESOLVED', 'CLOSED'].includes(claim.status))
        throw new AppError('El reclamo ya fue cerrado.', { status: 409 });
      const status = oneOf(input.status, ['ACCEPTED', 'REJECTED', 'RESOLVED'], 'El estado'),
        resolution = required(input.resolution, 'La resolución', { max: 3000 });
      const orderId =
        input.workOrderId === undefined ? claim.work_order_id : input.workOrderId || null;
      if (
        orderId &&
        !(await db
          .prepare(
            "SELECT 1 FROM work_orders o JOIN warranties w ON w.id=? JOIN work_orders original ON original.id=w.work_order_id WHERE o.id=? AND o.tenant_id=? AND o.vehicle_id=original.vehicle_id AND o.id<>original.id AND o.created_at>=original.created_at AND o.status<>'CANCELED'",
          )
          .get(claim.warranty_id, orderId, context.tenant.id))
      )
        throw new AppError(
          'Selecciona una orden posterior del mismo vehículo y taller, que no esté cancelada.',
        );
      await db
        .prepare(
          'UPDATE warranty_claims SET status=?,resolution=?,work_order_id=?,resolved_at=? WHERE id=? AND tenant_id=?',
        )
        .run(
          status,
          resolution,
          orderId,
          status === 'ACCEPTED' ? null : now(),
          claim.id,
          context.tenant.id,
        );
      await audit(db, {
        ...actor(context),
        action: 'WARRANTY_CLAIM_UPDATED',
        entityType: 'warranty_claim',
        entityId: claim.id,
        before: claim,
        after: { status, resolution, orderId },
      });
    });
  });
}
