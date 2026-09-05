-- PostgreSQL baseline of legacy migrations 001–012. PostgreSQL runtime has no SQLite dependency.

-- Monetary values and quantities use exact NUMERIC storage; identifiers and ISO dates retain their existing representation.

-- Foreign keys are installed after all tables to support existing cyclic references.

CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('PLATFORM','TENANT')),
  platform_role TEXT, active INTEGER NOT NULL DEFAULT 1, last_activity_at TEXT, created_at TEXT NOT NULL
, email_verified_at TEXT, password_changed_at TEXT, must_change_password INTEGER NOT NULL DEFAULT 0);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  csrf_token TEXT NOT NULL, impersonated_tenant_id TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
, ip_hash TEXT, user_agent_hash TEXT);

CREATE TABLE plans (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  price_monthly NUMERIC NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'PYG', active INTEGER NOT NULL DEFAULT 1,
  public INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, retired_at TEXT
);

ALTER TABLE "plans" ADD CONSTRAINT "finite_plans_price_monthly" CHECK ("price_monthly" IS NULL OR "price_monthly" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE features (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  kind TEXT NOT NULL DEFAULT 'boolean', global_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE plan_features (
  plan_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, limit_value NUMERIC, PRIMARY KEY(plan_id,feature_id)
);

ALTER TABLE "plan_features" ADD CONSTRAINT "finite_plan_features_limit_value" CHECK ("limit_value" IS NULL OR "limit_value" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, legal_name TEXT, owner_name TEXT NOT NULL,
  tax_id TEXT, phone TEXT, email TEXT NOT NULL, address TEXT, country TEXT DEFAULT 'Paraguay', city TEXT,
  status TEXT NOT NULL DEFAULT 'INCOMPLETE', onboarding_step INTEGER NOT NULL DEFAULT 1,
  logo_url TEXT, primary_color TEXT DEFAULT '#0f766e', storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  last_activity_at TEXT, created_at TEXT NOT NULL, canceled_at TEXT, deletion_eligible_at TEXT
);

CREATE TABLE branches (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  phone TEXT, address TEXT, city TEXT, active INTEGER NOT NULL DEFAULT 1, is_main INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL,
  name TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '[]', system INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id,code)
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
  branch_id TEXT, role_id TEXT NOT NULL, job_title TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', invited_at TEXT, joined_at TEXT, UNIQUE(tenant_id,user_id)
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL UNIQUE, plan_id TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'MONTHLY', price NUMERIC NOT NULL, currency TEXT NOT NULL,
  started_at TEXT NOT NULL, next_charge_at TEXT NOT NULL, status TEXT NOT NULL, auto_renew INTEGER NOT NULL DEFAULT 0,
  discount_percent NUMERIC NOT NULL DEFAULT 0, promotion TEXT, grace_until TEXT, canceled_at TEXT, updated_at TEXT NOT NULL
);

ALTER TABLE "subscriptions" ADD CONSTRAINT "finite_subscriptions_price" CHECK ("price" IS NULL OR "price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "subscriptions" ADD CONSTRAINT "finite_subscriptions_discount_percent" CHECK ("discount_percent" IS NULL OR "discount_percent" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE subscription_history (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
  event TEXT NOT NULL, from_plan_id TEXT, to_plan_id TEXT, metadata TEXT DEFAULT '{}', actor_user_id TEXT, created_at TEXT NOT NULL
);

CREATE TABLE trials (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tenant_features (
  tenant_id TEXT NOT NULL, feature_id TEXT NOT NULL,
  enabled INTEGER, limit_value NUMERIC, reason TEXT, PRIMARY KEY(tenant_id,feature_id)
);

ALTER TABLE "tenant_features" ADD CONSTRAINT "finite_tenant_features_limit_value" CHECK ("limit_value" IS NULL OR "limit_value" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE tenant_settings (
  tenant_id TEXT PRIMARY KEY, currency TEXT NOT NULL DEFAULT 'PYG', tax_rate NUMERIC NOT NULL DEFAULT 10,
  timezone TEXT NOT NULL DEFAULT 'America/Asuncion', opening_hours TEXT DEFAULT '{}', document_header TEXT, document_footer TEXT,
  onboarding_data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
, warranty_days INTEGER NOT NULL DEFAULT 90, warranty_terms TEXT NOT NULL DEFAULT 'Garantía sobre los trabajos realizados.');

ALTER TABLE "tenant_settings" ADD CONSTRAINT "finite_tenant_settings_tax_rate" CHECK ("tax_rate" IS NULL OR "tax_rate" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT,
  name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, created_at TEXT NOT NULL
, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  plate TEXT NOT NULL, make TEXT, model TEXT, year INTEGER, vin TEXT, color TEXT, odometer INTEGER DEFAULT 0, created_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id,plate)
);

CREATE TABLE services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  price NUMERIC NOT NULL DEFAULT 0, duration_minutes INTEGER NOT NULL DEFAULT 60, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

ALTER TABLE "services" ADD CONSTRAINT "finite_services_price" CHECK ("price" IS NULL OR "price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE work_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, vehicle_id TEXT NOT NULL,
  number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'RECEIVED', complaint TEXT, diagnosis TEXT, notes TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0, tax NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
  promised_at TEXT, completed_at TEXT, created_by TEXT, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,number)
);

ALTER TABLE "work_orders" ADD CONSTRAINT "finite_work_orders_subtotal" CHECK ("subtotal" IS NULL OR "subtotal" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_orders" ADD CONSTRAINT "finite_work_orders_tax" CHECK ("tax" IS NULL OR "tax" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_orders" ADD CONSTRAINT "finite_work_orders_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE work_order_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  item_type TEXT NOT NULL, description TEXT NOT NULL, quantity NUMERIC NOT NULL DEFAULT 1, unit_price NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0
);

ALTER TABLE "work_order_items" ADD CONSTRAINT "finite_work_order_items_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_items" ADD CONSTRAINT "finite_work_order_items_unit_price" CHECK ("unit_price" IS NULL OR "unit_price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_items" ADD CONSTRAINT "finite_work_order_items_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  sku TEXT, name TEXT NOT NULL, quantity NUMERIC NOT NULL DEFAULT 0, minimum_stock NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0, sale_price NUMERIC NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,sku)
);

ALTER TABLE "inventory_items" ADD CONSTRAINT "finite_inventory_items_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "inventory_items" ADD CONSTRAINT "finite_inventory_items_minimum_stock" CHECK ("minimum_stock" IS NULL OR "minimum_stock" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "inventory_items" ADD CONSTRAINT "finite_inventory_items_cost" CHECK ("cost" IS NULL OR "cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "inventory_items" ADD CONSTRAINT "finite_inventory_items_sale_price" CHECK ("sale_price" IS NULL OR "sale_price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  tax_id TEXT, phone TEXT, email TEXT, address TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL, number TEXT, amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RECEIVED', purchased_at TEXT NOT NULL, notes TEXT, created_by TEXT, created_at TEXT NOT NULL
);

ALTER TABLE "purchases" ADD CONSTRAINT "finite_purchases_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE bays (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'AVAILABLE', active INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id,branch_id,name)
);

CREATE TABLE appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, vehicle_id TEXT, scheduled_at TEXT NOT NULL,
  reason TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED', created_by TEXT, created_at TEXT NOT NULL
);

CREATE TABLE workshop_invoices (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL, work_order_id TEXT, number INTEGER NOT NULL,
  amount NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', due_at TEXT, paid_at TEXT, created_at TEXT NOT NULL, subtotal NUMERIC NOT NULL DEFAULT 0, tax NUMERIC NOT NULL DEFAULT 0, paid_amount NUMERIC NOT NULL DEFAULT 0, balance NUMERIC NOT NULL DEFAULT 0, voided_at TEXT, voided_by TEXT, void_reason TEXT, idempotency_key TEXT, currency TEXT,
  UNIQUE(tenant_id,number)
);

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "finite_workshop_invoices_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "finite_workshop_invoices_subtotal" CHECK ("subtotal" IS NULL OR "subtotal" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "finite_workshop_invoices_tax" CHECK ("tax" IS NULL OR "tax" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "finite_workshop_invoices_paid_amount" CHECK ("paid_amount" IS NULL OR "paid_amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "finite_workshop_invoices_balance" CHECK ("balance" IS NULL OR "balance" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  type TEXT NOT NULL, category TEXT NOT NULL, amount NUMERIC NOT NULL, reference TEXT, notes TEXT, created_by TEXT, created_at TEXT NOT NULL
, workshop_payment_id TEXT, purchase_payment_id TEXT, voided_at TEXT, idempotency_key TEXT, reversal_id TEXT);

ALTER TABLE "cash_movements" ADD CONSTRAINT "finite_cash_movements_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE saas_invoices (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
  number TEXT NOT NULL UNIQUE, amount NUMERIC NOT NULL, currency TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', paid_at TEXT, created_at TEXT NOT NULL
, paid_amount NUMERIC NOT NULL DEFAULT 0, balance NUMERIC NOT NULL DEFAULT 0);

ALTER TABLE "saas_invoices" ADD CONSTRAINT "finite_saas_invoices_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "saas_invoices" ADD CONSTRAINT "finite_saas_invoices_paid_amount" CHECK ("paid_amount" IS NULL OR "paid_amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "saas_invoices" ADD CONSTRAINT "finite_saas_invoices_balance" CHECK ("balance" IS NULL OR "balance" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE saas_payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
  invoice_id TEXT, amount NUMERIC NOT NULL, currency TEXT NOT NULL, paid_at TEXT NOT NULL,
  method TEXT NOT NULL, reference TEXT, notes TEXT, period_start TEXT, period_end TEXT,
  provider TEXT NOT NULL DEFAULT 'manual', provider_payment_id TEXT, status TEXT NOT NULL DEFAULT 'APPROVED',
  recorded_by TEXT, created_at TEXT NOT NULL,
  UNIQUE(provider,provider_payment_id)
);

ALTER TABLE "saas_payments" ADD CONSTRAINT "finite_saas_payments_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, created_by TEXT NOT NULL,
  type TEXT NOT NULL, subject TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'NEW', assigned_to TEXT, resolution TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE files (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE, size_bytes BIGINT NOT NULL, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, tenant_id TEXT, actor_user_id TEXT,
  impersonator_user_id TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  ip_address TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
, branch_id TEXT, before_json TEXT, after_json TEXT, request_id TEXT);

CREATE TABLE document_sequences (
  tenant_id TEXT NOT NULL, kind TEXT NOT NULL, next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(tenant_id,kind), CHECK(next_value > 0)
);

CREATE TABLE receptions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL UNIQUE, received_by TEXT NOT NULL,
  fuel_level INTEGER, odometer INTEGER NOT NULL DEFAULT 0, accessories TEXT NOT NULL DEFAULT '[]',
  visible_damage TEXT, customer_notes TEXT, received_at TEXT NOT NULL,
  CHECK(fuel_level IS NULL OR (fuel_level >= 0 AND fuel_level <= 100)), CHECK(odometer >= 0)
);

