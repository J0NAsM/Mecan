import { AppError } from '../errors.js';
import { required, positive } from '../validation.js';
import { id, now } from '../utils.js';
import {
  withTenantWrite,
  assertPermission,
  assertTenantWritable,
  assertEntitlement,
} from '../tenancy.js';
import { audit } from '../domain.js';

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
async function itemRow(db, tenantId, itemId) {
  const row = await db
    .prepare('SELECT * FROM inventory_items WHERE id=? AND tenant_id=? AND active=1')
    .get(itemId, tenantId);
  if (!row) throw new AppError('Artículo activo no encontrado.', { status: 404 });
  return row;
}
export async function reservedStock(db, tenantId, itemId, excludeOrder = null) {
  return Number(
    (
      await db
        .prepare(
          "SELECT COALESCE(SUM(quantity),0) amount FROM stock_reservations WHERE tenant_id=? AND inventory_item_id=? AND status='ACTIVE' AND (?::text IS NULL OR work_order_id<>?)",
        )
        .get(tenantId, itemId, excludeOrder, excludeOrder)
    ).amount,
  );
}
async function movement(db, context, item, quantity, type, reason, key, referenceId = null) {
  const next = Number(item.quantity) + quantity;
  if (next < (await reservedStock(db, context.tenant.id, item.id)))
    throw new AppError(
      'La operación afecta stock reservado. Libera las reservas o modifica la cantidad.',
      { status: 409 },
    );
  await db
    .prepare('UPDATE inventory_items SET quantity=? WHERE id=? AND tenant_id=?')
    .run(next, item.id, context.tenant.id);
  await db
    .prepare(
      'INSERT INTO inventory_movements (id,tenant_id,branch_id,inventory_item_id,movement_type,quantity,previous_quantity,resulting_quantity,unit_cost,reference_type,reference_id,reason,actor_user_id,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id(),
      context.tenant.id,
      item.branch_id,
      item.id,
      type,
      quantity,
      item.quantity,
      next,
      item.cost,
      'INVENTORY',
      referenceId,
      reason,
      context.user.user_id,
      key,
      now(),
    );
  await audit(db, {
    tenantId: context.tenant.id,
    branchId: item.branch_id,
    actorUserId: context.user.user_id,
    action: 'STOCK_' + type,
    entityType: 'inventory_item',
    entityId: item.id,
    before: { quantity: item.quantity },
    after: { quantity: next, reason, referenceId },
  });
}
export async function adjustStock(db, context, itemId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.adjust');
    assertTenantWritable(context);
    await assertEntitlement(db, context.tenant.id, 'inventory');
    const quantity = positive(input.quantity, 'La existencia contada', { allowZero: true }),
      reason = required(input.reason, 'El motivo', { max: 1000 }),
      key = required(input.idempotencyKey, 'La referencia de operación');
    return await transaction(db, async () => {
      const previous = await db
        .prepare('SELECT * FROM inventory_movements WHERE tenant_id=? AND idempotency_key=?')
        .get(context.tenant.id, 'adjust:' + key);
      if (previous) {
        if (
          previous.inventory_item_id !== itemId ||
          Number(previous.resulting_quantity) !== quantity ||
          previous.reason !== reason
        )
          throw new AppError(
            'Esta referencia ya corresponde a otro ajuste. Recarga el formulario.',
            {
              status: 409,
            },
          );
        return;
      }
      const item = await itemRow(db, context.tenant.id, itemId);
      if (quantity === Number(item.quantity))
        throw new AppError(
          'La existencia contada coincide con el stock actual. No es necesario un ajuste.',
        );
      await movement(
        db,
        context,
        item,
        quantity - Number(item.quantity),
        'ADJUSTMENT',
        reason,
        'adjust:' + key,
      );
    });
  });
}
export async function transferStock(db, context, itemId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.adjust');
    assertTenantWritable(context);
    await assertEntitlement(db, context.tenant.id, 'inventory');
    const quantity = positive(input.quantity, 'La cantidad'),
      key = required(input.idempotencyKey, 'La referencia de operación'),
      reason = required(input.reason, 'El motivo de transferencia', { max: 1000 });
    return await transaction(db, async () => {
      const previous = await db
        .prepare(
          "SELECT t.*,m.reason FROM inventory_transfers t JOIN inventory_movements m ON m.reference_id=t.id AND m.tenant_id=t.tenant_id AND m.movement_type='TRANSFER_OUT' WHERE t.tenant_id=? AND t.idempotency_key=?",
        )
        .get(context.tenant.id, key);
      if (previous) {
        if (
          previous.inventory_item_id !== itemId ||
          previous.destination_item_id !== input.destinationItemId ||
          Number(previous.quantity) !== quantity ||
          previous.reason !== reason
        )
          throw new AppError(
            'Esta referencia ya corresponde a otra transferencia. Recarga el formulario.',
            { status: 409 },
          );
        return;
      }
      const item = await itemRow(db, context.tenant.id, itemId),
        destination = await itemRow(db, context.tenant.id, input.destinationItemId);
      if (item.branch_id === destination.branch_id)
        throw new AppError('Selecciona un artículo equivalente de otra sucursal.', {
          status: 422,
        });
      const transferId = id();
      await movement(
        db,
        context,
        item,
        -quantity,
        'TRANSFER_OUT',
        reason,
        'transfer-out:' + key,
        transferId,
      );
      await movement(
        db,
        context,
        destination,
        quantity,
        'TRANSFER_IN',
        reason,
        'transfer-in:' + key,
        transferId,
      );
      const cost =
        (Number(destination.quantity) * Number(destination.cost) + quantity * Number(item.cost)) /
        (Number(destination.quantity) + quantity);
      await db
        .prepare('UPDATE inventory_items SET cost=? WHERE id=? AND tenant_id=?')
        .run(cost, destination.id, context.tenant.id);
      await db
        .prepare(
          "INSERT INTO inventory_transfers (id,tenant_id,inventory_item_id,from_branch_id,to_branch_id,quantity,status,created_by,created_at,completed_at,idempotency_key,destination_item_id) VALUES (?,?,?,?,?,?,'COMPLETED',?,?,?,?,?)",
        )
        .run(
          transferId,
          context.tenant.id,
          item.id,
          item.branch_id,
          destination.branch_id,
          quantity,
          context.user.user_id,
          now(),
          now(),
          key,
          destination.id,
        );
    });
  });
}
export async function reserveStock(db, context, orderId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.consume');
    assertTenantWritable(context);
    await assertEntitlement(db, context.tenant.id, 'inventory');
    const quantity = positive(input.quantity, 'La cantidad'),
      key = required(input.idempotencyKey, 'La referencia');
    return await transaction(db, async () => {
      const previous = await db
        .prepare('SELECT * FROM stock_reservations WHERE tenant_id=? AND idempotency_key=?')
        .get(context.tenant.id, key);
      if (previous) {
        if (
          previous.work_order_id !== orderId ||
          previous.inventory_item_id !== input.inventoryItemId ||
          Number(previous.quantity) !== quantity
        )
          throw new AppError(
            'Esta referencia ya corresponde a otra reserva. Recarga el formulario.',
            { status: 409 },
          );
        return;
      }
      const order = await db
          .prepare(
            "SELECT * FROM work_orders WHERE id=? AND tenant_id=? AND status IN ('AUTHORIZED','IN_PROGRESS','WAITING_PARTS')",
          )
          .get(orderId, context.tenant.id),
        item = await itemRow(db, context.tenant.id, input.inventoryItemId);
      if (!order || order.branch_id !== item.branch_id)
        throw new AppError(
          'La orden y el artículo deben pertenecer a la misma sucursal y estar autorizados.',
          { status: 422 },
        );
      const authorized = Number(
        (
          await db
            .prepare(
              "SELECT COALESCE(SUM(ei.quantity),0) n FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id WHERE ei.tenant_id=? AND e.work_order_id=? AND e.status='APPROVED' AND ei.inventory_item_id=? AND ei.item_type='PART'",
            )
            .get(context.tenant.id, order.id, item.id)
        ).n,
      );
      const consumed = Number(
        (
          await db
            .prepare(
              'SELECT COALESCE(SUM(quantity),0) n FROM active_work_order_parts WHERE tenant_id=? AND work_order_id=? AND inventory_item_id=?',
            )
            .get(context.tenant.id, order.id, item.id)
        ).n,
      );
      const own = Number(
        (
          await db
            .prepare(
              "SELECT COALESCE(SUM(quantity),0) n FROM stock_reservations WHERE tenant_id=? AND work_order_id=? AND inventory_item_id=? AND status='ACTIVE'",
            )
            .get(context.tenant.id, order.id, item.id)
        ).n,
      );
      if (consumed + own + quantity > authorized)
        throw new AppError('La reserva supera la cantidad autorizada pendiente de utilizar.', {
          status: 409,
        });
      if (Number(item.quantity) - (await reservedStock(db, context.tenant.id, item.id)) < quantity)
        throw new AppError('No hay stock disponible para esta reserva.', { status: 409 });
      await db
        .prepare(
          "INSERT INTO stock_reservations (id,tenant_id,branch_id,inventory_item_id,work_order_id,quantity,status,created_by,created_at,idempotency_key) VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?)",
        )
        .run(
          id(),
          context.tenant.id,
          item.branch_id,
          item.id,
          order.id,
          quantity,
          context.user.user_id,
          now(),
          key,
        );
      await audit(db, {
        tenantId: context.tenant.id,
        branchId: order.branch_id,
        actorUserId: context.user.user_id,
        action: 'STOCK_RESERVED',
        entityType: 'work_order',
        entityId: order.id,
        after: { itemId: item.id, quantity },
      });
    });
  });
}
export async function releaseStock(db, context, reservationId) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.consume');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const row = await db
        .prepare("SELECT * FROM stock_reservations WHERE id=? AND tenant_id=? AND status='ACTIVE'")
        .get(reservationId, context.tenant.id);
      if (!row) throw new AppError('Reserva activa no encontrada.', { status: 404 });
      await db
        .prepare(
          "UPDATE stock_reservations SET status='RELEASED',released_at=? WHERE id=? AND tenant_id=?",
        )
        .run(now(), row.id, context.tenant.id);
      await audit(db, {
        tenantId: context.tenant.id,
        branchId: row.branch_id,
        actorUserId: context.user.user_id,
        action: 'STOCK_RELEASED',
        entityType: 'stock_reservation',
        entityId: row.id,
        before: row,
        after: { status: 'RELEASED' },
      });
    });
  });
}
