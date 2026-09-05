import { id, now } from './utils.js';
import { assertPermission, can } from './tenancy.js';
import { PERMISSIONS } from './permissions.js';
import { AppError } from './errors.js';

export function notificationPermission(eventType) {
  if (eventType === 'PURCHASE_RECEIVED') return 'inventory.view';
  if (['PAYMENT_RECEIVED', 'PAYMENT_REVERSED'].includes(eventType)) return 'billing.view';
  if (eventType === 'WORK_ASSIGNED') return 'orders.execute';
  if (
    ['ESTIMATE_SENT', 'ESTIMATE_APPROVED', 'VEHICLE_READY', 'VEHICLE_DELIVERED'].includes(eventType)
  )
    return 'orders.view';
  // Subscription and unclassified events are private to workshop administration.
  return 'settings.manage';
}

export async function queueNotification(
  db,
  {
    tenantId = null,
    userId = null,
    channel = 'IN_APP',
    eventType,
    title,
    message,
    payload = {},
    idempotencyKey,
    scheduledAt = now(),
  },
) {
  if (!idempotencyKey) throw new AppError('Falta la referencia del aviso.', { status: 422 });
  const scopedKey = JSON.stringify([tenantId, channel, idempotencyKey]);
  // Read legacy keys only in their original scope; never return another tenant's notification.
  let notification = await db
    .prepare(
      'SELECT * FROM notifications WHERE tenant_id IS NOT DISTINCT FROM ? AND channel=? AND idempotency_key IN (?,?) ORDER BY created_at LIMIT 1',
    )
    .get(tenantId, channel, scopedKey, idempotencyKey);
  if (notification && (notification.event_type !== eventType || notification.user_id !== userId))
    throw new AppError('La referencia del aviso ya se utilizó para otro destinatario o evento.', {
      status: 409,
    });
  if (!notification) {
    await db
      .prepare(
        `INSERT INTO notifications (id,tenant_id,user_id,channel,event_type,title,message,payload,status,idempotency_key,scheduled_at,created_at,required_permission)
      VALUES (?,?,?,?,?,?,?,?,'PENDING',?,?,?,?)`,
      )
      .run(
        id(),
        tenantId,
        userId,
        channel,
        eventType,
        title,
        message,
        JSON.stringify(payload),
        scopedKey,
        scheduledAt,
        now(),
        notificationPermission(eventType),
      );
    notification = await db
      .prepare(
        'SELECT * FROM notifications WHERE idempotency_key=? AND tenant_id IS NOT DISTINCT FROM ? AND channel=?',
      )
      .get(scopedKey, tenantId, channel);
  }
  if (channel === 'IN_APP' && tenantId && eventType.startsWith('SUBSCRIPTION_')) {
    const owner = await db
      .prepare(
        "SELECT u.id,u.email FROM users u JOIN memberships m ON m.user_id=u.id JOIN roles r ON r.id=m.role_id WHERE m.tenant_id=? AND r.code='OWNER' AND u.active=1 AND m.status='ACTIVE'",
      )
      .get(tenantId);
    if (owner)
      await queueNotification(db, {
        tenantId,
        userId: owner.id,
        channel: 'EMAIL',
        eventType,
        title,
        message,
        payload: { ...payload, to: owner.email },
        idempotencyKey: 'email:' + idempotencyKey,
        scheduledAt,
      });
  }
  return notification;
}

export async function notificationsForContext(db, context, { limit = 200 } = {}) {
  assertPermission(context, 'dashboard.view');
  const allowed = PERMISSIONS.map(([permission]) => permission).filter((permission) =>
    can(context, permission),
  );
  if (!allowed.length) return [];
  const allPermissions = Number(context.permissions.includes('*'));
  return await db
    .prepare(
      `SELECT n.id,n.channel,n.event_type,n.title,n.message,n.created_at,n.required_permission,
    CASE WHEN r.read_at IS NOT NULL THEN 'READ' ELSE 'PENDING' END status,r.read_at
    FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.tenant_id=n.tenant_id AND r.user_id=?
    WHERE n.tenant_id=? AND n.channel='IN_APP' AND (n.user_id IS NULL OR n.user_id=?)
    AND (?=1 OR n.required_permission IN (${allowed.map(() => '?').join(',')})) ORDER BY n.created_at DESC,n.id DESC LIMIT ?`,
    )
    .all(
      context.user.user_id,
      context.tenant.id,
      context.user.user_id,
      allPermissions,
      ...allowed,
      Math.max(1, Math.min(Number(limit) || 200, 500)),
    );
}

export async function markNotificationRead(db, notificationId, context) {
  assertPermission(context, 'dashboard.view');
  const notification = await db
    .prepare(
      "SELECT required_permission FROM notifications WHERE id=? AND tenant_id=? AND channel='IN_APP' AND (user_id IS NULL OR user_id=?)",
    )
    .get(notificationId, context.tenant.id, context.user.user_id);
  if (!notification || !can(context, notification.required_permission))
    return { changes: 0, found: false };
  const result = await db
    .prepare(
      'INSERT INTO notification_reads (notification_id,tenant_id,user_id,read_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
    )
    .run(notificationId, context.tenant.id, context.user.user_id, now());
  return { changes: result.changes, found: true };
}