CREATE TABLE inspections (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  inspector_user_id TEXT NOT NULL, checklist TEXT NOT NULL DEFAULT '[]', findings TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED')),
  completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE diagnoses (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  technician_user_id TEXT, summary TEXT NOT NULL, recommendations TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED')),
  completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE estimates (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  number INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','SENT','APPROVED','PARTIALLY_APPROVED','REJECTED','EXPIRED','CANCELED')),
  subtotal NUMERIC NOT NULL DEFAULT 0, tax NUMERIC NOT NULL DEFAULT 0, discount NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
  valid_until TEXT, sent_at TEXT, approved_at TEXT, approved_by_name TEXT, approval_notes TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, tax_rate NUMERIC, no_charge_approved_by TEXT, no_charge_reason TEXT,
  UNIQUE(tenant_id,number,version), CHECK(subtotal >= 0), CHECK(tax >= 0), CHECK(discount >= 0), CHECK(total >= 0)
);

ALTER TABLE "estimates" ADD CONSTRAINT "finite_estimates_subtotal" CHECK ("subtotal" IS NULL OR "subtotal" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimates" ADD CONSTRAINT "finite_estimates_tax" CHECK ("tax" IS NULL OR "tax" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimates" ADD CONSTRAINT "finite_estimates_discount" CHECK ("discount" IS NULL OR "discount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimates" ADD CONSTRAINT "finite_estimates_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimates" ADD CONSTRAINT "finite_estimates_tax_rate" CHECK ("tax_rate" IS NULL OR "tax_rate" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE estimate_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, estimate_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('LABOR','PART','SERVICE','OTHER')), description TEXT NOT NULL,
  inventory_item_id TEXT, quantity NUMERIC NOT NULL DEFAULT 1,
  unit_cost NUMERIC NOT NULL DEFAULT 0, unit_price NUMERIC NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 1,
  total NUMERIC NOT NULL DEFAULT 0, CHECK(quantity > 0), CHECK(unit_cost >= 0), CHECK(unit_price >= 0), CHECK(total >= 0)
);

ALTER TABLE "estimate_items" ADD CONSTRAINT "finite_estimate_items_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimate_items" ADD CONSTRAINT "finite_estimate_items_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimate_items" ADD CONSTRAINT "finite_estimate_items_unit_price" CHECK ("unit_price" IS NULL OR "unit_price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "estimate_items" ADD CONSTRAINT "finite_estimate_items_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE work_assignments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  technician_user_id TEXT NOT NULL, description TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')), status TEXT NOT NULL DEFAULT 'ASSIGNED'
    CHECK(status IN ('ASSIGNED','IN_PROGRESS','PAUSED','BLOCKED','COMPLETED','CANCELED')),
  instructions TEXT, started_at TEXT, paused_at TEXT, completed_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE time_entries (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
  technician_user_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
  duration_minutes INTEGER, notes TEXT, CHECK(duration_minutes IS NULL OR duration_minutes >= 0)
);

CREATE TABLE work_order_parts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL, quantity NUMERIC NOT NULL, unit_cost NUMERIC NOT NULL,
  unit_price NUMERIC NOT NULL, total NUMERIC NOT NULL, consumed_by TEXT NOT NULL, consumed_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, returned_at TEXT, UNIQUE(tenant_id,idempotency_key), CHECK(quantity > 0), CHECK(unit_cost >= 0), CHECK(unit_price >= 0)
);

ALTER TABLE "work_order_parts" ADD CONSTRAINT "finite_work_order_parts_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_parts" ADD CONSTRAINT "finite_work_order_parts_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_parts" ADD CONSTRAINT "finite_work_order_parts_unit_price" CHECK ("unit_price" IS NULL OR "unit_price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_parts" ADD CONSTRAINT "finite_work_order_parts_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE work_order_labor (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  technician_user_id TEXT, description TEXT NOT NULL, hours NUMERIC NOT NULL,
  hourly_cost NUMERIC NOT NULL DEFAULT 0, hourly_price NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(hours > 0), CHECK(hourly_cost >= 0), CHECK(hourly_price >= 0)
);

ALTER TABLE "work_order_labor" ADD CONSTRAINT "finite_work_order_labor_hours" CHECK ("hours" IS NULL OR "hours" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_labor" ADD CONSTRAINT "finite_work_order_labor_hourly_cost" CHECK ("hourly_cost" IS NULL OR "hourly_cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_labor" ADD CONSTRAINT "finite_work_order_labor_hourly_price" CHECK ("hourly_price" IS NULL OR "hourly_price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "work_order_labor" ADD CONSTRAINT "finite_work_order_labor_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL, movement_type TEXT NOT NULL
    CHECK(movement_type IN ('OPENING','PURCHASE','CONSUMPTION','RETURN','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','RESERVATION','RELEASE')),
  quantity NUMERIC NOT NULL, previous_quantity NUMERIC NOT NULL, resulting_quantity NUMERIC NOT NULL,
  unit_cost NUMERIC, reference_type TEXT, reference_id TEXT, reason TEXT, actor_user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key),
  CHECK(quantity <> 0), CHECK(previous_quantity >= 0), CHECK(resulting_quantity >= 0)
);

ALTER TABLE "inventory_movements" ADD CONSTRAINT "finite_inventory_movements_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "inventory_movements" ADD CONSTRAINT "finite_inventory_movements_previous_quantity" CHECK ("previous_quantity" IS NULL OR "previous_quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "inventory_movements" ADD CONSTRAINT "finite_inventory_movements_resulting_quantity" CHECK ("resulting_quantity" IS NULL OR "resulting_quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "inventory_movements" ADD CONSTRAINT "finite_inventory_movements_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE purchase_requests (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  work_order_id TEXT, inventory_item_id TEXT,
  description TEXT NOT NULL, quantity NUMERIC NOT NULL, priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','QUOTING','ORDERED','RECEIVED','CANCELED')),
  requested_by TEXT NOT NULL, created_at TEXT NOT NULL, canceled_at TEXT, canceled_by TEXT, cancel_reason TEXT, CHECK(quantity > 0)
);

ALTER TABLE "purchase_requests" ADD CONSTRAINT "finite_purchase_requests_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL, purchase_request_id TEXT, number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','PARTIAL','RECEIVED','CANCELED')),
  subtotal NUMERIC NOT NULL DEFAULT 0, tax NUMERIC NOT NULL DEFAULT 0, total NUMERIC NOT NULL DEFAULT 0,
  expected_at TEXT, received_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, currency TEXT, received_subtotal NUMERIC NOT NULL DEFAULT 0 CHECK(received_subtotal>=0), received_tax NUMERIC NOT NULL DEFAULT 0 CHECK(received_tax>=0), received_total NUMERIC NOT NULL DEFAULT 0 CHECK(received_total>=0), canceled_at TEXT, canceled_by TEXT, cancel_reason TEXT,
  UNIQUE(tenant_id,number), CHECK(total >= 0)
);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "finite_purchase_orders_subtotal" CHECK ("subtotal" IS NULL OR "subtotal" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "finite_purchase_orders_tax" CHECK ("tax" IS NULL OR "tax" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "finite_purchase_orders_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "finite_purchase_orders_received_subtotal" CHECK ("received_subtotal" IS NULL OR "received_subtotal" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "finite_purchase_orders_received_tax" CHECK ("received_tax" IS NULL OR "received_tax" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "finite_purchase_orders_received_total" CHECK ("received_total" IS NULL OR "received_total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, purchase_order_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL, description TEXT NOT NULL, quantity NUMERIC NOT NULL,
  received_quantity NUMERIC NOT NULL DEFAULT 0, unit_cost NUMERIC NOT NULL, total NUMERIC NOT NULL, opening_received_quantity NUMERIC NOT NULL DEFAULT 0 CHECK(opening_received_quantity>=0 AND opening_received_quantity<=received_quantity), canceled_quantity NUMERIC NOT NULL DEFAULT 0 CHECK(canceled_quantity>=0 AND received_quantity+canceled_quantity<=quantity),
  CHECK(quantity > 0), CHECK(received_quantity >= 0 AND received_quantity <= quantity), CHECK(unit_cost >= 0)
);

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "finite_purchase_order_items_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "finite_purchase_order_items_received_quantity" CHECK ("received_quantity" IS NULL OR "received_quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "finite_purchase_order_items_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "finite_purchase_order_items_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "finite_purchase_order_items_opening_received_quantity" CHECK ("opening_received_quantity" IS NULL OR "opening_received_quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "finite_purchase_order_items_canceled_quantity" CHECK ("canceled_quantity" IS NULL OR "canceled_quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE accounts_payable (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL, purchase_order_id TEXT NOT NULL UNIQUE,
  amount NUMERIC NOT NULL, paid_amount NUMERIC NOT NULL DEFAULT 0, balance NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PARTIAL','PAID','VOID')),
  due_at TEXT, created_at TEXT NOT NULL, CHECK(amount >= 0), CHECK(paid_amount >= 0), CHECK(balance >= 0)
);

ALTER TABLE "accounts_payable" ADD CONSTRAINT "finite_accounts_payable_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "accounts_payable" ADD CONSTRAINT "finite_accounts_payable_paid_amount" CHECK ("paid_amount" IS NULL OR "paid_amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "accounts_payable" ADD CONSTRAINT "finite_accounts_payable_balance" CHECK ("balance" IS NULL OR "balance" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE purchase_payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, payable_id TEXT NOT NULL,
  amount NUMERIC NOT NULL, method TEXT NOT NULL, reference TEXT, paid_at TEXT NOT NULL,
  actor_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key), CHECK(amount > 0)
);

ALTER TABLE "purchase_payments" ADD CONSTRAINT "finite_purchase_payments_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE quality_checks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  inspector_user_id TEXT NOT NULL, checklist TEXT NOT NULL DEFAULT '[]', notes TEXT,
  result TEXT NOT NULL CHECK(result IN ('PASSED','FAILED')), created_at TEXT NOT NULL
);

CREATE TABLE workshop_invoice_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
  item_type TEXT NOT NULL, description TEXT NOT NULL, quantity NUMERIC NOT NULL, unit_price NUMERIC NOT NULL, total NUMERIC NOT NULL,
  CHECK(quantity > 0), CHECK(unit_price >= 0), CHECK(total >= 0)
);

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "finite_workshop_invoice_items_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "finite_workshop_invoice_items_unit_price" CHECK ("unit_price" IS NULL OR "unit_price" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "finite_workshop_invoice_items_total" CHECK ("total" IS NULL OR "total" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE workshop_payments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
  amount NUMERIC NOT NULL, method TEXT NOT NULL, reference TEXT, paid_at TEXT NOT NULL,
  received_by TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,idempotency_key), CHECK(amount > 0)
);

ALTER TABLE "workshop_payments" ADD CONSTRAINT "finite_workshop_payments_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL UNIQUE,
  delivered_by TEXT NOT NULL, received_by_name TEXT NOT NULL, notes TEXT,
  odometer INTEGER, delivered_at TEXT NOT NULL, CHECK(odometer IS NULL OR odometer >= 0)
);

CREATE TABLE warranties (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, terms TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(status IN ('ACTIVE','CLAIMED','EXPIRED','VOID')), created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, channel TEXT NOT NULL,
  event_type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED','READ')),
  idempotency_key TEXT NOT NULL UNIQUE, scheduled_at TEXT NOT NULL, sent_at TEXT, read_at TEXT, created_at TEXT NOT NULL
, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, next_attempt_at TEXT, locked_until TEXT, required_permission TEXT NOT NULL DEFAULT 'settings.manage');

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, succeeded INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT NOT NULL
);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  tenant_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
  resource_id TEXT, response_json TEXT, created_at TEXT NOT NULL, PRIMARY KEY(tenant_id,operation,key)
);

CREATE TABLE file_links (
  file_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'DOCUMENT'
);

CREATE TABLE customer_communications (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('PHONE','EMAIL','WHATSAPP','SMS','IN_PERSON','OTHER')),
  direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')), subject TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECORDED', created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE warranty_claims (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, warranty_id TEXT NOT NULL,
  work_order_id TEXT, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACCEPTED','REJECTED','RESOLVED','CLOSED')),
  resolution TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT
);

CREATE TABLE stock_reservations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  inventory_item_id TEXT NOT NULL, work_order_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CONSUMED','RELEASED')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, released_at TEXT, idempotency_key TEXT, CHECK(quantity > 0)
);

ALTER TABLE "stock_reservations" ADD CONSTRAINT "finite_stock_reservations_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE inventory_transfers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, inventory_item_id TEXT NOT NULL,
  from_branch_id TEXT NOT NULL, to_branch_id TEXT NOT NULL, quantity NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('PENDING','COMPLETED','CANCELED')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
  idempotency_key TEXT NOT NULL, destination_item_id TEXT, UNIQUE(tenant_id,idempotency_key), CHECK(quantity > 0), CHECK(from_branch_id <> to_branch_id)
);

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "finite_inventory_transfers_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE contact_inquiries (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, workshop TEXT, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW', ip_hash TEXT, created_at TEXT NOT NULL
);

CREATE TABLE platform_sequences (
  kind TEXT NOT NULL, year INTEGER NOT NULL, next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(kind,year), CHECK(next_value > 0)
);

CREATE TABLE password_reset_requests (
  id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, requested_at TEXT NOT NULL
);

CREATE TABLE legal_acceptances (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,tenant_id TEXT NOT NULL,
      terms_version TEXT NOT NULL,privacy_version TEXT NOT NULL,accepted_at TEXT NOT NULL
    );

CREATE TABLE request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);

CREATE TABLE stock_returns (
      id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,part_id TEXT NOT NULL,
      quantity NUMERIC NOT NULL CHECK(quantity>0),reason TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,UNIQUE(tenant_id,idempotency_key)
    );

ALTER TABLE "stock_returns" ADD CONSTRAINT "finite_stock_returns_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE notification_reads (
        notification_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL, read_at TEXT NOT NULL,
        PRIMARY KEY(notification_id,user_id)
      );

CREATE TABLE payment_reversals (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  customer_payment_id TEXT UNIQUE,
  purchase_payment_id TEXT UNIQUE,
  amount NUMERIC NOT NULL CHECK(amount>0), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key),
  CHECK((customer_payment_id IS NOT NULL) <> (purchase_payment_id IS NOT NULL))
);

