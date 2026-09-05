import { json, now } from './utils.js';
import { PERMISSIONS } from './permissions.js';
import { AppError } from './errors.js';

export const TENANT_WRITABLE_STATUSES = new Set([
  'TRIAL',
  'ACTIVE',
  'PAYMENT_PENDING',
  'OVERDUE',
  'GRACE',
]);

export async function resolveContext(db, session) {
  if (!session) return null;
  if (session.kind === 'PLATFORM') {
    if (session.platform_role !== 'SUPER_ADMIN')
      return { user: session, tenant: null, membership: null, permissions: [], isPlatform: false };
    if (session.impersonated_tenant_id) {
      const tenant = await db
        .prepare('SELECT * FROM tenants WHERE id=?')
        .get(session.impersonated_tenant_id);
      if (tenant)
        return {
          user: session,
          tenant,
          membership: null,
          permissions: ['*'],
          isPlatform: true,
          isImpersonating: true,
        };
    }
    return {
      user: session,
      tenant: null,
      membership: null,
      permissions: ['*'],
      isPlatform: true,
      isImpersonating: false,
    };
  }
  const membership = await db
    .prepare(
      `SELECT m.*, r.permissions, r.name role_name, b.name branch_name
    FROM memberships m JOIN roles r ON r.id=m.role_id LEFT JOIN branches b ON b.id=m.branch_id
    WHERE m.user_id=? AND m.status='ACTIVE' ORDER BY m.joined_at LIMIT 1`,
    )
    .get(session.user_id);
  if (!membership)
    return { user: session, tenant: null, membership: null, permissions: [], isPlatform: false };
  const tenant = await db.prepare('SELECT * FROM tenants WHERE id=?').get(membership.tenant_id);
  return {
    user: session,
    tenant,
    membership,
    permissions: json(membership.permissions, []),
    isPlatform: false,
    isImpersonating: false,
  };
}

export function can(context, permission) {
  if (context?.permissions?.includes('*') || context?.permissions?.includes(permission))
    return true;
  const resource = permission.split('.')[0];
  if (resource === 'documents' && context?.permissions?.includes('documents.manage')) return true;
  if (permission === 'orders.execute' && context?.permissions?.includes('orders.update'))
    return true;
  if (
    permission.endsWith('.view') &&
    context?.permissions?.includes(permission.replace('.view', '.manage'))
  )
    return true;
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
    const error = new Error('No existe un taller activo en la sesión.');
    error.status = 403;
    throw error;
  }
  if (!TENANT_WRITABLE_STATUSES.has(context.tenant.status)) {
    const error = new Error(
      'La suscripción no permite crear nuevas operaciones. Los datos permanecen disponibles en modo consulta.',
    );
    error.status = 423;
    throw error;
  }
}

// Recheck authority AFTER acquiring the tenant lock. A request may have waited while
// another process suspended the tenant, revoked its session or changed the employee's role.
// Preserve restrictions already applied by the caller; refreshing never grants new authority.
export async function withTenantWrite(db, context, operation) {
  if (!context?.tenant?.id || !context?.user?.id)
    throw new AppError('Inicia sesión para continuar.', { status: 401 });
  return db.transaction(
    async () => {
      const session = await db
        .prepare(
          `SELECT s.*,u.email,u.name,u.kind,u.platform_role,
      u.active,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=? AND s.user_id=? AND s.expires_at>? AND u.active=1`,
        )
        .get(context.user.id, context.user.user_id, now());
      if (!session)
        throw new AppError('Tu sesión cambió. Inicia sesión nuevamente.', { status: 401 });
      const fresh = await resolveContext(db, session);
      if (fresh?.tenant?.id !== context.tenant.id || fresh.isPlatform !== context.isPlatform)
        throw new AppError('El acceso al taller ya no está disponible.', { status: 403 });
      fresh.permissions =
        context.permissions.includes('*') && fresh.permissions.includes('*')
          ? ['*']
          : PERMISSIONS.map(([permission]) => permission).filter(
              (permission) => can(context, permission) && can(fresh, permission),
            );
      assertTenantWritable(fresh);
      return operation(fresh);
    },
    { lockKey: 'tenant:' + context.tenant.id },
  );
}

export async function entitlement(db, tenantId, code) {
  const record = await db
    .prepare(
      `SELECT f.code,f.name,f.kind,f.global_enabled,pf.enabled plan_enabled,pf.limit_value plan_limit,
      tf.enabled tenant_enabled,tf.limit_value tenant_limit
    FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN features f ON f.code=?
    LEFT JOIN plan_features pf ON pf.plan_id=s.plan_id AND pf.feature_id=f.id
    LEFT JOIN tenant_features tf ON tf.tenant_id=t.id AND tf.feature_id=f.id WHERE t.id=?`,
    )
    .get(code, tenantId);
  if (!record || !record.global_enabled) return { enabled: false, limit: 0, code };
  const enabled =
    record.tenant_enabled == null ? Boolean(record.plan_enabled) : Boolean(record.tenant_enabled);
  const limit = record.tenant_limit == null ? record.plan_limit : record.tenant_limit;
  return { enabled, limit: limit == null ? null : Number(limit), code, name: record.name };
}

export async function assertEntitlement(db, tenantId, code, currentUsage = null) {
  const result = await entitlement(db, tenantId, code);
  if (
    !result.enabled ||
    (currentUsage != null && result.limit != null && Number(currentUsage) >= result.limit)
  ) {
    const error = new Error(
      result.enabled
        ? `Alcanzaste el límite de ${result.name || 'uso'} incluido en tu plan.`
        : `La funcionalidad ${result.name || 'solicitada'} no está incluida en tu plan.`,
    );
    error.status = 402;
    throw error;
  }
  return result;
}

export async function tenantRows(db, table, tenantId, order = 'created_at DESC') {
  const allowed = new Set([
    'branches',
    'memberships',
    'customers',
    'vehicles',
    'services',
    'work_orders',
    'inventory_items',
    'suppliers',
    'purchases',
    'bays',
    'appointments',
    'workshop_invoices',
    'cash_movements',
    'support_tickets',
    'files',
  ]);
  if (!allowed.has(table)) throw new Error('Tabla no autorizada');
  return await db
    .prepare(`SELECT * FROM ${table} WHERE tenant_id=? ORDER BY ${order}`)
    .all(tenantId);
}

export async function touchTenant(db, tenantId) {
  await db.prepare('UPDATE tenants SET last_activity_at=? WHERE id=?').run(now(), tenantId);
}
