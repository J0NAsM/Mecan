import {
  withTenantWrite,
  assertPermission,
  assertTenantWritable,
  assertEntitlement,
  can,
} from '../tenancy.js';
import { required, optional, email, integer, positive } from '../validation.js';
import { currencyCode } from '../money.js';
import { AppError } from '../errors.js';
import { audit } from '../domain.js';
import { now } from '../utils.js';
import { PERMISSIONS } from '../permissions.js';

const transaction = async (db, fn) => {
  try {
    return await db.transaction(async () => {
      const result = await fn();

      return result;
    }, {});
  } catch (error) {
    throw error;
  }
};
export async function updateRole(db, context, roleId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'employees.manage');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const role = await db
        .prepare("SELECT * FROM roles WHERE id=? AND tenant_id=? AND code<>'OWNER'")
        .get(roleId, context.tenant.id);
      if (!role) throw new AppError('Rol editable no encontrado.', { status: 404 });
      if (JSON.parse(role.permissions).some((p) => !can(context, p)))
        throw new AppError('No puedes editar un rol con permisos superiores a los tuyos.', {
          status: 403,
        });
      const selected = PERMISSIONS.map(([code]) => code).filter((code) => input['perm_' + code]);
      if (selected.some((p) => !can(context, p)))
        throw new AppError('No puedes conceder permisos que no tienes.', { status: 403 });
      await db
        .prepare('UPDATE roles SET name=?,permissions=? WHERE id=? AND tenant_id=?')
        .run(
          required(input.name, 'El nombre del rol', { max: 100 }),
          JSON.stringify(selected),
          role.id,
          context.tenant.id,
        );
      await db
        .prepare(
          'DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM memberships WHERE tenant_id=? AND role_id=?)',
        )
        .run(context.tenant.id, role.id);
      await audit(db, {
        tenantId: context.tenant.id,
        actorUserId: context.user.user_id,
        action: 'ROLE_UPDATED',
        entityType: 'role',
        entityId: role.id,
        before: { name: role.name, permissions: JSON.parse(role.permissions) },
        after: { name: input.name, permissions: selected },
      });
    });
  });
}
export async function configureWorkshop(db, context, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'settings.manage');
    assertTenantWritable(context);
    const currency = currencyCode(input.currency),
      tax = positive(input.taxRate, 'El impuesto', { allowZero: true, max: 100 }),
      timezone = required(input.timezone || 'America/Asuncion', 'La zona horaria');
    try {
      new Intl.DateTimeFormat('es', { timeZone: timezone });
    } catch {
      throw new AppError('La zona horaria no es válida.');
    }
    if (input.logoUrl) {
      try {
        const url = new URL(input.logoUrl);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      } catch {
        throw new AppError('El logo debe tener una URL HTTPS válida y sin credenciales.');
      }
    }
    const color = input.primaryColor || '#0f766e';
    if (!/^#[\da-f]{6}$/i.test(color)) throw new AppError('Selecciona un color válido.');
    return await transaction(db, async () => {
      const previous = await db
        .prepare('SELECT * FROM tenant_settings WHERE tenant_id=?')
        .get(context.tenant.id);
      const tenant = await db.prepare('SELECT * FROM tenants WHERE id=?').get(context.tenant.id);
      const supplied = (inputKey, column, max) =>
        input[inputKey] === undefined ? tenant[column] : optional(input[inputKey], { max });
      if (input.name !== undefined)
        await db
          .prepare('UPDATE tenants SET name=?,email=? WHERE id=?')
          .run(
            required(input.name, 'El nombre comercial', { max: 180 }),
            email(input.email),
            context.tenant.id,
          );
      if (input.documentHeader !== undefined)
        await db
          .prepare(
            'UPDATE tenant_settings SET document_header=?,document_footer=? WHERE tenant_id=?',
          )
          .run(
            optional(input.documentHeader, { max: 3000 }),
            optional(input.documentFooter, { max: 3000 }),
            context.tenant.id,
          );
      if (
        currency !== previous.currency &&
        (await db
          .prepare(
            'SELECT 1 FROM work_orders WHERE tenant_id=? UNION SELECT 1 FROM inventory_items WHERE tenant_id=? LIMIT 1',
          )
          .get(context.tenant.id, context.tenant.id))
      )
        throw new AppError(
          'No se puede cambiar la moneda cuando ya existen operaciones o existencias. No se realiza una conversión automática.',
          { status: 409 },
        );
      await db
        .prepare(
          'UPDATE tenants SET legal_name=?,tax_id=?,phone=?,address=?,city=?,logo_url=?,primary_color=?,onboarding_step=10 WHERE id=?',
        )
        .run(
          supplied('legalName', 'legal_name', 180),
          supplied('taxId', 'tax_id', 80),
          supplied('phone', 'phone', 60),
          supplied('address', 'address', 500),
          supplied('city', 'city', 150),
          supplied('logoUrl', 'logo_url', 1000),
          input.primaryColor === undefined ? tenant.primary_color : color,
          context.tenant.id,
        );
      await db
        .prepare(
          'UPDATE tenant_settings SET currency=?,tax_rate=?,timezone=?,opening_hours=?,warranty_days=?,warranty_terms=?,updated_at=? WHERE tenant_id=?',
        )
        .run(
          currency,
          tax,
          timezone,
          input.openingHours === undefined
            ? previous.opening_hours
            : JSON.stringify({ weekdays: optional(input.openingHours, { max: 500 }) }),
          integer(input.warrantyDays ?? previous.warranty_days, 'La garantía', {
            min: 0,
            max: 3650,
          }),
          required(input.warrantyTerms ?? previous.warranty_terms, 'Las condiciones de garantía', {
            max: 3000,
          }),
          now(),
          context.tenant.id,
        );
      await audit(db, {
        tenantId: context.tenant.id,
        actorUserId: context.user.user_id,
        action: 'WORKSHOP_CONFIGURED',
        entityType: 'tenant_settings',
        entityId: context.tenant.id,
        before: previous,
        after: { currency, tax, timezone, warrantyDays: input.warrantyDays },
      });
    });
  });
}
export async function updateEmployee(db, context, membershipId, input) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'employees.manage');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const membership = await db
        .prepare(
          'SELECT m.*,r.code,r.permissions FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.id=? AND m.tenant_id=?',
        )
        .get(membershipId, context.tenant.id);
      if (!membership) throw new AppError('Empleado no encontrado.', { status: 404 });
      if (membership.code === 'OWNER' || membership.user_id === context.user.user_id)
        throw new AppError('No puedes modificar aquí al propietario ni tus propios permisos.', {
          status: 403,
        });
      if (JSON.parse(membership.permissions).some((p) => !can(context, p)))
        throw new AppError(
          'No puedes administrar a un empleado con permisos superiores a los tuyos.',
          { status: 403 },
        );
      const role = await db
        .prepare("SELECT * FROM roles WHERE id=? AND tenant_id=? AND code<>'OWNER'")
        .get(input.roleId, context.tenant.id);
      if (!role || JSON.parse(role.permissions).some((p) => !can(context, p)))
        throw new AppError('No puedes asignar ese rol.', { status: 403 });
      const branch = await db
        .prepare('SELECT id FROM branches WHERE id=? AND tenant_id=? AND active=1')
        .get(input.branchId, context.tenant.id);
      if (!branch) throw new AppError('Selecciona una sucursal activa del taller.');
      await db
        .prepare('UPDATE users SET name=? WHERE id=?')
        .run(required(input.name, 'El nombre', { max: 150 }), membership.user_id);
      await db
        .prepare(
          'UPDATE memberships SET branch_id=?,role_id=?,job_title=? WHERE id=? AND tenant_id=?',
        )
        .run(
          branch.id,
          role.id,
          optional(input.jobTitle, { max: 150 }),
          membership.id,
          context.tenant.id,
        );
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(membership.user_id);
      await audit(db, {
        tenantId: context.tenant.id,
        actorUserId: context.user.user_id,
        action: 'EMPLOYEE_UPDATED',
        entityType: 'membership',
        entityId: membership.id,
        before: { branch: membership.branch_id, role: membership.role_id },
        after: { branch: branch.id, role: role.id },
      });
    });
  });
}
export async function toggleEmployee(db, context, membershipId) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'employees.manage');
    assertTenantWritable(context);
    return await transaction(db, async () => {
      const membership = await db
        .prepare(
          'SELECT m.*,r.code,r.permissions FROM memberships m JOIN roles r ON r.id=m.role_id WHERE m.id=? AND m.tenant_id=?',
        )
        .get(membershipId, context.tenant.id);
      if (!membership) throw new AppError('Empleado no encontrado.', { status: 404 });
      if (
        membership.user_id === context.user.user_id ||
        membership.code === 'OWNER' ||
        JSON.parse(membership.permissions).some((p) => !can(context, p))
      )
        throw new AppError('No puedes cambiar este acceso.', { status: 403 });
      const status = membership.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      if (status === 'ACTIVE')
        await assertEntitlement(
          db,
          context.tenant.id,
          'employees',
          (
            await db
              .prepare(
                "SELECT COUNT(*) n FROM memberships WHERE tenant_id=? AND status<>'DISABLED'",
              )
              .get(context.tenant.id)
          ).n,
        );
      await db
        .prepare('UPDATE memberships SET status=? WHERE id=? AND tenant_id=?')
        .run(status, membership.id, context.tenant.id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(membership.user_id);
      await audit(db, {
        tenantId: context.tenant.id,
        actorUserId: context.user.user_id,
        action: 'EMPLOYEE_' + status,
        entityType: 'membership',
        entityId: membership.id,
        before: { status: membership.status },
        after: { status },
      });
    });
  });
}