ALTER TABLE "payment_reversals" ADD CONSTRAINT "finite_payment_reversals_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE purchase_receipts (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
      purchase_order_id TEXT NOT NULL, reference TEXT, notes TEXT,
      subtotal NUMERIC NOT NULL CHECK(subtotal>=0), tax NUMERIC NOT NULL CHECK(tax>=0), amount NUMERIC NOT NULL CHECK(amount>=0), currency TEXT NOT NULL,
      received_by TEXT NOT NULL, received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, UNIQUE(tenant_id,idempotency_key)
    );

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "finite_purchase_receipts_subtotal" CHECK ("subtotal" IS NULL OR "subtotal" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "finite_purchase_receipts_tax" CHECK ("tax" IS NULL OR "tax" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "finite_purchase_receipts_amount" CHECK ("amount" IS NULL OR "amount" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE TABLE purchase_receipt_lines (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, receipt_id TEXT NOT NULL,
      purchase_order_item_id TEXT NOT NULL, inventory_item_id TEXT NOT NULL,
      quantity NUMERIC NOT NULL CHECK(quantity>0), unit_cost NUMERIC NOT NULL CHECK(unit_cost>=0),
      inventory_movement_id TEXT NOT NULL UNIQUE, UNIQUE(receipt_id,purchase_order_item_id)
    );

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "finite_purchase_receipt_lines_quantity" CHECK ("quantity" IS NULL OR "quantity" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "finite_purchase_receipt_lines_unit_cost" CHECK ("unit_cost" IS NULL OR "unit_cost" NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric));

CREATE UNIQUE INDEX users_email_case_insensitive ON users(lower(email));

CREATE UNIQUE INDEX memberships_single_tenant_user ON memberships(user_id);

ALTER TABLE "branches" ADD CONSTRAINT "tenant_identity_branches" UNIQUE(tenant_id,id);

ALTER TABLE "roles" ADD CONSTRAINT "tenant_identity_roles" UNIQUE(tenant_id,id);

ALTER TABLE "memberships" ADD CONSTRAINT "tenant_identity_memberships" UNIQUE(tenant_id,id);

ALTER TABLE "subscriptions" ADD CONSTRAINT "tenant_identity_subscriptions" UNIQUE(tenant_id,id);

ALTER TABLE "subscription_history" ADD CONSTRAINT "tenant_identity_subscription_history" UNIQUE(tenant_id,id);

ALTER TABLE "trials" ADD CONSTRAINT "tenant_identity_trials" UNIQUE(tenant_id,id);

ALTER TABLE "customers" ADD CONSTRAINT "tenant_identity_customers" UNIQUE(tenant_id,id);

ALTER TABLE "vehicles" ADD CONSTRAINT "tenant_identity_vehicles" UNIQUE(tenant_id,id);

ALTER TABLE "services" ADD CONSTRAINT "tenant_identity_services" UNIQUE(tenant_id,id);

ALTER TABLE "work_orders" ADD CONSTRAINT "tenant_identity_work_orders" UNIQUE(tenant_id,id);

ALTER TABLE "work_order_items" ADD CONSTRAINT "tenant_identity_work_order_items" UNIQUE(tenant_id,id);

ALTER TABLE "inventory_items" ADD CONSTRAINT "tenant_identity_inventory_items" UNIQUE(tenant_id,id);

ALTER TABLE "suppliers" ADD CONSTRAINT "tenant_identity_suppliers" UNIQUE(tenant_id,id);

ALTER TABLE "purchases" ADD CONSTRAINT "tenant_identity_purchases" UNIQUE(tenant_id,id);

ALTER TABLE "bays" ADD CONSTRAINT "tenant_identity_bays" UNIQUE(tenant_id,id);

ALTER TABLE "appointments" ADD CONSTRAINT "tenant_identity_appointments" UNIQUE(tenant_id,id);

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "tenant_identity_workshop_invoices" UNIQUE(tenant_id,id);

ALTER TABLE "cash_movements" ADD CONSTRAINT "tenant_identity_cash_movements" UNIQUE(tenant_id,id);

ALTER TABLE "saas_invoices" ADD CONSTRAINT "tenant_identity_saas_invoices" UNIQUE(tenant_id,id);

ALTER TABLE "saas_payments" ADD CONSTRAINT "tenant_identity_saas_payments" UNIQUE(tenant_id,id);

ALTER TABLE "support_tickets" ADD CONSTRAINT "tenant_identity_support_tickets" UNIQUE(tenant_id,id);

ALTER TABLE "files" ADD CONSTRAINT "tenant_identity_files" UNIQUE(tenant_id,id);

ALTER TABLE "audit_logs" ADD CONSTRAINT "tenant_identity_audit_logs" UNIQUE(tenant_id,id);

ALTER TABLE "receptions" ADD CONSTRAINT "tenant_identity_receptions" UNIQUE(tenant_id,id);

ALTER TABLE "inspections" ADD CONSTRAINT "tenant_identity_inspections" UNIQUE(tenant_id,id);

ALTER TABLE "diagnoses" ADD CONSTRAINT "tenant_identity_diagnoses" UNIQUE(tenant_id,id);

ALTER TABLE "estimates" ADD CONSTRAINT "tenant_identity_estimates" UNIQUE(tenant_id,id);

ALTER TABLE "estimate_items" ADD CONSTRAINT "tenant_identity_estimate_items" UNIQUE(tenant_id,id);

ALTER TABLE "work_assignments" ADD CONSTRAINT "tenant_identity_work_assignments" UNIQUE(tenant_id,id);

ALTER TABLE "time_entries" ADD CONSTRAINT "tenant_identity_time_entries" UNIQUE(tenant_id,id);

ALTER TABLE "work_order_parts" ADD CONSTRAINT "tenant_identity_work_order_parts" UNIQUE(tenant_id,id);

ALTER TABLE "work_order_labor" ADD CONSTRAINT "tenant_identity_work_order_labor" UNIQUE(tenant_id,id);

ALTER TABLE "inventory_movements" ADD CONSTRAINT "tenant_identity_inventory_movements" UNIQUE(tenant_id,id);

ALTER TABLE "purchase_requests" ADD CONSTRAINT "tenant_identity_purchase_requests" UNIQUE(tenant_id,id);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "tenant_identity_purchase_orders" UNIQUE(tenant_id,id);

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "tenant_identity_purchase_order_items" UNIQUE(tenant_id,id);

ALTER TABLE "accounts_payable" ADD CONSTRAINT "tenant_identity_accounts_payable" UNIQUE(tenant_id,id);

ALTER TABLE "purchase_payments" ADD CONSTRAINT "tenant_identity_purchase_payments" UNIQUE(tenant_id,id);

ALTER TABLE "quality_checks" ADD CONSTRAINT "tenant_identity_quality_checks" UNIQUE(tenant_id,id);

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "tenant_identity_workshop_invoice_items" UNIQUE(tenant_id,id);

ALTER TABLE "workshop_payments" ADD CONSTRAINT "tenant_identity_workshop_payments" UNIQUE(tenant_id,id);

ALTER TABLE "deliveries" ADD CONSTRAINT "tenant_identity_deliveries" UNIQUE(tenant_id,id);

ALTER TABLE "warranties" ADD CONSTRAINT "tenant_identity_warranties" UNIQUE(tenant_id,id);

ALTER TABLE "notifications" ADD CONSTRAINT "tenant_identity_notifications" UNIQUE(tenant_id,id);

ALTER TABLE "customer_communications" ADD CONSTRAINT "tenant_identity_customer_communications" UNIQUE(tenant_id,id);

ALTER TABLE "warranty_claims" ADD CONSTRAINT "tenant_identity_warranty_claims" UNIQUE(tenant_id,id);

ALTER TABLE "stock_reservations" ADD CONSTRAINT "tenant_identity_stock_reservations" UNIQUE(tenant_id,id);

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "tenant_identity_inventory_transfers" UNIQUE(tenant_id,id);

ALTER TABLE "legal_acceptances" ADD CONSTRAINT "tenant_identity_legal_acceptances" UNIQUE(tenant_id,id);

ALTER TABLE "stock_returns" ADD CONSTRAINT "tenant_identity_stock_returns" UNIQUE(tenant_id,id);

ALTER TABLE "payment_reversals" ADD CONSTRAINT "tenant_identity_payment_reversals" UNIQUE(tenant_id,id);

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "tenant_identity_purchase_receipts" UNIQUE(tenant_id,id);

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "tenant_identity_purchase_receipt_lines" UNIQUE(tenant_id,id);

ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "plan_features" ADD CONSTRAINT "fk_plan_features_feature_id" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "plan_features" ADD CONSTRAINT "fk_plan_features_plan_id" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "branches" ADD CONSTRAINT "fk_branches_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "roles" ADD CONSTRAINT "fk_roles_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "memberships" ADD CONSTRAINT "fk_memberships_role_id" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "memberships" ADD CONSTRAINT "tenant_fk_memberships_role_id" FOREIGN KEY (tenant_id,"role_id") REFERENCES "roles"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "memberships" ADD CONSTRAINT "fk_memberships_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "memberships" ADD CONSTRAINT "tenant_fk_memberships_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "memberships" ADD CONSTRAINT "fk_memberships_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "memberships" ADD CONSTRAINT "fk_memberships_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_plan_id" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscription_history" ADD CONSTRAINT "fk_subscription_history_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscription_history" ADD CONSTRAINT "tenant_fk_subscription_history_subscription_id" FOREIGN KEY (tenant_id,"subscription_id") REFERENCES "subscriptions"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscription_history" ADD CONSTRAINT "fk_subscription_history_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trials" ADD CONSTRAINT "fk_trials_plan_id" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trials" ADD CONSTRAINT "fk_trials_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tenant_features" ADD CONSTRAINT "fk_tenant_features_feature_id" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tenant_features" ADD CONSTRAINT "fk_tenant_features_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tenant_settings" ADD CONSTRAINT "fk_tenant_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customers" ADD CONSTRAINT "tenant_fk_customers_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customers" ADD CONSTRAINT "fk_customers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vehicles" ADD CONSTRAINT "fk_vehicles_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vehicles" ADD CONSTRAINT "tenant_fk_vehicles_customer_id" FOREIGN KEY (tenant_id,"customer_id") REFERENCES "customers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "vehicles" ADD CONSTRAINT "fk_vehicles_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "services" ADD CONSTRAINT "fk_services_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "fk_work_orders_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "fk_work_orders_vehicle_id" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "tenant_fk_work_orders_vehicle_id" FOREIGN KEY (tenant_id,"vehicle_id") REFERENCES "vehicles"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "fk_work_orders_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "tenant_fk_work_orders_customer_id" FOREIGN KEY (tenant_id,"customer_id") REFERENCES "customers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "fk_work_orders_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "tenant_fk_work_orders_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_orders" ADD CONSTRAINT "fk_work_orders_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_items" ADD CONSTRAINT "fk_work_order_items_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_items" ADD CONSTRAINT "tenant_fk_work_order_items_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_items" ADD CONSTRAINT "fk_work_order_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_items" ADD CONSTRAINT "tenant_fk_inventory_items_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inventory_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "suppliers" ADD CONSTRAINT "fk_suppliers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchases" ADD CONSTRAINT "tenant_fk_purchases_supplier_id" FOREIGN KEY (tenant_id,"supplier_id") REFERENCES "suppliers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchases" ADD CONSTRAINT "tenant_fk_purchases_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchases" ADD CONSTRAINT "fk_purchases_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "bays" ADD CONSTRAINT "fk_bays_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "bays" ADD CONSTRAINT "tenant_fk_bays_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "bays" ADD CONSTRAINT "fk_bays_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_vehicle_id" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "tenant_fk_appointments_vehicle_id" FOREIGN KEY (tenant_id,"vehicle_id") REFERENCES "vehicles"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "tenant_fk_appointments_customer_id" FOREIGN KEY (tenant_id,"customer_id") REFERENCES "customers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "tenant_fk_appointments_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD CONSTRAINT "fk_appointments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "fk_workshop_invoices_voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "fk_workshop_invoices_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "tenant_fk_workshop_invoices_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "fk_workshop_invoices_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "tenant_fk_workshop_invoices_customer_id" FOREIGN KEY (tenant_id,"customer_id") REFERENCES "customers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "fk_workshop_invoices_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "tenant_fk_workshop_invoices_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoices" ADD CONSTRAINT "fk_workshop_invoices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "fk_cash_movements_reversal_id" FOREIGN KEY ("reversal_id") REFERENCES "payment_reversals"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "tenant_fk_cash_movements_reversal_id" FOREIGN KEY (tenant_id,"reversal_id") REFERENCES "payment_reversals"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "fk_cash_movements_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "fk_cash_movements_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "tenant_fk_cash_movements_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "cash_movements" ADD CONSTRAINT "fk_cash_movements_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_invoices" ADD CONSTRAINT "fk_saas_invoices_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_invoices" ADD CONSTRAINT "tenant_fk_saas_invoices_subscription_id" FOREIGN KEY (tenant_id,"subscription_id") REFERENCES "subscriptions"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_invoices" ADD CONSTRAINT "fk_saas_invoices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_payments" ADD CONSTRAINT "fk_saas_payments_recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_payments" ADD CONSTRAINT "fk_saas_payments_invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "saas_invoices"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_payments" ADD CONSTRAINT "tenant_fk_saas_payments_invoice_id" FOREIGN KEY (tenant_id,"invoice_id") REFERENCES "saas_invoices"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_payments" ADD CONSTRAINT "fk_saas_payments_subscription_id" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_payments" ADD CONSTRAINT "tenant_fk_saas_payments_subscription_id" FOREIGN KEY (tenant_id,"subscription_id") REFERENCES "subscriptions"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "saas_payments" ADD CONSTRAINT "fk_saas_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "support_tickets" ADD CONSTRAINT "fk_support_tickets_assigned_to" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "support_tickets" ADD CONSTRAINT "fk_support_tickets_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "support_tickets" ADD CONSTRAINT "fk_support_tickets_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "files" ADD CONSTRAINT "fk_files_uploaded_by" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "files" ADD CONSTRAINT "fk_files_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "tenant_fk_audit_logs_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_impersonator_user_id" FOREIGN KEY ("impersonator_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_audit_logs_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "document_sequences" ADD CONSTRAINT "fk_document_sequences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "receptions" ADD CONSTRAINT "fk_receptions_received_by" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "receptions" ADD CONSTRAINT "fk_receptions_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "receptions" ADD CONSTRAINT "tenant_fk_receptions_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "receptions" ADD CONSTRAINT "fk_receptions_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "receptions" ADD CONSTRAINT "tenant_fk_receptions_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "receptions" ADD CONSTRAINT "fk_receptions_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections_inspector_user_id" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inspections" ADD CONSTRAINT "tenant_fk_inspections_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inspections" ADD CONSTRAINT "fk_inspections_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "diagnoses" ADD CONSTRAINT "fk_diagnoses_technician_user_id" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "diagnoses" ADD CONSTRAINT "fk_diagnoses_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "diagnoses" ADD CONSTRAINT "tenant_fk_diagnoses_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "diagnoses" ADD CONSTRAINT "fk_diagnoses_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimates" ADD CONSTRAINT "fk_estimates_no_charge_approved_by" FOREIGN KEY ("no_charge_approved_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimates" ADD CONSTRAINT "fk_estimates_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimates" ADD CONSTRAINT "fk_estimates_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimates" ADD CONSTRAINT "tenant_fk_estimates_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimates" ADD CONSTRAINT "fk_estimates_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimate_items" ADD CONSTRAINT "fk_estimate_items_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimate_items" ADD CONSTRAINT "tenant_fk_estimate_items_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimate_items" ADD CONSTRAINT "fk_estimate_items_estimate_id" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimate_items" ADD CONSTRAINT "tenant_fk_estimate_items_estimate_id" FOREIGN KEY (tenant_id,"estimate_id") REFERENCES "estimates"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "estimate_items" ADD CONSTRAINT "fk_estimate_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_assignments" ADD CONSTRAINT "fk_work_assignments_technician_user_id" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_assignments" ADD CONSTRAINT "fk_work_assignments_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_assignments" ADD CONSTRAINT "tenant_fk_work_assignments_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_assignments" ADD CONSTRAINT "fk_work_assignments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "time_entries" ADD CONSTRAINT "fk_time_entries_technician_user_id" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "time_entries" ADD CONSTRAINT "fk_time_entries_assignment_id" FOREIGN KEY ("assignment_id") REFERENCES "work_assignments"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "time_entries" ADD CONSTRAINT "tenant_fk_time_entries_assignment_id" FOREIGN KEY (tenant_id,"assignment_id") REFERENCES "work_assignments"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "time_entries" ADD CONSTRAINT "fk_time_entries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_parts" ADD CONSTRAINT "fk_work_order_parts_consumed_by" FOREIGN KEY ("consumed_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_parts" ADD CONSTRAINT "fk_work_order_parts_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_parts" ADD CONSTRAINT "tenant_fk_work_order_parts_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_parts" ADD CONSTRAINT "fk_work_order_parts_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_parts" ADD CONSTRAINT "tenant_fk_work_order_parts_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_parts" ADD CONSTRAINT "fk_work_order_parts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_labor" ADD CONSTRAINT "fk_work_order_labor_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_labor" ADD CONSTRAINT "fk_work_order_labor_technician_user_id" FOREIGN KEY ("technician_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_labor" ADD CONSTRAINT "fk_work_order_labor_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_labor" ADD CONSTRAINT "tenant_fk_work_order_labor_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "work_order_labor" ADD CONSTRAINT "fk_work_order_labor_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "tenant_fk_inventory_movements_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "tenant_fk_inventory_movements_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_inventory_movements_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_canceled_by" FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_requested_by" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "tenant_fk_purchase_requests_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "tenant_fk_purchase_requests_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "tenant_fk_purchase_requests_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_requests" ADD CONSTRAINT "fk_purchase_requests_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_canceled_by" FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_purchase_request_id" FOREIGN KEY ("purchase_request_id") REFERENCES "purchase_requests"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "tenant_fk_purchase_orders_purchase_request_id" FOREIGN KEY (tenant_id,"purchase_request_id") REFERENCES "purchase_requests"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "tenant_fk_purchase_orders_supplier_id" FOREIGN KEY (tenant_id,"supplier_id") REFERENCES "suppliers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "tenant_fk_purchase_orders_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_purchase_orders_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "fk_purchase_order_items_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "tenant_fk_purchase_order_items_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "fk_purchase_order_items_purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "tenant_fk_purchase_order_items_purchase_order_id" FOREIGN KEY (tenant_id,"purchase_order_id") REFERENCES "purchase_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "fk_purchase_order_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "fk_accounts_payable_purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "tenant_fk_accounts_payable_purchase_order_id" FOREIGN KEY (tenant_id,"purchase_order_id") REFERENCES "purchase_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "fk_accounts_payable_supplier_id" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "tenant_fk_accounts_payable_supplier_id" FOREIGN KEY (tenant_id,"supplier_id") REFERENCES "suppliers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "fk_accounts_payable_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "tenant_fk_accounts_payable_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "accounts_payable" ADD CONSTRAINT "fk_accounts_payable_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_payments" ADD CONSTRAINT "fk_purchase_payments_actor_user_id" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_payments" ADD CONSTRAINT "fk_purchase_payments_payable_id" FOREIGN KEY ("payable_id") REFERENCES "accounts_payable"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_payments" ADD CONSTRAINT "tenant_fk_purchase_payments_payable_id" FOREIGN KEY (tenant_id,"payable_id") REFERENCES "accounts_payable"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_payments" ADD CONSTRAINT "fk_purchase_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "quality_checks" ADD CONSTRAINT "fk_quality_checks_inspector_user_id" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "quality_checks" ADD CONSTRAINT "fk_quality_checks_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "quality_checks" ADD CONSTRAINT "tenant_fk_quality_checks_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "quality_checks" ADD CONSTRAINT "fk_quality_checks_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "fk_workshop_invoice_items_invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "workshop_invoices"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "tenant_fk_workshop_invoice_items_invoice_id" FOREIGN KEY (tenant_id,"invoice_id") REFERENCES "workshop_invoices"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_invoice_items" ADD CONSTRAINT "fk_workshop_invoice_items_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_payments" ADD CONSTRAINT "fk_workshop_payments_received_by" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_payments" ADD CONSTRAINT "fk_workshop_payments_invoice_id" FOREIGN KEY ("invoice_id") REFERENCES "workshop_invoices"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_payments" ADD CONSTRAINT "tenant_fk_workshop_payments_invoice_id" FOREIGN KEY (tenant_id,"invoice_id") REFERENCES "workshop_invoices"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workshop_payments" ADD CONSTRAINT "fk_workshop_payments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "deliveries" ADD CONSTRAINT "fk_deliveries_delivered_by" FOREIGN KEY ("delivered_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "deliveries" ADD CONSTRAINT "fk_deliveries_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "deliveries" ADD CONSTRAINT "tenant_fk_deliveries_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "deliveries" ADD CONSTRAINT "fk_deliveries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranties" ADD CONSTRAINT "fk_warranties_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranties" ADD CONSTRAINT "fk_warranties_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranties" ADD CONSTRAINT "tenant_fk_warranties_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranties" ADD CONSTRAINT "fk_warranties_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "fk_password_reset_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "fk_idempotency_keys_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_links" ADD CONSTRAINT "fk_file_links_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_links" ADD CONSTRAINT "fk_file_links_file_id" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_links" ADD CONSTRAINT "tenant_fk_file_links_file_id" FOREIGN KEY (tenant_id,"file_id") REFERENCES "files"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customer_communications" ADD CONSTRAINT "fk_customer_communications_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customer_communications" ADD CONSTRAINT "fk_customer_communications_customer_id" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customer_communications" ADD CONSTRAINT "tenant_fk_customer_communications_customer_id" FOREIGN KEY (tenant_id,"customer_id") REFERENCES "customers"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "customer_communications" ADD CONSTRAINT "fk_customer_communications_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranty_claims" ADD CONSTRAINT "fk_warranty_claims_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranty_claims" ADD CONSTRAINT "fk_warranty_claims_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranty_claims" ADD CONSTRAINT "tenant_fk_warranty_claims_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranty_claims" ADD CONSTRAINT "fk_warranty_claims_warranty_id" FOREIGN KEY ("warranty_id") REFERENCES "warranties"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranty_claims" ADD CONSTRAINT "tenant_fk_warranty_claims_warranty_id" FOREIGN KEY (tenant_id,"warranty_id") REFERENCES "warranties"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "warranty_claims" ADD CONSTRAINT "fk_warranty_claims_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "fk_stock_reservations_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "fk_stock_reservations_work_order_id" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "tenant_fk_stock_reservations_work_order_id" FOREIGN KEY (tenant_id,"work_order_id") REFERENCES "work_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "fk_stock_reservations_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "tenant_fk_stock_reservations_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "fk_stock_reservations_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "tenant_fk_stock_reservations_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_reservations" ADD CONSTRAINT "fk_stock_reservations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "fk_inventory_transfers_destination_item_id" FOREIGN KEY ("destination_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "tenant_fk_inventory_transfers_destination_item_id" FOREIGN KEY (tenant_id,"destination_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "fk_inventory_transfers_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "fk_inventory_transfers_to_branch_id" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "tenant_fk_inventory_transfers_to_branch_id" FOREIGN KEY (tenant_id,"to_branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "fk_inventory_transfers_from_branch_id" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "tenant_fk_inventory_transfers_from_branch_id" FOREIGN KEY (tenant_id,"from_branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "fk_inventory_transfers_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "tenant_fk_inventory_transfers_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "fk_inventory_transfers_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "legal_acceptances" ADD CONSTRAINT "fk_legal_acceptances_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "legal_acceptances" ADD CONSTRAINT "fk_legal_acceptances_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_returns" ADD CONSTRAINT "fk_stock_returns_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_returns" ADD CONSTRAINT "fk_stock_returns_part_id" FOREIGN KEY ("part_id") REFERENCES "work_order_parts"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_returns" ADD CONSTRAINT "tenant_fk_stock_returns_part_id" FOREIGN KEY (tenant_id,"part_id") REFERENCES "work_order_parts"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "stock_returns" ADD CONSTRAINT "fk_stock_returns_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_reads" ADD CONSTRAINT "fk_notification_reads_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_reads" ADD CONSTRAINT "fk_notification_reads_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_reads" ADD CONSTRAINT "fk_notification_reads_notification_id" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification_reads" ADD CONSTRAINT "tenant_fk_notification_reads_notification_id" FOREIGN KEY (tenant_id,"notification_id") REFERENCES "notifications"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "fk_payment_reversals_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "fk_payment_reversals_purchase_payment_id" FOREIGN KEY ("purchase_payment_id") REFERENCES "purchase_payments"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "tenant_fk_payment_reversals_purchase_payment_id" FOREIGN KEY (tenant_id,"purchase_payment_id") REFERENCES "purchase_payments"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "fk_payment_reversals_customer_payment_id" FOREIGN KEY ("customer_payment_id") REFERENCES "workshop_payments"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "tenant_fk_payment_reversals_customer_payment_id" FOREIGN KEY (tenant_id,"customer_payment_id") REFERENCES "workshop_payments"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "fk_payment_reversals_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "tenant_fk_payment_reversals_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "payment_reversals" ADD CONSTRAINT "fk_payment_reversals_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_purchase_receipts_received_by" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_purchase_receipts_purchase_order_id" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "tenant_fk_purchase_receipts_purchase_order_id" FOREIGN KEY (tenant_id,"purchase_order_id") REFERENCES "purchase_orders"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_purchase_receipts_branch_id" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "tenant_fk_purchase_receipts_branch_id" FOREIGN KEY (tenant_id,"branch_id") REFERENCES "branches"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_purchase_receipts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_purchase_receipt_lines_inventory_movement_id" FOREIGN KEY ("inventory_movement_id") REFERENCES "inventory_movements"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "tenant_fk_purchase_receipt_lines_inventory_movement_id" FOREIGN KEY (tenant_id,"inventory_movement_id") REFERENCES "inventory_movements"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_purchase_receipt_lines_inventory_item_id" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "tenant_fk_purchase_receipt_lines_inventory_item_id" FOREIGN KEY (tenant_id,"inventory_item_id") REFERENCES "inventory_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_purchase_receipt_lines_purchase_order_item_id" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "tenant_fk_purchase_receipt_lines_purchase_order_item_id" FOREIGN KEY (tenant_id,"purchase_order_item_id") REFERENCES "purchase_order_items"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_purchase_receipt_lines_receipt_id" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "tenant_fk_purchase_receipt_lines_receipt_id" FOREIGN KEY (tenant_id,"receipt_id") REFERENCES "purchase_receipts"(tenant_id,"id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_purchase_receipt_lines_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX idx_memberships_user ON memberships(user_id);

CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id,created_at DESC);

CREATE INDEX idx_orders_tenant_created ON work_orders(tenant_id,created_at DESC);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);

CREATE INDEX idx_vehicles_tenant ON vehicles(tenant_id);

CREATE INDEX idx_payments_tenant ON saas_payments(tenant_id,paid_at DESC);

CREATE UNIQUE INDEX idx_saas_invoice_period ON saas_invoices(subscription_id,period_start,period_end);

CREATE INDEX idx_purchases_tenant ON purchases(tenant_id,purchased_at DESC);

CREATE INDEX idx_appointments_tenant ON appointments(tenant_id,scheduled_at);

CREATE UNIQUE INDEX idx_workshop_invoice_order ON workshop_invoices(tenant_id,work_order_id) WHERE work_order_id IS NOT NULL AND voided_at IS NULL;

CREATE UNIQUE INDEX idx_workshop_invoice_idempotency ON workshop_invoices(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_cash_workshop_payment ON cash_movements(tenant_id,workshop_payment_id) WHERE workshop_payment_id IS NOT NULL;

CREATE UNIQUE INDEX idx_cash_purchase_payment ON cash_movements(tenant_id,purchase_payment_id) WHERE purchase_payment_id IS NOT NULL;

CREATE INDEX idx_assignments_tech_status ON work_assignments(tenant_id,technician_user_id,status);

CREATE INDEX idx_inventory_movements_item ON inventory_movements(tenant_id,inventory_item_id,created_at DESC);

CREATE INDEX idx_estimates_order ON estimates(tenant_id,work_order_id,version DESC);

CREATE INDEX idx_payables_status_due ON accounts_payable(tenant_id,status,due_at);

CREATE INDEX idx_notifications_pending ON notifications(status,scheduled_at);

CREATE INDEX idx_login_attempts_identity ON login_attempts(identity_hash,attempted_at DESC);

CREATE INDEX idx_communications_customer ON customer_communications(tenant_id,customer_id,created_at DESC);

CREATE INDEX idx_warranty_claims ON warranty_claims(tenant_id,warranty_id,status);

CREATE INDEX idx_reservations_item ON stock_reservations(tenant_id,inventory_item_id,status);

CREATE INDEX idx_notifications_delivery ON notifications(status,next_attempt_at,scheduled_at);

CREATE INDEX idx_orders_promised_status ON work_orders(tenant_id,promised_at,status);

CREATE INDEX idx_saas_invoices_balance ON saas_invoices(tenant_id,status,due_at);

CREATE INDEX idx_invoices_balance ON workshop_invoices(tenant_id,status,due_at) WHERE voided_at IS NULL;

CREATE INDEX idx_files_tenant_created ON files(tenant_id,created_at DESC);

CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE INDEX idx_password_reset_request_rate ON password_reset_requests(ip_hash,identity_hash,requested_at DESC);

CREATE UNIQUE INDEX reservation_idempotency ON stock_reservations(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX cash_idempotency ON cash_movements(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX login_ip_time ON login_attempts(ip_hash,attempted_at);

CREATE INDEX login_identity_time ON login_attempts(identity_hash,attempted_at);

CREATE INDEX ownership_idx_memberships_role_id ON "memberships"(tenant_id,"role_id");

CREATE INDEX ownership_idx_memberships_branch_id ON "memberships"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_subscription_history_subscription_id ON "subscription_history"(tenant_id,"subscription_id");

CREATE INDEX ownership_idx_customers_branch_id ON "customers"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_vehicles_customer_id ON "vehicles"(tenant_id,"customer_id");

CREATE INDEX ownership_idx_work_orders_vehicle_id ON "work_orders"(tenant_id,"vehicle_id");

CREATE INDEX ownership_idx_work_orders_customer_id ON "work_orders"(tenant_id,"customer_id");

CREATE INDEX ownership_idx_work_orders_branch_id ON "work_orders"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_work_order_items_work_order_id ON "work_order_items"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_inventory_items_branch_id ON "inventory_items"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_purchases_supplier_id ON "purchases"(tenant_id,"supplier_id");

CREATE INDEX ownership_idx_purchases_branch_id ON "purchases"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_bays_branch_id ON "bays"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_appointments_vehicle_id ON "appointments"(tenant_id,"vehicle_id");

CREATE INDEX ownership_idx_appointments_customer_id ON "appointments"(tenant_id,"customer_id");

CREATE INDEX ownership_idx_appointments_branch_id ON "appointments"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_workshop_invoices_work_order_id ON "workshop_invoices"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_workshop_invoices_customer_id ON "workshop_invoices"(tenant_id,"customer_id");

CREATE INDEX ownership_idx_workshop_invoices_branch_id ON "workshop_invoices"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_cash_movements_branch_id ON "cash_movements"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_saas_invoices_subscription_id ON "saas_invoices"(tenant_id,"subscription_id");

CREATE INDEX ownership_idx_saas_payments_invoice_id ON "saas_payments"(tenant_id,"invoice_id");

CREATE INDEX ownership_idx_saas_payments_subscription_id ON "saas_payments"(tenant_id,"subscription_id");

CREATE INDEX ownership_idx_audit_logs_branch_id ON "audit_logs"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_receptions_work_order_id ON "receptions"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_receptions_branch_id ON "receptions"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_inspections_work_order_id ON "inspections"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_diagnoses_work_order_id ON "diagnoses"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_estimates_work_order_id ON "estimates"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_estimate_items_inventory_item_id ON "estimate_items"(tenant_id,"inventory_item_id");

CREATE INDEX ownership_idx_estimate_items_estimate_id ON "estimate_items"(tenant_id,"estimate_id");

CREATE INDEX ownership_idx_work_assignments_work_order_id ON "work_assignments"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_time_entries_assignment_id ON "time_entries"(tenant_id,"assignment_id");

CREATE INDEX ownership_idx_work_order_parts_inventory_item_id ON "work_order_parts"(tenant_id,"inventory_item_id");

CREATE INDEX ownership_idx_work_order_parts_work_order_id ON "work_order_parts"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_work_order_labor_work_order_id ON "work_order_labor"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_inventory_movements_inventory_item_id ON "inventory_movements"(tenant_id,"inventory_item_id");

CREATE INDEX ownership_idx_inventory_movements_branch_id ON "inventory_movements"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_purchase_requests_inventory_item_id ON "purchase_requests"(tenant_id,"inventory_item_id");

CREATE INDEX ownership_idx_purchase_requests_work_order_id ON "purchase_requests"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_purchase_requests_branch_id ON "purchase_requests"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_purchase_orders_purchase_request_id ON "purchase_orders"(tenant_id,"purchase_request_id");

CREATE INDEX ownership_idx_purchase_orders_supplier_id ON "purchase_orders"(tenant_id,"supplier_id");

CREATE INDEX ownership_idx_purchase_orders_branch_id ON "purchase_orders"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_purchase_order_items_inventory_item_id ON "purchase_order_items"(tenant_id,"inventory_item_id");

CREATE INDEX ownership_idx_purchase_order_items_purchase_order_id ON "purchase_order_items"(tenant_id,"purchase_order_id");

CREATE INDEX ownership_idx_accounts_payable_purchase_order_id ON "accounts_payable"(tenant_id,"purchase_order_id");

CREATE INDEX ownership_idx_accounts_payable_supplier_id ON "accounts_payable"(tenant_id,"supplier_id");

CREATE INDEX ownership_idx_accounts_payable_branch_id ON "accounts_payable"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_purchase_payments_payable_id ON "purchase_payments"(tenant_id,"payable_id");

CREATE INDEX ownership_idx_quality_checks_work_order_id ON "quality_checks"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_workshop_invoice_items_invoice_id ON "workshop_invoice_items"(tenant_id,"invoice_id");

CREATE INDEX ownership_idx_workshop_payments_invoice_id ON "workshop_payments"(tenant_id,"invoice_id");

CREATE INDEX ownership_idx_deliveries_work_order_id ON "deliveries"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_warranties_work_order_id ON "warranties"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_file_links_file_id ON "file_links"(tenant_id,"file_id");

CREATE INDEX ownership_idx_customer_communications_customer_id ON "customer_communications"(tenant_id,"customer_id");

CREATE INDEX ownership_idx_warranty_claims_work_order_id ON "warranty_claims"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_warranty_claims_warranty_id ON "warranty_claims"(tenant_id,"warranty_id");

CREATE INDEX ownership_idx_stock_reservations_work_order_id ON "stock_reservations"(tenant_id,"work_order_id");

CREATE INDEX ownership_idx_stock_reservations_inventory_item_id ON "stock_reservations"(tenant_id,"inventory_item_id");

CREATE INDEX ownership_idx_stock_reservations_branch_id ON "stock_reservations"(tenant_id,"branch_id");

CREATE INDEX ownership_idx_inventory_transfers_to_branch_id ON "inventory_transfers"(tenant_id,"to_branch_id");

CREATE INDEX ownership_idx_inventory_transfers_from_branch_id ON "inventory_transfers"(tenant_id,"from_branch_id");

CREATE INDEX ownership_idx_inventory_transfers_inventory_item_id ON "inventory_transfers"(tenant_id,"inventory_item_id");

CREATE VIEW active_work_order_parts AS SELECT * FROM work_order_parts WHERE returned_at IS NULL;

CREATE INDEX warranties_expiration ON warranties(tenant_id,status,ends_at);

CREATE INDEX notification_reads_user ON notification_reads(tenant_id,user_id,read_at);

CREATE INDEX notification_audience ON notifications(tenant_id,channel,required_permission,created_at);

CREATE INDEX payment_reversals_tenant ON payment_reversals(tenant_id,created_at);

CREATE UNIQUE INDEX cash_reversal ON cash_movements(reversal_id) WHERE reversal_id IS NOT NULL;

CREATE VIEW effective_workshop_payments AS SELECT p.* FROM workshop_payments p WHERE NOT EXISTS(SELECT 1 FROM payment_reversals r WHERE r.customer_payment_id=p.id);

CREATE VIEW effective_purchase_payments AS SELECT p.* FROM purchase_payments p WHERE NOT EXISTS(SELECT 1 FROM payment_reversals r WHERE r.purchase_payment_id=p.id);

CREATE INDEX purchase_receipts_order ON purchase_receipts(tenant_id,purchase_order_id,received_at);

CREATE INDEX purchase_receipt_lines_order_line ON purchase_receipt_lines(tenant_id,purchase_order_item_id);

CREATE INDEX purchase_request_order_status ON purchase_orders(tenant_id,purchase_request_id,status);

-- Guards are native PL/pgSQL. Conditions run in the function because PostgreSQL trigger WHEN cannot contain subqueries.

CREATE FUNCTION "guard_fcd4d4ab9a45325995dc5eba"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.quantity < 0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='inventory_negative', CONSTRAINT='prevent_negative_inventory_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "prevent_negative_inventory_update" BEFORE UPDATE OF quantity ON inventory_items FOR EACH ROW EXECUTE FUNCTION "guard_fcd4d4ab9a45325995dc5eba"();

CREATE FUNCTION "guard_2aaa382cb0228dad8ec968b8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.quantity < 0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='inventory_negative', CONSTRAINT='prevent_negative_inventory_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "prevent_negative_inventory_insert" BEFORE INSERT ON inventory_items FOR EACH ROW EXECUTE FUNCTION "guard_2aaa382cb0228dad8ec968b8"();

CREATE FUNCTION "guard_7cd1f2f098f2db8649b8a8d2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_vehicle_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_vehicle_insert" BEFORE INSERT ON vehicles FOR EACH ROW EXECUTE FUNCTION "guard_7cd1f2f098f2db8649b8a8d2"();

CREATE FUNCTION "guard_cf89e1f1b685b740e37eb300"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_vehicle_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_vehicle_update" BEFORE UPDATE OF tenant_id,customer_id ON vehicles FOR EACH ROW EXECUTE FUNCTION "guard_cf89e1f1b685b740e37eb300"();

CREATE FUNCTION "guard_87fd72b1e148432b8a326a30"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND v.customer_id=NEW.customer_id AND v.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_order_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_order_insert" BEFORE INSERT ON work_orders FOR EACH ROW EXECUTE FUNCTION "guard_87fd72b1e148432b8a326a30"();

CREATE FUNCTION "guard_37776205eb5692c9e08aa5ae"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.id=NEW.vehicle_id AND v.customer_id=NEW.customer_id AND v.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_order_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_order_update" BEFORE UPDATE OF tenant_id,branch_id,customer_id,vehicle_id ON work_orders FOR EACH ROW EXECUTE FUNCTION "guard_37776205eb5692c9e08aa5ae"();

CREATE FUNCTION "guard_c8c74614ae7e137bae8f0fb6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_inventory_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_inventory_insert" BEFORE INSERT ON inventory_items FOR EACH ROW EXECUTE FUNCTION "guard_c8c74614ae7e137bae8f0fb6"();

CREATE FUNCTION "guard_1060c03db88093ef4cfc15b2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=NEW.customer_id AND c.tenant_id=NEW.tenant_id)
  OR (NEW.work_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_invoice_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_invoice_insert" BEFORE INSERT ON workshop_invoices FOR EACH ROW EXECUTE FUNCTION "guard_1060c03db88093ef4cfc15b2"();

CREATE FUNCTION "guard_2a8608e75991ae87b2761bd5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM workshop_invoices i WHERE i.id=NEW.invoice_id AND i.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_workshop_payment_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_workshop_payment_insert" BEFORE INSERT ON workshop_payments FOR EACH ROW EXECUTE FUNCTION "guard_2a8608e75991ae87b2761bd5"();

CREATE FUNCTION "guard_7bfb7c6a81e2e6ce0678fff1"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.inventory_item_id AND i.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_part_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_part_insert" BEFORE INSERT ON work_order_parts FOR EACH ROW EXECUTE FUNCTION "guard_7bfb7c6a81e2e6ce0678fff1"();

CREATE FUNCTION "guard_1a617f8e8b79d648bd4839c8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR (NEW.work_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_orders o WHERE o.id=NEW.work_order_id AND o.tenant_id=NEW.tenant_id))
  OR (NEW.inventory_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.inventory_item_id AND i.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_purchase_request_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_purchase_request_insert" BEFORE INSERT ON purchase_requests FOR EACH ROW EXECUTE FUNCTION "guard_1a617f8e8b79d648bd4839c8"();

CREATE FUNCTION "guard_5c18d4785c6f972eefa2b5f3"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM suppliers s WHERE s.id=NEW.supplier_id AND s.tenant_id=NEW.tenant_id)
  OR (NEW.purchase_request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_requests r WHERE r.id=NEW.purchase_request_id AND r.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='tenant_guard_purchase_order_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "tenant_guard_purchase_order_insert" BEFORE INSERT ON purchase_orders FOR EACH ROW EXECUTE FUNCTION "guard_5c18d4785c6f972eefa2b5f3"();

CREATE FUNCTION "guard_06e2b9439797e54bca10764b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_branches';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_branches" BEFORE UPDATE OF tenant_id ON "branches" FOR EACH ROW EXECUTE FUNCTION "guard_06e2b9439797e54bca10764b"();

CREATE FUNCTION "guard_13fd55ba16c5c3470d81c23c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_roles';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_roles" BEFORE UPDATE OF tenant_id ON "roles" FOR EACH ROW EXECUTE FUNCTION "guard_13fd55ba16c5c3470d81c23c"();

CREATE FUNCTION "guard_099584d01535347f7a6acaaa"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."role_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "roles" p WHERE p."id"=NEW."role_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_memberships_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_memberships_insert" BEFORE INSERT ON "memberships" FOR EACH ROW EXECUTE FUNCTION "guard_099584d01535347f7a6acaaa"();

CREATE FUNCTION "guard_0376887f32aa34f00a88c116"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."role_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "roles" p WHERE p."id"=NEW."role_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_memberships_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_memberships_update" BEFORE UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION "guard_0376887f32aa34f00a88c116"();

CREATE FUNCTION "guard_dd1dbd2f73d0280a2dd79885"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_memberships';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_memberships" BEFORE UPDATE OF tenant_id ON "memberships" FOR EACH ROW EXECUTE FUNCTION "guard_dd1dbd2f73d0280a2dd79885"();

CREATE FUNCTION "guard_9450490f49f602b02133d6c0"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_subscriptions';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_subscriptions" BEFORE UPDATE OF tenant_id ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION "guard_9450490f49f602b02133d6c0"();

CREATE FUNCTION "guard_ce16cbbb9a274fb997a59845"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."subscription_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "subscriptions" p WHERE p."id"=NEW."subscription_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_subscription_history_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_subscription_history_insert" BEFORE INSERT ON "subscription_history" FOR EACH ROW EXECUTE FUNCTION "guard_ce16cbbb9a274fb997a59845"();

CREATE FUNCTION "guard_b00082793e7ee86194e29247"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."subscription_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "subscriptions" p WHERE p."id"=NEW."subscription_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_subscription_history_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_subscription_history_update" BEFORE UPDATE ON "subscription_history" FOR EACH ROW EXECUTE FUNCTION "guard_b00082793e7ee86194e29247"();

CREATE FUNCTION "guard_83c557d6e5ba9a6c24e4baa8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_subscription_history';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_subscription_history" BEFORE UPDATE OF tenant_id ON "subscription_history" FOR EACH ROW EXECUTE FUNCTION "guard_83c557d6e5ba9a6c24e4baa8"();

CREATE FUNCTION "guard_ed4e7d8f0aa8949ca8a4e5d5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_trials';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_trials" BEFORE UPDATE OF tenant_id ON "trials" FOR EACH ROW EXECUTE FUNCTION "guard_ed4e7d8f0aa8949ca8a4e5d5"();

CREATE FUNCTION "guard_a37a812eef38accd331ffc3c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_tenant_features';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_tenant_features" BEFORE UPDATE OF tenant_id ON "tenant_features" FOR EACH ROW EXECUTE FUNCTION "guard_a37a812eef38accd331ffc3c"();

CREATE FUNCTION "guard_2605dfc4f07eefb573e4207b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_tenant_settings';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_tenant_settings" BEFORE UPDATE OF tenant_id ON "tenant_settings" FOR EACH ROW EXECUTE FUNCTION "guard_2605dfc4f07eefb573e4207b"();

CREATE FUNCTION "guard_646adf89d193cb0b0da82136"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_customers_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_customers_insert" BEFORE INSERT ON "customers" FOR EACH ROW EXECUTE FUNCTION "guard_646adf89d193cb0b0da82136"();

CREATE FUNCTION "guard_53ef2bb3c62657cc6e0a8e23"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_customers_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_customers_update" BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION "guard_53ef2bb3c62657cc6e0a8e23"();

CREATE FUNCTION "guard_779c364ee424753d2e72f236"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_customers';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_customers" BEFORE UPDATE OF tenant_id ON "customers" FOR EACH ROW EXECUTE FUNCTION "guard_779c364ee424753d2e72f236"();

CREATE FUNCTION "guard_42af0cd914d58f797116e94a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_vehicles_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_vehicles_insert" BEFORE INSERT ON "vehicles" FOR EACH ROW EXECUTE FUNCTION "guard_42af0cd914d58f797116e94a"();

CREATE FUNCTION "guard_cb1b76d0987cbf9b272a307c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_vehicles_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_vehicles_update" BEFORE UPDATE ON "vehicles" FOR EACH ROW EXECUTE FUNCTION "guard_cb1b76d0987cbf9b272a307c"();

CREATE FUNCTION "guard_87ca4fdb59dd100f19fab3a9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_vehicles';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_vehicles" BEFORE UPDATE OF tenant_id ON "vehicles" FOR EACH ROW EXECUTE FUNCTION "guard_87ca4fdb59dd100f19fab3a9"();

CREATE FUNCTION "guard_73ef916698202978d9480508"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_services';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_services" BEFORE UPDATE OF tenant_id ON "services" FOR EACH ROW EXECUTE FUNCTION "guard_73ef916698202978d9480508"();

CREATE FUNCTION "guard_8ddba1f91ab6cb59cb4043c9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."vehicle_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "vehicles" p WHERE p."id"=NEW."vehicle_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_orders_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_orders_insert" BEFORE INSERT ON "work_orders" FOR EACH ROW EXECUTE FUNCTION "guard_8ddba1f91ab6cb59cb4043c9"();

CREATE FUNCTION "guard_c84fcf063b8f8cb1f142e038"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."vehicle_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "vehicles" p WHERE p."id"=NEW."vehicle_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_orders_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_orders_update" BEFORE UPDATE ON "work_orders" FOR EACH ROW EXECUTE FUNCTION "guard_c84fcf063b8f8cb1f142e038"();

CREATE FUNCTION "guard_8bcb3a91a1f07d4e55c513b2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_work_orders';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_work_orders" BEFORE UPDATE OF tenant_id ON "work_orders" FOR EACH ROW EXECUTE FUNCTION "guard_8bcb3a91a1f07d4e55c513b2"();

CREATE FUNCTION "guard_39214cc5103b6b6d87216091"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_order_items_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_order_items_insert" BEFORE INSERT ON "work_order_items" FOR EACH ROW EXECUTE FUNCTION "guard_39214cc5103b6b6d87216091"();

CREATE FUNCTION "guard_576a1071a3c49db1a084935f"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_order_items_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_order_items_update" BEFORE UPDATE ON "work_order_items" FOR EACH ROW EXECUTE FUNCTION "guard_576a1071a3c49db1a084935f"();

CREATE FUNCTION "guard_ee73bc9059d01d71b2992188"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_work_order_items';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_work_order_items" BEFORE UPDATE OF tenant_id ON "work_order_items" FOR EACH ROW EXECUTE FUNCTION "guard_ee73bc9059d01d71b2992188"();

CREATE FUNCTION "guard_5ceac05ef19995efe0672f2d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inventory_items_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inventory_items_insert" BEFORE INSERT ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION "guard_5ceac05ef19995efe0672f2d"();

CREATE FUNCTION "guard_24b03d594e2a09ed2c29d72c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inventory_items_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inventory_items_update" BEFORE UPDATE ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION "guard_24b03d594e2a09ed2c29d72c"();

CREATE FUNCTION "guard_65569449abeabd0928ccce68"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_inventory_items';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_inventory_items" BEFORE UPDATE OF tenant_id ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION "guard_65569449abeabd0928ccce68"();

CREATE FUNCTION "guard_18524fd29bd1ea9b474fc90c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_suppliers';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_suppliers" BEFORE UPDATE OF tenant_id ON "suppliers" FOR EACH ROW EXECUTE FUNCTION "guard_18524fd29bd1ea9b474fc90c"();

CREATE FUNCTION "guard_51044911581e62be0077a1ac"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."supplier_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "suppliers" p WHERE p."id"=NEW."supplier_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchases_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchases_insert" BEFORE INSERT ON "purchases" FOR EACH ROW EXECUTE FUNCTION "guard_51044911581e62be0077a1ac"();

CREATE FUNCTION "guard_3cb0ead112b6403e0bda8697"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."supplier_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "suppliers" p WHERE p."id"=NEW."supplier_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchases_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchases_update" BEFORE UPDATE ON "purchases" FOR EACH ROW EXECUTE FUNCTION "guard_3cb0ead112b6403e0bda8697"();

CREATE FUNCTION "guard_28971eeab2af28096c044cb9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_purchases';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_purchases" BEFORE UPDATE OF tenant_id ON "purchases" FOR EACH ROW EXECUTE FUNCTION "guard_28971eeab2af28096c044cb9"();

CREATE FUNCTION "guard_311e7aae452acb98747b8858"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_bays_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_bays_insert" BEFORE INSERT ON "bays" FOR EACH ROW EXECUTE FUNCTION "guard_311e7aae452acb98747b8858"();

CREATE FUNCTION "guard_d3800d7c509b516571fbbd18"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_bays_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_bays_update" BEFORE UPDATE ON "bays" FOR EACH ROW EXECUTE FUNCTION "guard_d3800d7c509b516571fbbd18"();

CREATE FUNCTION "guard_5a309fd80f161384dc796238"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_bays';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_bays" BEFORE UPDATE OF tenant_id ON "bays" FOR EACH ROW EXECUTE FUNCTION "guard_5a309fd80f161384dc796238"();

CREATE FUNCTION "guard_15df75e2053279ed15f745f4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."vehicle_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "vehicles" p WHERE p."id"=NEW."vehicle_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_appointments_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_appointments_insert" BEFORE INSERT ON "appointments" FOR EACH ROW EXECUTE FUNCTION "guard_15df75e2053279ed15f745f4"();

CREATE FUNCTION "guard_1343db18b83f7252270f47e6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."vehicle_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "vehicles" p WHERE p."id"=NEW."vehicle_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_appointments_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_appointments_update" BEFORE UPDATE ON "appointments" FOR EACH ROW EXECUTE FUNCTION "guard_1343db18b83f7252270f47e6"();

CREATE FUNCTION "guard_b00b14dab7806ea6dfa3e596"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_appointments';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_appointments" BEFORE UPDATE OF tenant_id ON "appointments" FOR EACH ROW EXECUTE FUNCTION "guard_b00b14dab7806ea6dfa3e596"();

CREATE FUNCTION "guard_bbef20038a93df9069bdd9e5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_workshop_invoices_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_workshop_invoices_insert" BEFORE INSERT ON "workshop_invoices" FOR EACH ROW EXECUTE FUNCTION "guard_bbef20038a93df9069bdd9e5"();

CREATE FUNCTION "guard_44dd725048ec5355b40689ed"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_workshop_invoices_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_workshop_invoices_update" BEFORE UPDATE ON "workshop_invoices" FOR EACH ROW EXECUTE FUNCTION "guard_44dd725048ec5355b40689ed"();

CREATE FUNCTION "guard_fdab83f1d09cb4e699b64584"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_workshop_invoices';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_workshop_invoices" BEFORE UPDATE OF tenant_id ON "workshop_invoices" FOR EACH ROW EXECUTE FUNCTION "guard_fdab83f1d09cb4e699b64584"();

CREATE FUNCTION "guard_254dccbb8b89c548a58d2ead"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_cash_movements_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_cash_movements_insert" BEFORE INSERT ON "cash_movements" FOR EACH ROW EXECUTE FUNCTION "guard_254dccbb8b89c548a58d2ead"();

CREATE FUNCTION "guard_3b22b73557d213c51fdf3cfe"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_cash_movements_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_cash_movements_update" BEFORE UPDATE ON "cash_movements" FOR EACH ROW EXECUTE FUNCTION "guard_3b22b73557d213c51fdf3cfe"();

CREATE FUNCTION "guard_fbcbe7bb71c9c9551ffd314d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_cash_movements';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_cash_movements" BEFORE UPDATE OF tenant_id ON "cash_movements" FOR EACH ROW EXECUTE FUNCTION "guard_fbcbe7bb71c9c9551ffd314d"();

CREATE FUNCTION "guard_45b35448526f1516270db89b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."subscription_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "subscriptions" p WHERE p."id"=NEW."subscription_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_saas_invoices_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_saas_invoices_insert" BEFORE INSERT ON "saas_invoices" FOR EACH ROW EXECUTE FUNCTION "guard_45b35448526f1516270db89b"();

CREATE FUNCTION "guard_9a344e52be14d1b0e6e16200"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."subscription_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "subscriptions" p WHERE p."id"=NEW."subscription_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_saas_invoices_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_saas_invoices_update" BEFORE UPDATE ON "saas_invoices" FOR EACH ROW EXECUTE FUNCTION "guard_9a344e52be14d1b0e6e16200"();

CREATE FUNCTION "guard_2f38d112c1b19a23d78ebce6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_saas_invoices';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_saas_invoices" BEFORE UPDATE OF tenant_id ON "saas_invoices" FOR EACH ROW EXECUTE FUNCTION "guard_2f38d112c1b19a23d78ebce6"();

CREATE FUNCTION "guard_72e6cd4bd72b475273c92ea7"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."invoice_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "saas_invoices" p WHERE p."id"=NEW."invoice_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."subscription_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "subscriptions" p WHERE p."id"=NEW."subscription_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_saas_payments_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_saas_payments_insert" BEFORE INSERT ON "saas_payments" FOR EACH ROW EXECUTE FUNCTION "guard_72e6cd4bd72b475273c92ea7"();

CREATE FUNCTION "guard_ad46e902163d2177f3fc0007"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."invoice_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "saas_invoices" p WHERE p."id"=NEW."invoice_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."subscription_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "subscriptions" p WHERE p."id"=NEW."subscription_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_saas_payments_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_saas_payments_update" BEFORE UPDATE ON "saas_payments" FOR EACH ROW EXECUTE FUNCTION "guard_ad46e902163d2177f3fc0007"();

CREATE FUNCTION "guard_d06e3b181f765a5f7c9a8a62"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_saas_payments';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_saas_payments" BEFORE UPDATE OF tenant_id ON "saas_payments" FOR EACH ROW EXECUTE FUNCTION "guard_d06e3b181f765a5f7c9a8a62"();

CREATE FUNCTION "guard_c5dcbe75572d7dcbe7d18586"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_support_tickets';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_support_tickets" BEFORE UPDATE OF tenant_id ON "support_tickets" FOR EACH ROW EXECUTE FUNCTION "guard_c5dcbe75572d7dcbe7d18586"();

CREATE FUNCTION "guard_abf6a7829d4f6f5a23923e28"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_files';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_files" BEFORE UPDATE OF tenant_id ON "files" FOR EACH ROW EXECUTE FUNCTION "guard_abf6a7829d4f6f5a23923e28"();

CREATE FUNCTION "guard_86807427870b6e5e8c8178cb"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_audit_logs_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_audit_logs_insert" BEFORE INSERT ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "guard_86807427870b6e5e8c8178cb"();

CREATE FUNCTION "guard_ca27ac27dc44a5a2914ff928"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_audit_logs_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_audit_logs_update" BEFORE UPDATE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "guard_ca27ac27dc44a5a2914ff928"();

CREATE FUNCTION "guard_7aa182b0072c63f57db58e0a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_audit_logs';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_audit_logs" BEFORE UPDATE OF tenant_id ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "guard_7aa182b0072c63f57db58e0a"();

CREATE FUNCTION "guard_bac1009a49773b0829f7764d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_document_sequences';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_document_sequences" BEFORE UPDATE OF tenant_id ON "document_sequences" FOR EACH ROW EXECUTE FUNCTION "guard_bac1009a49773b0829f7764d"();

CREATE FUNCTION "guard_81160198bdb06cf2c517dd78"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_receptions_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_receptions_insert" BEFORE INSERT ON "receptions" FOR EACH ROW EXECUTE FUNCTION "guard_81160198bdb06cf2c517dd78"();

CREATE FUNCTION "guard_d3d49dbb4cc404262689f023"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_receptions_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_receptions_update" BEFORE UPDATE ON "receptions" FOR EACH ROW EXECUTE FUNCTION "guard_d3d49dbb4cc404262689f023"();

CREATE FUNCTION "guard_4f73a0a34752976eeb16dafd"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_receptions';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_receptions" BEFORE UPDATE OF tenant_id ON "receptions" FOR EACH ROW EXECUTE FUNCTION "guard_4f73a0a34752976eeb16dafd"();

CREATE FUNCTION "guard_6b679d85ed449490c47880e4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inspections_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inspections_insert" BEFORE INSERT ON "inspections" FOR EACH ROW EXECUTE FUNCTION "guard_6b679d85ed449490c47880e4"();

CREATE FUNCTION "guard_84d967afcee0291014f2a36b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inspections_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inspections_update" BEFORE UPDATE ON "inspections" FOR EACH ROW EXECUTE FUNCTION "guard_84d967afcee0291014f2a36b"();

CREATE FUNCTION "guard_2954529282dc6eec00e6e9da"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_inspections';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_inspections" BEFORE UPDATE OF tenant_id ON "inspections" FOR EACH ROW EXECUTE FUNCTION "guard_2954529282dc6eec00e6e9da"();

CREATE FUNCTION "guard_54ac53ba0349d002812265d6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_diagnoses_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_diagnoses_insert" BEFORE INSERT ON "diagnoses" FOR EACH ROW EXECUTE FUNCTION "guard_54ac53ba0349d002812265d6"();

CREATE FUNCTION "guard_c876f425af10458d0fafe4f5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_diagnoses_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_diagnoses_update" BEFORE UPDATE ON "diagnoses" FOR EACH ROW EXECUTE FUNCTION "guard_c876f425af10458d0fafe4f5"();

CREATE FUNCTION "guard_a118d49e81e045057eec4a6a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_diagnoses';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_diagnoses" BEFORE UPDATE OF tenant_id ON "diagnoses" FOR EACH ROW EXECUTE FUNCTION "guard_a118d49e81e045057eec4a6a"();

CREATE FUNCTION "guard_dcffc76ddacf94d0b08d4da2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_estimates_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_estimates_insert" BEFORE INSERT ON "estimates" FOR EACH ROW EXECUTE FUNCTION "guard_dcffc76ddacf94d0b08d4da2"();

CREATE FUNCTION "guard_960e608a9d14a077a2565aff"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_estimates_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_estimates_update" BEFORE UPDATE ON "estimates" FOR EACH ROW EXECUTE FUNCTION "guard_960e608a9d14a077a2565aff"();

CREATE FUNCTION "guard_25cb3dd974e394cfa047e73c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_estimates';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_estimates" BEFORE UPDATE OF tenant_id ON "estimates" FOR EACH ROW EXECUTE FUNCTION "guard_25cb3dd974e394cfa047e73c"();

CREATE FUNCTION "guard_ade07eecaeb67a78af5cb43d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."estimate_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "estimates" p WHERE p."id"=NEW."estimate_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_estimate_items_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_estimate_items_insert" BEFORE INSERT ON "estimate_items" FOR EACH ROW EXECUTE FUNCTION "guard_ade07eecaeb67a78af5cb43d"();

CREATE FUNCTION "guard_91dbce8daaf866c96ac60b3b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."estimate_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "estimates" p WHERE p."id"=NEW."estimate_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_estimate_items_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_estimate_items_update" BEFORE UPDATE ON "estimate_items" FOR EACH ROW EXECUTE FUNCTION "guard_91dbce8daaf866c96ac60b3b"();

CREATE FUNCTION "guard_d39270ac85b153fd98c3aa69"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_estimate_items';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_estimate_items" BEFORE UPDATE OF tenant_id ON "estimate_items" FOR EACH ROW EXECUTE FUNCTION "guard_d39270ac85b153fd98c3aa69"();

CREATE FUNCTION "guard_f6f65522ffc96aeb8e974ed8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_assignments_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_assignments_insert" BEFORE INSERT ON "work_assignments" FOR EACH ROW EXECUTE FUNCTION "guard_f6f65522ffc96aeb8e974ed8"();

CREATE FUNCTION "guard_5e9f60b9ec4004e6bbc0e83a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_assignments_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_assignments_update" BEFORE UPDATE ON "work_assignments" FOR EACH ROW EXECUTE FUNCTION "guard_5e9f60b9ec4004e6bbc0e83a"();

CREATE FUNCTION "guard_d2e58c6df7681c02266c98ce"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_work_assignments';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_work_assignments" BEFORE UPDATE OF tenant_id ON "work_assignments" FOR EACH ROW EXECUTE FUNCTION "guard_d2e58c6df7681c02266c98ce"();

CREATE FUNCTION "guard_383672f2b2c302dbf0b25f93"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."assignment_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_assignments" p WHERE p."id"=NEW."assignment_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_time_entries_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_time_entries_insert" BEFORE INSERT ON "time_entries" FOR EACH ROW EXECUTE FUNCTION "guard_383672f2b2c302dbf0b25f93"();

CREATE FUNCTION "guard_81f35f972af50eb46972a92f"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."assignment_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_assignments" p WHERE p."id"=NEW."assignment_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_time_entries_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_time_entries_update" BEFORE UPDATE ON "time_entries" FOR EACH ROW EXECUTE FUNCTION "guard_81f35f972af50eb46972a92f"();

CREATE FUNCTION "guard_b017e04d9914e39956636e10"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_time_entries';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_time_entries" BEFORE UPDATE OF tenant_id ON "time_entries" FOR EACH ROW EXECUTE FUNCTION "guard_b017e04d9914e39956636e10"();

CREATE FUNCTION "guard_59cdcc5514bf1d24b9fa2cf2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_order_parts_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_order_parts_insert" BEFORE INSERT ON "work_order_parts" FOR EACH ROW EXECUTE FUNCTION "guard_59cdcc5514bf1d24b9fa2cf2"();

CREATE FUNCTION "guard_cce59842c0a522cd403d1f49"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_order_parts_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_order_parts_update" BEFORE UPDATE ON "work_order_parts" FOR EACH ROW EXECUTE FUNCTION "guard_cce59842c0a522cd403d1f49"();

CREATE FUNCTION "guard_95419f64d6089cabadfb4290"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_work_order_parts';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_work_order_parts" BEFORE UPDATE OF tenant_id ON "work_order_parts" FOR EACH ROW EXECUTE FUNCTION "guard_95419f64d6089cabadfb4290"();

CREATE FUNCTION "guard_dd76a5fb2eee5deec24bcd05"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_order_labor_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_order_labor_insert" BEFORE INSERT ON "work_order_labor" FOR EACH ROW EXECUTE FUNCTION "guard_dd76a5fb2eee5deec24bcd05"();

CREATE FUNCTION "guard_59d3529f26cd0e84567f8351"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_work_order_labor_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_work_order_labor_update" BEFORE UPDATE ON "work_order_labor" FOR EACH ROW EXECUTE FUNCTION "guard_59d3529f26cd0e84567f8351"();

CREATE FUNCTION "guard_3324c3d3877db4a09254bdb2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_work_order_labor';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_work_order_labor" BEFORE UPDATE OF tenant_id ON "work_order_labor" FOR EACH ROW EXECUTE FUNCTION "guard_3324c3d3877db4a09254bdb2"();

CREATE FUNCTION "guard_50d7ab6b37ead5f3fb1bbf63"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inventory_movements_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inventory_movements_insert" BEFORE INSERT ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION "guard_50d7ab6b37ead5f3fb1bbf63"();

CREATE FUNCTION "guard_6c0e5d31ff6d12e713f695d5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inventory_movements_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inventory_movements_update" BEFORE UPDATE ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION "guard_6c0e5d31ff6d12e713f695d5"();

CREATE FUNCTION "guard_3a4514005f2787936c1c9bfa"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_inventory_movements';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_inventory_movements" BEFORE UPDATE OF tenant_id ON "inventory_movements" FOR EACH ROW EXECUTE FUNCTION "guard_3a4514005f2787936c1c9bfa"();

CREATE FUNCTION "guard_c69660e250aa47f59b45a4f0"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_requests_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_requests_insert" BEFORE INSERT ON "purchase_requests" FOR EACH ROW EXECUTE FUNCTION "guard_c69660e250aa47f59b45a4f0"();

CREATE FUNCTION "guard_319c18006c247daf59c638c5"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_requests_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_requests_update" BEFORE UPDATE ON "purchase_requests" FOR EACH ROW EXECUTE FUNCTION "guard_319c18006c247daf59c638c5"();

CREATE FUNCTION "guard_e1f25f54312a057df5cbbcf6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_purchase_requests';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_purchase_requests" BEFORE UPDATE OF tenant_id ON "purchase_requests" FOR EACH ROW EXECUTE FUNCTION "guard_e1f25f54312a057df5cbbcf6"();

CREATE FUNCTION "guard_07a48539b0c16aaf69fd7c45"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."purchase_request_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "purchase_requests" p WHERE p."id"=NEW."purchase_request_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."supplier_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "suppliers" p WHERE p."id"=NEW."supplier_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_orders_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_orders_insert" BEFORE INSERT ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION "guard_07a48539b0c16aaf69fd7c45"();

CREATE FUNCTION "guard_960f6ce319893daf8939a628"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."purchase_request_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "purchase_requests" p WHERE p."id"=NEW."purchase_request_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."supplier_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "suppliers" p WHERE p."id"=NEW."supplier_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_orders_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_orders_update" BEFORE UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION "guard_960f6ce319893daf8939a628"();

CREATE FUNCTION "guard_32984386bfd0a5ca1501c263"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_purchase_orders';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_purchase_orders" BEFORE UPDATE OF tenant_id ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION "guard_32984386bfd0a5ca1501c263"();

CREATE FUNCTION "guard_1c527b6f5bdbb817b0f0bfec"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."purchase_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "purchase_orders" p WHERE p."id"=NEW."purchase_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_order_items_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_order_items_insert" BEFORE INSERT ON "purchase_order_items" FOR EACH ROW EXECUTE FUNCTION "guard_1c527b6f5bdbb817b0f0bfec"();

CREATE FUNCTION "guard_1cb7c2f2f211e87222e203cd"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."purchase_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "purchase_orders" p WHERE p."id"=NEW."purchase_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_order_items_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_order_items_update" BEFORE UPDATE ON "purchase_order_items" FOR EACH ROW EXECUTE FUNCTION "guard_1cb7c2f2f211e87222e203cd"();

CREATE FUNCTION "guard_e79c9ef3ca0a482c891c2238"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_purchase_order_items';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_purchase_order_items" BEFORE UPDATE OF tenant_id ON "purchase_order_items" FOR EACH ROW EXECUTE FUNCTION "guard_e79c9ef3ca0a482c891c2238"();

CREATE FUNCTION "guard_3c8bda72573d9edeeb2218f9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."purchase_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "purchase_orders" p WHERE p."id"=NEW."purchase_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."supplier_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "suppliers" p WHERE p."id"=NEW."supplier_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_accounts_payable_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_accounts_payable_insert" BEFORE INSERT ON "accounts_payable" FOR EACH ROW EXECUTE FUNCTION "guard_3c8bda72573d9edeeb2218f9"();

CREATE FUNCTION "guard_25bd84ca1dac63b30c3054dd"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."purchase_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "purchase_orders" p WHERE p."id"=NEW."purchase_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."supplier_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "suppliers" p WHERE p."id"=NEW."supplier_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_accounts_payable_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_accounts_payable_update" BEFORE UPDATE ON "accounts_payable" FOR EACH ROW EXECUTE FUNCTION "guard_25bd84ca1dac63b30c3054dd"();

CREATE FUNCTION "guard_b02fe3cdedf3d56dc2a7c969"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_accounts_payable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_accounts_payable" BEFORE UPDATE OF tenant_id ON "accounts_payable" FOR EACH ROW EXECUTE FUNCTION "guard_b02fe3cdedf3d56dc2a7c969"();

CREATE FUNCTION "guard_c5f4fdc063a4e060bf9df4d2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."payable_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "accounts_payable" p WHERE p."id"=NEW."payable_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_payments_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_payments_insert" BEFORE INSERT ON "purchase_payments" FOR EACH ROW EXECUTE FUNCTION "guard_c5f4fdc063a4e060bf9df4d2"();

CREATE FUNCTION "guard_f5ddd7a2b96a3646c808187a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."payable_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "accounts_payable" p WHERE p."id"=NEW."payable_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_purchase_payments_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_purchase_payments_update" BEFORE UPDATE ON "purchase_payments" FOR EACH ROW EXECUTE FUNCTION "guard_f5ddd7a2b96a3646c808187a"();

CREATE FUNCTION "guard_11648313c761fb1d0195c089"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_purchase_payments';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_purchase_payments" BEFORE UPDATE OF tenant_id ON "purchase_payments" FOR EACH ROW EXECUTE FUNCTION "guard_11648313c761fb1d0195c089"();

CREATE FUNCTION "guard_c4f9810bd27cadb980c11576"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_quality_checks_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_quality_checks_insert" BEFORE INSERT ON "quality_checks" FOR EACH ROW EXECUTE FUNCTION "guard_c4f9810bd27cadb980c11576"();

CREATE FUNCTION "guard_fc759c23b8ea6bf5f4dd6add"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_quality_checks_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_quality_checks_update" BEFORE UPDATE ON "quality_checks" FOR EACH ROW EXECUTE FUNCTION "guard_fc759c23b8ea6bf5f4dd6add"();

CREATE FUNCTION "guard_8a9de1949de325a19b73d056"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_quality_checks';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_quality_checks" BEFORE UPDATE OF tenant_id ON "quality_checks" FOR EACH ROW EXECUTE FUNCTION "guard_8a9de1949de325a19b73d056"();

CREATE FUNCTION "guard_f0be9b4cad569364d41e3a3e"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."invoice_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "workshop_invoices" p WHERE p."id"=NEW."invoice_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_workshop_invoice_items_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_workshop_invoice_items_insert" BEFORE INSERT ON "workshop_invoice_items" FOR EACH ROW EXECUTE FUNCTION "guard_f0be9b4cad569364d41e3a3e"();

CREATE FUNCTION "guard_73aba4bdfce74a6775140b0b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."invoice_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "workshop_invoices" p WHERE p."id"=NEW."invoice_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_workshop_invoice_items_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_workshop_invoice_items_update" BEFORE UPDATE ON "workshop_invoice_items" FOR EACH ROW EXECUTE FUNCTION "guard_73aba4bdfce74a6775140b0b"();

CREATE FUNCTION "guard_766ccabeb9302c5641629ed3"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_workshop_invoice_items';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_workshop_invoice_items" BEFORE UPDATE OF tenant_id ON "workshop_invoice_items" FOR EACH ROW EXECUTE FUNCTION "guard_766ccabeb9302c5641629ed3"();

CREATE FUNCTION "guard_d4252cddf55235464ca7d51d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."invoice_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "workshop_invoices" p WHERE p."id"=NEW."invoice_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_workshop_payments_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_workshop_payments_insert" BEFORE INSERT ON "workshop_payments" FOR EACH ROW EXECUTE FUNCTION "guard_d4252cddf55235464ca7d51d"();

CREATE FUNCTION "guard_621bff53b68465d5d874f4a9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."invoice_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "workshop_invoices" p WHERE p."id"=NEW."invoice_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_workshop_payments_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_workshop_payments_update" BEFORE UPDATE ON "workshop_payments" FOR EACH ROW EXECUTE FUNCTION "guard_621bff53b68465d5d874f4a9"();

CREATE FUNCTION "guard_2c326364512c6557d713e24a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_workshop_payments';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_workshop_payments" BEFORE UPDATE OF tenant_id ON "workshop_payments" FOR EACH ROW EXECUTE FUNCTION "guard_2c326364512c6557d713e24a"();

CREATE FUNCTION "guard_7e84f00e8df1c4c27f55ba2b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_deliveries_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_deliveries_insert" BEFORE INSERT ON "deliveries" FOR EACH ROW EXECUTE FUNCTION "guard_7e84f00e8df1c4c27f55ba2b"();

CREATE FUNCTION "guard_afc8907c16da4a2706481285"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_deliveries_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_deliveries_update" BEFORE UPDATE ON "deliveries" FOR EACH ROW EXECUTE FUNCTION "guard_afc8907c16da4a2706481285"();

CREATE FUNCTION "guard_f518043adbf8a02ec31dba3c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_deliveries';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_deliveries" BEFORE UPDATE OF tenant_id ON "deliveries" FOR EACH ROW EXECUTE FUNCTION "guard_f518043adbf8a02ec31dba3c"();

CREATE FUNCTION "guard_e83bfb12cb1dddeea90a1053"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_warranties_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_warranties_insert" BEFORE INSERT ON "warranties" FOR EACH ROW EXECUTE FUNCTION "guard_e83bfb12cb1dddeea90a1053"();

CREATE FUNCTION "guard_5cee1878a8dc3c63fe336b7e"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_warranties_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_warranties_update" BEFORE UPDATE ON "warranties" FOR EACH ROW EXECUTE FUNCTION "guard_5cee1878a8dc3c63fe336b7e"();

CREATE FUNCTION "guard_e2672f2f6734d05d7b984aec"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_warranties';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_warranties" BEFORE UPDATE OF tenant_id ON "warranties" FOR EACH ROW EXECUTE FUNCTION "guard_e2672f2f6734d05d7b984aec"();

CREATE FUNCTION "guard_98cf85b216b7112540cde272"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_notifications';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_notifications" BEFORE UPDATE OF tenant_id ON "notifications" FOR EACH ROW EXECUTE FUNCTION "guard_98cf85b216b7112540cde272"();

CREATE FUNCTION "guard_e59d74852757df4723d3272d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_idempotency_keys';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_idempotency_keys" BEFORE UPDATE OF tenant_id ON "idempotency_keys" FOR EACH ROW EXECUTE FUNCTION "guard_e59d74852757df4723d3272d"();

CREATE FUNCTION "guard_8289b82670da8fd64a54b1eb"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."file_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "files" p WHERE p."id"=NEW."file_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_file_links_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_file_links_insert" BEFORE INSERT ON "file_links" FOR EACH ROW EXECUTE FUNCTION "guard_8289b82670da8fd64a54b1eb"();

CREATE FUNCTION "guard_071ccc602630a1eaf258d07b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."file_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "files" p WHERE p."id"=NEW."file_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_file_links_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_file_links_update" BEFORE UPDATE ON "file_links" FOR EACH ROW EXECUTE FUNCTION "guard_071ccc602630a1eaf258d07b"();

CREATE FUNCTION "guard_081884140d1ab74d0224862c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_file_links';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_file_links" BEFORE UPDATE OF tenant_id ON "file_links" FOR EACH ROW EXECUTE FUNCTION "guard_081884140d1ab74d0224862c"();

CREATE FUNCTION "guard_237d243ba9733a7d569f125c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_customer_communications_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_customer_communications_insert" BEFORE INSERT ON "customer_communications" FOR EACH ROW EXECUTE FUNCTION "guard_237d243ba9733a7d569f125c"();

CREATE FUNCTION "guard_a8a62bbb43d8b5e6278112b6"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."customer_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "customers" p WHERE p."id"=NEW."customer_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_customer_communications_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_customer_communications_update" BEFORE UPDATE ON "customer_communications" FOR EACH ROW EXECUTE FUNCTION "guard_a8a62bbb43d8b5e6278112b6"();

CREATE FUNCTION "guard_25b399b2a473032a6f0a84b2"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_customer_communications';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_customer_communications" BEFORE UPDATE OF tenant_id ON "customer_communications" FOR EACH ROW EXECUTE FUNCTION "guard_25b399b2a473032a6f0a84b2"();

CREATE FUNCTION "guard_01c7dd0ea78918e2cb948b77"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."warranty_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "warranties" p WHERE p."id"=NEW."warranty_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_warranty_claims_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_warranty_claims_insert" BEFORE INSERT ON "warranty_claims" FOR EACH ROW EXECUTE FUNCTION "guard_01c7dd0ea78918e2cb948b77"();

CREATE FUNCTION "guard_7a3fa4f379a1649282593805"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."warranty_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "warranties" p WHERE p."id"=NEW."warranty_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_warranty_claims_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_warranty_claims_update" BEFORE UPDATE ON "warranty_claims" FOR EACH ROW EXECUTE FUNCTION "guard_7a3fa4f379a1649282593805"();

CREATE FUNCTION "guard_113a338be5fc6ce31ac31f21"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_warranty_claims';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_warranty_claims" BEFORE UPDATE OF tenant_id ON "warranty_claims" FOR EACH ROW EXECUTE FUNCTION "guard_113a338be5fc6ce31ac31f21"();

CREATE FUNCTION "guard_da3f91c208f9fba91415754c"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_stock_reservations_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_stock_reservations_insert" BEFORE INSERT ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION "guard_da3f91c208f9fba91415754c"();

CREATE FUNCTION "guard_b13573c8bb4ff7c846407842"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."work_order_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "work_orders" p WHERE p."id"=NEW."work_order_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."branch_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_stock_reservations_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_stock_reservations_update" BEFORE UPDATE ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION "guard_b13573c8bb4ff7c846407842"();

CREATE FUNCTION "guard_41c3aecd80c7b9e2bafa94d9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_stock_reservations';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_stock_reservations" BEFORE UPDATE OF tenant_id ON "stock_reservations" FOR EACH ROW EXECUTE FUNCTION "guard_41c3aecd80c7b9e2bafa94d9"();

CREATE FUNCTION "guard_d4f864848d26deb3dc4e87f4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."to_branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."to_branch_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."from_branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."from_branch_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inventory_transfers_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inventory_transfers_insert" BEFORE INSERT ON "inventory_transfers" FOR EACH ROW EXECUTE FUNCTION "guard_d4f864848d26deb3dc4e87f4"();

CREATE FUNCTION "guard_cb783750de6c86be9f05d153"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW."to_branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."to_branch_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."from_branch_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "branches" p WHERE p."id"=NEW."from_branch_id" AND p.tenant_id=NEW.tenant_id)) OR (NEW."inventory_item_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "inventory_items" p WHERE p."id"=NEW."inventory_item_id" AND p.tenant_id=NEW.tenant_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='ownership_inventory_transfers_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "ownership_inventory_transfers_update" BEFORE UPDATE ON "inventory_transfers" FOR EACH ROW EXECUTE FUNCTION "guard_cb783750de6c86be9f05d153"();

CREATE FUNCTION "guard_35d48fcc2b79773c83adc250"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='immutable_tenant_inventory_transfers';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "immutable_tenant_inventory_transfers" BEFORE UPDATE OF tenant_id ON "inventory_transfers" FOR EACH ROW EXECUTE FUNCTION "guard_35d48fcc2b79773c83adc250"();

CREATE FUNCTION "guard_d32109e9633fc4bc6d0570b4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='TENANT')
    OR EXISTS(SELECT 1 FROM memberships WHERE user_id=NEW.user_id AND tenant_id<>NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='membership_tenant_user_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "membership_tenant_user_insert" BEFORE INSERT ON memberships FOR EACH ROW EXECUTE FUNCTION "guard_d32109e9633fc4bc6d0570b4"();

CREATE FUNCTION "guard_bd0ecca2dd7ecdf1d9589274"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND kind='TENANT')
    OR EXISTS(SELECT 1 FROM memberships WHERE user_id=NEW.user_id AND tenant_id<>NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='membership_tenant_user_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "membership_tenant_user_update" BEFORE UPDATE OF user_id ON memberships FOR EACH ROW EXECUTE FUNCTION "guard_bd0ecca2dd7ecdf1d9589274"();

CREATE FUNCTION "guard_3b08317333d0f1d98309dfea"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM work_order_parts p WHERE p.id=NEW.part_id AND p.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='stock_return_tenant';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "stock_return_tenant" BEFORE INSERT ON stock_returns FOR EACH ROW EXECUTE FUNCTION "guard_3b08317333d0f1d98309dfea"();

CREATE FUNCTION "guard_475b25bed36d091ad341e77a"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='stock_return_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "stock_return_immutable" BEFORE UPDATE ON stock_returns FOR EACH ROW EXECUTE FUNCTION "guard_475b25bed36d091ad341e77a"();

CREATE FUNCTION "guard_4e4f259e6771b5f43ae697f9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=NEW.user_id AND m.tenant_id=NEW.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='legal_acceptance_tenant';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "legal_acceptance_tenant" BEFORE INSERT ON legal_acceptances FOR EACH ROW EXECUTE FUNCTION "guard_4e4f259e6771b5f43ae697f9"();

CREATE FUNCTION "guard_45e503985e8e9102ad831241"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_acceptance', CONSTRAINT='legal_acceptance_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "legal_acceptance_immutable" BEFORE UPDATE ON legal_acceptances FOR EACH ROW EXECUTE FUNCTION "guard_45e503985e8e9102ad831241"();

CREATE FUNCTION "guard_6a10355743cd6d6fc4ba97fe"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.destination_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.destination_item_id AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.to_branch_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='transfer_destination_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "transfer_destination_insert" BEFORE INSERT ON inventory_transfers FOR EACH ROW EXECUTE FUNCTION "guard_6a10355743cd6d6fc4ba97fe"();

CREATE FUNCTION "guard_dde452e7598d1e6619cd3704"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.destination_item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_items i WHERE i.id=NEW.destination_item_id AND i.tenant_id=NEW.tenant_id AND i.branch_id=NEW.to_branch_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='transfer_destination_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "transfer_destination_update" BEFORE UPDATE ON inventory_transfers FOR EACH ROW EXECUTE FUNCTION "guard_dde452e7598d1e6619cd3704"();

CREATE FUNCTION "guard_ef3c8e3dd44679ccf03ae966"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW.entity_type='WORK_ORDER' AND NOT EXISTS(SELECT 1 FROM work_orders WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='VEHICLE' AND NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='CUSTOMER' AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR NEW.entity_type NOT IN ('WORK_ORDER','VEHICLE','CUSTOMER') THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='file_entity_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "file_entity_insert" BEFORE INSERT ON file_links FOR EACH ROW EXECUTE FUNCTION "guard_ef3c8e3dd44679ccf03ae966"();

CREATE FUNCTION "guard_41883bc6ee4ab3b58b6d6bfd"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW.entity_type='WORK_ORDER' AND NOT EXISTS(SELECT 1 FROM work_orders WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='VEHICLE' AND NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR (NEW.entity_type='CUSTOMER' AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id)) OR NEW.entity_type NOT IN ('WORK_ORDER','VEHICLE','CUSTOMER') THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='file_entity_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "file_entity_update" BEFORE UPDATE ON file_links FOR EACH ROW EXECUTE FUNCTION "guard_41883bc6ee4ab3b58b6d6bfd"();

CREATE FUNCTION "guard_76ccd3a5bf2713031516a149"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='notification_recipient_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "notification_recipient_insert" BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION "guard_76ccd3a5bf2713031516a149"();

CREATE FUNCTION "guard_36c78b8722dcf419c32e14f1"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND NEW.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='notification_recipient_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "notification_recipient_update" BEFORE UPDATE OF tenant_id,user_id ON notifications FOR EACH ROW EXECUTE FUNCTION "guard_36c78b8722dcf419c32e14f1"();

CREATE FUNCTION "guard_598970e792c073bf65feb7d7"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM notifications n WHERE n.id=NEW.notification_id AND n.tenant_id=NEW.tenant_id AND n.channel='IN_APP' AND (n.user_id IS NULL OR n.user_id=NEW.user_id)) OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='notification_read_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "notification_read_owner" BEFORE INSERT ON notification_reads FOR EACH ROW EXECUTE FUNCTION "guard_598970e792c073bf65feb7d7"();

CREATE FUNCTION "guard_ef1310c783c5661b25f76932"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_read', CONSTRAINT='notification_read_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "notification_read_immutable" BEFORE UPDATE ON notification_reads FOR EACH ROW EXECUTE FUNCTION "guard_ef1310c783c5661b25f76932"();

CREATE FUNCTION "guard_07d58c6ba2d3ac3ee73d0d35"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.status='APPROVED' AND NEW.total=0 AND (NEW.no_charge_approved_by IS NULL OR length(trim(COALESCE(NEW.no_charge_reason,'')))=0) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='no_charge_approval_required', CONSTRAINT='no_charge_estimate_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "no_charge_estimate_insert" BEFORE INSERT ON estimates FOR EACH ROW EXECUTE FUNCTION "guard_07d58c6ba2d3ac3ee73d0d35"();

CREATE FUNCTION "guard_872e94a8b9a06cab80443172"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.status='APPROVED' AND NEW.total=0 AND (NEW.no_charge_approved_by IS NULL OR length(trim(COALESCE(NEW.no_charge_reason,'')))=0) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='no_charge_approval_required', CONSTRAINT='no_charge_estimate_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "no_charge_estimate_update" BEFORE UPDATE OF status,total,no_charge_approved_by,no_charge_reason ON estimates FOR EACH ROW EXECUTE FUNCTION "guard_872e94a8b9a06cab80443172"();

CREATE FUNCTION "guard_5eed997e9120f262c1507937"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.no_charge_approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.no_charge_approved_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='no_charge_actor_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "no_charge_actor_update" BEFORE UPDATE OF no_charge_approved_by ON estimates FOR EACH ROW EXECUTE FUNCTION "guard_5eed997e9120f262c1507937"();

CREATE FUNCTION "guard_2a4c1acdc07975b97b1da850"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.no_charge_approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.no_charge_approved_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='no_charge_actor_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "no_charge_actor_insert" BEFORE INSERT ON estimates FOR EACH ROW EXECUTE FUNCTION "guard_2a4c1acdc07975b97b1da850"();

CREATE FUNCTION "guard_efa2dc30b6a439fae2882d32"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND tenant_id=NEW.tenant_id)
  OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.created_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id)))
  OR (NEW.customer_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workshop_payments p JOIN workshop_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.id=NEW.customer_payment_id AND p.tenant_id=NEW.tenant_id AND p.amount=NEW.amount AND i.branch_id=NEW.branch_id AND i.voided_at IS NULL))
  OR (NEW.purchase_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_payments p JOIN accounts_payable a ON a.id=p.payable_id AND a.tenant_id=p.tenant_id WHERE p.id=NEW.purchase_payment_id AND p.tenant_id=NEW.tenant_id AND p.amount=NEW.amount AND a.branch_id=NEW.branch_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='invalid_payment_reversal', CONSTRAINT='payment_reversal_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "payment_reversal_owner" BEFORE INSERT ON payment_reversals FOR EACH ROW EXECUTE FUNCTION "guard_efa2dc30b6a439fae2882d32"();

CREATE FUNCTION "guard_7f26492517bd5b5e1efb9c77"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='payment_reversal_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "payment_reversal_immutable" BEFORE UPDATE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION "guard_7f26492517bd5b5e1efb9c77"();

CREATE FUNCTION "guard_65a3e74531bdb772d3518ff9"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='payment_reversal_no_delete';
  END IF;
  RETURN OLD;
END
$guard$;
CREATE TRIGGER "payment_reversal_no_delete" BEFORE DELETE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION "guard_65a3e74531bdb772d3518ff9"();

CREATE FUNCTION "guard_44d2d105eb96a208a37c8942"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.reversal_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM payment_reversals r WHERE r.id=NEW.reversal_id AND r.tenant_id=NEW.tenant_id AND r.branch_id=NEW.branch_id
  AND r.amount=NEW.amount AND NEW.workshop_payment_id IS NULL AND NEW.purchase_payment_id IS NULL
  AND ((r.customer_payment_id IS NOT NULL AND NEW.type='EXPENSE' AND NEW.category='CUSTOMER_PAYMENT_REVERSAL') OR (r.purchase_payment_id IS NOT NULL AND NEW.type='INCOME' AND NEW.category='SUPPLIER_PAYMENT_REVERSAL'))
) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='invalid_payment_reversal', CONSTRAINT='cash_reversal_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "cash_reversal_owner" BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_44d2d105eb96a208a37c8942"();

CREATE FUNCTION "guard_76bb177eca3a0e076cd65f68"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF OLD.reversal_id IS NOT NULL OR NEW.reversal_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='cash_reversal_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "cash_reversal_immutable" BEFORE UPDATE ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_76bb177eca3a0e076cd65f68"();

CREATE FUNCTION "guard_34fc5acd91c9652c20feb774"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF OLD.reversal_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='cash_reversal_no_delete';
  END IF;
  RETURN OLD;
END
$guard$;
CREATE TRIGGER "cash_reversal_no_delete" BEFORE DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_34fc5acd91c9652c20feb774"();

CREATE FUNCTION "guard_bb4ce4646eda1152d86a0af4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM payment_reversals WHERE customer_payment_id=OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='reversed_customer_payment_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "reversed_customer_payment_immutable" BEFORE UPDATE ON workshop_payments FOR EACH ROW EXECUTE FUNCTION "guard_bb4ce4646eda1152d86a0af4"();

CREATE FUNCTION "guard_4b1e38d90251cb225627bc6d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM payment_reversals WHERE purchase_payment_id=OLD.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='reversed_supplier_payment_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "reversed_supplier_payment_immutable" BEFORE UPDATE ON purchase_payments FOR EACH ROW EXECUTE FUNCTION "guard_4b1e38d90251cb225627bc6d"();

CREATE FUNCTION "guard_177a884ba5563ed79dd438a8"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM payment_reversals WHERE customer_payment_id=OLD.workshop_payment_id OR purchase_payment_id=OLD.purchase_payment_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='reversed_original_cash_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "reversed_original_cash_immutable" BEFORE UPDATE ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_177a884ba5563ed79dd438a8"();

CREATE FUNCTION "guard_c788a2bccdfb94bbe5dbcc74"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM payment_reversals WHERE customer_payment_id=OLD.workshop_payment_id OR purchase_payment_id=OLD.purchase_payment_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='reversed_original_cash_no_delete';
  END IF;
  RETURN OLD;
END
$guard$;
CREATE TRIGGER "reversed_original_cash_no_delete" BEFORE DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_c788a2bccdfb94bbe5dbcc74"();

CREATE FUNCTION "guard_37cc3bcbff688a0eee842cf4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW.workshop_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workshop_payments p JOIN workshop_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.id=NEW.workshop_payment_id AND p.tenant_id=NEW.tenant_id AND i.branch_id=NEW.branch_id AND p.amount=NEW.amount AND NEW.type='INCOME' AND NEW.category='CUSTOMER_PAYMENT' AND NEW.purchase_payment_id IS NULL AND NEW.reversal_id IS NULL))
  OR (NEW.purchase_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_payments p JOIN accounts_payable a ON a.id=p.payable_id AND a.tenant_id=p.tenant_id WHERE p.id=NEW.purchase_payment_id AND p.tenant_id=NEW.tenant_id AND a.branch_id=NEW.branch_id AND p.amount=NEW.amount AND NEW.type='EXPENSE' AND NEW.category='SUPPLIER_PAYMENT' AND NEW.workshop_payment_id IS NULL AND NEW.reversal_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='invalid_payment_cash', CONSTRAINT='cash_payment_owner_insert';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "cash_payment_owner_insert" BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_37cc3bcbff688a0eee842cf4"();

CREATE FUNCTION "guard_34dc4bf164992a78d955276d"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF (NEW.workshop_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workshop_payments p JOIN workshop_invoices i ON i.id=p.invoice_id AND i.tenant_id=p.tenant_id WHERE p.id=NEW.workshop_payment_id AND p.tenant_id=NEW.tenant_id AND i.branch_id=NEW.branch_id AND p.amount=NEW.amount AND NEW.type='INCOME' AND NEW.category='CUSTOMER_PAYMENT' AND NEW.purchase_payment_id IS NULL AND NEW.reversal_id IS NULL))
  OR (NEW.purchase_payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM purchase_payments p JOIN accounts_payable a ON a.id=p.payable_id AND a.tenant_id=p.tenant_id WHERE p.id=NEW.purchase_payment_id AND p.tenant_id=NEW.tenant_id AND a.branch_id=NEW.branch_id AND p.amount=NEW.amount AND NEW.type='EXPENSE' AND NEW.category='SUPPLIER_PAYMENT' AND NEW.workshop_payment_id IS NULL AND NEW.reversal_id IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='invalid_payment_cash', CONSTRAINT='cash_payment_owner_update';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "cash_payment_owner_update" BEFORE UPDATE ON cash_movements FOR EACH ROW EXECUTE FUNCTION "guard_34dc4bf164992a78d955276d"();

CREATE FUNCTION "guard_707181d6dc6a819f0318f24e"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM purchase_orders p WHERE p.id=NEW.purchase_order_id AND p.tenant_id=NEW.tenant_id AND p.branch_id=NEW.branch_id AND p.currency=NEW.currency)
      OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.received_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='purchase_receipt_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_receipt_owner" BEFORE INSERT ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION "guard_707181d6dc6a819f0318f24e"();

CREATE FUNCTION "guard_102ca22f783c1daf6a89cb3b"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NOT EXISTS(
      SELECT 1 FROM purchase_receipts r JOIN purchase_order_items l ON l.purchase_order_id=r.purchase_order_id AND l.tenant_id=r.tenant_id
      JOIN inventory_movements m ON m.id=NEW.inventory_movement_id AND m.tenant_id=r.tenant_id
      WHERE r.id=NEW.receipt_id AND r.tenant_id=NEW.tenant_id AND l.id=NEW.purchase_order_item_id AND l.inventory_item_id=NEW.inventory_item_id
      AND l.unit_cost=NEW.unit_cost AND NEW.quantity-(l.quantity-l.received_quantity-l.canceled_quantity)<=0.000000001
      AND m.inventory_item_id=NEW.inventory_item_id AND m.branch_id=r.branch_id AND m.quantity=NEW.quantity AND m.movement_type='PURCHASE'
      AND m.reference_type='PURCHASE_ORDER' AND m.reference_id=r.purchase_order_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='invalid_purchase_receipt', CONSTRAINT='purchase_receipt_line_owner';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_receipt_line_owner" BEFORE INSERT ON purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION "guard_102ca22f783c1daf6a89cb3b"();

CREATE FUNCTION "guard_529053bdf411b1c63f3aa159"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='purchase_receipt_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_receipt_immutable" BEFORE UPDATE ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION "guard_529053bdf411b1c63f3aa159"();

CREATE FUNCTION "guard_74e8a98635dcc7a73a625324"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='purchase_receipt_no_delete';
  END IF;
  RETURN OLD;
END
$guard$;
CREATE TRIGGER "purchase_receipt_no_delete" BEFORE DELETE ON purchase_receipts FOR EACH ROW EXECUTE FUNCTION "guard_74e8a98635dcc7a73a625324"();

CREATE FUNCTION "guard_810cbfa6af17efa347d347b4"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='purchase_receipt_line_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_receipt_line_immutable" BEFORE UPDATE ON purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION "guard_810cbfa6af17efa347d347b4"();

CREATE FUNCTION "guard_8fbde4d568e30615f47bfa20"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF TRUE THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='purchase_receipt_line_no_delete';
  END IF;
  RETURN OLD;
END
$guard$;
CREATE TRIGGER "purchase_receipt_line_no_delete" BEFORE DELETE ON purchase_receipt_lines FOR EACH ROW EXECUTE FUNCTION "guard_8fbde4d568e30615f47bfa20"();

CREATE FUNCTION "guard_515b7c5400b18290126bb702"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.opening_received_quantity<>OLD.opening_received_quantity THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_movement', CONSTRAINT='purchase_opening_immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_opening_immutable" BEFORE UPDATE OF opening_received_quantity ON purchase_order_items FOR EACH ROW EXECUTE FUNCTION "guard_515b7c5400b18290126bb702"();

CREATE FUNCTION "guard_90830b50104850fc72a943dd"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.canceled_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.canceled_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='purchase_orders_cancellation_actor';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_orders_cancellation_actor" BEFORE UPDATE OF canceled_by ON purchase_orders FOR EACH ROW EXECUTE FUNCTION "guard_90830b50104850fc72a943dd"();

CREATE FUNCTION "guard_502da4e58cc02de736a98f52"() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $guard$
BEGIN
  IF NEW.canceled_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.canceled_by AND ((u.kind='PLATFORM' AND u.platform_role='SUPER_ADMIN') OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=NEW.tenant_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23503', MESSAGE='tenant_mismatch', CONSTRAINT='purchase_requests_cancellation_actor';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER "purchase_requests_cancellation_actor" BEFORE UPDATE OF canceled_by ON purchase_requests FOR EACH ROW EXECUTE FUNCTION "guard_502da4e58cc02de736a98f52"();
