import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { id, now, addDays, addMonths } from '../../src/utils.js';
import { hashPassword } from '../../src/auth.js';
import { releaseMigration } from '../../src/migrations/release.js';
import { paymentReversalsSchema } from '../../src/migrations/payment-reversals.js';
import { purchasingMigration } from '../../src/migrations/purchasing.js';
export const databaseEngine = 'sqlite';
import {
  MANAGER_PERMISSIONS,
  TECHNICIAN_PERMISSIONS,
  RECEPTION_PERMISSIONS,
  CASHIER_PERMISSIONS,
  INVENTORY_PERMISSIONS,
} from '../../src/permissions.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('PLATFORM','TENANT')),
  platform_role TEXT, active INTEGER NOT NULL DEFAULT 1, last_activity_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL, impersonated_tenant_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  price_monthly REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'PYG', active INTEGER NOT NULL DEFAULT 1,
  public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, retired_at TEXT
);
CREATE TABLE IF NOT EXISTS features (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  kind TEXT NOT NULL DEFAULT 'boolean', global_enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS plan_features (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1, limit_value REAL, PRIMARY KEY(plan_id,feature_id)
);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, legal_name TEXT, owner_name TEXT NOT NULL,
  tax_id TEXT, phone TEXT, email TEXT NOT NULL, address TEXT, country TEXT DEFAULT 'Paraguay', city TEXT,
  status TEXT NOT NULL DEFAULT 'INCOMPLETE', onboarding_step INTEGER NOT NULL DEFAULT 1,
  logo_url TEXT, primary_color TEXT DEFAULT '#0f766e', storage_used_bytes INTEGER NOT NULL DEFAULT 0,
  last_activity_at TEXT, created_at TEXT NOT NULL, canceled_at TEXT, deletion_eligible_at TEXT
);
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  phone TEXT, address TEXT, city TEXT, active INTEGER NOT NULL DEFAULT 1, is_main INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), code TEXT NOT NULL,
  name TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]', system INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id,code)
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
  branch_id TEXT REFERENCES branches(id), role_id TEXT NOT NULL REFERENCES roles(id), job_title TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', invited_at TEXT, joined_at TEXT, UNIQUE(tenant_id,user_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id), plan_id TEXT NOT NULL REFERENCES plans(id),
  billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY', price REAL NOT NULL, currency TEXT NOT NULL,
  started_at TEXT NOT NULL, next_charge_at TEXT NOT NULL, status TEXT NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0, promotion TEXT, grace_until TEXT, canceled_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscription_history (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  event TEXT NOT NULL, from_plan_id TEXT, to_plan_id TEXT, metadata TEXT DEFAULT '{}', actor_user_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trials (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), plan_id TEXT NOT NULL REFERENCES plans(id),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tenant_features (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), feature_id TEXT NOT NULL REFERENCES features(id),
  enabled INTEGER, limit_value REAL, reason TEXT, PRIMARY KEY(tenant_id,feature_id)
);
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), currency TEXT NOT NULL DEFAULT 'PYG', tax_rate REAL NOT NULL DEFAULT 10,
  timezone TEXT NOT NULL DEFAULT 'America/Asuncion', opening_hours TEXT DEFAULT '{}', document_header TEXT, document_footer TEXT,
  onboarding_data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT REFERENCES branches(id),
  name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id),
  plate TEXT NOT NULL, make TEXT, model TEXT, year INTEGER, vin TEXT, color TEXT, odometer INTEGER DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,plate)
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, description TEXT,
  price REAL NOT NULL DEFAULT 0, duration_minutes INTEGER NOT NULL DEFAULT 60, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id), vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'RECEIVED', complaint TEXT, diagnosis TEXT, notes TEXT,
  subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  promised_at TEXT, completed_at TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(tenant_id,number)
);
CREATE TABLE IF NOT EXISTS work_order_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  item_type TEXT NOT NULL, description TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  sku TEXT, name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, minimum_stock REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,sku)
);
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL,
  tax_id TEXT, phone TEXT, email TEXT, address TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id), number TEXT, amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RECEIVED', purchased_at TEXT NOT NULL, notes TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bays (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AVAILABLE', active INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id,branch_id,name)
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id), vehicle_id TEXT REFERENCES vehicles(id), scheduled_at TEXT NOT NULL,
  reason TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED', created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workshop_invoices (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id), work_order_id TEXT REFERENCES work_orders(id), number INTEGER NOT NULL,
  amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', due_at TEXT, paid_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,number)
);
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  type TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, reference TEXT, notes TEXT, created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saas_invoices (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  number TEXT NOT NULL UNIQUE, amount REAL NOT NULL, currency TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', paid_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saas_payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
  invoice_id TEXT REFERENCES saas_invoices(id), amount REAL NOT NULL, currency TEXT NOT NULL, paid_at TEXT NOT NULL,
  method TEXT NOT NULL, reference TEXT, notes TEXT, period_start TEXT, period_end TEXT,
  provider TEXT NOT NULL DEFAULT 'manual', provider_payment_id TEXT, status TEXT NOT NULL DEFAULT 'APPROVED',
  recorded_by TEXT REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(provider,provider_payment_id)
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), created_by TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'NEW', assigned_to TEXT REFERENCES users(id), resolution TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), name TEXT NOT NULL, mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, uploaded_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, tenant_id TEXT REFERENCES tenants(id), actor_user_id TEXT REFERENCES users(id),
  impersonator_user_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  ip_address TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON work_orders(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON saas_payments(tenant_id,paid_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saas_invoice_period ON saas_invoices(subscription_id,period_start,period_end);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchases(tenant_id,purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant ON appointments(tenant_id,scheduled_at);
`;

const operationalSchema = `
ALTER TABLE audit_logs ADD COLUMN branch_id TEXT REFERENCES branches(id);
ALTER TABLE audit_logs ADD COLUMN before_json TEXT;
ALTER TABLE audit_logs ADD COLUMN after_json TEXT;
ALTER TABLE audit_logs ADD COLUMN request_id TEXT;
ALTER TABLE workshop_invoices ADD COLUMN subtotal REAL NOT NULL DEFAULT 0;
ALTER TABLE workshop_invoices ADD COLUMN tax REAL NOT NULL DEFAULT 0;
ALTER TABLE workshop_invoices ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE workshop_invoices ADD COLUMN balance REAL NOT NULL DEFAULT 0;
ALTER TABLE workshop_invoices ADD COLUMN voided_at TEXT;
ALTER TABLE workshop_invoices ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE workshop_invoices ADD COLUMN void_reason TEXT;
ALTER TABLE workshop_invoices ADD COLUMN idempotency_key TEXT;
ALTER TABLE cash_movements ADD COLUMN workshop_payment_id TEXT;
ALTER TABLE cash_movements ADD COLUMN purchase_payment_id TEXT;
ALTER TABLE cash_movements ADD COLUMN voided_at TEXT;
ALTER TABLE cash_movements ADD COLUMN idempotency_key TEXT;

CREATE TABLE IF NOT EXISTS document_sequences (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), kind TEXT NOT NULL, next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(tenant_id,kind), CHECK(next_value > 0)
);
CREATE TABLE IF NOT EXISTS receptions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  work_order_id TEXT NOT NULL UNIQUE REFERENCES work_orders(id), received_by TEXT NOT NULL REFERENCES users(id),
  fuel_level INTEGER, odometer INTEGER NOT NULL DEFAULT 0, accessories TEXT NOT NULL DEFAULT '[]',
  visible_damage TEXT, customer_notes TEXT, received_at TEXT NOT NULL,
  CHECK(fuel_level IS NULL OR (fuel_level >= 0 AND fuel_level <= 100)), CHECK(odometer >= 0)
);
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  inspector_user_id TEXT NOT NULL REFERENCES users(id), checklist TEXT NOT NULL DEFAULT '[]', findings TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED')),
  completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagnoses (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_user_id TEXT REFERENCES users(id), summary TEXT NOT NULL, recommendations TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED')),
  completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS estimates (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  number INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','SENT','APPROVED','PARTIALLY_APPROVED','REJECTED','EXPIRED','CANCELED')),
  subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  valid_until TEXT, sent_at TEXT, approved_at TEXT, approved_by_name TEXT, approval_notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,number,version), CHECK(subtotal >= 0), CHECK(tax >= 0), CHECK(discount >= 0), CHECK(total >= 0)
);
CREATE TABLE IF NOT EXISTS estimate_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK(item_type IN ('LABOR','PART','SERVICE','OTHER')), description TEXT NOT NULL,
  inventory_item_id TEXT REFERENCES inventory_items(id), quantity REAL NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 1,
  total REAL NOT NULL DEFAULT 0, CHECK(quantity > 0), CHECK(unit_cost >= 0), CHECK(unit_price >= 0), CHECK(total >= 0)
);
CREATE TABLE IF NOT EXISTS work_assignments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_user_id TEXT NOT NULL REFERENCES users(id), description TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')), status TEXT NOT NULL DEFAULT 'ASSIGNED'
    CHECK(status IN ('ASSIGNED','IN_PROGRESS','PAUSED','BLOCKED','COMPLETED','CANCELED')),
  instructions TEXT, started_at TEXT, paused_at TEXT, completed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), assignment_id TEXT NOT NULL REFERENCES work_assignments(id),
  technician_user_id TEXT NOT NULL REFERENCES users(id), started_at TEXT NOT NULL, ended_at TEXT,
  duration_minutes INTEGER, notes TEXT, CHECK(duration_minutes IS NULL OR duration_minutes >= 0)
);
CREATE TABLE IF NOT EXISTS work_order_parts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id), quantity REAL NOT NULL, unit_cost REAL NOT NULL,
  unit_price REAL NOT NULL, total REAL NOT NULL, consumed_by TEXT NOT NULL REFERENCES users(id), consumed_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key), CHECK(quantity > 0), CHECK(unit_cost >= 0), CHECK(unit_price >= 0)
);
CREATE TABLE IF NOT EXISTS work_order_labor (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  technician_user_id TEXT REFERENCES users(id), description TEXT NOT NULL, hours REAL NOT NULL,
  hourly_cost REAL NOT NULL DEFAULT 0, hourly_price REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, CHECK(hours > 0), CHECK(hourly_cost >= 0), CHECK(hourly_price >= 0)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id), movement_type TEXT NOT NULL
    CHECK(movement_type IN ('OPENING','PURCHASE','CONSUMPTION','RETURN','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','RESERVATION','RELEASE')),
  quantity REAL NOT NULL, previous_quantity REAL NOT NULL, resulting_quantity REAL NOT NULL,
  unit_cost REAL, reference_type TEXT, reference_id TEXT, reason TEXT, actor_user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key),
  CHECK(quantity <> 0), CHECK(previous_quantity >= 0), CHECK(resulting_quantity >= 0)
);
CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  work_order_id TEXT REFERENCES work_orders(id), inventory_item_id TEXT REFERENCES inventory_items(id),
  description TEXT NOT NULL, quantity REAL NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','QUOTING','ORDERED','RECEIVED','CANCELED')),
  requested_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, CHECK(quantity > 0)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id), purchase_request_id TEXT REFERENCES purchase_requests(id), number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','PARTIAL','RECEIVED','CANCELED')),
  subtotal REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
  expected_at TEXT, received_at TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
  UNIQUE(tenant_id,number), CHECK(total >= 0)
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id), description TEXT NOT NULL, quantity REAL NOT NULL,
  received_quantity REAL NOT NULL DEFAULT 0, unit_cost REAL NOT NULL, total REAL NOT NULL,
  CHECK(quantity > 0), CHECK(received_quantity >= 0 AND received_quantity <= quantity), CHECK(unit_cost >= 0)
);
CREATE TABLE IF NOT EXISTS accounts_payable (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id), purchase_order_id TEXT NOT NULL UNIQUE REFERENCES purchase_orders(id),
  amount REAL NOT NULL, paid_amount REAL NOT NULL DEFAULT 0, balance REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PARTIAL','PAID','VOID')),
  due_at TEXT, created_at TEXT NOT NULL, CHECK(amount >= 0), CHECK(paid_amount >= 0), CHECK(balance >= 0)
);
CREATE TABLE IF NOT EXISTS purchase_payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), payable_id TEXT NOT NULL REFERENCES accounts_payable(id),
  amount REAL NOT NULL, method TEXT NOT NULL, reference TEXT, paid_at TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key), CHECK(amount > 0)
);
CREATE TABLE IF NOT EXISTS quality_checks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  inspector_user_id TEXT NOT NULL REFERENCES users(id), checklist TEXT NOT NULL DEFAULT '[]', notes TEXT,
  result TEXT NOT NULL CHECK(result IN ('PASSED','FAILED')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workshop_invoice_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), invoice_id TEXT NOT NULL REFERENCES workshop_invoices(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL, description TEXT NOT NULL, quantity REAL NOT NULL, unit_price REAL NOT NULL, total REAL NOT NULL,
  CHECK(quantity > 0), CHECK(unit_price >= 0), CHECK(total >= 0)
);
CREATE TABLE IF NOT EXISTS workshop_payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), invoice_id TEXT NOT NULL REFERENCES workshop_invoices(id),
  amount REAL NOT NULL, method TEXT NOT NULL, reference TEXT, paid_at TEXT NOT NULL,
  received_by TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,idempotency_key), CHECK(amount > 0)
);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL UNIQUE REFERENCES work_orders(id),
  delivered_by TEXT NOT NULL REFERENCES users(id), received_by_name TEXT NOT NULL, notes TEXT,
  odometer INTEGER, delivered_at TEXT NOT NULL, CHECK(odometer IS NULL OR odometer >= 0)
);
CREATE TABLE IF NOT EXISTS warranties (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, terms TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(status IN ('ACTIVE','CLAIMED','EXPIRED','VOID')), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id), user_id TEXT REFERENCES users(id), channel TEXT NOT NULL,
  event_type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED','READ')),
  idempotency_key TEXT NOT NULL UNIQUE, scheduled_at TEXT NOT NULL, sent_at TEXT, read_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, succeeded INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id TEXT NOT NULL REFERENCES tenants(id), operation TEXT NOT NULL, key TEXT NOT NULL,
  resource_id TEXT, response_json TEXT, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,operation,key)
);
CREATE TABLE IF NOT EXISTS file_links (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, tenant_id TEXT NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'DOCUMENT'
);
CREATE TRIGGER IF NOT EXISTS prevent_negative_inventory_update BEFORE UPDATE OF quantity ON inventory_items
WHEN NEW.quantity < 0 BEGIN SELECT RAISE(ABORT,'inventory_negative'); END;
CREATE TRIGGER IF NOT EXISTS prevent_negative_inventory_insert BEFORE INSERT ON inventory_items
WHEN NEW.quantity < 0 BEGIN SELECT RAISE(ABORT,'inventory_negative'); END;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_invoice_order ON workshop_invoices(tenant_id,work_order_id) WHERE work_order_id IS NOT NULL AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_invoice_idempotency ON workshop_invoices(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_workshop_payment ON cash_movements(tenant_id,workshop_payment_id) WHERE workshop_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_purchase_payment ON cash_movements(tenant_id,purchase_payment_id) WHERE purchase_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assignments_tech_status ON work_assignments(tenant_id,technician_user_id,status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(tenant_id,inventory_item_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_estimates_order ON estimates(tenant_id,work_order_id,version DESC);
CREATE INDEX IF NOT EXISTS idx_payables_status_due ON accounts_payable(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications(status,scheduled_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identity ON login_attempts(identity_hash,attempted_at DESC);
`;

const customerAndSecuritySchema = `
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE sessions ADD COLUMN ip_hash TEXT;
ALTER TABLE sessions ADD COLUMN user_agent_hash TEXT;
CREATE TABLE IF NOT EXISTS customer_communications (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), customer_id TEXT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL CHECK(channel IN ('PHONE','EMAIL','WHATSAPP','SMS','IN_PERSON','OTHER')),
  direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')), subject TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECORDED', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS warranty_claims (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), warranty_id TEXT NOT NULL REFERENCES warranties(id),
  work_order_id TEXT REFERENCES work_orders(id), description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACCEPTED','REJECTED','RESOLVED','CLOSED')),
  resolution TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), branch_id TEXT NOT NULL REFERENCES branches(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id), work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  quantity REAL NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONSUMED','RELEASED')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, released_at TEXT, CHECK(quantity > 0)
);
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  from_branch_id TEXT NOT NULL REFERENCES branches(id), to_branch_id TEXT NOT NULL REFERENCES branches(id), quantity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('PENDING','COMPLETED','CANCELED')),
  created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, completed_at TEXT,
  idempotency_key TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key), CHECK(quantity > 0), CHECK(from_branch_id <> to_branch_id)
);
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, workshop TEXT, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW', ip_hash TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_communications_customer ON customer_communications(tenant_id,customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_claims ON warranty_claims(tenant_id,warranty_id,status);
CREATE INDEX IF NOT EXISTS idx_reservations_item ON stock_reservations(tenant_id,inventory_item_id,status);
`;

const notificationDeliverySchema = `
ALTER TABLE notifications ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN last_error TEXT;
ALTER TABLE notifications ADD COLUMN next_attempt_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_delivery ON notifications(status,next_attempt_at,scheduled_at);
`;

const operationalHardeningSchema = `
CREATE TABLE IF NOT EXISTS platform_sequences (
  kind TEXT NOT NULL, year INTEGER NOT NULL, next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(kind,year), CHECK(next_value > 0)
);
ALTER TABLE saas_invoices ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0;
ALTER TABLE saas_invoices ADD COLUMN balance REAL NOT NULL DEFAULT 0;
UPDATE saas_invoices SET paid_amount=CASE WHEN status='PAID' THEN amount ELSE 0 END,
  balance=CASE WHEN status='PAID' THEN 0 ELSE amount END;
