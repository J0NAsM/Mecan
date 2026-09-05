import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { openTestDatabase, connectTestDatabase } from './helpers/postgres.js';
import { seedDatabase } from '../src/db.js';
import { provisionWorkshop, createBranch } from '../src/domain.js';
import {
  createSession,
  readSession,
  createPasswordReset,
  consumePasswordReset,
  hashPassword,
} from '../src/auth.js';
import { resolveContext } from '../src/tenancy.js';
import { recordManualPayment, refreshSubscriptionStates, setTenantStatus } from '../src/billing.js';
import { adjustStock } from '../src/services/inventory.js';
import { now, addDays } from '../src/utils.js';
import { bindParameters } from '../src/postgres/parameters.js';
import { releasePost } from '../src/routes/release.js';

async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, {
    superadminEmail: 'root@example.test',
    superadminPassword: 'ConcurrentTest123!',
  });
  const tenant = await provisionWorkshop(db, {
    ownerName: 'Propietario',
    workshopName: 'Concurrencia',
    email: 'owner@example.test',
    password: 'ConcurrentTest123!',
    planId: 'plan-pro',
  });
  const session = await readSession(db, (await createSession(db, tenant.userId)).id);
  return {
    db,
    peer: connectTestDatabase(db.schema),
    observer: connectTestDatabase(db.schema),
    tenant,
    context: await resolveContext(db, session),
  };
}

// Wait for an actual PostgreSQL lock wait, not a timing assumption. Only then commit the competing change.
async function whileChangeCommits(fixture, change, operation) {
  const { db, peer, observer, tenant } = fixture;
  const ready = Promise.withResolvers(),
    release = Promise.withResolvers();
  const writer = db.transaction(
    async () => {
      await change(db);
      ready.resolve((await db.get('SELECT pg_backend_pid() pid')).pid);
      await release.promise;
    },
    { lockKey: 'tenant:' + tenant.tenantId },
  );
  writer.catch(ready.reject);
  let outcome;
  try {
    const writerPid = await ready.promise;
    // Attach rejection handling before releasing the lock to avoid unhandled rejection noise.
    outcome = operation(peer).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      blocked = (
        await observer.get(
          'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) blocked',
          [writerPid],
        )
      ).blocked;
      if (blocked) break;
      await delay(20);
    }
    assert.equal(blocked, true, 'La operación debe estar esperando el bloqueo real del taller');
  } finally {
    release.resolve();
    await writer;
  }
  return outcome;
}

test('una escritura que esperaba rechaza la suspensión recién confirmada y no crea sucursales', async () => {
  const f = await fixture();
  const before = await f.db.get('SELECT count(*) n FROM branches WHERE tenant_id=$1', [
    f.tenant.tenantId,
  ]);
  const result = await whileChangeCommits(
    f,
    (db) =>
      setTenantStatus(
        db,
        f.tenant.tenantId,
        'SUSPENDED',
        f.tenant.userId,
        'Prueba de suspensión concurrente',
      ),
    (peer) => createBranch(peer, f.context, { name: 'No debe crearse' }),
  );
  assert.equal(result.error?.status, 423);
  assert.deepEqual(
    await f.db.get('SELECT count(*) n FROM branches WHERE tenant_id=$1', [f.tenant.tenantId]),
    before,
  );
});

test('una escritura en espera vuelve a comprobar permisos y mantiene restricciones del llamador', async () => {
  const f = await fixture();
  await assert.rejects(
    createBranch(f.db, { ...f.context, permissions: ['branches.view'] }, { name: 'Prohibida' }),
    { status: 403 },
  );
  const result = await whileChangeCommits(
    f,
    (db) =>
      db.run('UPDATE roles SET permissions=$1 WHERE id=$2', [
        '["branches.view"]',
        f.context.membership.role_id,
      ]),
    (peer) => createBranch(peer, f.context, { name: 'Revocada durante la espera' }),
  );
  assert.equal(result.error?.status, 403);
  assert.equal(
    (await f.db.get('SELECT count(*) n FROM branches WHERE tenant_id=$1', [f.tenant.tenantId])).n,
    1,
  );
});

test('una sesión revocada mientras espera no conserva autoridad para escribir', async () => {
  const f = await fixture();
  const result = await whileChangeCommits(
    f,
    (db) => db.run('DELETE FROM sessions WHERE id=$1', [f.context.user.id]),
    (peer) => createBranch(peer, f.context, { name: 'Sesión revocada' }),
  );
  assert.equal(result.error?.status, 401);
});

