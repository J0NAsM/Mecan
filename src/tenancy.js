import { json, now } from './utils.js';

export const TENANT_WRITABLE_STATUSES = new Set(['TRIAL', 'ACTIVE', 'PAYMENT_PENDING', 'OVERDUE', 'GRACE']);

export function resolveContext(db, session) {
  if (!session) return null;
  if (session.kind === 'PLATFORM') {
    if (session.impersonated_tenant_id) {
      const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(session.impersonated_tenant_id);
      if (tenant) return { user: session, tenant, membership: null, permissions: ['*'], isPlatform: true, isImpersonating: true };
    }
    return { user: session, tenant: null, membership: null, permissions: ['*'], isPlatform: true, isImpersonating: false };
  }
  const membership = db.prepare(`SELECT m.*, r.permissions, r.name role_name, b.name branch_name
    FROM memberships m JOIN roles r ON r.id=m.role_id LEFT JOIN branches b ON b.id=m.branch_id
    WHERE m.user_id=? AND m.status='ACTIVE' ORDER BY m.joined_at LIMIT 1`).get(session.user_id);
  if (!membership) return { user: session, tenant: null, membership: null, permissions: [], isPlatform: false };
  const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(membership.tenant_id);
  return { user: session, tenant, membership, permissions: json(membership.permissions, []), isPlatform: false, isImpersonating: false };
}

export function can(context, permission) {
  if (context?.permissions?.includes('*') || context?.permissions?.includes(permission)) return true;
  const resource=permission.split('.')[0];
  if(context?.permissions?.includes(`${resource}.manage`))return true;
  if(permission==='orders.execute'&&context?.permissions?.includes('orders.update'))return true;
  if (permission.endsWith('.view') && context?.permissions?.includes(permission.replace('.view','.manage'))) return true;
  return false;
}

export function assertPermission(context, permission) {
  if (!can(context, permission)) {
    const error = new Error('No posee permisos para realizar esta acción.');
    error.status = 403;
    throw error;
  }
}

export function assertTenantWritable(context) {
  if (!context?.tenant) {
    const error = new Error('No existe un taller activo en la sesión.'); error.status = 403; throw error;
  }
  if (!TENANT_WRITABLE_STATUSES.has(context.tenant.status)) {
    const error = new Error('La suscripción no permite crear nuevas operaciones. Los datos permanecen disponibles en modo consulta.');
    error.status = 423;
    throw error;
  }
}

export function entitlement(db, tenantId, code) {
  const record = db.prepare(`SELECT f.code,f.kind,f.global_enabled,pf.enabled plan_enabled,pf.limit_value plan_limit,
      tf.enabled tenant_enabled,tf.limit_value tenant_limit
    FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN features f ON f.code=?
    LEFT JOIN plan_features pf ON pf.plan_id=s.plan_id AND pf.feature_id=f.id
    LEFT JOIN tenant_features tf ON tf.tenant_id=t.id AND tf.feature_id=f.id WHERE t.id=?`).get(code, tenantId);
  if (!record || !record.global_enabled) return { enabled: false, limit: 0, code };
  const enabled = record.tenant_enabled == null ? Boolean(record.plan_enabled) : Boolean(record.tenant_enabled);
  const limit = record.tenant_limit == null ? record.plan_limit : record.tenant_limit;
  return { enabled, limit: limit == null ? null : Number(limit), code };
}

export function assertEntitlement(db, tenantId, code, currentUsage = null) {
  const result = entitlement(db, tenantId, code);
  if (!result.enabled || (currentUsage != null && result.limit != null && Number(currentUsage) >= result.limit)) {
    const error = new Error(result.enabled ? `Alcanzó el límite de ${code} incluido en su plan.` : `La función ${code} no está incluida en su plan.`);
    error.status = 402;
    throw error;
  }
  return result;
}

export function tenantRows(db, table, tenantId, order = 'created_at DESC') {
  const allowed = new Set(['branches','memberships','customers','vehicles','services','work_orders','inventory_items','suppliers','purchases','bays','appointments','workshop_invoices','cash_movements','support_tickets','files']);
  if (!allowed.has(table)) throw new Error('Tabla no autorizada');
  return db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? ORDER BY ${order}`).all(tenantId);
}

export function touchTenant(db, tenantId) {
  db.prepare('UPDATE tenants SET last_activity_at=? WHERE id=?').run(now(), tenantId);
}
