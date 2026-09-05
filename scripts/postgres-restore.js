import fs from 'node:fs';
import path from 'node:path';
import { restorePostgresBackup } from '../src/postgres/backups.js';
if (fs.existsSync(path.resolve('.env'))) process.loadEnvFile(path.resolve('.env'));
try {
  if (
    process.argv.length !== 3 ||
    !process.env.RESTORE_DATABASE_URL ||
    !process.env.RESTORE_STORAGE_PATH
  )
    throw new Error(
      'Indica el directorio del respaldo y configura RESTORE_DATABASE_URL y RESTORE_STORAGE_PATH para un destino vacío separado.',
    );
  console.log(
    JSON.stringify(
      await restorePostgresBackup(process.argv[2], {
        ...process.env,
        DATABASE_URL: process.env.RESTORE_DATABASE_URL,
        STORAGE_PATH: process.env.RESTORE_STORAGE_PATH,
      }),
    ),
  );
} catch (error) {
  console.error(
    'Restauración PostgreSQL no verificada.',
    error.code ? `Código: ${error.code}.` : error.message,
  );
  process.exitCode = 1;
}
