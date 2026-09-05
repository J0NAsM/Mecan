import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createPostgresDatabase,
  postgresOptions,
  quoteIdentifier,
} from '../src/postgres/database.js';
import { migratePostgres } from '../src/postgres/migrate.js';
import { importLegacyDatabase } from '../scripts/legacy/import-postgres.js';
import { openDatabase } from '../scripts/legacy/sqlite-db.js';
import { verifyPassword } from '../src/auth.js';
import { legacyFixture } from './fixtures/legacy.js';
import { publicError } from '../src/errors.js';
import { now } from '../src/utils.js';
import {
  createPostgresBackup,
  restorePostgresBackup,
  verifyPostgresBackup,
} from '../src/postgres/backups.js';

test('configuración PostgreSQL no admite TLS inseguro ni inyección por parámetros', () => {
  assert.throws(() => postgresOptions({}), /DATABASE_URL/);
  assert.throws(
    () =>
      postgresOptions({
        DATABASE_URL: 'postgres://user@db.internal/app',
        DATABASE_SSL_MODE: 'disable',
      }),
    /TLS/,
  );
  assert.throws(
    () => postgresOptions({ DATABASE_URL: 'postgres://user@localhost/app?sslmode=no-verify' }),
    /DATABASE_URL/,
  );
  assert.throws(
    () =>
      postgresOptions({
        DATABASE_URL: 'postgres://user@localhost/app',
        DATABASE_SCHEMA: 'a;DROP SCHEMA mecan',
      }),
    /Identificador/,
  );
  assert.throws(
    () =>
      postgresOptions({
        DATABASE_URL: 'postgres://user@localhost/app',
        DATABASE_POOL_MAX: '10000',
      }),
    /DATABASE_POOL_MAX/,
  );
  const valid = postgresOptions({
    DATABASE_URL: 'postgres://user@db.internal/app',
    NODE_ENV: 'production',
  });
  assert.equal(valid.ssl.rejectUnauthorized, true);
  assert.throws(() => quoteIdentifier('pg_catalog;'), /Identificador/);
});

