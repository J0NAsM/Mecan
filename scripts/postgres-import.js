import fs from 'node:fs';
import path from 'node:path';
import { createPostgresDatabase, postgresOptions } from '../src/postgres/database.js';
import { importLegacyDatabase } from './legacy/import-postgres.js';

if (fs.existsSync(path.resolve('.env'))) process.loadEnvFile(path.resolve('.env'));
let db;
try {
  if (process.argv.length !== 3)
    throw new Error('Uso: npm run postgres:import -- ruta/al/origen.db');
  db = createPostgresDatabase(postgresOptions());
  const result = await importLegacyDatabase(db, process.argv[2]);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    'No se pudo importar la base. El destino no recibió cambios parciales.',
    error.code ? `Código: ${error.code}.` : error.message,
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
