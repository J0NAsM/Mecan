import nodemailer from 'nodemailer';
import { now } from './utils.js';
import { logger } from './logger.js';

export function smtpTransport(config) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    requireTLS: config.smtpRequireTls,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}
export async function processNotificationQueue(db, config, { limit = 20, transport = null } = {}) {
  const emailMode =
    config.emailTransport || (config.notificationWebhookUrl ? 'webhook' : 'disabled');
  if (emailMode === 'disabled' && !config.notificationWebhookUrl)
    return { processed: 0, skipped: true };
  const pending = await db
    .prepare(
      "SELECT * FROM notifications WHERE channel<>'IN_APP' AND status IN ('PENDING','FAILED','SENDING') AND scheduled_at<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND (locked_until IS NULL OR locked_until<?) AND attempts<5 ORDER BY scheduled_at LIMIT ?",
    )
    .all(now(), now(), now(), limit);
  let processed = 0;
  const smtp = transport || (emailMode === 'smtp' ? smtpTransport(config) : null);
  for (const notification of pending) {
    const claimed = await db
      .prepare(
        "UPDATE notifications SET locked_until=?,attempts=attempts+1 WHERE id=? AND status IN ('PENDING','FAILED') AND (locked_until IS NULL OR locked_until<?)",
      )
      .run(new Date(Date.now() + 120000).toISOString(), notification.id, now());
    if (!claimed.changes) continue;
    try {
      const payload = JSON.parse(notification.payload || '{}');
      if (
        notification.event_type === 'PASSWORD_RESET' &&
        new Date(notification.created_at).getTime() + 30 * 60000 < Date.now()
      ) {
        await db
          .prepare(
            "UPDATE notifications SET status='FAILED',attempts=5,last_error='RESET_EXPIRED',payload='{}',locked_until=NULL WHERE id=?",
          )
          .run(notification.id);
        continue;
      }
      if (notification.channel === 'EMAIL' && emailMode === 'smtp') {
        if (!payload.to) throw new Error('missing_recipient');
        const text = [
          notification.message,
          payload.resetUrl ? 'Enlace de un solo uso (30 minutos): ' + payload.resetUrl : '',
          payload.url ? 'Ver detalle: ' + payload.url : '',
          config.appName,
        ]
          .filter(Boolean)
          .join('\n\n');
        await smtp.sendMail({
          from: config.emailFrom,
          to: payload.to,
          replyTo: config.emailReplyTo || undefined,
          subject: notification.title,
          text,
          messageId: '<' + notification.id + '@' + new URL(config.appUrl).hostname + '>',
        });
      } else {
        if (!config.notificationWebhookUrl || !config.notificationWebhookSecret)
          throw new Error('channel_not_configured');
        const response = await fetch(config.notificationWebhookUrl, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + config.notificationWebhookSecret,
            'idempotency-key': notification.idempotency_key,
          },
          body: JSON.stringify({
            id: notification.id,
            channel: notification.channel,
            eventType: notification.event_type,
            title: notification.title,
            message: notification.message,
            payload,
          }),
        });
        if (!response.ok) throw new Error('provider_status_' + response.status);
      }
      await db
        .prepare(
          "UPDATE notifications SET status='SENT',sent_at=?,locked_until=NULL,last_error=NULL,payload=CASE WHEN event_type='PASSWORD_RESET' THEN '{}' ELSE payload END WHERE id=?",
        )
        .run(now(), notification.id);
      processed++;
    } catch (error) {
      const attempts = Number(notification.attempts) + 1,
        next = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60000).toISOString();
      await db
        .prepare(
          "UPDATE notifications SET status='FAILED',locked_until=NULL,last_error=?,next_attempt_at=? WHERE id=?",
        )
        .run(String(error.code || 'DELIVERY_FAILED').slice(0, 80), next, notification.id);
      logger.warn('notification_delivery_failed', {
        notificationId: notification.id,
        eventType: notification.event_type,
        attempts,
      });
    }
  }
  smtp?.close?.();
  return { processed, skipped: false };
}