test('cobranza automática relee el pago confirmado y no suspende ni vuelve a facturar un período ya renovado', async () => {
  const f = await fixture();
  await f.db.run("UPDATE subscriptions SET next_charge_at=$1,status='ACTIVE' WHERE tenant_id=$2", [
    addDays(now(), -20),
    f.tenant.tenantId,
  ]);
  await f.db.run("UPDATE tenants SET status='ACTIVE' WHERE id=$1", [f.tenant.tenantId]);
  const sub = await f.db.get('SELECT * FROM subscriptions WHERE tenant_id=$1', [f.tenant.tenantId]);
  const result = await whileChangeCommits(
    f,
    (db) =>
      recordManualPayment(
        db,
        {
          tenantId: f.tenant.tenantId,
          amount: sub.price,
          reference: 'concurrent-renewal',
          method: 'TRANSFER',
        },
        f.tenant.userId,
      ),
    (peer) => refreshSubscriptionStates(peer),
  );
  assert.equal(result.error, undefined);
  const after = await f.db.get(
    'SELECT status,next_charge_at FROM subscriptions WHERE tenant_id=$1',
    [f.tenant.tenantId],
  );
  assert.equal(after.status, 'ACTIVE');
  assert.ok(after.next_charge_at > now());
  assert.equal(
    (await f.db.get('SELECT count(*) n FROM saas_invoices WHERE tenant_id=$1', [f.tenant.tenantId]))
      .n,
    1,
  );
  assert.equal(
    (await f.db.get('SELECT status FROM tenants WHERE id=$1', [f.tenant.tenantId])).status,
    'ACTIVE',
  );
});

test('peticiones simultáneas de ajuste idempotente generan un solo movimiento de stock', async () => {
  const f = await fixture();
  await f.db.run(
    'INSERT INTO inventory_items(id,tenant_id,branch_id,name,quantity,cost,sale_price,created_at) VALUES($1,$2,$3,$4,5,100,200,$5)',
    ['part', f.tenant.tenantId, f.tenant.branchId, 'Filtro', now()],
  );
  const input = { quantity: 3, reason: 'Conteo físico', idempotencyKey: 'same-adjustment' };
  await Promise.all([
    adjustStock(f.db, f.context, 'part', input),
    adjustStock(f.peer, f.context, 'part', input),
  ]);
  assert.equal(
    (await f.db.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
    3,
  );
  assert.equal(
    (
      await f.db.get(
        "SELECT count(*) n FROM inventory_movements WHERE idempotency_key='adjust:same-adjustment'",
      )
    ).n,
    1,
  );
});

test('un enlace de recuperación solo puede consumirse una vez incluso desde dos conexiones', async () => {
  const f = await fixture();
  const token = await createPasswordReset(f.db, f.tenant.userId);
  const results = await Promise.all([
    consumePasswordReset(f.db, token, hashPassword('NewFirstPassword123!')),
    consumePasswordReset(f.peer, token, hashPassword('NewSecondPassword123!')),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(
    (await f.db.get('SELECT count(*) n FROM sessions WHERE user_id=$1', [f.tenant.userId])).n,
    0,
  );
});

test('recuperaciones concurrentes invalidan todos los enlaces salvo el último', async () => {
  const f = await fixture();
  await Promise.all([
    createPasswordReset(f.db, f.tenant.userId),
    createPasswordReset(f.peer, f.tenant.userId),
  ]);
  assert.equal(
    (
      await f.db.get(
        'SELECT count(*) n FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL',
        [f.tenant.userId],
      )
    ).n,
    1,
  );
});

test('parámetros PostgreSQL no sustituyen signos dentro de literales, identificadores o comentarios', () => {
  const sql = `SELECT ?, '?' AS "?", 'it''s ?' /* outer ? /* nested ? */ ? */,
    $$ body ? $$, $tag$ ? $tag$ -- ?
    , ?`;
  assert.deepEqual(bindParameters(sql), {
    sql: sql.replace('SELECT ?', 'SELECT $1').replace(', ?', ', $2'),
    count: 2,
  });
});

test('cambios de contraseña concurrentes aceptan solo la sesión vigente e invalidan resets anteriores', async () => {
  const f = await fixture();
  const token = await createPasswordReset(f.db, f.tenant.userId);
  const input = {
    currentPassword: 'ConcurrentTest123!',
    password: 'ConcurrentNewPassword123!',
    confirmation: 'ConcurrentNewPassword123!',
  };
  const req = { session: f.context.user, context: f.context };
  const invoke = (db) =>
    releasePost(req, {}, new URL('http://localhost/account/password'), input, {
      db,
      match: () => null,
      requireAuth: (request) => assert.equal(request.session.user_id, f.tenant.userId),
      checkCsrf: () => {}, // Transport CSRF is exercised in the HTTP suite; this test targets the shared account transaction.
      redirect: () => {},
      withMessage: (target) => target,
    });
  const outcomes = await Promise.allSettled([invoke(f.db), invoke(f.peer)]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((result) => result.status === 'rejected').reason.status, 401);
  assert.equal(
    await consumePasswordReset(f.db, token, hashPassword('MustNotReplacePassword123!')),
    false,
  );
  assert.equal(
    (await f.db.get('SELECT count(*) n FROM sessions WHERE user_id=$1', [f.tenant.userId])).n,
    1,
  );
  assert.equal(
    (
      await f.db.get(
        "SELECT count(*) n FROM audit_logs WHERE actor_user_id=$1 AND action='PASSWORD_CHANGED'",
        [f.tenant.userId],
      )
    ).n,
    1,
  );
});
