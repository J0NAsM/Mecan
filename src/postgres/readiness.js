import { postgresMigrations } from './migrate.js';
import { financialIntegrityIssues } from '../services/financial-integrity.js';

// Diagnostic only: never migrates, repairs, seeds or deletes data.
export async function postgresReadinessIssues(db) {
  return db.transaction(
    async () => {
      const issues = [];
      if (
        !(await db.get('SELECT to_regclass($1) relation', [db.schema + '.schema_migrations']))
          .relation
      )
        return ['PostgreSQL: esquema sin inicializar; ejecutar npm run migrate antes del arranque'];
      const definitions = postgresMigrations();
      const applied = await db.all('SELECT id,checksum FROM schema_migrations');
      for (const expected of definitions) {
        const actual = applied.find((row) => row.id === expected.id);
        if (!actual) issues.push('PostgreSQL: falta la migración ' + expected.id);
        else if (actual.checksum !== expected.checksum)
          issues.push('PostgreSQL: checksum incompatible en ' + expected.id);
      }
      if (applied.some((row) => !definitions.some((expected) => expected.id === row.id)))
        issues.push('PostgreSQL: la base contiene migraciones desconocidas para esta versión');
      if (issues.length) return issues;
      const triggers = await db.all(
        `SELECT t.tgname name,t.tgenabled enabled FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND NOT t.tgisinternal`,
        [db.schema],
      );
      const expectedTriggers = definitions.flatMap((entry) =>
        [...entry.sql.matchAll(/CREATE TRIGGER "([a-z_0-9]+)"/g)].map((match) => match[1]),
      );
      const missing = expectedTriggers.filter(
        (name) => !triggers.some((t) => t.name === name && ['O', 'A'].includes(t.enabled)),
      );
      if (missing.length)
        issues.push(
          `PostgreSQL: ${missing.length} protección(es) de datos faltantes o deshabilitadas`,
        );
      const constraints = await db.all(
        `SELECT c.conname name,r.relname relation FROM pg_constraint c
        JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class r ON r.oid=c.conrelid WHERE n.nspname=$1`,
        [db.schema],
      );
      const expectedConstraints = definitions.flatMap((entry) =>
        [...entry.sql.matchAll(/ALTER TABLE "([a-z_0-9]+)" ADD CONSTRAINT "([a-z_0-9]+)"/g)].map(
          (match) => ({ relation: match[1], name: match[2] }),
        ),
      );
      const missingConstraints = expectedConstraints.filter(
        (expected) =>
          !constraints.some(
            (actual) => actual.name === expected.name && actual.relation === expected.relation,
          ),
      );
      if (missingConstraints.length)
        issues.push(`PostgreSQL: ${missingConstraints.length} restricción(es) esperadas faltantes`);
      const disabledInternal = await db.get(
        `SELECT count(*) n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgisinternal AND t.tgenabled NOT IN ('O','A')`,
        [db.schema],
      );
      if (disabledInternal.n)
        issues.push('PostgreSQL: existen controles internos de integridad deshabilitados');
      const invalidConstraints = await db.get(
        `SELECT count(*) n FROM pg_constraint c
      JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND NOT c.convalidated`,
        [db.schema],
      );
      if (invalidConstraints.n) issues.push('PostgreSQL: existen restricciones sin validar');
      const invalidIndexes = await db.get(
        `SELECT count(*) n FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND (NOT i.indisvalid OR NOT i.indisready)`,
        [db.schema],
      );
      if (invalidIndexes.n) issues.push('PostgreSQL: existen índices no válidos o incompletos');
      issues.push(...(await financialIntegrityIssues(db)));
      const saas = await db.get(`SELECT count(*) n FROM saas_invoices i LEFT JOIN
      (SELECT invoice_id,tenant_id,sum(amount) paid FROM saas_payments WHERE status='APPROVED' GROUP BY invoice_id,tenant_id) p
      ON p.invoice_id=i.id AND p.tenant_id=i.tenant_id WHERE i.paid_amount<>COALESCE(p.paid,0)
      OR i.balance<>i.amount-COALESCE(p.paid,0) OR i.balance<0
      OR i.status<>CASE WHEN i.balance=0 THEN 'PAID' WHEN COALESCE(p.paid,0)>0 THEN 'PARTIAL' ELSE 'PENDING' END`);
      if (saas.n)
        issues.push(`Cobranza SaaS: ${saas.n} saldo(s) o estado(s) no coinciden con sus pagos`);
      if (
        await db.get(
          "SELECT 1 FROM users WHERE active=1 AND email ~* '\\.(local|test|invalid|example)$' LIMIT 1",
        )
      )
        issues.push(
          'Accesos locales/demo activos: revisar y desactivar antes de utilizar esta base en producción',
        );
      if (
        !(await db.get(
          "SELECT 1 FROM users WHERE active=1 AND kind='PLATFORM' AND platform_role='SUPER_ADMIN' LIMIT 1",
        ))
      )
        issues.push('No existe un administrador de plataforma activo');
      if (
        await db.get(
          'SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)',
        )
      )
        issues.push(
          'DATABASE_URL: el usuario de la aplicación debe carecer de privilegios de superusuario, creación de roles/bases, replicación y bypass RLS',
        );
      return issues;
    },
    { isolation: 'REPEATABLE READ', readOnly: true },
  );
}
