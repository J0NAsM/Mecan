import { createPostgresDatabase, postgresOptions } from './postgres/database.js';
import { migratePostgres } from './postgres/migrate.js';
export { seedDatabase, seedDemoTenant, resetExpiredSessions } from './seed.js';
export const databaseEngine = 'postgres';

export async function openDatabase(options = postgresOptions()) {
  if (typeof options === 'string')
    throw new Error('PostgreSQL requiere opciones de conexión, no una ruta SQLite.');
  const db = createPostgresDatabase(options);
  try {
    await migratePostgres(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
