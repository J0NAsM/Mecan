import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDatabase } from '../src/db.js';
import { provisionWorkshop } from '../src/domain.js';
import { createSession, readSession, createPasswordReset, consumePasswordReset, hashPassword } from '../src/auth.js';
import { assertLoginAllowed, recordLoginAttempt, detectFileType, opaqueHash } from '../src/security.js';
import { now } from '../src/utils.js';

function fixture(){
  const db=openDatabase(':memory:');
  seedDatabase(db,{superadminEmail:'root@security.local',superadminPassword:'Strong123!'});
  const a=provisionWorkshop(db,{ownerName:'Ana',workshopName:'Seguridad A',email:'ana@security.local',password:'Strong123!',planId:'plan-pro'});
  const b=provisionWorkshop(db,{ownerName:'Beto',workshopName:'Seguridad B',email:'beto@security.local',password:'Strong123!',planId:'plan-pro'});
  return {db,a,b};
}

test('las sesiones persisten solo el hash y el reset invalida todas las sesiones',()=>{
  const {db,a}=fixture();
  const session=createSession(db,a.userId,14,{ip:'127.0.0.1',userAgent:'test-agent'});
  const stored=db.prepare('SELECT * FROM sessions WHERE user_id=?').get(a.userId);
  assert.notEqual(stored.id,session.id);
  assert.equal(stored.id,opaqueHash(session.id));
  assert.ok(stored.ip_hash);assert.ok(stored.user_agent_hash);
  assert.equal(readSession(db,session.id).user_id,a.userId);
  const reset=createPasswordReset(db,a.userId);
  assert.equal(consumePasswordReset(db,reset,hashPassword('NewStrong123!')),true);
  assert.equal(readSession(db,session.id),null);
  assert.equal(consumePasswordReset(db,reset,hashPassword('OtherStrong123!')),false);
});

test('el rate limit de acceso bloquea intentos repetidos sin guardar email o IP en claro',()=>{
  const {db}=fixture(),email='victima@example.com',ip='203.0.113.5';
  for(let i=0;i<8;i++)recordLoginAttempt(db,email,ip,false);
  assert.throws(()=>assertLoginAllowed(db,email,ip),error=>error.status===429);
  const row=db.prepare('SELECT * FROM login_attempts LIMIT 1').get();
  assert.notEqual(row.identity_hash,email);assert.notEqual(row.ip_hash,ip);
});

test('la base de datos rechaza asociaciones cruzadas aunque la aplicación sea omitida',()=>{
  const {db,a,b}=fixture();
  db.prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)').run('customer-a',a.tenantId,a.branchId,'Cliente A',now());
  assert.throws(()=>db.prepare('INSERT INTO vehicles (id,tenant_id,customer_id,plate,created_at) VALUES (?,?,?,?,?)').run('bad-vehicle',b.tenantId,'customer-a','CROSS',now()),/tenant_mismatch/);
});

test('la carga de archivos valida firmas reales y no solo extensiones declaradas',()=>{
  assert.equal(detectFileType(Buffer.from('%PDF-1.7')),'application/pdf');
  assert.equal(detectFileType(Buffer.from('contenido ejecutable')),null);
  assert.equal(detectFileType(Buffer.from('89504e470d0a1a0a','hex')),'image/png');
});
