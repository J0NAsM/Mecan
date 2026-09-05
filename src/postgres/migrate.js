import fs from 'node:fs';
import crypto from 'node:crypto';
import { quoteIdentifier } from './database.js';

const migrationFiles = [
  new URL('./migrations/001_baseline.sql', import.meta.url),
  new URL('./migrations/002_import_history.sql', import.meta.url),
];
export function postgresMigrations() {
  return migrationFiles.map((file) => {
    const id = file.pathname
      .split('/')
      .at(-1)
      .replace(/\.sql$/, '');
    const sql = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    return { id, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}
export async function migratePostgres(db) {
  return db.transaction(
    async () => {
      await db.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(db.schema)}`);
      await db.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      );
      const applied = await db.all('SELECT id,checksum FROM schema_migrations');
      const definitions = postgresMigrations();
      const available = definitions.map((entry) => entry.id);
      if (applied.some((entry) => !available.includes(entry.id)))
        throw new Error('La base tiene migraciones posteriores a esta versión.');
      for (const { id, sql, checksum } of definitions) {
        const existing = applied.find((entry) => entry.id === id);
        if (existing) {
          if (existing.checksum !== checksum)
            throw new Error('Una migración aplicada fue modificada: ' + id);
          continue;
        }
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations(id,checksum) VALUES ($1,$2)', [id, checksum]);
      }
      return { migrations: available.length };
    },
    { lockKey: `mecan:migrate:${db.schema}` },
  );
}