test('PostgreSQL real: migración, importación íntegra, aislamiento y concurrencia', async (t) => {
  // Missing PostgreSQL is a failure, not a skipped or simulated integration test.
  const schema = 'test_pg_' + crypto.randomBytes(12).toString('hex');
  const options = { ...postgresOptions(), schema, max: 4 };
  const db = createPostgresDatabase(options),
    otherPool = createPostgresDatabase(options);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-pg-test-'));
  const source = path.join(temp, 'legacy.db');
  let legacy;
  try {
    assert.match((await db.get('SELECT version() version')).version, /PostgreSQL/);
    await t.test('migraciones atómicas, repetibles y esquema nativo completo', async () => {
      assert.deepEqual(await migratePostgres(db), { migrations: 2 });
      assert.deepEqual(await migratePostgres(db), { migrations: 2 });
      assert.equal(
        (
          await db.get(
            "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",
            [schema],
          )
        ).n,
        74,
      );
      assert.equal(
        (
          await db.get(
            'SELECT COUNT(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal',
            [schema],
          )
        ).n,
        184,
      );
      assert.ok(
        (
          await db.get(
            "SELECT COUNT(*) n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.conname LIKE 'tenant_fk_%'",
            [schema],
          )
        ).n > 70,
      );
      assert.equal(
        (
          await db.get(
            "SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='workshop_payments' AND column_name='amount'",
            [schema],
          )
        ).data_type,
        'numeric',
      );
    });
    const { tenantA, tenantB, receipt, originalPassword } = legacyFixture(source);
    const originalBytes = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    await t.test(
      'importa todas las tablas, valores, historial, cobros y recepciones sin tocar SQLite',
      async () => {
        const imported = await importLegacyDatabase(db, source);
        assert.equal(imported.tables, 72);
        assert.equal(imported.rowCounts.tenants, 2);
        assert.equal(imported.rowCounts.purchase_receipts, 2);
        assert.equal(imported.rowCounts.payment_reversals, 1);
        assert.equal(imported.rowCounts.cash_movements, 3);
        assert.equal(
          (await db.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
          4,
        );
        assert.deepEqual(
          await db.get(
            'SELECT amount,paid_amount,balance,status FROM accounts_payable WHERE id=$1',
            [receipt.payableId],
          ),
          { amount: 2200, paid_amount: 1000, balance: 1200, status: 'PARTIAL' },
        );
        const password = (
          await db.get('SELECT password_hash FROM users WHERE id=$1', [tenantA.userId])
        ).password_hash;
        assert.equal(password, originalPassword);
        assert.equal(verifyPassword('PgTestingOnly123!', password), true);
        assert.equal(
          crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
          originalBytes,
        );
        assert.equal((await db.get('SELECT COUNT(*) n FROM legacy_imports')).n, 1);
        await assert.rejects(importLegacyDatabase(db, source), /destino vacío/);
        assert.equal((await db.get('SELECT COUNT(*) n FROM tenants')).n, 2);
      },
    );
    await t.test(
      'rechaza referencias entre talleres, stock negativo y movimientos históricos alterados',
      async () => {
        for (const sql of [
          ['UPDATE vehicles SET customer_id=$1 WHERE id=$2', ['customer-b', 'vehicle-a']],
          ['UPDATE customers SET tenant_id=$1 WHERE id=$2', [tenantB.tenantId, 'customer-a']],
          ['UPDATE inventory_items SET branch_id=$1 WHERE id=$2', [tenantB.branchId, 'part']],
          ["UPDATE inventory_items SET quantity=-1 WHERE id='part'", []],
          ["UPDATE inventory_items SET quantity='NaN' WHERE id='part'", []],
          ['UPDATE payment_reversals SET amount=1', []],
          ['DELETE FROM purchase_receipts', []],
          [
            "INSERT INTO users(id,email,password_hash,name,kind,created_at) VALUES('duplicate','A@PG.TEST','x','x','TENANT',$1)",
            [now()],
          ],
        ])
          await assert.rejects(db.query(...sql), (error) =>
            ['23503', '23514', '23505'].includes(error.code),
          );
        assert.equal(
          (await db.get("SELECT customer_id FROM vehicles WHERE id='vehicle-a'")).customer_id,
          'customer-a',
        );
        assert.equal(
          (await db.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
          4,
        );
        assert.equal(
          (
            await db.get(
              "SELECT COUNT(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgenabled<>'O'",
              [schema],
            )
          ).n,
          0,
        );
      },
    );
    await t.test(
      'una importación con referencias históricas inválidas revierte todos los registros y reactiva los guards',
      async () => {
        const invalidSource = path.join(temp, 'invalid-source.db');
        fs.copyFileSync(source, invalidSource, fs.constants.COPYFILE_EXCL);
        const invalid = openDatabase(invalidSource);
        try {
          invalid.exec(
            'DROP TRIGGER ownership_vehicles_update; DROP TRIGGER tenant_guard_vehicle_update;',
          );
          invalid
            .prepare("UPDATE vehicles SET customer_id='customer-b' WHERE id='vehicle-a'")
            .run();
        } finally {
          invalid.close();
        }
        const rollbackSchema = 'test_pg_' + crypto.randomBytes(12).toString('hex');
        const rollbackDb = createPostgresDatabase({ ...options, schema: rollbackSchema });
        try {
          await assert.rejects(
            importLegacyDatabase(rollbackDb, invalidSource),
            (error) => error.code === '23503',
          );
          assert.equal((await rollbackDb.get('SELECT COUNT(*) n FROM tenants')).n, 0);
          assert.equal((await rollbackDb.get('SELECT COUNT(*) n FROM users')).n, 0);
          assert.equal((await rollbackDb.get('SELECT COUNT(*) n FROM legacy_imports')).n, 0);
          assert.equal(
            (
              await rollbackDb.get(
                "SELECT COUNT(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgenabled<>'O'",
                [rollbackSchema],
              )
            ).n,
            0,
          );
          // After failure, a valid retry still imports successfully with all checks enabled.
          assert.equal((await importLegacyDatabase(rollbackDb, source)).rowCounts.tenants, 2);
        } finally {
          if (/^test_pg_[a-f0-9]{24}$/.test(rollbackSchema))
            await rollbackDb.query(
              `DROP SCHEMA IF EXISTS ${quoteIdentifier(rollbackSchema)} CASCADE`,
            );
          await rollbackDb.close();
        }
      },
    );
    await t.test(
      'rollback íntegro, mismo cliente y fallo SQL capturado nunca se presenta como éxito',
      async () => {
        await assert.rejects(
          db.transaction(async () => {
            const first = await db.get('SELECT pg_backend_pid() pid');
            await db.transaction(async () =>
              assert.equal((await db.get('SELECT pg_backend_pid() pid')).pid, first.pid),
            );
            await db.query("UPDATE inventory_items SET quantity=9 WHERE id='part'");
            throw new Error('failure injection');
          }),
          /failure injection/,
        );
        assert.equal(
          (await db.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
          4,
        );
        await assert.rejects(
          db.transaction(async () => {
            try {
              await db.query("UPDATE inventory_items SET quantity=-1 WHERE id='part'");
            } catch {
              /* intentional caller failure */
            }
            return 'must not report success';
          }),
          (error) => error.code === '23514',
        );
        await assert.rejects(
          db.transaction(() => db.query("UPDATE inventory_items SET quantity=9 WHERE id='part'"), {
            readOnly: true,
          }),
          (error) => error.code === '25006',
        );
        await assert.rejects(
          db.transaction(async () => {
            try {
              await db.transaction(async () => {
                await db.query("UPDATE inventory_items SET quantity=10 WHERE id='part'");
                throw new Error('nested validation');
              });
            } catch {
              /* The outer callback cannot commit a failed nested operation. */
            }
          }),
          /nested validation/,
        );
        assert.equal(
          (await db.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
          4,
        );
        let detached;
        await assert.rejects(
          db.transaction(async () => {
            detached = db.query('SELECT pg_sleep(0.03)');
          }),
          /sin esperar/,
        );
        await detached;
        let late;
        await db.transaction(async () => {
          late = delay(30).then(() =>
            assert.rejects(
              db.query("UPDATE inventory_items SET quantity=99 WHERE id='part'"),
              /finalizada/,
            ),
          );
        });
        await late;
        assert.equal(
          (await db.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
          4,
        );
      },
    );
    await t.test(
      'bloqueo por tenant evita actualizaciones perdidas entre pools sin serializar otros tenants',
      async () => {
        await db.query(
          "INSERT INTO document_sequences(tenant_id,kind,next_value) VALUES($1,'PG_TEST',1)",
          [tenantA.tenantId],
        );
        await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            (index % 2 ? otherPool : db).transaction(
              async (connection) => {
                const current = await connection.get(
                  "SELECT next_value FROM document_sequences WHERE tenant_id=$1 AND kind='PG_TEST'",
                  [tenantA.tenantId],
                );
                await delay(2);
                await connection.query(
                  "UPDATE document_sequences SET next_value=$1 WHERE tenant_id=$2 AND kind='PG_TEST'",
                  [current.next_value + 1, tenantA.tenantId],
                );
              },
              { lockKey: `tenant:${tenantA.tenantId}` },
            ),
          ),
        );
        assert.equal(
          (
            await db.get(
              "SELECT next_value FROM document_sequences WHERE tenant_id=$1 AND kind='PG_TEST'",
              [tenantA.tenantId],
            )
          ).next_value,
          21,
        );
        let release, ready;
        const holding = new Promise((resolve) => {
          release = resolve;
        });
        const entered = new Promise((resolve) => {
          ready = resolve;
        });
        const tx = db.transaction(
          async () => {
            ready();
            await holding;
          },
          { lockKey: `tenant:${tenantA.tenantId}` },
        );
        await entered;
        try {
          const unlocked = await Promise.race([
            otherPool.transaction(() => true, { lockKey: `tenant:${tenantB.tenantId}` }),
            delay(2000).then(() => false),
          ]);
          assert.equal(unlocked, true);
        } finally {
          release();
          await tx;
        }
      },
    );
    await t.test(
      'errores PostgreSQL se convierten en mensajes de usuario sin SQL ni datos privados',
      async () => {
        for (const code of ['23505', '23503', '23514', '40001', '40P01', '08006', '22P02']) {
          const result = publicError({
            code,
            message: 'SQL SECRET private_column postgres://private',
          });
          assert.ok(result.status >= 400 && result.status < 600);
          assert.doesNotMatch(result.message, /SECRET|SQL|private|postgres/);
        }
      },
    );
    await t.test(
      'pg_dump y pg_restore recuperan PostgreSQL y archivos en otra base sin sobrescribir origen',
      async () => {
        const storage = path.join(temp, 'storage');
        const key = tenantA.tenantId + '/private-document.txt';
        fs.mkdirSync(path.dirname(path.join(storage, key)), { recursive: true });
        const content = 'Adjunto privado de prueba PostgreSQL';
        fs.writeFileSync(path.join(storage, key), content, { flag: 'wx' });
        await db.query(
          'INSERT INTO files(id,tenant_id,name,mime_type,storage_key,size_bytes,uploaded_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            'pg-file',
            tenantA.tenantId,
            'document.txt',
            'text/plain',
            key,
            Buffer.byteLength(content),
            tenantA.userId,
            now(),
          ],
        );
        const env = {
          ...process.env,
          DATABASE_SCHEMA: schema,
          STORAGE_PATH: storage,
          BACKUP_PATH: path.join(temp, 'backups'),
        };
        const backup = await createPostgresBackup(env);
        assert.equal((await verifyPostgresBackup(backup.directory)).files.length, 1);
        await assert.rejects(restorePostgresBackup(backup.directory, env), /otra base vacía/);
        const restoreName = 'mecan_restore_' + crypto.randomBytes(12).toString('hex');
        const url = new URL(options.connectionString);
        url.pathname = '/' + restoreName;
        const destination = {
          ...env,
          DATABASE_URL: url.href,
          STORAGE_PATH: path.join(temp, 'restored-storage'),
        };
        await db.query('CREATE DATABASE ' + quoteIdentifier(restoreName));
        let restored;
        try {
          assert.deepEqual(await restorePostgresBackup(backup.directory, destination), {
            engine: 'postgres',
            files: 1,
            restored: true,
          });
          restored = createPostgresDatabase(postgresOptions(destination));
          assert.equal((await restored.get('SELECT COUNT(*) n FROM tenants')).n, 2);
          assert.equal((await restored.get('SELECT COUNT(*) n FROM purchase_receipts')).n, 2);
          assert.equal(
            (await restored.get("SELECT quantity FROM inventory_items WHERE id='part'")).quantity,
            4,
          );
          assert.equal(fs.readFileSync(path.join(destination.STORAGE_PATH, key), 'utf8'), content);
          await assert.rejects(
            restored.query("UPDATE inventory_items SET quantity=-1 WHERE id='part'"),
            (error) => error.code === '23514',
          );
          await assert.rejects(
            restorePostgresBackup(backup.directory, {
              ...destination,
              STORAGE_PATH: path.join(temp, 'empty'),
            }),
            /base de restauración debe estar vacía/,
          );
          fs.appendFileSync(path.join(backup.directory, 'database.dump'), 'tamper');
          await assert.rejects(verifyPostgresBackup(backup.directory), /modificado/);
        } finally {
          await restored?.close();
          if (/^mecan_restore_[a-f0-9]{24}$/.test(restoreName))
            await db.query('DROP DATABASE ' + quoteIdentifier(restoreName));
        }
      },
    );
  } finally {
    legacy?.close();
    await otherPool.close();
    // Exact, randomly generated test schema only. Never mecan/public or user-selected targets.
    if (/^test_pg_[a-f0-9]{24}$/.test(schema))
      await db.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await db.close();
    if (
      path.dirname(temp) === path.resolve(os.tmpdir()) &&
      path.basename(temp).startsWith('mecan-pg-test-')
    )
      fs.rmSync(temp, { recursive: true, force: true });
  }
});
