import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { id, now, addDays } from './utils.js';

export const opaqueHash = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');
const identityHash = (value) =>
  opaqueHash(
    String(value || '')
      .trim()
      .toLowerCase(),
  );

export async function assertRequestRate(db, identity, route, limit = 10, minutes = 15) {
  const key = opaqueHash(route + ':' + identity),
    at = now(),
    expires = new Date(Date.now() + minutes * 60000).toISOString();
  const row = await db
    .prepare(
      `INSERT INTO request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN request_limits.expires_at<? THEN 1 ELSE request_limits.count+1 END,expires_at=CASE WHEN request_limits.expires_at<? THEN excluded.expires_at ELSE request_limits.expires_at END RETURNING count`,
    )
    .get(key, expires, at, at);
  await db.prepare('DELETE FROM request_limits WHERE expires_at<?').run(at);
  if (row.count > limit)
    throw new AppError('Demasiadas solicitudes. Espera unos minutos antes de volver a intentar.', {
      status: 429,
      code: 'RATE_LIMIT',
    });
}

export async function assertLoginAllowed(db, email, ip) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const identity = identityHash(email),
    ipDigest = identityHash(ip);
  const failures = (
    await db
      .prepare(
        'SELECT COUNT(*) total FROM login_attempts WHERE attempted_at>=? AND succeeded=0 AND (identity_hash=? OR ip_hash=?)',
      )
      .get(since, identity, ipDigest)
  ).total;
  if (Number(failures) >= 8)
    throw new AppError(
      'Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.',
      { status: 429, code: 'LOGIN_RATE_LIMIT' },
    );
}
export async function recordLoginAttempt(db, email, ip, succeeded) {
  await db
    .prepare(
      'INSERT INTO login_attempts (id,identity_hash,ip_hash,succeeded,attempted_at) VALUES (?,?,?,?,?)',
    )
    .run(id(), identityHash(email), identityHash(ip), succeeded ? 1 : 0, now());
  await db.prepare('DELETE FROM login_attempts WHERE attempted_at<?').run(addDays(now(), -2));
}

export async function assertMutationRate(db, userId, action, limit = 60, windowMinutes = 1) {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const total = (
    await db
      .prepare(
        'SELECT COUNT(*) total FROM audit_logs WHERE actor_user_id=? AND action=? AND created_at>=?',
      )
      .get(userId, action, since)
  ).total;
  if (Number(total) >= limit)
    throw new AppError(
      'Has realizado demasiadas operaciones. Espera un momento y vuelve a intentar.',
      { status: 429, code: 'RATE_LIMIT' },
    );
}

export function detectFileType(bytes) {
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('hex') === '25504446')
    return 'application/pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
    return 'image/png';
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export function safeUploadName(filename, mimeType) {
  const extension = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  }[mimeType];
  if (!extension) throw new AppError('Tipo de archivo no permitido.', { status: 422 });
  const basename = String(filename || 'documento')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, 160);
  return `${basename || 'documento'}.${extension}`;
}