CREATE INDEX IF NOT EXISTS idx_orders_promised_status ON work_orders(tenant_id,promised_at,status);
CREATE INDEX IF NOT EXISTS idx_saas_invoices_balance ON saas_invoices(tenant_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_invoices_balance ON workshop_invoices(tenant_id,status,due_at) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_tenant_created ON files(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE TRIGGER IF NOT EXISTS tenant_guard_vehicle_insert BEFORE INSERT ON vehicles
WHEN NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_vehicle_update BEFORE UPDATE OF tenant_id,customer_id ON vehicles
WHEN NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_order_insert BEFORE INSERT ON work_orders
WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND v.customer_id=NEW.customer_id AND v.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_order_update BEFORE UPDATE OF tenant_id,branch_id,customer_id,vehicle_id ON work_orders
WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND v.customer_id=NEW.customer_id AND v.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_inventory_insert BEFORE INSERT ON inventory_items
WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_invoice_insert BEFORE INSERT ON workshop_invoices
WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
  OR (NEW.work_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_workshop_payment_insert BEFORE INSERT ON workshop_payments
WHEN NOT EXISTS(SELECT 1 FROM workshop_invoices i WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_part_insert BEFORE INSERT ON work_order_parts
WHEN NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.inventory_item_id AND i.tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_purchase_request_insert BEFORE INSERT ON purchase_requests
WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR (NEW.work_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id))
  OR (NEW.inventory_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.inventory_item_id AND i.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
CREATE TRIGGER IF NOT EXISTS tenant_guard_purchase_order_insert BEFORE INSERT ON purchase_orders
WHEN NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM suppliers s WHERE s.id=NEW.supplier_id AND s.tenant_id=NEW.tenant_id)
  OR (NEW.purchase_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_requests r WHERE r.id=NEW.purchase_request_id AND r.tenant_id=NEW.tenant_id))
BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
`;

const accountRecoverySchema = `
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, requested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_request_rate ON password_reset_requests(ip_hash,identity_hash,requested_at DESC);
`;

function applyMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, applied_at TEXT NOT NULL
  )`);
  const migrations = [
    ['001_initial', schema],
    ['002_operational_workflow', operationalSchema],
    ['003_customer_security', customerAndSecuritySchema],
    ['004_notification_delivery', notificationDeliverySchema],
    ['005_operational_hardening', operationalHardeningSchema],
    ['006_account_recovery_rate_limit', accountRecoverySchema],
    ['007_release_integrity', releaseMigration],
    [
      '008_operational_closure',
      `
      ALTER TABLE work_order_parts ADD COLUMN returned_at TEXT;
      CREATE VIEW active_work_order_parts AS SELECT * FROM work_order_parts WHERE returned_at IS NULL;
      CREATE TRIGGER stock_return_tenant BEFORE INSERT ON stock_returns WHEN NOT EXISTS(SELECT 1 FROM work_order_parts p WHERE p.id=NEW.part_id AND p.tenant_id=NEW.tenant_id) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER stock_return_immutable BEFORE UPDATE ON stock_returns BEGIN SELECT RAISE(ABORT,'immutable_movement'); END;
      CREATE TRIGGER legal_acceptance_tenant BEFORE INSERT ON legal_acceptances WHEN NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=NEW.user_id AND m.tenant_id=NEW.tenant_id) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE INDEX warranties_expiration ON warranties(tenant_id,status,ends_at);
      CREATE TRIGGER legal_acceptance_immutable BEFORE UPDATE ON legal_acceptances BEGIN SELECT RAISE(ABORT,'immutable_acceptance'); END;
      CREATE TRIGGER transfer_destination_insert BEFORE INSERT ON inventory_transfers WHEN NEW.destination_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.destination_item_id AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.to_branch_id) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER transfer_destination_update BEFORE UPDATE ON inventory_transfers WHEN NEW.destination_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.destination_item_id AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.to_branch_id) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER file_entity_insert BEFORE INSERT ON file_links WHEN (NEW.entity_type='WORK_ORDER' AND NOT EXISTS(SELECT 1 FROM work_orders WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='VEHICLE' AND NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='CUSTOMER' AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR NEW.entity_type NOT IN ('WORK_ORDER','VEHICLE','CUSTOMER') BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER file_entity_update BEFORE UPDATE ON file_links WHEN (NEW.entity_type='WORK_ORDER' AND NOT EXISTS(SELECT 1 FROM work_orders WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='VEHICLE' AND NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='CUSTOMER' AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR NEW.entity_type NOT IN ('WORK_ORDER','VEHICLE','CUSTOMER') BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      UPDATE roles SET permissions=json_insert(permissions,'$[#]','orders.print') WHERE system=1 AND code IN ('MANAGER','RECEPTION') AND NOT EXISTS(SELECT 1 FROM json_each(roles.permissions) WHERE value='orders.print');
      UPDATE roles SET permissions=json_insert(permissions,'$[#]','billing.print') WHERE system=1 AND code IN ('MANAGER','CASHIER') AND NOT EXISTS(SELECT 1 FROM json_each(roles.permissions) WHERE value='billing.print');
      UPDATE roles SET permissions=json_insert(permissions,'$[#]','inventory.request') WHERE system=1 AND code IN ('TECHNICIAN','INVENTORY','MANAGER') AND NOT EXISTS(SELECT 1 FROM json_each(roles.permissions) WHERE value='inventory.request');
      UPDATE roles SET permissions=json_insert(permissions,'$[#]','purchases.pay') WHERE system=1 AND code IN ('CASHIER','MANAGER') AND NOT EXISTS(SELECT 1 FROM json_each(roles.permissions) WHERE value='purchases.pay');
    `,
    ],
    [
      '009_notification_privacy',
      (connection) => {
        if (
          connection
            .prepare(
              'SELECT 1 FROM notifications n WHERE n.tenant_id IS NOT NULL AND n.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=n.tenant_id AND m.user_id=n.user_id) LIMIT 1',
            )
            .get()
        )
          throw new Error(
            'Existen avisos con destinatarios de otro taller. Revisa esos datos antes de migrar; no se han eliminado.',
          );
        return `
      ALTER TABLE notifications ADD COLUMN required_permission TEXT NOT NULL DEFAULT 'settings.manage';
      UPDATE notifications SET required_permission=CASE
        WHEN event_type='PAYMENT_RECEIVED' THEN 'billing.view'
        WHEN event_type='WORK_ASSIGNED' THEN 'orders.execute'
        WHEN event_type IN ('ESTIMATE_SENT','ESTIMATE_APPROVED','VEHICLE_READY','VEHICLE_DELIVERED') THEN 'orders.view'
        ELSE 'settings.manage' END;
      CREATE TABLE notification_reads (
        notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id),
        user_id TEXT NOT NULL REFERENCES users(id), read_at TEXT NOT NULL,
        PRIMARY KEY(notification_id,user_id)
      );
      CREATE INDEX notification_reads_user ON notification_reads(tenant_id,user_id,read_at);
      CREATE INDEX notification_audience ON notifications(tenant_id,channel,required_permission,created_at);
      CREATE TRIGGER notification_recipient_insert BEFORE INSERT ON notifications WHEN NEW.tenant_id IS NOT NULL AND NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER notification_recipient_update BEFORE UPDATE OF tenant_id,user_id ON notifications WHEN NEW.tenant_id IS NOT NULL AND NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER notification_read_owner BEFORE INSERT ON notification_reads WHEN NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id=NEW.notification_id AND n.tenant_id=NEW.tenant_id AND n.channel='IN_APP' AND (n.user_id IS NULL OR n.user_id=NEW.user_id)) OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
      CREATE TRIGGER notification_read_immutable BEFORE UPDATE ON notification_reads BEGIN SELECT RAISE(ABORT,'immutable_read'); END;
      INSERT INTO notification_reads(notification_id,tenant_id,user_id,read_at)
        SELECT n.id,n.tenant_id,n.user_id,COALESCE(n.read_at,n.created_at) FROM notifications n WHERE n.channel='IN_APP' AND n.status='READ' AND n.user_id IS NOT NULL AND n.tenant_id IS NOT NULL AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=n.user_id AND m.tenant_id=n.tenant_id);
      `;
      },
    ],
  ];
  migrations.push([
    '010_no_charge_authorization',
    `
    ALTER TABLE estimates ADD COLUMN no_charge_approved_by TEXT REFERENCES users(id);
    ALTER TABLE estimates ADD COLUMN no_charge_reason TEXT;
    CREATE TRIGGER no_charge_estimate_insert BEFORE INSERT ON estimates WHEN NEW.status='APPROVED' AND NEW.total=0 AND (NEW.no_charge_approved_by IS NULL OR length(trim(COALESCE(NEW.no_charge_reason,'')))=0) BEGIN SELECT RAISE(ABORT,'no_charge_approval_required'); END;
    CREATE TRIGGER no_charge_estimate_update BEFORE UPDATE OF status,total,no_charge_approved_by,no_charge_reason ON estimates WHEN NEW.status='APPROVED' AND NEW.total=0 AND (NEW.no_charge_approved_by IS NULL OR length(trim(COALESCE(NEW.no_charge_reason,'')))=0) BEGIN SELECT RAISE(ABORT,'no_charge_approval_required'); END;
    CREATE TRIGGER no_charge_actor_update BEFORE UPDATE OF no_charge_approved_by ON estimates WHEN NEW.no_charge_approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.no_charge_approved_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
    CREATE TRIGGER no_charge_actor_insert BEFORE INSERT ON estimates WHEN NEW.no_charge_approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.no_charge_approved_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) BEGIN SELECT RAISE(ABORT,'tenant_mismatch'); END;
  `,
  ]);
  migrations.push(['011_payment_reversals', paymentReversalsSchema]);
  migrations.push(['012_partial_purchasing', purchasingMigration]);
  for (const [migrationId, sql] of migrations) {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(migrationId)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(typeof sql === 'function' ? sql(db) : sql);
      db.prepare('INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)').run(
        migrationId,
        now(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Falló la migración ${migrationId}: ${error.message}`);
    }
  }
}

export function openDatabase(filename = './data/mecan.db') {
  if (filename !== ':memory:')
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    applyMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

const baseFeatures = [
  ['employees', 'Empleados', 'Límite de empleados', 'limit'],
  ['branches', 'Sucursales', 'Límite de sucursales', 'limit'],
  ['users', 'Usuarios', 'Límite de usuarios', 'limit'],
  ['storage_mb', 'Almacenamiento', 'Megabytes disponibles', 'limit'],
  ['vehicles', 'Vehículos', 'Límite de vehículos', 'limit'],
  ['orders_monthly', 'Órdenes mensuales', 'Límite mensual', 'limit'],
  ['inventory', 'Inventario', 'Gestión de inventario', 'boolean'],
  ['reports', 'Reportes', 'Reportes avanzados', 'boolean'],
  ['multi_branch', 'Consolidación', 'Operación multi-sucursal', 'boolean'],
  ['integrations', 'Integraciones', 'Acceso a integraciones', 'boolean'],
];

export function seedDatabase(db, options = {}) {
  const created = now();
  const insertFeature = db.prepare(
    'INSERT OR IGNORE INTO features (id,code,name,description,kind) VALUES (?,?,?,?,?)',
  );
  for (const feature of baseFeatures) insertFeature.run(`feat-${feature[0]}`, ...feature);
  const plans = [
    ['plan-basic', 'basic', 'Esencial', 'Para talleres que están comenzando', 149000, 'PYG', 1, 1],
    [
      'plan-pro',
      'professional',
      'Profesional',
      'Operación completa para talleres en crecimiento',
      299000,
      'PYG',
      1,
      1,
    ],
    [
      'plan-premium',
      'premium',
      'Multi-sucursal',
      'Control consolidado para operaciones amplias',
      549000,
      'PYG',
      1,
      1,
    ],
  ];
  const insertPlan = db.prepare(
    'INSERT OR IGNORE INTO plans (id,code,name,description,price_monthly,currency,active,public,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (const plan of plans) insertPlan.run(...plan, created);
  const limits = {
    'plan-basic': {
      employees: 5,
      branches: 1,
      users: 5,
      storage_mb: 500,
      vehicles: 500,
      orders_monthly: 200,
      inventory: 1,
      reports: 0,
      multi_branch: 0,
      integrations: 0,
    },
    'plan-pro': {
      employees: 20,
      branches: 3,
      users: 20,
      storage_mb: 5000,
      vehicles: 5000,
      orders_monthly: 2000,
      inventory: 1,
      reports: 1,
      multi_branch: 1,
      integrations: 1,
    },
    'plan-premium': {
      employees: 100,
      branches: 15,
      users: 100,
      storage_mb: 25000,
      vehicles: 50000,
      orders_monthly: 20000,
      inventory: 1,
      reports: 1,
      multi_branch: 1,
      integrations: 1,
    },
  };
  const upsertCapability =
    db.prepare(`INSERT OR IGNORE INTO plan_features (plan_id,feature_id,enabled,limit_value)
    VALUES (?,?,?,?)`);
  for (const [planId, entries] of Object.entries(limits))
    for (const [code, value] of Object.entries(entries)) {
      const feature = db.prepare('SELECT id,kind FROM features WHERE code=?').get(code);
      upsertCapability.run(
        planId,
        feature.id,
        feature.kind === 'boolean' ? Number(Boolean(value)) : 1,
        feature.kind === 'limit' ? value : null,
      );
    }
  const settings = {
    trial_days: '14',
    grace_days: '5',
    suspension_days: '10',
    retention_days: '365',
    default_plan_id: 'plan-pro',
    support_email: options.supportEmail || 'soporte@mecan.local',
    platform_name: options.appName || 'Mecan Cloud',
  };
  const set = db.prepare(
    'INSERT OR IGNORE INTO platform_settings (key,value,updated_at) VALUES (?,?,?)',
  );
  for (const [key, value] of Object.entries(settings)) set.run(key, value, created);
  const defaultRoles = [
    ['MANAGER', 'Gerencia', MANAGER_PERMISSIONS],
    ['RECEPTION', 'Recepción', RECEPTION_PERMISSIONS],
    ['TECHNICIAN', 'Mecánico', TECHNICIAN_PERMISSIONS],
    ['CASHIER', 'Caja', CASHIER_PERMISSIONS],
    ['INVENTORY', 'Inventario', INVENTORY_PERMISSIONS],
  ];
  for (const tenant of db.prepare('SELECT id FROM tenants').all())
    for (const [code, name, rolePermissions] of defaultRoles)
      db.prepare(
        'INSERT OR IGNORE INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1)',
      ).run(id(), tenant.id, code, name, JSON.stringify(rolePermissions));

  const adminEmail = (options.superadminEmail || 'admin@mecan.local').toLowerCase();
  if (
    !db.prepare("SELECT id FROM users WHERE kind='PLATFORM' AND platform_role='SUPER_ADMIN'").get()
  ) {
    db.prepare(
      'INSERT INTO users (id,email,password_hash,name,kind,platform_role,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      'user-platform-admin',
      adminEmail,
      hashPassword(options.superadminPassword || 'Admin123!'),
      'Administrador de plataforma',
      'PLATFORM',
      'SUPER_ADMIN',
      created,
    );
  }
}

export function seedDemoTenant(db) {
  if (db.prepare("SELECT id FROM tenants WHERE slug='taller-demo'").get()) return;
  const created = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO tenants (id,slug,name,legal_name,owner_name,tax_id,phone,email,address,country,city,status,onboarding_step,last_activity_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'tenant-demo',
      'taller-demo',
      'Taller Demo',
      'Taller Demo S.R.L.',
      'María Benítez',
      '80012345-6',
      '0981123456',
      'demo@taller.local',
      'Av. Principal 123',
      'Paraguay',
      'Asunción',
      'TRIAL',
      6,
      created,
      created,
    );
    db.prepare(
      'INSERT INTO tenant_settings (tenant_id,currency,tax_rate,opening_hours,onboarding_data,updated_at) VALUES (?,?,?,?,?,?)',
    ).run(
      'tenant-demo',
      'PYG',
      10,
      JSON.stringify({ weekdays: '07:30–18:00' }),
      JSON.stringify({ services: true, employees: true }),
      created,
    );
    db.prepare(
      'INSERT INTO branches (id,tenant_id,name,phone,address,city,active,is_main,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      'branch-demo',
      'tenant-demo',
      'Casa central',
      '0981123456',
      'Av. Principal 123',
      'Asunción',
      1,
      1,
      created,
    );
    db.prepare(
      'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,?)',
    ).run('role-demo-owner', 'tenant-demo', 'OWNER', 'Propietario', JSON.stringify(['*']), 1);
    for (const [code, name, rolePermissions] of [
      ['MANAGER', 'Gerencia', MANAGER_PERMISSIONS],
      ['RECEPTION', 'Recepción', RECEPTION_PERMISSIONS],
      ['TECHNICIAN', 'Mecánico', TECHNICIAN_PERMISSIONS],
      ['CASHIER', 'Caja', CASHIER_PERMISSIONS],
      ['INVENTORY', 'Inventario', INVENTORY_PERMISSIONS],
    ])
      db.prepare(
        'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1)',
      ).run(id(), 'tenant-demo', code, name, JSON.stringify(rolePermissions));
    db.prepare(
      'INSERT INTO users (id,email,password_hash,name,kind,created_at) VALUES (?,?,?,?,?,?)',
    ).run(
      'user-demo-owner',
      'dueno@demo.local',
      hashPassword('Demo123!'),
      'María Benítez',
      'TENANT',
      created,
    );
    db.prepare(
      'INSERT INTO memberships (id,tenant_id,user_id,branch_id,role_id,job_title,status,joined_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      id(),
      'tenant-demo',
      'user-demo-owner',
      'branch-demo',
      'role-demo-owner',
      'Propietaria',
      'ACTIVE',
      created,
    );
    db.prepare(
      `INSERT INTO subscriptions (id,tenant_id,plan_id,billing_cycle,price,currency,started_at,next_charge_at,status,auto_renew,grace_until,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'sub-demo',
      'tenant-demo',
      'plan-pro',
      'MONTHLY',
      299000,
      'PYG',
      created,
      addDays(created, 14),
      'TRIAL',
      0,
      addDays(created, 19),
      created,
    );
    db.prepare(
      'INSERT INTO trials (id,tenant_id,plan_id,starts_at,ends_at,active) VALUES (?,?,?,?,?,1)',
    ).run(id(), 'tenant-demo', 'plan-pro', created, addDays(created, 14));
    db.prepare(
      'INSERT INTO services (id,tenant_id,name,description,price,duration_minutes,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(id(), 'tenant-demo', 'Cambio de aceite', 'Aceite y filtro', 180000, 60, created);
    db.prepare(
      'INSERT INTO customers (id,tenant_id,branch_id,name,document,phone,email,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      'customer-demo',
      'tenant-demo',
      'branch-demo',
      'Carlos Gómez',
      '4567890',
      '0971555123',
      'carlos@example.com',
      created,
    );
    db.prepare(
      'INSERT INTO vehicles (id,tenant_id,customer_id,plate,make,model,year,color,odometer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      'vehicle-demo',
      'tenant-demo',
      'customer-demo',
      'ABC123',
      'Toyota',
      'Corolla',
      2018,
      'Gris',
      84200,
      created,
    );
    db.prepare(
      'INSERT INTO audit_logs (id,scope,tenant_id,actor_user_id,action,entity_type,entity_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      id(),
      'PLATFORM',
      'tenant-demo',
      'user-platform-admin',
      'TENANT_PROVISIONED',
      'tenant',
      'tenant-demo',
      '{"source":"demo_seed"}',
      created,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function resetExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
}
