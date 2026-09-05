export const paymentReversalsSchema = `
UPDATE accounts_payable SET status='PAID' WHERE amount=0 AND paid_amount=0 AND balance=0 AND status='PENDING';
CREATE TABLE payment_reversals (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_payment_id TEXT UNIQUE REFERENCES workshop_payments(id),
  purchase_payment_id TEXT UNIQUE REFERENCES purchase_payments(id),
  amount REAL NOT NULL CHECK(amount>0), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key),
  CHECK((customer_payment_id IS NOT NULL) <> (purchase_payment_id IS NOT NULL))
);
CREATE INDEX payment_reversals_tenant ON payment_reversals(tenant_id,created_at);
CREATE TRIGGER payment_reversal_owner BEFORE INSERT ON payment_reversals WHEN
  NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.created_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id)))
  OR (NEW.customer_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workshop_payments p JOIN workshop_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.id=NEW.customer_payment_id AND p.tenant_id=NEW.tenant_id AND p.amount=NEW.amount AND i.branch_id=NEW.branch_id AND i.voided_at IS NULL))
  OR (NEW.purchase_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_payments p JOIN accounts_payable a ON a.id=p.payable_id AND a.tenant_id=p.tenant_id WHERE p.id=NEW.purchase_payment_id AND p.tenant_id=NEW.tenant_id AND p.amount=NEW.amount AND a.branch_id=NEW.branch_id))
  BEGIN SELECT RAISE(ABORT,'invalid_payment_reversal'); END;
CREATE TRIGGER payment_reversal_immutable BEFORE UPDATE ON payment_reversals BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
CREATE TRIGGER payment_reversal_no_delete BEFORE DELETE ON payment_reversals BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
ALTER TABLE cash_movements ADD COLUMN reversal_id TEXT REFERENCES payment_reversals(id);
CREATE UNIQUE INDEX cash_reversal ON cash_movements(reversal_id) WHERE reversal_id IS NOT NULL;
CREATE TRIGGER cash_reversal_owner BEFORE INSERT ON cash_movements WHEN NEW.reversal_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM payment_reversals r WHERE r.id=NEW.reversal_id AND r.tenant_id=NEW.tenant_id AND r.branch_id=NEW.branch_id
  AND r.amount=NEW.amount AND NEW.workshop_payment_id IS NULL AND NEW.purchase_payment_id IS NULL
  AND ((r.customer_payment_id IS NOT NULL AND NEW.type='EXPENSE' AND NEW.category='CUSTOMER_PAYMENT_REVERSAL') OR (r.purchase_payment_id IS NOT NULL AND NEW.type='INCOME' AND NEW.category='SUPPLIER_PAYMENT_REVERSAL'))
) BEGIN SELECT RAISE(ABORT,'invalid_payment_reversal'); END;
CREATE TRIGGER cash_reversal_immutable BEFORE UPDATE ON cash_movements WHEN OLD.reversal_id IS NOT NULL OR NEW.reversal_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
CREATE TRIGGER cash_reversal_no_delete BEFORE DELETE ON cash_movements WHEN OLD.reversal_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
CREATE VIEW effective_workshop_payments AS SELECT p.* FROM workshop_payments p WHERE NOT EXISTS(SELECT 1 FROM payment_reversals r WHERE r.customer_payment_id=p.id);
CREATE VIEW effective_purchase_payments AS SELECT p.* FROM purchase_payments p WHERE NOT EXISTS(SELECT 1 FROM payment_reversals r WHERE r.purchase_payment_id=p.id);
CREATE TRIGGER reversed_customer_payment_immutable BEFORE UPDATE ON workshop_payments WHEN EXISTS(SELECT 1 FROM payment_reversals WHERE customer_payment_id=OLD.id) BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
CREATE TRIGGER reversed_supplier_payment_immutable BEFORE UPDATE ON purchase_payments WHEN EXISTS(SELECT 1 FROM payment_reversals WHERE purchase_payment_id=OLD.id) BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
CREATE TRIGGER reversed_original_cash_immutable BEFORE UPDATE ON cash_movements WHEN EXISTS(SELECT 1 FROM payment_reversals WHERE customer_payment_id=OLD.workshop_payment_id OR purchase_payment_id=OLD.purchase_payment_id) BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
CREATE TRIGGER reversed_original_cash_no_delete BEFORE DELETE ON cash_movements WHEN EXISTS(SELECT 1 FROM payment_reversals WHERE customer_payment_id=OLD.workshop_payment_id OR purchase_payment_id=OLD.purchase_payment_id) BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
${['INSERT', 'UPDATE']
  .map(
    (
      event,
    ) => `CREATE TRIGGER cash_payment_owner_${event.toLowerCase()} BEFORE ${event} ON cash_movements WHEN
  (NEW.workshop_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workshop_payments p JOIN workshop_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.id=NEW.workshop_payment_id AND p.tenant_id=NEW.tenant_id AND i.branch_id=NEW.branch_id AND p.amount=NEW.amount AND NEW.type='INCOME' AND NEW.category='CUSTOMER_PAYMENT' AND NEW.purchase_payment_id IS NULL AND NEW.reversal_id IS NULL))
  OR (NEW.purchase_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_payments p JOIN accounts_payable a ON a.id=p.payable_id AND a.tenant_id=p.tenant_id WHERE p.id=NEW.purchase_payment_id AND p.tenant_id=NEW.tenant_id AND a.branch_id=NEW.branch_id AND p.amount=NEW.amount AND NEW.type='EXPENSE' AND NEW.category='SUPPLIER_PAYMENT' AND NEW.workshop_payment_id IS NULL AND NEW.reversal_id IS NULL))
  BEGIN SELECT RAISE(ABORT,'invalid_payment_cash'); END;`,
  )
  .join('\n')}
`;
