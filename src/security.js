import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { id, now, addDays } from './utils.js';

export const opaqueHash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const identityHash=value=>opaqueHash(String(value||'').trim().toLowerCase());

export function assertLoginAllowed(db,email,ip){
  const since=new Date(Date.now()-15*60_000).toISOString();
  const identity=identityHash(email),ipDigest=identityHash(ip);
  const failures=db.prepare('SELECT COUNT(*) total FROM login_attempts WHERE attempted_at>=? AND succeeded=0 AND (identity_hash=? OR ip_hash=?)').get(since,identity,ipDigest).total;
  if(Number(failures)>=8)throw new AppError('Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.',{status:429,code:'LOGIN_RATE_LIMIT'});
}
export function recordLoginAttempt(db,email,ip,succeeded){
  db.prepare('INSERT INTO login_attempts (id,identity_hash,ip_hash,succeeded,attempted_at) VALUES (?,?,?,?,?)').run(id(),identityHash(email),identityHash(ip),succeeded?1:0,now());
  db.prepare('DELETE FROM login_attempts WHERE attempted_at<?').run(addDays(now(),-2));
}

export function assertMutationRate(db,userId,action,limit=60,windowMinutes=1){
  const since=new Date(Date.now()-windowMinutes*60_000).toISOString();
  const total=db.prepare('SELECT COUNT(*) total FROM audit_logs WHERE actor_user_id=? AND action=? AND created_at>=?').get(userId,action,since).total;
  if(Number(total)>=limit)throw new AppError('Has realizado demasiadas operaciones. Espera un momento y vuelve a intentar.',{status:429,code:'RATE_LIMIT'});
}

export function detectFileType(bytes){
  if(bytes.length>=4&&bytes.subarray(0,4).toString('hex')==='25504446')return 'application/pdf';
  if(bytes.length>=8&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return 'image/png';
  if(bytes.length>=3&&bytes.subarray(0,3).toString('hex')==='ffd8ff')return 'image/jpeg';
  if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return null;
}
