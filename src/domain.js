import { id, now, addDays, slugify, asNumber } from './utils.js';
import { hashPassword } from './auth.js';
import { assertEntitlement, touchTenant } from './tenancy.js';
import { MANAGER_PERMISSIONS as GRANULAR_MANAGER, TECHNICIAN_PERMISSIONS } from './permissions.js';
import { required, email as validEmail, password as validPassword } from './validation.js';

export const OWNER_PERMISSIONS = ['*'];
export const MANAGER_PERMISSIONS = GRANULAR_MANAGER;
export const TECH_PERMISSIONS = TECHNICIAN_PERMISSIONS;

export function audit(db, { scope = 'TENANT', tenantId = null, branchId = null, actorUserId = null, impersonatorUserId = null, action, entityType = null, entityId = null, ip = null, requestId = null, metadata = {}, before = null, after = null }) {
  db.prepare(`INSERT INTO audit_logs (id,scope,tenant_id,branch_id,actor_user_id,impersonator_user_id,action,entity_type,entity_id,ip_address,request_id,metadata,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id(), scope, tenantId, branchId, actorUserId, impersonatorUserId, action, entityType, entityId, ip, requestId, JSON.stringify(metadata), before==null?null:JSON.stringify(before), after==null?null:JSON.stringify(after), now());
}

export function uniqueSlug(db, name) {
  const base = slugify(name) || 'taller';
  let value = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM tenants WHERE slug=?').get(value)) value = `${base}-${suffix++}`;
  return value;
}

export function provisionWorkshop(db, input, options = {}) {
  const email = validEmail(input.email), ownerName=required(input.ownerName,'Tu nombre',{max:150}), workshopName=required(input.workshopName,'El nombre del taller',{max:180}), password=validPassword(input.password);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) { const error = new Error('El email ya está registrado.'); error.status = 409; throw error; }
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1 AND public=1').get(input.planId);
  if (!plan) { const error = new Error('Seleccione un plan disponible.'); error.status = 422; throw error; }
  const tenantId = id(), userId = id(), branchId = id(), roleId = id(), subscriptionId = id();
  const created = now();
  const trialDays = Number(db.prepare("SELECT value FROM platform_settings WHERE key='trial_days'").get()?.value || 14);
  const graceDays = Number(db.prepare("SELECT value FROM platform_settings WHERE key='grace_days'").get()?.value || 5);
  const trialEnd = addDays(created, trialDays);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO tenants (id,slug,name,legal_name,owner_name,tax_id,phone,email,address,country,city,status,onboarding_step,last_activity_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(tenantId,uniqueSlug(db,workshopName),workshopName,input.legalName || workshopName,ownerName,input.taxId || null,input.phone || null,email,input.address || null,input.country || 'Paraguay',input.city || null,'TRIAL',1,created,created);
    db.prepare('INSERT INTO users (id,email,password_hash,name,kind,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId,email,hashPassword(password),ownerName,'TENANT',created);
    db.prepare('INSERT INTO branches (id,tenant_id,name,address,city,active,is_main,created_at) VALUES (?,?,?,?,?,1,1,?)')
      .run(branchId,tenantId,input.branchName || 'Casa central',input.address || null,input.city || null,created);
    db.prepare('INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1)')
      .run(roleId,tenantId,'OWNER','Propietario',JSON.stringify(OWNER_PERMISSIONS));
    db.prepare('INSERT INTO memberships (id,tenant_id,user_id,branch_id,role_id,job_title,status,joined_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id(),tenantId,userId,branchId,roleId,'Propietario/a','ACTIVE',created);
    db.prepare('INSERT INTO tenant_settings (tenant_id,currency,tax_rate,timezone,onboarding_data,updated_at) VALUES (?,?,?,?,?,?)')
      .run(tenantId,input.currency || plan.currency,asNumber(input.taxRate,10),input.timezone || 'America/Asuncion','{}',created);
    db.prepare(`INSERT INTO subscriptions (id,tenant_id,plan_id,billing_cycle,price,currency,started_at,next_charge_at,status,auto_renew,grace_until,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(subscriptionId,tenantId,plan.id,input.billingCycle || 'MONTHLY',plan.price_monthly,plan.currency,created,trialEnd,'TRIAL',0,addDays(trialEnd,graceDays),created);
    db.prepare('INSERT INTO trials (id,tenant_id,plan_id,starts_at,ends_at,active) VALUES (?,?,?,?,?,1)')
      .run(id(),tenantId,plan.id,created,trialEnd);
    audit(db,{scope:'PLATFORM',tenantId,actorUserId:userId,action:'TENANT_PROVISIONED',entityType:'tenant',entityId:tenantId,ip:options.ip,metadata:{plan:plan.code,source:'self_signup'}});
    db.exec('COMMIT');
    return { tenantId, userId, branchId };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function createBranch(db, context, input) {
  const branchId = id(), name=required(input.name,'El nombre de la sucursal',{max:150});
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare('SELECT COUNT(*) total FROM branches WHERE tenant_id=? AND active=1').get(context.tenant.id).total;
    assertEntitlement(db, context.tenant.id, 'branches', count);
    db.prepare('INSERT INTO branches (id,tenant_id,name,phone,address,city,active,is_main,created_at) VALUES (?,?,?,?,?,?,1,0,?)')
      .run(branchId,context.tenant.id,name,input.phone || null,input.address || null,input.city || null,now());
    audit(db,{tenantId:context.tenant.id,actorUserId:context.user.user_id,action:'BRANCH_CREATED',entityType:'branch',entityId:branchId,after:{name}});
    touchTenant(db,context.tenant.id);
    db.exec('COMMIT');
    return branchId;
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

export function createEmployee(db, context, input) {
  const role = db.prepare('SELECT id FROM roles WHERE id=? AND tenant_id=?').get(input.roleId,context.tenant.id);
  const branch = db.prepare('SELECT id FROM branches WHERE id=? AND tenant_id=? AND active=1').get(input.branchId,context.tenant.id);
  if (!role || !branch) throw Object.assign(new Error('Rol o sucursal inválidos.'),{status:422});
  const email = validEmail(input.email), name=required(input.name,'El nombre',{max:150});
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare("SELECT COUNT(*) total FROM memberships WHERE tenant_id=? AND status!='DISABLED'").get(context.tenant.id).total;
    assertEntitlement(db, context.tenant.id, 'employees', count);
    let user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (user && db.prepare('SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=?').get(context.tenant.id,user.id)) throw Object.assign(new Error('El empleado ya pertenece al taller.'),{status:409});
    if (user && db.prepare('SELECT 1 FROM memberships WHERE user_id=? AND tenant_id<>?').get(user.id,context.tenant.id)) throw Object.assign(new Error('El email ya está asociado a otro taller.'),{status:409});
    const userId = user?.id || id();
    if (!user) db.prepare('INSERT INTO users (id,email,password_hash,name,kind,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId,email,hashPassword(validPassword(input.password || 'Cambiar123!')),name,'TENANT',now());
    db.prepare('INSERT INTO memberships (id,tenant_id,user_id,branch_id,role_id,job_title,status,invited_at,joined_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id(),context.tenant.id,userId,branch.id,role.id,input.jobTitle || null,'ACTIVE',now(),now());
    audit(db,{tenantId:context.tenant.id,branchId:branch.id,actorUserId:context.user.user_id,action:'EMPLOYEE_INVITED',entityType:'user',entityId:userId,after:{email,roleId:role.id,branchId:branch.id}});
    db.exec('COMMIT');
    return userId;
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}

export function nextNumber(db, table, tenantId) {
  const allowed = new Set(['work_orders','workshop_invoices']);
  if (!allowed.has(table)) throw new Error('Secuencia inválida');
  return Number(db.prepare(`SELECT COALESCE(MAX(number),0)+1 value FROM ${table} WHERE tenant_id=?`).get(tenantId).value);
}

export function createWorkOrder(db, context, input) {
  const month = now().slice(0,7);
  const count = db.prepare("SELECT COUNT(*) total FROM work_orders WHERE tenant_id=? AND substr(created_at,1,7)=?").get(context.tenant.id,month).total;
  assertEntitlement(db,context.tenant.id,'orders_monthly',count);
  const customer = db.prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?').get(input.customerId,context.tenant.id);
  const vehicle = db.prepare('SELECT id FROM vehicles WHERE id=? AND customer_id=? AND tenant_id=?').get(input.vehicleId,input.customerId,context.tenant.id);
  const branch = db.prepare('SELECT id FROM branches WHERE id=? AND tenant_id=?').get(input.branchId,context.tenant.id);
  if (!customer || !vehicle || !branch) throw Object.assign(new Error('Cliente, vehículo o sucursal inválidos.'),{status:422});
  const orderId = id(), created = now(), taxRate = Number(db.prepare('SELECT tax_rate FROM tenant_settings WHERE tenant_id=?').get(context.tenant.id)?.tax_rate || 0);
  const subtotal = asNumber(input.amount), tax = subtotal * taxRate / 100;
  db.prepare(`INSERT INTO work_orders (id,tenant_id,branch_id,customer_id,vehicle_id,number,status,complaint,diagnosis,notes,subtotal,tax,total,promised_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(orderId,context.tenant.id,branch.id,customer.id,vehicle.id,nextNumber(db,'work_orders',context.tenant.id),'RECEIVED',input.complaint || null,input.diagnosis || null,input.notes || null,subtotal,tax,subtotal+tax,input.promisedAt || null,context.user.user_id,created);
  if (input.description || subtotal) db.prepare('INSERT INTO work_order_items (id,tenant_id,work_order_id,item_type,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?,?)')
    .run(id(),context.tenant.id,orderId,'SERVICE',input.description || 'Servicio',1,subtotal,subtotal);
  audit(db,{tenantId:context.tenant.id,actorUserId:context.user.user_id,action:'WORK_ORDER_CREATED',entityType:'work_order',entityId:orderId});
  touchTenant(db,context.tenant.id);
  return orderId;
}
