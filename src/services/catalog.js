import { audit } from '../domain.js';
import {
  withTenantWrite,
  assertPermission,
  assertTenantWritable,
  assertEntitlement,
  can,
} from '../tenancy.js';
import { required, optional, email, integer, positive } from '../validation.js';
import { AppError } from '../errors.js';
import { moneyAmount, tenantCurrency } from '../money.js';

export const catalogs = {
  customers: {
    table: 'customers',
    title: 'Clientes',
    permission: 'customers.update',
    create: 'customers.create',
    fields: [
      ['name', 'Nombre', 'text', true],
      ['document', 'Documento / RUC'],
      ['phone', 'Teléfono', 'tel'],
      ['email', 'Email', 'email'],
      ['address', 'Dirección'],
      ['notes', 'Notas', 'textarea'],
    ],
  },
  vehicles: {
    table: 'vehicles',
    title: 'Vehículos',
    permission: 'vehicles.update',
    create: 'vehicles.create',
    fields: [
      ['customer_id', 'Cliente', 'customers', true],
      ['plate', 'Matrícula', 'text', true],
      ['make', 'Marca'],
      ['model', 'Modelo'],
      ['year', 'Año', 'number'],
      ['vin', 'VIN / Chasis'],
      ['color', 'Color'],
      ['odometer', 'Kilometraje', 'number'],
    ],
  },
  services: {
    table: 'services',
    title: 'Servicios',
    permission: 'settings.manage',
    create: 'settings.manage',
    fields: [
      ['name', 'Servicio', 'text', true],
      ['description', 'Descripción', 'textarea'],
      ['price', 'Precio', 'number', true],
      ['duration_minutes', 'Duración (minutos)', 'number', true],
    ],
  },
  suppliers: {
    table: 'suppliers',
    title: 'Proveedores',
    permission: 'purchases.manage',
    create: 'purchases.manage',
    fields: [
      ['name', 'Proveedor', 'text', true],
      ['tax_id', 'Documento / RUC'],
      ['phone', 'Teléfono', 'tel'],
      ['email', 'Email', 'email'],
      ['address', 'Dirección'],
    ],
  },
  branches: {
    table: 'branches',
    title: 'Sucursales',
    permission: 'branches.manage',
    create: 'branches.manage',
    fields: [
      ['name', 'Sucursal', 'text', true],
      ['phone', 'Teléfono', 'tel'],
      ['address', 'Dirección'],
      ['city', 'Ciudad'],
    ],
  },
  inventory: {
    table: 'inventory_items',
    title: 'Inventario',
    permission: 'inventory.adjust',
    create: 'inventory.adjust',
    fields: [
      ['name', 'Artículo', 'text', true],
      ['sku', 'SKU'],
      ['minimum_stock', 'Stock mínimo', 'number'],
      ['cost', 'Costo unitario', 'number'],
      ['sale_price', 'Precio de venta', 'number'],
    ],
  },
};
export async function catalogRecord(db, context, kind, recordId) {
  const definition = catalogs[kind];
  if (!definition) throw new AppError('Sección no encontrada.', { status: 404 });
  const record = await db
    .prepare(`SELECT * FROM ${definition.table} WHERE id=? AND tenant_id=?`)
    .get(recordId, context.tenant.id);
  if (!record) throw new AppError('Registro no encontrado.', { status: 404 });
  return record;
}
export async function updateCatalog(db, context, kind, recordId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    const definition = catalogs[kind];
    if (!definition) throw new AppError('Sección no encontrada.', { status: 404 });
    assertPermission(context, definition.permission);
    assertTenantWritable(context);
    const record = await catalogRecord(db, context, kind, recordId),
      values = {};
    for (const [name, label, type, mandatory] of definition.fields) {
      if (kind === 'inventory' && name === 'cost' && !can(context, 'inventory.cost')) {
        if (input[name] !== undefined) assertPermission(context, 'inventory.cost');
        continue;
      }
      const value = input[name];
      if (type === 'number')
        values[name] = ['year', 'odometer', 'duration_minutes'].includes(name)
          ? name === 'year' && !value
            ? null
            : integer(value, label, {
                min: name === 'duration_minutes' ? 1 : name === 'year' ? 1886 : 0,
                max: name === 'year' ? new Date().getFullYear() + 1 : 10000000,
              })
          : ['cost', 'sale_price', 'price'].includes(name)
            ? moneyAmount(value || 0, await tenantCurrency(db, context.tenant.id), label, {
                allowZero: true,
              })
            : positive(value || 0, label, { allowZero: true });
      else if (type === 'email') values[name] = value ? email(value) : null;
      else
        values[name] = mandatory
          ? required(value, label, { max: 200 })
          : optional(value, { max: type === 'textarea' ? 3000 : 500 });
    }
    if (kind === 'vehicles') {
      if (
        !(await db
          .prepare('SELECT 1 FROM customers WHERE id=? AND tenant_id=? AND active=1')
          .get(values.customer_id, context.tenant.id))
      )
        throw new AppError('Selecciona un cliente activo del taller.', { status: 422 });
      if (values.odometer < record.odometer)
        throw new AppError('El kilometraje no puede disminuir respecto del historial.', {
          status: 422,
        });
      if (
        values.customer_id !== record.customer_id &&
        (await db
          .prepare(
            "SELECT 1 FROM work_orders WHERE vehicle_id=? AND tenant_id=? AND status NOT IN ('DELIVERED','CLOSED','CANCELED')",
          )
          .get(record.id, context.tenant.id))
      )
        throw new AppError(
          'Finaliza las órdenes abiertas antes de transferir el vehículo a otro cliente.',
          { status: 409 },
        );
      values.plate = values.plate.toUpperCase();
    }

    try {
      await db.transaction(
        async () => {
          await db
            .prepare(
              `UPDATE ${definition.table} SET ${Object.keys(values)
                .map((name) => name + '=?')
                .join(',')} WHERE id=? AND tenant_id=?`,
            )
            .run(...Object.values(values), record.id, context.tenant.id);
          await audit(db, {
            ...meta,
            tenantId: context.tenant.id,
            actorUserId: context.user.user_id,
            action: 'CATALOG_UPDATED',
            entityType: definition.table,
            entityId: record.id,
            before: Object.fromEntries(Object.keys(values).map((key) => [key, record[key]])),
            after: values,
          });
        },
        { lockKey: 'tenant:' + context.tenant.id },
      );
    } catch (error) {
      throw error;
    }
  });
}
export async function archiveCatalog(db, context, kind, recordId, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    const definition = catalogs[kind];
    if (!definition) throw new AppError('Sección no encontrada.', { status: 404 });
    assertPermission(context, kind === 'customers' ? 'customers.delete' : definition.permission);
    assertTenantWritable(context);
    const row = await catalogRecord(db, context, kind, recordId);
    if (row.active === 0) throw new AppError('El registro ya está archivado.', { status: 409 });
    if (
      kind === 'branches' &&
      (row.is_main ||
        (await db
          .prepare("SELECT 1 FROM memberships WHERE branch_id=? AND status='ACTIVE'")
          .get(row.id)))
    )
      throw new AppError('La sucursal principal o con empleados activos no puede archivarse.', {
        status: 409,
      });
    if (['customers', 'vehicles', 'branches'].includes(kind)) {
      const key = { customers: 'customer_id', vehicles: 'vehicle_id', branches: 'branch_id' }[kind];
      if (
        await db
          .prepare(
            `SELECT 1 FROM work_orders WHERE tenant_id=? AND ${key}=? AND status NOT IN ('DELIVERED','CLOSED','CANCELED')`,
          )
          .get(context.tenant.id, row.id)
      )
        throw new AppError('Finaliza las órdenes abiertas antes de archivar este registro.', {
          status: 409,
        });
      if (
        await db
          .prepare(
            `SELECT 1 FROM appointments WHERE tenant_id=? AND ${key}=? AND status='SCHEDULED'`,
          )
          .get(context.tenant.id, row.id)
      )
        throw new AppError(
          'Reprograma o cancela los turnos pendientes antes de archivar este registro.',
          { status: 409 },
        );
    }
    if (
      kind === 'branches' &&
      (await db
        .prepare('SELECT 1 FROM inventory_items WHERE tenant_id=? AND branch_id=? AND quantity<>0')
        .get(context.tenant.id, row.id))
    )
      throw new AppError('Transfiere o regulariza las existencias antes de archivar la sucursal.', {
        status: 409,
      });
    if (
      kind === 'inventory' &&
      (Number(row.quantity) !== 0 ||
        (await db
          .prepare(
            "SELECT 1 FROM stock_reservations WHERE inventory_item_id=? AND tenant_id=? AND status='ACTIVE'",
          )
          .get(row.id, context.tenant.id)))
    )
      throw new AppError(
        'El artículo tiene existencias o reservas. Regulariza el inventario antes de archivarlo.',
        { status: 409 },
      );

    try {
      await db.transaction(
        async () => {
          await db
            .prepare(`UPDATE ${definition.table} SET active=0 WHERE id=? AND tenant_id=?`)
            .run(row.id, context.tenant.id);
          await audit(db, {
            ...meta,
            tenantId: context.tenant.id,
            actorUserId: context.user.user_id,
            action: 'CATALOG_ARCHIVED',
            entityType: definition.table,
            entityId: row.id,
            before: { active: 1 },
            after: { active: 0 },
          });
        },
        { lockKey: 'tenant:' + context.tenant.id },
      );
    } catch (error) {
      throw error;
    }
  });
}

