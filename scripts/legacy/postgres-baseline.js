// One-time, reviewable schema conversion. Never loaded by the PostgreSQL runtime.
// Prints native PostgreSQL DDL; it does not read or modify an existing customer database.
import crypto from 'node:crypto';
import { openDatabase } from './sqlite-db.js';

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const shortName = (value) =>
  value.length <= 63
    ? value
    : value.slice(0, 45) +
      '_' +
      crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
const db = openDatabase(':memory:');
try {
  const objects = db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all();
  const tables = objects.filter(
    (entry) => entry.type === 'table' && entry.name !== 'schema_migrations',
  );
  const columns = new Map(
    tables.map(({ name }) => [name, db.prepare(`PRAGMA table_info(${quote(name)})`).all()]),
  );
  const statements = [
    '-- PostgreSQL baseline of legacy migrations 001–012. PostgreSQL runtime has no SQLite dependency.',
    '-- Monetary values and quantities use exact NUMERIC storage; identifiers and ISO dates retain their existing representation.',
    '-- Foreign keys are installed after all tables to support existing cyclic references.',
  ];
  const foreignKeys = [];
  for (const table of tables) {
    let sql = table.sql.replace(
      /\s+REFERENCES\s+\w+\s*\(\w+\)(?:\s+ON DELETE (?:CASCADE|SET NULL|RESTRICT|NO ACTION))?/gi,
      '',
    );
    sql = sql.replace(/\bREAL\b/g, 'NUMERIC').replace(/\s+COLLATE NOCASE/g, '');
    // Storage quotas can exceed the PostgreSQL int4 limit even for a single workshop.
    sql = sql.replace(/\b(storage_used_bytes|size_bytes) INTEGER\b/g, '$1 BIGINT');
    statements.push(sql + ';');
    for (const column of columns.get(table.name)) {
      if (column.type === 'REAL')
        statements.push(
          `ALTER TABLE ${quote(table.name)} ADD CONSTRAINT ${quote(shortName('finite_' + table.name + '_' + column.name))} CHECK (${quote(column.name)} IS NULL OR ${quote(column.name)} NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));`,
        );
    }
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all()) {
      if (fk.seq !== 0)
        throw new Error('Review composite legacy FK before generating: ' + table.name);
      foreignKeys.push({ child: table.name, ...fk });
    }
  }
  // Case-insensitive uniqueness is retained without requiring privileged extensions.
  statements.push('CREATE UNIQUE INDEX users_email_case_insensitive ON users(lower(email));');
  statements.push('CREATE UNIQUE INDEX memberships_single_tenant_user ON memberships(user_id);');
  for (const [name, entries] of columns) {
    if (entries.some((c) => c.name === 'tenant_id') && entries.some((c) => c.name === 'id')) {
      statements.push(
        `ALTER TABLE ${quote(name)} ADD CONSTRAINT ${quote(shortName('tenant_identity_' + name))} UNIQUE(tenant_id,id);`,
      );
    }
  }
  for (const fk of foreignKeys) {
    statements.push(
      `ALTER TABLE ${quote(fk.child)} ADD CONSTRAINT ${quote(shortName('fk_' + fk.child + '_' + fk.from))} FOREIGN KEY (${quote(fk.from)}) REFERENCES ${quote(fk.table)}(${quote(fk.to)}) ON DELETE ${fk.on_delete} DEFERRABLE INITIALLY IMMEDIATE;`,
    );
    if (
      fk.from !== 'tenant_id' &&
      columns.get(fk.child).some((c) => c.name === 'tenant_id') &&
      columns.get(fk.table)?.some((c) => c.name === 'tenant_id')
    ) {
      statements.push(
        `ALTER TABLE ${quote(fk.child)} ADD CONSTRAINT ${quote(shortName('tenant_fk_' + fk.child + '_' + fk.from))} FOREIGN KEY (tenant_id,${quote(fk.from)}) REFERENCES ${quote(fk.table)}(tenant_id,${quote(fk.to)}) DEFERRABLE INITIALLY IMMEDIATE;`,
      );
    }
  }
  for (const entry of objects.filter((entry) => ['index', 'view'].includes(entry.type)))
    statements.push(entry.sql + ';');
  statements.push(
    '-- Guards are native PL/pgSQL. Conditions run in the function because PostgreSQL trigger WHEN cannot contain subqueries.',
  );
  for (const trigger of objects.filter((entry) => entry.type === 'trigger')) {
    const match = trigger.sql.match(
      /^CREATE TRIGGER (?:IF NOT EXISTS )?(\w+) BEFORE (INSERT|DELETE|UPDATE(?: OF [\w, ]+?)?) ON ("?\w+"?)\s*(?:WHEN\s+([\s\S]+?)\s*)?BEGIN SELECT RAISE\(ABORT,'([^']+)'\); END$/i,
    );
    if (!match) throw new Error('Unrecognized trigger: ' + trigger.name);
    const [, name, event, table, originalCondition, message] = match;
    const fn = 'guard_' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 24);
    const condition = (originalCondition || 'TRUE')
      .replace(/\bIS NOT (OLD|NEW)\./g, 'IS DISTINCT FROM $1.')
      .replace(/\bIS (OLD|NEW)\./g, 'IS NOT DISTINCT FROM $1.');
    const errorCode = message.includes('tenant') ? '23503' : '23514';
    statements.push(
      `CREATE FUNCTION ${quote(fn)}() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$\nBEGIN\n  IF ${condition} THEN\n    RAISE EXCEPTION USING ERRCODE='${errorCode}', MESSAGE='${message}', CONSTRAINT='${shortName(name)}';\n  END IF;\n  RETURN ${event === 'DELETE' ? 'OLD' : 'NEW'};\nEND\n$guard$;\nCREATE TRIGGER ${quote(shortName(name))} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${quote(fn)}();`,
    );
  }
  process.stdout.write(statements.join('\n\n') + '\n');
} finally {
  db.close();
}
