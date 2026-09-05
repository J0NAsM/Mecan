import { roundMoney } from '../money.js';

export function purchasingMigration(db) {
  db.exec(`
    ALTER TABLE purchase_orders ADD COLUMN currency TEXT;
    ALTER TABLE purchase_orders ADD COLUMN received_subtotal REAL NOT NULL DEFAULT 0 CHECK(received_subtotal>=0);
    ALTER TABLE purchase_orders ADD COLUMN received_tax REAL NOT NULL DEFAULT 0 CHECK(received_tax>=0);
    ALTER TABLE purchase_orders ADD COLUMN received_total REAL NOT NULL DEFAULT 0 CHECK(received_total>=0);
    ALTER TABLE purchase_orders ADD COLUMN canceled_at TEXT;
    ALTER TABLE purchase_orders ADD COLUMN canceled_by TEXT REFERENCES users(id);
    ALTER TABLE purchase_orders ADD COLUMN cancel_reason TEXT;
    ALTER TABLE purchase_requests ADD COLUMN canceled_at TEXT;
    ALTER TABLE purchase_requests ADD COLUMN canceled_by TEXT REFERENCES users(id);
    ALTER TABLE purchase_requests ADD COLUMN cancel_reason TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN opening_received_quantity REAL NOT NULL DEFAULT 0 CHECK(opening_received_quantity>=0 AND opening_received_quantity<=received_quantity);
    ALTER TABLE purchase_order_items ADD COLUMN canceled_quantity REAL NOT NULL DEFAULT 0 CHECK(canceled_quantity>=0 AND received_quantity+canceled_quantity<=quantity);
    UPDATE purchase_order_items SET opening_received_quantity=received_quantity;
    UPDATE purchase_order_items SET canceled_quantity=quantity-received_quantity WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE status='CANCELED');
  `);
  for (const po of db
    .prepare(
      'SELECT po.*,s.currency configured_currency FROM purchase_orders po JOIN tenant_settings s ON s.tenant_id=po.tenant_id',
    )
    .all()) {
    const lines = db
      .prepare('SELECT * FROM purchase_order_items WHERE tenant_id=? AND purchase_order_id=?')
      .all(po.tenant_id, po.id);
    const currency = po.configured_currency;
    const subtotal = roundMoney(
      lines.reduce(
        (sum, line) =>
          sum + roundMoney(Number(line.received_quantity) * Number(line.unit_cost), currency),
        0,
      ),
      currency,
    );
    const tax = roundMoney(
      Number(po.subtotal) ? (Number(po.tax) * subtotal) / Number(po.subtotal) : 0,
      currency,
    );
    const total = roundMoney(subtotal + tax, currency);
    const payable = db
      .prepare('SELECT amount FROM accounts_payable WHERE tenant_id=? AND purchase_order_id=?')
      .get(po.tenant_id, po.id);
    if (
      (payable && Number(payable.amount) !== total) ||
      (!payable && total > 0) ||
      total > Number(po.total)
    )
      throw new Error(
        'Hay compras históricas cuya recepción no coincide con la deuda registrada. Concilia esos registros antes de migrar; no se eliminaron ni reasignaron datos.',
      );
    db.prepare(
      'UPDATE purchase_orders SET currency=?,received_subtotal=?,received_tax=?,received_total=? WHERE id=?',
    ).run(currency, subtotal, tax, total, po.id);
  }
  return `
    CREATE TABLE purchase_receipts (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id), reference TEXT, notes TEXT,
      subtotal REAL NOT NULL CHECK(subtotal>=0), tax REAL NOT NULL CHECK(tax>=0), amount REAL NOT NULL CHECK(amount>=0), currency TEXT NOT NULL,
      received_by TEXT NOT NULL REFERENCES users(id), received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key)
    );
    CREATE INDEX purchase_receipts_order ON purchase_receipts(tenant_id,purchase_order_id,received_at);
    CREATE TABLE purchase_receipt_lines (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), receipt_id TEXT NOT NULL REFERENCES purchase_receipts(id),
      purchase_order_item_id TEXT NOT NULL REFERENCES purchase_order_items(id), inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
      quantity REAL NOT NULL CHECK(quantity>0), unit_cost REAL NOT NULL CHECK(unit_cost>=0),
      inventory_movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id), UNIQUE(receipt_id,purchase_order_item_id)
    );
    CREATE INDEX purchase_receipt_lines_order_line ON purchase_receipt_lines(tenant_id,purchase_order_item_id);
    CREATE TRIGGER purchase_receipt_owner BEFORE INSERT ON purchase_receipts WHEN
      NOT EXISTS(SELECT 1 FROM purchase_orders p WHERE p.id=NEW.purchase_order_id AND p.tenant_id=NEW.tenant_id AND p.branch_id=NEW.branch_id AND p.currency=NEW.currency)
      OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.received_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id)))
      BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
    CREATE TRIGGER purchase_receipt_line_owner BEFORE INSERT ON purchase_receipt_lines WHEN NOT EXISTS(
      SELECT 1 FROM purchase_receipts r JOIN purchase_order_items l ON l.purchase_order_id=r.purchase_order_id AND l.tenant_id=r.tenant_id
      JOIN inventory_movements m ON m.id=NEW.inventory_movement_id AND m.tenant_id=r.tenant_id
      WHERE r.id=NEW.receipt_id AND r.tenant_id=NEW.tenant_id AND l.id=NEW.purchase_order_item_id AND l.inventory_item_id=NEW.inventory_item_id
      AND l.unit_cost=NEW.unit_cost AND NEW.quantity-(l.quantity-l.received_quantity-l.canceled_quantity)<=0.000000001
      AND m.inventory_item_id=NEW.inventory_item_id AND m.branch_id=r.branch_id AND m.quantity=NEW.quantity AND m.movement_type='PURCHASE'
      AND m.reference_type='PURCHASE_ORDER' AND m.reference_id=r.purchase_order_id
    ) BEGIN SELECT RAISE(ABORT,'invalid_purchase_receipt'); END;
    CREATE TRIGGER purchase_receipt_immutable BEFORE UPDATE ON purchase_receipts BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
    CREATE TRIGGER purchase_receipt_no_delete BEFORE DELETE ON purchase_receipts BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
    CREATE TRIGGER purchase_receipt_line_immutable BEFORE UPDATE ON purchase_receipt_lines BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
    CREATE TRIGGER purchase_receipt_line_no_delete BEFORE DELETE ON purchase_receipt_lines BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
    CREATE TRIGGER purchase_opening_immutable BEFORE UPDATE OF opening_received_quantity ON purchase_order_items WHEN NEW.opening_received_quantity<>OLD.opening_received_quantity BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
    CREATE INDEX purchase_request_order_status ON purchase_orders(tenant_id,purchase_request_id,status);
    ${['purchase_orders', 'purchase_requests'].map((table) => `CREATE TRIGGER ${table}_cancellation_actor BEFORE UPDATE OF canceled_by ON ${table} WHEN NEW.canceled_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.canceled_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;`).join('\n')}
  `;
}
