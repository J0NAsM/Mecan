import { id, now } from './utils.js';

export function queueNotification(db,{tenantId=null,userId=null,channel='IN_APP',eventType,title,message,payload={},idempotencyKey,scheduledAt=now()}){
  const notificationId=id();
  db.prepare(`INSERT OR IGNORE INTO notifications (id,tenant_id,user_id,channel,event_type,title,message,payload,status,idempotency_key,scheduled_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(notificationId,tenantId,userId,channel,eventType,title,message,JSON.stringify(payload),idempotencyKey,scheduledAt,now());
  return db.prepare('SELECT * FROM notifications WHERE idempotency_key=?').get(idempotencyKey);
}

export function markNotificationRead(db,notificationId,tenantId,userId){
  return db.prepare("UPDATE notifications SET status='READ',read_at=? WHERE id=? AND tenant_id=? AND (user_id IS NULL OR user_id=?)").run(now(),notificationId,tenantId,userId);
}
