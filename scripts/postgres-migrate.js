import fs from 'node:fs';
import path from 'node:path';
import { createPostgresDatabase, postgresOptions } from '../src/postgres/database.js';
import { migratePostgres } from '../src/postgres/migrate.js';

if (fs.existsSync(path.resolve('.env'))) process.loadEnvFile(path.resolve('.env'));
let db;
try {
  db = createPostgresDatabase(postgresOptions());
  const result = await migratePostgres(db);
  console.log(`PostgreSQL: ${result.migrations} migración(es) verificadas.`);
} catch (error) {
  // No connection URLs, credentials or driver stack traces in command output.
  console.error(
    'No se pudo migrar PostgreSQL.',
    error.code ? `Código: ${error.code}.` : error.message,
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
