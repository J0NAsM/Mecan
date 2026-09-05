import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../scripts/legacy/sqlite-db.js';
import { legacyFixture } from '../integration/fixtures/legacy.js';
import { createBackup, verifyBackup, within } from '../src/backups.js';
import { now } from '../src/utils.js';
async function fixture(file) {
  const { tenantA: tenant } = legacyFixture(file);
  const db = openDatabase(file);
  db.prepare('INSERT INTO customers(id,tenant_id,branch_id,name,created_at) VALUES(?,?,?,?,?)').run(
    'customer',
    tenant.tenantId,
    tenant.branchId,
    'Cliente visible',
    now(),
  );
  return { db, tenant };
}

test('backups incluyen archivos, detectan corrupción y rechazan rutas externas', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-backup-test-'));
  const settings = {
    databasePath: path.join(root, 'data', 'db.sqlite'),
    storagePath: path.join(root, 'storage'),
    backupPath: path.join(root, 'backups'),
  };
  const { db, tenant } = await fixture(settings.databasePath);
  try {
    const key = tenant.tenantId + '/file.pdf';
    fs.mkdirSync(path.dirname(within(settings.storagePath, key)), { recursive: true });
    fs.writeFileSync(within(settings.storagePath, key), '%PDF-test');
    await db
      .prepare(
        'INSERT INTO files (id,tenant_id,name,mime_type,storage_key,size_bytes,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run('file', tenant.tenantId, 'Documento', 'application/pdf', key, 9, tenant.userId, now());
    const result = createBackup(settings);
    assert.equal(verifyBackup(result.directory).files.length, 1);
    fs.writeFileSync(path.join(result.directory, 'storage', key), 'broken');
    assert.throws(() => verifyBackup(result.directory));
    assert.throws(() => within(settings.storagePath, '../secret'));
    assert.throws(() => within(settings.storagePath, settings.storagePath));
  } finally {
    await db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restauración recupera base y adjuntos y conserva copia previa', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-restore-test-'));
  const settings = {
    databasePath: path.join(root, 'data', 'mecan.db'),
    storagePath: path.join(root, 'storage'),
    backupPath: path.join(root, 'backups'),
  };
  let { db, tenant } = await fixture(settings.databasePath);
  try {
    const key = tenant.tenantId + '/test.pdf',
      file = within(settings.storagePath, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '%PDF-test');
    await db
      .prepare(
        'INSERT INTO files (id,tenant_id,name,mime_type,storage_key,size_bytes,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        'restore-file',
        tenant.tenantId,
        'Adjunto',
        'application/pdf',
        key,
        9,
        tenant.userId,
        now(),
      );
    const snapshot = createBackup(settings);
    await db.prepare("UPDATE customers SET name='Modificado' WHERE id='customer'").run();
    await db.close();
    db = null;
    fs.writeFileSync(file, 'changed');
    const result = spawnSync(
      process.execPath,
      ['scripts/legacy/restore-sqlite.js', snapshot.directory, '--confirm'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          DATABASE_PATH: settings.databasePath,
          STORAGE_PATH: settings.storagePath,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    db = await openDatabase(settings.databasePath);
    assert.equal(
      (await db.prepare("SELECT name FROM customers WHERE id='customer'").get()).name,
      'Cliente visible',
    );
    assert.equal(fs.readFileSync(file, 'utf8'), '%PDF-test');
    assert.ok(
      fs
        .readdirSync(path.dirname(settings.databasePath))
        .some((f) => f.includes('.before-restore-')),
    );
  } finally {
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migración de avisos conserva lecturas conocidas y detiene destinatarios históricos cruzados', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-notification-upgrade-'));
  const file = path.join(root, 'db.sqlite');
  let { db, tenant } = await fixture(file);
  const legacySchema = async (connection) =>
    await connection.exec(`
    DROP TABLE notification_reads;
    DROP TRIGGER notification_recipient_insert;
    DROP TRIGGER notification_recipient_update;
    DROP INDEX notification_audience;
    ALTER TABLE notifications DROP COLUMN required_permission;
    DELETE FROM schema_migrations WHERE id='009_notification_privacy';
  `);
  const insertLegacy = async (notificationId, recipient) =>
    await db
      .prepare(
        "INSERT INTO notifications(id,tenant_id,user_id,channel,event_type,title,message,payload,status,idempotency_key,scheduled_at,created_at,read_at) VALUES(?,?,?,'IN_APP','PAYMENT_RECEIVED','Cobro','Detalle','{}','READ',?,?,?,?)",
      )
      .run(notificationId, tenant.tenantId, recipient, notificationId, now(), now(), now());
  try {
    await legacySchema(db);
    await insertLegacy('legacy-known', tenant.userId);
    await db.close();
    db = await openDatabase(file);
    assert.equal(
      (
        await db
          .prepare("SELECT required_permission FROM notifications WHERE id='legacy-known'")
          .get()
      ).required_permission,
      'billing.view',
    );
    assert.equal(
      (
        await db
          .prepare("SELECT user_id FROM notification_reads WHERE notification_id='legacy-known'")
          .get()
      ).user_id,
      tenant.userId,
    );
    const other = await db.prepare("SELECT id AS userId FROM users WHERE email='b@pg.test'").get();
    await legacySchema(db);
    await insertLegacy('legacy-crossed', other.userId);
    await db.close();
    db = null;
    await assert.rejects(async () => await openDatabase(file), /destinatarios de otro taller/);
    db = new DatabaseSync(file, { readOnly: true });
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id='009_notification_privacy'")
          .get()
      ).n,
      0,
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) n FROM notifications WHERE id='legacy-crossed'").get()).n,
      1,
      'No borra datos históricos para aprobar la migración',
    );
  } finally {
    await db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
