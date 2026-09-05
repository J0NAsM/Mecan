import crypto from 'node:crypto';
import { id, now, addDays } from './utils.js';
import { opaqueHash } from './security.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, salt, expected] = String(stored).split(':');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function createSession(db, userId, days = 14, metadata = {}) {
  const sessionToken = `${id()}${crypto.randomBytes(32).toString('hex')}`;
  const sessionId = opaqueHash(sessionToken);
  const csrf = crypto.randomBytes(24).toString('hex');
  await db
    .prepare(
      'INSERT INTO sessions (id,user_id,csrf_token,expires_at,created_at,ip_hash,user_agent_hash) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      sessionId,
      userId,
      csrf,
      addDays(new Date(), days),
      now(),
      metadata.ip ? opaqueHash(metadata.ip) : null,
      metadata.userAgent ? opaqueHash(metadata.userAgent) : null,
    );
  return { id: sessionToken, csrf };
}

export async function readSession(db, sessionId) {
  if (!sessionId) return null;
  const session = await db
    .prepare(
      `SELECT s.*, u.email, u.name, u.kind, u.platform_role, u.active, u.must_change_password
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=? AND s.expires_at>? AND u.active=1`,
    )
    .get(opaqueHash(sessionId), now());
  if (!session) return null;
  await db.prepare('UPDATE users SET last_activity_at=? WHERE id=?').run(now(), session.user_id);
  return session;
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => {
        const at = part.indexOf('=');
        if (at < 0) return ['', ''];
        try {
          return [
            decodeURIComponent(part.slice(0, at).trim()),
            decodeURIComponent(part.slice(at + 1).trim()),
          ];
        } catch {
          return ['', ''];
        }
      })
      .filter(([key]) => key),
  );
}

export function sessionCookie(sessionId, secure = false, days = 14) {
  return `mecan_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure = false) {
  return `mecan_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export async function createPasswordReset(db, userId, minutes = 30) {
  return db.transaction(
    async () => {
      const token = crypto.randomBytes(32).toString('base64url'),
        tokenHash = opaqueHash(token),
        created = now();
      await db
        .prepare('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL')
        .run(created, userId);
      await db
        .prepare(
          'INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)',
        )
        .run(
          id(),
          userId,
          tokenHash,
          new Date(Date.now() + minutes * 60_000).toISOString(),
          created,
        );
      return token;
    },
    { lockKey: 'account:' + userId },
  );
}

export async function consumePasswordReset(db, token, newPasswordHash) {
  const record = await db
    .prepare(
      'SELECT * FROM password_reset_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?',
    )
    .get(opaqueHash(token), now());
  if (!record) return false;

  try {
    return await db.transaction(
      async () => {
        if (
          !(await db
            .prepare(
              'SELECT 1 FROM password_reset_tokens WHERE id=? AND used_at IS NULL AND expires_at>?',
            )
            .get(record.id, now()))
        )
          return false;
        const used = now();
        await db
          .prepare(
            'UPDATE users SET password_hash=?,password_changed_at=?,must_change_password=0 WHERE id=?',
          )
          .run(newPasswordHash, used, record.user_id);
        await db
          .prepare('UPDATE password_reset_tokens SET used_at=? WHERE id=?')
          .run(used, record.id);
        await db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.user_id);

        return true;
      },
      { lockKey: 'account:' + record.user_id },
    );
  } catch (error) {
    throw error;
  }
}
