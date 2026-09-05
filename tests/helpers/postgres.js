import { after } from 'node:test';
import crypto from 'node:crypto';
import { openDatabase } from '../../src/db.js';
import {
  createPostgresDatabase,
  postgresOptions,
  quoteIdentifier,
} from '../../src/postgres/database.js';

const schemas = new Set(),
  connections = new Set();
export async function openTestDatabase() {
  const schema = 'test_app_' + crypto.randomBytes(12).toString('hex');
  schemas.add(schema);
  const db = await openDatabase({ ...postgresOptions(), schema });
  connections.add(db);
  return db;
}
export function connectTestDatabase(schema) {
  if (!schemas.has(schema))
    throw new Error('Solo se permite reconectar un esquema de esta prueba.');
  const db = createPostgresDatabase({ ...postgresOptions(), schema });
  connections.add(db);
  return db;
}
after(async () => {
  for (const db of connections) await db.close();
  if (!schemas.size) return;
  const control = createPostgresDatabase(postgresOptions());
  try {
    for (const schema of schemas) {
      if (!/^test_app_[a-f0-9]{24}$/.test(schema))
        throw new Error('Esquema de prueba no reconocido.');
      await control.query('DROP SCHEMA IF EXISTS ' + quoteIdentifier(schema) + ' CASCADE');
    }
  } finally {
    await control.close();
  }
});
