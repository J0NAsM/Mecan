import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase } from './helpers/postgres.js';
import { provisionWorkshop } from '../src/domain.js';
import {
  createSession,
  readSession,
  createPasswordReset,
  consumePasswordReset,
  hashPassword,
  sessionCookie,
  clearSessionCookie,
} from '../src/auth.js';
import {
  assertLoginAllowed,
  recordLoginAttempt,
  detectFileType,
  opaqueHash,
} from '../src/security.js';
import { now } from '../src/utils.js';

async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, {
    superadminEmail: 'root@security.local',
    superadminPassword: 'Strong123!',
  });
  const a = await provisionWorkshop(db, {
    ownerName: 'Ana',
    workshopName: 'Seguridad A',
    email: 'ana@security.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  const b = await provisionWorkshop(db, {
    ownerName: 'Beto',
    workshopName: 'Seguridad B',
    email: 'beto@security.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  return { db, a, b };
}

test('las sesiones persisten solo el hash y el reset invalida todas las sesiones', async () => {
  const { db, a } = await fixture();
  const session = await createSession(db, a.userId, 14, {
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  });
  const stored = await db.prepare('SELECT * FROM sessions WHERE user_id=?').get(a.userId);
  assert.notEqual(stored.id, session.id);
  assert.equal(stored.id, opaqueHash(session.id));
  assert.ok(stored.ip_hash);
  assert.ok(stored.user_agent_hash);
  assert.equal((await readSession(db, session.id)).user_id, a.userId);
  const reset = await createPasswordReset(db, a.userId);
  assert.equal(await consumePasswordReset(db, reset, hashPassword('NewStrong123!')), true);
  assert.equal(await readSession(db, session.id), null);
  assert.equal(await consumePasswordReset(db, reset, hashPassword('OtherStrong123!')), false);
});

test('el rate limit de acceso bloquea intentos repetidos sin guardar email o IP en claro', async () => {
  const { db } = await fixture(),
    email = 'victima@example.com',
    ip = '203.0.113.5';
  for (let i = 0; i < 8; i++) await recordLoginAttempt(db, email, ip, false);
  await assert.rejects(
    async () => await assertLoginAllowed(db, email, ip),
    (error) => error.status === 429,
  );
  const row = await db.prepare('SELECT * FROM login_attempts LIMIT 1').get();
  assert.notEqual(row.identity_hash, email);
  assert.notEqual(row.ip_hash, ip);
});

test('la base de datos rechaza asociaciones cruzadas aunque la aplicación sea omitida', async () => {
  const { db, a, b } = await fixture();
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('customer-a', a.tenantId, a.branchId, 'Cliente A', now());
  await assert.rejects(
    async () =>
      await db
        .prepare(
          'INSERT INTO vehicles (id,tenant_id,customer_id,plate,created_at) VALUES (?,?,?,?,?)',
        )
        .run('bad-vehicle', b.tenantId, 'customer-a', 'CROSS', now()),
    /tenant_mismatch/,
  );
});

test('la carga de archivos valida firmas reales y no solo extensiones declaradas', () => {
  assert.equal(detectFileType(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(detectFileType(Buffer.from('contenido ejecutable')), null);
  assert.equal(detectFileType(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png');
});

/**
 * Lee config.secureTransport en un proceso aparte.
 *
 * config.js congela la configuración al importarse, así que no alcanza con cambiar process.env
 * dentro de la prueba: hay que arrancar de nuevo para que la vuelva a derivar.
 */
function secureTransportCon(entorno) {
  const code =
    "import('./src/config.js').then((m) => process.stdout.write(String(m.config.secureTransport)))";
  return execFileSync(process.execPath, ['-e', code], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, NODE_ENV: '', APP_URL: '', ...entorno },
    encoding: 'utf8',
  });
}

test('Secure y HSTS dependen de que el transporte sea HTTPS, no del modo de ejecución', () => {
  // Detrás de un túnel HTTPS la aplicación corre sin NODE_ENV=production, que exige tener cargados
  // todos los datos comerciales. Aun así la sesión debe viajar marcada como Secure: si no, el
  // navegador la mandaría también en una petición en claro al mismo host.
  assert.equal(secureTransportCon({ APP_URL: 'https://taller.ngrok-free.app' }), 'true');
  assert.equal(secureTransportCon({ APP_URL: 'http://localhost:3000' }), 'false');
  // Producción sigue implicando transporte seguro aunque APP_URL estuviera mal cargada.
  assert.equal(
    secureTransportCon({ NODE_ENV: 'production', APP_URL: 'http://localhost:3000' }),
    'true',
  );

  assert.match(sessionCookie('sesion', true), /; Secure$/);
  assert.doesNotMatch(sessionCookie('sesion', false), /; Secure/);
  assert.match(clearSessionCookie(true), /; Secure$/);
});