export async function restoreCatalog(db, context, kind, recordId) {
  return await withTenantWrite(db, context, async (context) => {
    const definition = catalogs[kind];
    if (!definition) throw new AppError('Sección no encontrada.', { status: 404 });
    assertPermission(context, definition.permission);
    assertTenantWritable(context);

    try {
      await db.transaction(
        async () => {
          const row = await catalogRecord(db, context, kind, recordId);
          if (row.active) throw new AppError('El registro ya está activo.', { status: 409 });
          if (kind === 'branches')
            await assertEntitlement(
              db,
              context.tenant.id,
              'branches',
              (
                await db
                  .prepare('SELECT COUNT(*) n FROM branches WHERE tenant_id=? AND active=1')
                  .get(context.tenant.id)
              ).n,
            );
          await db
            .prepare(`UPDATE ${definition.table} SET active=1 WHERE id=? AND tenant_id=?`)
            .run(row.id, context.tenant.id);
          await audit(db, {
            tenantId: context.tenant.id,
            actorUserId: context.user.user_id,
            action: 'CATALOG_RESTORED',
            entityType: definition.table,
            entityId: row.id,
            before: { active: 0 },
            after: { active: 1 },
          });
        },
        { lockKey: 'tenant:' + context.tenant.id },
      );
    } catch (error) {
      throw error;
    }
  });
}
