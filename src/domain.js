import { id, now, addDays, slugify, asNumber } from './utils.js';
import { hashPassword } from './auth.js';
import {
  withTenantWrite,
  assertPermission,
  assertEntitlement,
  touchTenant,
  can,
} from './tenancy.js';
import {
  MANAGER_PERMISSIONS as GRANULAR_MANAGER,
  TECHNICIAN_PERMISSIONS,
  RECEPTION_PERMISSIONS,
  CASHIER_PERMISSIONS,
  INVENTORY_PERMISSIONS,
} from './permissions.js';
import {
  required,
  email as validEmail,
  password as validPassword,
  oneOf,
  positive,
} from './validation.js';
import { currencyCode } from './money.js';

export const OWNER_PERMISSIONS = ['*'];
export const MANAGER_PERMISSIONS = GRANULAR_MANAGER;
export const TECH_PERMISSIONS = TECHNICIAN_PERMISSIONS;

export async function audit(
  db,
  {
    scope = 'TENANT',
    tenantId = null,
    branchId = null,
    actorUserId = null,
    impersonatorUserId = null,
    action,
    entityType = null,
    entityId = null,
    ip = null,
    requestId = null,
    metadata = {},
    before = null,
    after = null,
  },
) {
  await db
    .prepare(
      `INSERT INTO audit_logs (id,scope,tenant_id,branch_id,actor_user_id,impersonator_user_id,action,entity_type,entity_id,ip_address,request_id,metadata,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id(),
      scope,
      tenantId,
      branchId,
      actorUserId,
      impersonatorUserId,
      action,
      entityType,
      entityId,
      ip,
      requestId,
      JSON.stringify(metadata),
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
      now(),
    );
}

export async function uniqueSlug(db, name) {
  const base = slugify(name) || 'taller';
  let value = base;
  let suffix = 2;
  while (await db.prepare('SELECT 1 FROM tenants WHERE slug=?').get(value))
    value = `${base}-${suffix++}`;
  return value;
}

export async function provisionWorkshop(db, input, options = {}) {
  const email = validEmail(input.email),
    ownerName = required(input.ownerName, 'Tu nombre', { max: 150 }),
    workshopName = required(input.workshopName, 'El nombre del taller', { max: 180 }),
    password = validPassword(input.password);
  if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
    const error = new Error('El email ya está registrado.');
    error.status = 409;
    throw error;
  }
  const plan = await db
    .prepare('SELECT * FROM plans WHERE id=? AND active=1 AND public=1')
    .get(input.planId);
  if (!plan) {
    const error = new Error('Seleccione un plan disponible.');
    error.status = 422;
    throw error;
  }
  const tenantId = id(),
    userId = id(),
    branchId = id(),
    roleId = id(),
    subscriptionId = id();
  const created = now();
  const trialDays = Number(
    (await db.prepare("SELECT value FROM platform_settings WHERE key='trial_days'").get())?.value ??
      14,
  );
  const graceDays = Number(
    (await db.prepare("SELECT value FROM platform_settings WHERE key='grace_days'").get())?.value ??
      5,
  );
  const trialEnd = addDays(created, trialDays);

  try {
    return await db.transaction(
      async () => {
        await db
          .prepare(
            `INSERT INTO tenants (id,slug,name,legal_name,owner_name,tax_id,phone,email,address,country,city,status,onboarding_step,last_activity_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            tenantId,
            await uniqueSlug(db, workshopName),
            workshopName,
            input.legalName || workshopName,
            ownerName,
            input.taxId || null,
            input.phone || null,
            email,
            input.address || null,
            input.country || 'Paraguay',
            input.city || null,
            'TRIAL',
            1,
            created,
            created,
          );
        await db
          .prepare(
            'INSERT INTO users (id,email,password_hash,name,kind,created_at) VALUES (?,?,?,?,?,?)',
          )
          .run(userId, email, hashPassword(password), ownerName, 'TENANT', created);
        await db
          .prepare(
            'INSERT INTO branches (id,tenant_id,name,address,city,active,is_main,created_at) VALUES (?,?,?,?,?,1,1,?)',
          )
          .run(
            branchId,
            tenantId,
            input.branchName || 'Casa central',
            input.address || null,
            input.city || null,
            created,
          );
        await db
          .prepare(
            'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1)',
          )
          .run(roleId, tenantId, 'OWNER', 'Propietario', JSON.stringify(OWNER_PERMISSIONS));
        for (const [code, name, rolePermissions] of [
          ['MANAGER', 'Gerencia', MANAGER_PERMISSIONS],
          ['RECEPTION', 'Recepción', RECEPTION_PERMISSIONS],
          ['TECHNICIAN', 'Mecánico', TECH_PERMISSIONS],
          ['CASHIER', 'Caja', CASHIER_PERMISSIONS],
          ['INVENTORY', 'Inventario', INVENTORY_PERMISSIONS],
        ])
          await db
            .prepare(
              'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1)',
            )
            .run(id(), tenantId, code, name, JSON.stringify(rolePermissions));
        await db
          .prepare(
            'INSERT INTO memberships (id,tenant_id,user_id,branch_id,role_id,job_title,status,joined_at) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(id(), tenantId, userId, branchId, roleId, 'Propietario/a', 'ACTIVE', created);
        await db
          .prepare(
            'INSERT INTO tenant_settings (tenant_id,currency,tax_rate,timezone,onboarding_data,updated_at) VALUES (?,?,?,?,?,?)',
          )
          .run(
            tenantId,
            currencyCode(input.currency || plan.currency),
            positive(input.taxRate ?? 10, 'El impuesto', { allowZero: true, max: 100 }),
            input.timezone || 'America/Asuncion',
            '{}',
            created,
          );
        await db
          .prepare(
            `INSERT INTO subscriptions (id,tenant_id,plan_id,billing_cycle,price,currency,started_at,next_charge_at,status,auto_renew,grace_until,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            subscriptionId,
            tenantId,
            plan.id,
            oneOf(input.billingCycle || 'MONTHLY', ['MONTHLY'], 'El ciclo de registro'),
            plan.price_monthly,
            plan.currency,
            created,
            trialEnd,
            'TRIAL',
            0,
            addDays(trialEnd, graceDays),
            created,
          );
        await db
          .prepare(
            'INSERT INTO trials (id,tenant_id,plan_id,starts_at,ends_at,active) VALUES (?,?,?,?,?,1)',
          )
          .run(id(), tenantId, plan.id, created, trialEnd);
        await audit(db, {
          scope: 'PLATFORM',
          tenantId,
          actorUserId: userId,
          action: 'TENANT_PROVISIONED',
          entityType: 'tenant',
          entityId: tenantId,
          ip: options.ip,
          metadata: { plan: plan.code, source: 'self_signup' },
        });

        return { tenantId, userId, branchId };
      },
      { lockKey: 'platform:signup' },
    );
  } catch (error) {
    throw error;
  }
}

export async function createBranch(db, context, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'branches.manage');
    const branchId = id(),
      name = required(input.name, 'El nombre de la sucursal', { max: 150 });

    try {
      return await db.transaction(
        async () => {
          const count = (
            await db
              .prepare('SELECT COUNT(*) total FROM branches WHERE tenant_id=? AND active=1')
              .get(context.tenant.id)
          ).total;
          await assertEntitlement(db, context.tenant.id, 'branches', count);
          await db
            .prepare(
              'INSERT INTO branches (id,tenant_id,name,phone,address,city,active,is_main,created_at) VALUES (?,?,?,?,?,?,1,0,?)',
            )
            .run(
              branchId,
              context.tenant.id,
              name,
              input.phone || null,
              input.address || null,
              input.city || null,
              now(),
            );
          await audit(db, {
            tenantId: context.tenant.id,
            actorUserId: context.user.user_id,
            action: 'BRANCH_CREATED',
            entityType: 'branch',
            entityId: branchId,
            after: { name },
          });
          await touchTenant(db, context.tenant.id);

          return branchId;
        },
        { lockKey: 'tenant:' + context.tenant.id },
      );
    } catch (error) {
      throw error;
    }
  });
}

export async function createEmployee(db, context, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'employees.manage');
    const role = await db
      .prepare('SELECT id,code,permissions FROM roles WHERE id=? AND tenant_id=?')
      .get(input.roleId, context.tenant.id);
    const branch = await db
      .prepare('SELECT id FROM branches WHERE id=? AND tenant_id=? AND active=1')
      .get(input.branchId, context.tenant.id);
    if (!role || !branch)
      throw Object.assign(new Error('Rol o sucursal inválidos.'), { status: 422 });
    if (role.code === 'OWNER')
      throw Object.assign(new Error('El rol de propietario no puede asignarse a otro usuario.'), {
        status: 403,
      });
    const email = validEmail(input.email),
      name = required(input.name, 'El nombre', { max: 150 });
    if (JSON.parse(role.permissions).some((permission) => !can(context, permission)))
      throw Object.assign(new Error('No puedes asignar un rol con permisos que no posees.'), {
        status: 403,
      });

    try {
      return await db.transaction(
        async () => {
          const count = (
            await db
              .prepare(
                "SELECT COUNT(*) total FROM memberships WHERE tenant_id=? AND status!='DISABLED'",
              )
              .get(context.tenant.id)
          ).total;
          await assertEntitlement(db, context.tenant.id, 'employees', count);
          let user = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
          if (user && user.kind !== 'TENANT')
            throw Object.assign(new Error('El email no está disponible para crear este acceso.'), {
              status: 409,
            });
          if (
            user &&
            (await db
              .prepare('SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=?')
              .get(context.tenant.id, user.id))
          )
            throw Object.assign(new Error('El empleado ya pertenece al taller.'), {
              status: 409,
            });
          if (
            user &&
            (await db
              .prepare('SELECT 1 FROM memberships WHERE user_id=? AND tenant_id<>?')
              .get(user.id, context.tenant.id))
          )
            throw Object.assign(new Error('El email ya está asociado a otro taller.'), {
              status: 409,
            });
          const userId = user?.id || id();
          if (!user)
            await db
              .prepare(
                'INSERT INTO users (id,email,password_hash,name,kind,created_at) VALUES (?,?,?,?,?,?)',
              )
              .run(
                userId,
                email,
                hashPassword(validPassword(input.password)),
                name,
                'TENANT',
                now(),
              );
          if (!user)
            await db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(userId);
          await db
            .prepare(
              'INSERT INTO memberships (id,tenant_id,user_id,branch_id,role_id,job_title,status,invited_at,joined_at) VALUES (?,?,?,?,?,?,?,?,?)',
            )
            .run(
              id(),
              context.tenant.id,
              userId,
              branch.id,
              role.id,
              input.jobTitle || null,
              'ACTIVE',
              now(),
              now(),
            );
          await audit(db, {
            tenantId: context.tenant.id,
            branchId: branch.id,
            actorUserId: context.user.user_id,
            action: 'EMPLOYEE_INVITED',
            entityType: 'user',
            entityId: userId,
            after: { email, roleId: role.id, branchId: branch.id },
          });

          return userId;
        },
        { lockKey: 'tenant:' + context.tenant.id },
      );
    } catch (error) {
      throw error;
    }
  });
}

export async function nextNumber(db, table, tenantId) {
  const allowed = new Set(['work_orders', 'workshop_invoices']);
  if (!allowed.has(table)) throw new Error('Secuencia inválida');
  return Number(
    (
      await db
        .prepare(`SELECT COALESCE(MAX(number),0)+1 value FROM ${table} WHERE tenant_id=?`)
        .get(tenantId)
    ).value,
  );
}

export async function createWorkOrder(db, context, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.create');
    const month = now().slice(0, 7);
    const count = (
      await db
        .prepare(
          'SELECT COUNT(*) total FROM work_orders WHERE tenant_id=? AND substr(created_at,1,7)=?',
        )
        .get(context.tenant.id, month)
    ).total;
    await assertEntitlement(db, context.tenant.id, 'orders_monthly', count);
    const customer = await db
      .prepare('SELECT id FROM customers WHERE id=? AND tenant_id=?')
      .get(input.customerId, context.tenant.id);
    const vehicle = await db
      .prepare('SELECT id FROM vehicles WHERE id=? AND customer_id=? AND tenant_id=?')
      .get(input.vehicleId, input.customerId, context.tenant.id);
    const branch = await db
      .prepare('SELECT id FROM branches WHERE id=? AND tenant_id=?')
      .get(input.branchId, context.tenant.id);
    if (!customer || !vehicle || !branch)
      throw Object.assign(new Error('Cliente, vehículo o sucursal inválidos.'), { status: 422 });
    const orderId = id(),
      created = now(),
      taxRate = Number(
        (
          await db
            .prepare('SELECT tax_rate FROM tenant_settings WHERE tenant_id=?')
            .get(context.tenant.id)
        )?.tax_rate || 0,
      );
    const subtotal = asNumber(input.amount),
      tax = (subtotal * taxRate) / 100;
    await db
      .prepare(
        `INSERT INTO work_orders (id,tenant_id,branch_id,customer_id,vehicle_id,number,status,complaint,diagnosis,notes,subtotal,tax,total,promised_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        orderId,
        context.tenant.id,
        branch.id,
        customer.id,
        vehicle.id,
        await nextNumber(db, 'work_orders', context.tenant.id),
        'RECEIVED',
        input.complaint || null,
        input.diagnosis || null,
        input.notes || null,
        subtotal,
        tax,
        subtotal + tax,
        input.promisedAt || null,
        context.user.user_id,
        created,
      );
    if (input.description || subtotal)
      await db
        .prepare(
          'INSERT INTO work_order_items (id,tenant_id,work_order_id,item_type,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          id(),
          context.tenant.id,
          orderId,
          'SERVICE',
          input.description || 'Servicio',
          1,
          subtotal,
          subtotal,
        );
    await audit(db, {
      tenantId: context.tenant.id,
      actorUserId: context.user.user_id,
      action: 'WORK_ORDER_CREATED',
      entityType: 'work_order',
      entityId: orderId,
    });
    await touchTenant(db, context.tenant.id);
    return orderId;
  });
}
