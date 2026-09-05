import { id, now, addDays, addMonths } from './utils.js';
import { hashPassword } from './auth.js';
import {
  MANAGER_PERMISSIONS,
  TECHNICIAN_PERMISSIONS,
  RECEPTION_PERMISSIONS,
  CASHIER_PERMISSIONS,
  INVENTORY_PERMISSIONS,
} from './permissions.js';

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

export async function seedDatabase(db, options = {}) {
  return await db.transaction(
    async () => {
      const created = now();
      const insertFeature = db.prepare(
        'INSERT INTO features (id,code,name,description,kind) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING',
      );
      for (const feature of baseFeatures) await insertFeature.run(`feat-${feature[0]}`, ...feature);
      const plans = [
        [
          'plan-basic',
          'basic',
          'Esencial',
          'Para talleres que están comenzando',
          149000,
          'PYG',
          1,
          1,
        ],
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
        'INSERT INTO plans (id,code,name,description,price_monthly,currency,active,public,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      );
      for (const plan of plans) await insertPlan.run(...plan, created);
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
        db.prepare(`INSERT INTO plan_features (plan_id,feature_id,enabled,limit_value)
    VALUES (?,?,?,?) ON CONFLICT DO NOTHING`);
      for (const [planId, entries] of Object.entries(limits))
        for (const [code, value] of Object.entries(entries)) {
          const feature = await db.prepare('SELECT id,kind FROM features WHERE code=?').get(code);
          await upsertCapability.run(
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
        'INSERT INTO platform_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT DO NOTHING',
      );
      for (const [key, value] of Object.entries(settings)) await set.run(key, value, created);
      const defaultRoles = [
        ['MANAGER', 'Gerencia', MANAGER_PERMISSIONS],
        ['RECEPTION', 'Recepción', RECEPTION_PERMISSIONS],
        ['TECHNICIAN', 'Mecánico', TECHNICIAN_PERMISSIONS],
        ['CASHIER', 'Caja', CASHIER_PERMISSIONS],
        ['INVENTORY', 'Inventario', INVENTORY_PERMISSIONS],
      ];
      for (const tenant of await db.prepare('SELECT id FROM tenants').all())
        for (const [code, name, rolePermissions] of defaultRoles)
          await db
            .prepare(
              'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1) ON CONFLICT DO NOTHING',
            )
            .run(id(), tenant.id, code, name, JSON.stringify(rolePermissions));

      const adminEmail = (options.superadminEmail || 'admin@mecan.local').toLowerCase();
      if (
        !(await db
          .prepare("SELECT id FROM users WHERE kind='PLATFORM' AND platform_role='SUPER_ADMIN'")
          .get())
      ) {
        await db
          .prepare(
            'INSERT INTO users (id,email,password_hash,name,kind,platform_role,created_at) VALUES (?,?,?,?,?,?,?)',
          )
          .run(
            'user-platform-admin',
            adminEmail,
            hashPassword(options.superadminPassword || 'Admin123!'),
            'Administrador de plataforma',
            'PLATFORM',
            'SUPER_ADMIN',
            created,
          );
      }
    },
    { lockKey: 'platform:seed' },
  );
}

export async function seedDemoTenant(db) {
  return await db.transaction(
    async () => {
      if (await db.prepare("SELECT id FROM tenants WHERE slug='taller-demo'").get()) return;
      const created = now();

      try {
        await db.transaction(
          async () => {
            await db
              .prepare(
                `INSERT INTO tenants (id,slug,name,legal_name,owner_name,tax_id,phone,email,address,country,city,status,onboarding_step,last_activity_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
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
            await db
              .prepare(
                'INSERT INTO tenant_settings (tenant_id,currency,tax_rate,opening_hours,onboarding_data,updated_at) VALUES (?,?,?,?,?,?)',
              )
              .run(
                'tenant-demo',
                'PYG',
                10,
                JSON.stringify({ weekdays: '07:30–18:00' }),
                JSON.stringify({ services: true, employees: true }),
                created,
              );
            await db
              .prepare(
                'INSERT INTO branches (id,tenant_id,name,phone,address,city,active,is_main,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
              )
              .run(
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
            await db
              .prepare(
                'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,?)',
              )
              .run(
                'role-demo-owner',
                'tenant-demo',
                'OWNER',
                'Propietario',
                JSON.stringify(['*']),
                1,
              );
            for (const [code, name, rolePermissions] of [
              ['MANAGER', 'Gerencia', MANAGER_PERMISSIONS],
              ['RECEPTION', 'Recepción', RECEPTION_PERMISSIONS],
              ['TECHNICIAN', 'Mecánico', TECHNICIAN_PERMISSIONS],
              ['CASHIER', 'Caja', CASHIER_PERMISSIONS],
              ['INVENTORY', 'Inventario', INVENTORY_PERMISSIONS],
            ])
              await db
                .prepare(
                  'INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,1)',
                )
                .run(id(), 'tenant-demo', code, name, JSON.stringify(rolePermissions));
            await db
              .prepare(
                'INSERT INTO users (id,email,password_hash,name,kind,created_at) VALUES (?,?,?,?,?,?)',
              )
              .run(
                'user-demo-owner',
                'dueno@demo.local',
                hashPassword('Demo123!'),
                'María Benítez',
                'TENANT',
                created,
              );
            await db
              .prepare(
                'INSERT INTO memberships (id,tenant_id,user_id,branch_id,role_id,job_title,status,joined_at) VALUES (?,?,?,?,?,?,?,?)',
              )
              .run(
                id(),
                'tenant-demo',
                'user-demo-owner',
                'branch-demo',
                'role-demo-owner',
                'Propietaria',
                'ACTIVE',
                created,
              );
            await db
              .prepare(
                `INSERT INTO subscriptions (id,tenant_id,plan_id,billing_cycle,price,currency,started_at,next_charge_at,status,auto_renew,grace_until,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(
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
            await db
              .prepare(
                'INSERT INTO trials (id,tenant_id,plan_id,starts_at,ends_at,active) VALUES (?,?,?,?,?,1)',
              )
              .run(id(), 'tenant-demo', 'plan-pro', created, addDays(created, 14));
            await db
              .prepare(
                'INSERT INTO services (id,tenant_id,name,description,price,duration_minutes,created_at) VALUES (?,?,?,?,?,?,?)',
              )
              .run(id(), 'tenant-demo', 'Cambio de aceite', 'Aceite y filtro', 180000, 60, created);
            await db
              .prepare(
                'INSERT INTO customers (id,tenant_id,branch_id,name,document,phone,email,created_at) VALUES (?,?,?,?,?,?,?,?)',
              )
              .run(
                'customer-demo',
                'tenant-demo',
                'branch-demo',
                'Carlos Gómez',
                '4567890',
                '0971555123',
                'carlos@example.com',
                created,
              );
            await db
              .prepare(
                'INSERT INTO vehicles (id,tenant_id,customer_id,plate,make,model,year,color,odometer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
              )
              .run(
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
            await db
              .prepare(
                'INSERT INTO audit_logs (id,scope,tenant_id,actor_user_id,action,entity_type,entity_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
              )
              .run(
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
          },
          { lockKey: 'tenant:tenant-demo' },
        );
      } catch (error) {
        throw error;
      }
    },
    { lockKey: 'tenant:tenant-demo' },
  );
}

export async function resetExpiredSessions(db) {
  await db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
}
