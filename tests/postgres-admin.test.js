import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openTestDatabase } from './helpers/postgres.js';
import { seedDatabase } from '../src/db.js';
import { provisionWorkshop } from '../src/domain.js';
import { postgresReadinessIssues } from '../src/postgres/readiness.js';
import { exportPostgresTenant } from '../src/postgres/export-tenant.js';
import { queueNotification } from '../src/notifications.js';
import { now } from '../src/utils.js';

async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, {
    superadminEmail: 'root@example.test',
    superadminPassword: 'AdminTestPassword123!',
  });
  const tenant = await provisionWorkshop(db, {
    ownerName: 'Ana',
    workshopName: 'Taller A',
    email: 'owner@example.test',
    password: 'TenantTestPassword123!',
    planId: 'plan-pro',
  });
  return { db, tenant };
}

test('comprobación de publicación PostgreSQL es de solo lectura y detecta guards y migraciones alterados', async () => {
  const { db } = await fixture();
  const baseline = await db.transaction(() => postgresReadinessIssues(db), {
    readOnly: true,
    isolation: 'REPEATABLE READ',
  });
  assert.ok(baseline.some((issue) => issue.includes('Accesos locales/demo')));
  assert.equal(
    baseline.filter(
      (issue) => !issue.startsWith('Accesos locales/demo') && !issue.startsWith('DATABASE_URL:'),
    ).length,
    0,
  );
  await db.exec('ALTER TABLE inventory_movements DISABLE TRIGGER USER');
  assert.ok((await postgresReadinessIssues(db)).some((issue) => issue.includes('protección(es)')));
  await db.exec('ALTER TABLE inventory_movements ENABLE TRIGGER USER');
  await db.exec('ALTER TABLE audit_logs DROP CONSTRAINT fk_audit_logs_actor_user_id');
  assert.ok(
    (await postgresReadinessIssues(db)).some((issue) =>
      issue.includes('restricción(es) esperadas faltantes'),
    ),
  );
  await db.run("UPDATE schema_migrations SET checksum='invalid' WHERE id='001_baseline'");
  assert.ok(
    (await postgresReadinessIssues(db)).some((issue) => issue.includes('checksum incompatible')),
  );
  // Checker must not fix the marker silently.
  assert.equal(
    (await db.get("SELECT checksum FROM schema_migrations WHERE id='001_baseline'")).checksum,
    'invalid',
  );
});

test('exportación PostgreSQL recorre cursores, excluye otro taller y secretos, y no sobrescribe archivos', async () => {
  const { db, tenant } = await fixture();
  const other = await provisionWorkshop(db, {
    ownerName: 'Bruno privado',
    workshopName: 'Taller B privado',
    email: 'neighbor@example.test',
    password: 'NeighborTestPassword123!',
    planId: 'plan-pro',
  });
  await db.run(
    `INSERT INTO customers(id,tenant_id,branch_id,name,created_at)
    SELECT 'client-' || n,$1,$2,'Cliente ' || n,$3 FROM generate_series(1,450) n`,
    [tenant.tenantId, tenant.branchId, now()],
  );
  await db.run(
    'INSERT INTO customers(id,tenant_id,branch_id,name,created_at) VALUES($1,$2,$3,$4,$5)',
    ['private-client', other.tenantId, other.branchId, 'Dato ajeno confidencial', now()],
  );
  await queueNotification(db, {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    channel: 'EMAIL',
    eventType: 'PASSWORD_RESET',
    title: 'Recuperación',
    message: 'No exportar',
    payload: { resetUrl: 'https://example.test/?token=secret-test-token' },
    idempotencyKey: 'private-reset',
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mecan-export-test-'));
  const target = path.join(directory, 'tenant.json');
  try {
    assert.equal(await exportPostgresTenant(db, tenant.tenantId, target), target);
    const raw = await fs.readFile(target, 'utf8'),
      data = JSON.parse(raw);
    assert.equal(data.engine, 'postgres');
    assert.equal(data.customers.length, 450);
    assert.deepEqual(
      data.users.map((user) => user.id),
      [tenant.userId],
    );
    for (const secret of [
      'Dato ajeno confidencial',
      'Bruno privado',
      other.tenantId,
      'scrypt:',
      'password_hash',
      'secret-test-token',
      'PASSWORD_RESET',
    ])
      assert.equal(raw.includes(secret), false, secret);
    assert.equal(data.sessions, undefined);
    assert.equal(data.password_reset_tokens, undefined);
    await assert.rejects(exportPostgresTenant(db, tenant.tenantId, target), { code: 'EEXIST' });
    assert.equal(await fs.readFile(target, 'utf8'), raw);
    await assert.rejects(
      exportPostgresTenant(db, 'non-existent', path.join(directory, 'missing.json')),
      /Taller no encontrado/,
    );
  } finally {
    await fs.rm(directory, { recursive: true }); // This test's exact mkdtemp directory only.
  }
});
