import { config, productionIssues } from '../src/config.js';
import { createPostgresDatabase, postgresOptions } from '../src/postgres/database.js';
import { postgresReadinessIssues } from '../src/postgres/readiness.js';
const issues = productionIssues();
if (!config.production) issues.push('NODE_ENV: production es obligatorio para el despliegue');
let db;
try {
  db = createPostgresDatabase(postgresOptions());
  const databaseIssues = await postgresReadinessIssues(db);
  issues.push(...databaseIssues);
  console.log(
    databaseIssues.length
      ? 'PostgreSQL: requiere atender los hallazgos indicados.'
      : 'PostgreSQL: migraciones, protecciones, saldos y caja verificados.',
  );
} catch (error) {
  // Driver diagnostics can contain private row values or connection details.
  issues.push(
    'PostgreSQL: no se pudo completar la comprobación de solo lectura' +
      (error.code
        ? ' (código ' + error.code + ')'
        : '. Revisar DATABASE_URL, DATABASE_* y el esquema'),
  );
} finally {
  await db?.close();
}
console.log(
  issues.length
    ? 'NO APTO PARA PUBLICACIÓN:\n' + issues.map((x) => '- ' + x).join('\n')
    : 'Configuración y verificaciones de base aptas. El acceso público, correo, recuperación externa y cobro real deben verificarse desde producción.',
);
process.exitCode = issues.length ? 1 : 0;
