// Offline import only. SQLite is a read-only migration source, never a PostgreSQL runtime fallback.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { openDatabase } from './sqlite-db.js';
import { financialIntegrityIssues } from '../../src/services/financial-integrity.js';
import { quoteIdentifier } from '../../src/postgres/database.js';
import { migratePostgres } from '../../src/postgres/migrate.js';

const legacyVersions = [
  '001_initial',
  '002_operational_workflow',
  '003_customer_security',
  '004_notification_delivery',
  '005_operational_hardening',
  '006_account_recovery_rate_limit',
  '007_release_integrity',
  '008_operational_closure',
  '009_notification_privacy',
  '010_no_charge_authorization',
  '011_payment_reversals',
  '012_partial_purchasing',
];

export async function importLegacyDatabase(db, sourceFile) {
  const source = path.resolve(sourceFile);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile())
    throw new Error('No existe el archivo SQLite de origen.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-pg-import-'));
  const copy = path.join(temp, 'source.db');
  let snapshot;
  try {
    const original = new DatabaseSync(source, { readOnly: true });
    try {
      await backup(original, copy);
    } finally {
      original.close();
    }
    // Upgrade ONLY the private copy. Keep the original database/WAL and credentials untouched.
    snapshot = openDatabase(copy);
    if (
      snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      snapshot.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('El origen no supera la verificación de integridad.');
    const versions = snapshot.prepare('SELECT * FROM schema_migrations ORDER BY id').all();
    if (JSON.stringify(versions.map((v) => v.id)) !== JSON.stringify(legacyVersions))
      throw new Error('El origen no corresponde a las versiones de migración admitidas.');
    const financialIssues = await financialIntegrityIssues(snapshot);
    if (financialIssues.length)
      throw new Error(
        'El origen requiere conciliación financiera antes de importarse: ' +
          financialIssues.join('; '),
      );
    const tables = snapshot
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    const metadata = tables.map((table) => {
      const columns = snapshot.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
      const primaryKey = columns
        .filter((column) => column.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      if (!primaryKey.length) throw new Error('Tabla sin identidad estable: ' + table);
      return { table, columns: columns.map((column) => column.name), primaryKey };
    });
    await migratePostgres(db);
    return await db.transaction(
      async () => {
        const targetTables = (
          await db.all(
            'SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type=$2 ORDER BY table_name',
            [db.schema, 'BASE TABLE'],
          )
        )
          .map((row) => row.table_name)
          .filter((table) => !['schema_migrations', 'legacy_imports'].includes(table));
        if (JSON.stringify(targetTables) !== JSON.stringify(tables))
          throw new Error('El esquema destino no coincide con el origen; no se importaron datos.');
        await db.query(
          `LOCK TABLE ${[...tables, 'legacy_imports'].map(quoteIdentifier).join(',')} IN ACCESS EXCLUSIVE MODE`,
        );
        for (const table of [...tables, 'legacy_imports'])
          if (
            (await db.get(`SELECT EXISTS(SELECT 1 FROM ${quoteIdentifier(table)}) occupied`))
              .occupied
          )
            throw new Error(
              'La importación solo admite un destino vacío. No se sobrescribió ningún registro.',
            );
        await db.query('SET CONSTRAINTS ALL DEFERRED');
        // Historical records are final snapshots (e.g. a received line is already fully received).
        // Replaying their original INSERT guards would replay the business action. Disable USER
        // triggers under exclusive locks for this transaction only; FK/check/unique constraints stay active.
        // Any exception rolls back both rows AND trigger state. All guards are restored before commit.
        for (const table of tables)
          await db.query(`ALTER TABLE ${quoteIdentifier(table)} DISABLE TRIGGER USER`);
        const rowCounts = {},
          digest = crypto.createHash('sha256');
        for (const { table, columns, primaryKey } of metadata) {
          const targetColumns = (
            await db.all(
              'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',
              [db.schema, table],
            )
          ).map((column) => column.column_name);
          if (JSON.stringify(targetColumns) !== JSON.stringify(columns))
            throw new Error('Las columnas del destino no coinciden: ' + table);
          rowCounts[table] = 0;
          const batch = [];
          const insertBatch = async () => {
            if (!batch.length) return;
            const values = batch.flatMap((row) => columns.map((column) => row[column]));
            const placeholders = batch
              .map(
                (row, i) =>
                  '(' +
                  columns.map((column, j) => '$' + (i * columns.length + j + 1)).join(',') +
                  ')',
              )
              .join(',');
            const inserted = await db.all(
              `INSERT INTO ${quoteIdentifier(table)}(${columns.map(quoteIdentifier).join(',')}) VALUES ${placeholders} RETURNING *`,
              values,
            );
            const byKey = new Map(
              inserted.map((row) => [JSON.stringify(primaryKey.map((key) => row[key])), row]),
            );
            for (const row of batch) {
              const identity = JSON.stringify(primaryKey.map((key) => row[key]));
              const actual = byKey.get(identity);
              const serialized = JSON.stringify(columns.map((column) => row[column]));
              if (!actual || JSON.stringify(columns.map((column) => actual[column])) !== serialized)
                throw new Error('Un registro cambió de valor durante la importación: ' + table);
              digest.update(JSON.stringify([table, columns, serialized]) + '\n');
            }
            rowCounts[table] += batch.length;
            batch.length = 0;
          };
          for (const row of snapshot
            .prepare(
              `SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${primaryKey.map(quoteIdentifier).join(',')}`,
            )
            .iterate()) {
            batch.push(row);
            if (batch.length === 200) await insertBatch();
          }
          await insertBatch();
          if (
            (await db.get(`SELECT COUNT(*) n FROM ${quoteIdentifier(table)}`)).n !==
            rowCounts[table]
          )
            throw new Error('El conteo de registros no coincide: ' + table);
        }
        await db.query('SET CONSTRAINTS ALL IMMEDIATE');
        for (const table of tables)
          await db.query(`ALTER TABLE ${quoteIdentifier(table)} ENABLE TRIGGER USER`);
        const sourceSha256 = digest.digest('hex');
        await db.query(
          'INSERT INTO legacy_imports(id,source_sha256,source_migrations,row_counts) VALUES($1,$2,$3,$4)',
          [crypto.randomUUID(), sourceSha256, JSON.stringify(versions), JSON.stringify(rowCounts)],
        );
        return {
          sourceSha256,
          tables: tables.length,
          rows: Object.values(rowCounts).reduce((sum, count) => sum + count, 0),
          rowCounts,
        };
      },
      { lockKey: `mecan:import:${db.schema}` },
    );
  } finally {
    snapshot?.close();
    // Only the exact mkdtemp directory owned by this import is removed, never the source.
    if (
      path.dirname(temp) === path.resolve(os.tmpdir()) &&
      path.basename(temp).startsWith('mecan-pg-import-')
    )
      fs.rmSync(temp, { recursive: true, force: true });
  }
}
