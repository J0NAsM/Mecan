import fs from 'node:fs';
import path from 'node:path';
import { createPostgresBackup } from '../src/postgres/backups.js';
if (fs.existsSync(path.resolve('.env'))) process.loadEnvFile(path.resolve('.env'));
try {
  if (process.argv.length > 3) throw new Error('Uso: npm run backup -- [directorio-destino]');
  console.log(
    JSON.stringify(
      await createPostgresBackup({
        ...process.env,
        ...(process.argv[2] ? { BACKUP_PATH: process.argv[2] } : {}),
      }),
    ),
  );
} catch (error) {
  console.error(
    'Respaldo PostgreSQL no completado.',
    error.code ? `Código: ${error.code}.` : error.message,
  );
  process.exitCode = 1;
}
