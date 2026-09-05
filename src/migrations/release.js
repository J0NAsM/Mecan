// All ownership checks are installed transactionally after validating the existing schema.
export function releaseMigration(db) {
  let sql = `
    ALTER TABLE estimates ADD COLUMN tax_rate REAL;
    UPDATE estimates SET tax_rate=CASE WHEN subtotal>0 THEN tax*100/subtotal ELSE 0 END;
    ALTER TABLE workshop_invoices ADD COLUMN currency TEXT;
    UPDATE workshop_invoices SET currency=(SELECT currency FROM tenant_settings WHERE tenant_id=workshop_invoices.tenant_id);
    ALTER TABLE notifications ADD COLUMN locked_until TEXT;
    ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE customers ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE vehicles ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE tenant_settings ADD COLUMN warranty_days INTEGER NOT NULL DEFAULT 90;
    ALTER TABLE tenant_settings ADD COLUMN warranty_terms TEXT NOT NULL DEFAULT 'Garantía sobre los trabajos realizados.';
    ALTER TABLE stock_reservations ADD COLUMN idempotency_key TEXT;
    CREATE UNIQUE INDEX reservation_idempotency ON stock_reservations(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    ALTER TABLE inventory_transfers ADD COLUMN destination_item_id TEXT REFERENCES inventory_items(id);
    CREATE TABLE legal_acceptances (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),tenant_id TEXT NOT NULL REFERENCES tenants(id),
      terms_version TEXT NOT NULL,privacy_version TEXT NOT NULL,accepted_at TEXT NOT NULL
    );
    CREATE TABLE request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE stock_returns (
      id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),part_id TEXT NOT NULL REFERENCES work_order_parts(id),
      quantity REAL NOT NULL CHECK(quantity>0),reason TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,UNIQUE(tenant_id,idempotency_key)
    );
    CREATE UNIQUE INDEX cash_idempotency ON cash_movements(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX login_ip_time ON login_attempts(ip_hash,attempted_at);
    CREATE INDEX login_identity_time ON login_attempts(identity_hash,attempted_at);
  `;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  const columns = new Map(
    tables.map(({ name }) => [
      name,
      db
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((c) => c.name),
    ]),
  );
  for (const [table, names] of columns) {
    if (!names.includes('tenant_id')) continue;
    const references = db
      .prepare(`PRAGMA foreign_key_list("${table}")`)
      .all()
      .filter((fk) => columns.get(fk.table)?.includes('tenant_id'));
    for (const fk of references) {
      const invalid = db
        .prepare(
          `SELECT 1 FROM "${table}" child JOIN "${fk.table}" parent ON parent."${fk.to}"=child."${fk.from}" WHERE child.tenant_id IS NOT parent.tenant_id LIMIT 1`,
        )
        .get();
      if (invalid)
        throw new Error(
          'Migración detenida: hay asociaciones entre talleres en ' +
            table +
            '. Restaura el respaldo o corrige los registros antes de continuar.',
        );
    }
    if (references.length) {
      const invalid = references
        .map(
          (fk) =>
            `(NEW."${fk.from}" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "${fk.table}" p WHERE p."${fk.to}"=NEW."${fk.from}" AND p.tenant_id=NEW.tenant_id))`,
        )
        .join(' OR ');
      for (const event of ['INSERT', 'UPDATE'])
        sql += `CREATE TRIGGER ownership_${table}_${event.toLowerCase()} BEFORE ${event} ON "${table}" WHEN ${invalid} BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;\n`;
      for (const fk of references)
        sql += `CREATE INDEX IF NOT EXISTS ownership_idx_${table}_${fk.from} ON "${table}"(tenant_id,"${fk.from}");\n`;
    }
    sql += `CREATE TRIGGER immutable_tenant_${table} BEFORE UPDATE OF tenant_id ON "${table}" WHEN NEW.tenant_id IS NOT OLD.tenant_id BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;\n`;
  }
  sql += `CREATE TRIGGER membership_tenant_user_insert BEFORE INSERT ON memberships
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='TENANT')
    OR EXISTS(SELECT 1 FROM memberships WHERE user_id=NEW.user_id AND tenant_id<>NEW.tenant_id)
    BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
    CREATE TRIGGER membership_tenant_user_update BEFORE UPDATE OF user_id ON memberships
    WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='TENANT')
    OR EXISTS(SELECT 1 FROM memberships WHERE user_id=NEW.user_id AND tenant_id<>NEW.tenant_id)
    BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
  `;
  return sql;
}
