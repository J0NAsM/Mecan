import '../src/config.js';
import { createPostgresDatabase, postgresOptions } from '../src/postgres/database.js';
import { exportPostgresTenant } from '../src/postgres/export-tenant.js';
let db;
try {
  if (!process.argv[2] || process.argv.length > 4)
    throw new Error('Uso: npm run export-tenant -- <tenant-id> [destino.json]');
  db = createPostgresDatabase(postgresOptions());
  const target = await exportPostgresTenant(db, process.argv[2], process.argv[3]);
  console.log(
    'Exportación PostgreSQL consistente, sin contraseñas ni tokens: ' +
      target +
      '. Los binarios privados se conservan en el respaldo completo.',
  );
} catch (error) {
  console.error('Exportación no completada.', error.code ? 'Código: ' + error.code : error.message);
  process.exitCode = 1;
} finally {
  await db?.close();
}
