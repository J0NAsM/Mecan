import http from 'node:http';
import { pagedRows } from './pagination.js';
import { currencyCode, moneyAmount, tenantCurrency } from './money.js';
import fs from 'node:fs';
import path from 'node:path';
import { config, validateProductionConfig } from './config.js';
import { postgresReadinessIssues } from './postgres/readiness.js';
import { releaseGet, releasePost } from './routes/release.js';
import { mobileGet } from './routes/mobile.js';
import { legalDocument } from './legal.js';
import { catalogActions } from './pages/catalog.js';
import { configureUi, withUiSettings } from './ui.js';
import { spawn } from 'node:child_process';
import {
  databaseEngine,
  openDatabase,
  seedDatabase,
  seedDemoTenant,
  resetExpiredSessions,
} from './db.js';
import {
  parseCookies,
  readSession,
  verifyPassword,
  createSession,
  sessionCookie,
  clearSessionCookie,
  hashPassword,
  createPasswordReset,
  consumePasswordReset,
} from './auth.js';
import {
  resolveContext,
  assertPermission,
  assertTenantWritable,
  assertEntitlement,
  entitlement,
  can,
} from './tenancy.js';
import { provisionWorkshop, createBranch, createEmployee, audit } from './domain.js';
import {
  refreshSubscriptionStates,
  recordManualPayment,
  changeSubscription,
  setTenantStatus,
  platformMetrics,
  billingRows,
  platformSetting,
} from './billing.js';
import { tenantDateTime, calendarDate, startOfLocalDate } from './time.js';
import { id, now, asNumber, safeNext, csvCell } from './utils.js';
import {
  layout,
  esc,
  money,
  shortDate,
  badge,
  label,
  field,
  textarea,
  select,
  csrfInput,
  pageHead,
  card,
  empty,
  dataTable,
  formCard,
  metricGrid,
  publicHome,
  pricingPage,
  featuresPage,
  faqPage,
  authPage,
} from './ui.js';
import { PERMISSIONS } from './permissions.js';
import {
  orderDetailPage,
  myWorkPage,
  purchasesPage,
  globalSearchPage,
  reportsPage,
  reportPeriod,
} from './pages/workshop-operations.js';
import { customerDetailPage, vehicleDetailPage } from './pages/customer-360.js';
import { ORDER_LABELS } from './workflow.js';
import { publicError, AppError } from './errors.js';
import { logger, requestId } from './logger.js';
import {
  assertRequestRate,
  assertLoginAllowed,
  recordLoginAttempt,
  detectFileType,
  safeUploadName,
  opaqueHash,
} from './security.js';
import {
  queueNotification,
  markNotificationRead,
  notificationsForContext,
} from './notifications.js';
import { processNotificationQueue } from './notification-delivery.js';
import { required, optional, email as validEmail, positive, integer, oneOf } from './validation.js';
import {
  receiveVehicle,
  completeInspection,
  completeDiagnosis,
  addEstimateItem,
  sendEstimate,
  approveEstimate,
  assignTechnician,
  updateAssignment,
  consumePart,
  requestPart,
  sendToQuality,
  recordQualityCheck,
  invoiceOrder,
  recordCustomerPayment,
  deliverVehicle,
  createPurchaseOrder,
  receivePurchaseOrder,
  paySupplier,
  voidInvoice,
  cancelOrder,
} from './services/workshop-operations.js';

validateProductionConfig();
export const db = await openDatabase();
await seedDatabase(db, config);
if (config.seedDemo) await seedDemoTenant(db);
if (config.production) {
  const issues = await postgresReadinessIssues(db);
  if (issues.length) {
    await db.close();
    throw new Error('Base no apta para producción: ' + issues.join('; '));
  }
}

// Una contraseña de administrador adivinable es un descuido tolerable mientras el sistema solo
// escucha en la red local, y una puerta abierta apenas se publica. APP_URL en HTTPS significa que
// se está publicando —es lo que exige el túnel—, así que ahí se comprueba antes de aceptar visitas.
// El rechazo dejaría sin poder entrar justamente a cambiarla, por eso ALLOW_WEAK_ADMIN lo omite.
if (config.secureTransport && process.env.ALLOW_WEAK_ADMIN !== 'true') {
  const superadmin = await db
    .prepare(
      "SELECT password_hash FROM users WHERE kind='PLATFORM' AND platform_role='SUPER_ADMIN'",
    )
    .get();
  const obvias = ['Admin', 'admin', 'Admin123!', 'Admin123', 'admin123', 'password', '123456'];
  const debil =
    superadmin && obvias.find((clave) => verifyPassword(clave, superadmin.password_hash));
  if (debil) {
    await db.close();
    throw new Error(
      `La cuenta de administrador tiene la contraseña «${debil}» y APP_URL es pública ` +
        `(${config.appUrl}): publicarla así es dejarla abierta. Cambiala desde el sistema, o ` +
        'arrancá con ALLOW_WEAK_ADMIN=true para poder entrar a cambiarla.',
    );
  }
}
await resetExpiredSessions(db);
await refreshSubscriptionStates(db);
setInterval(async () => {
  try {
    await refreshSubscriptionStates(db);
  } catch (error) {
    logger.error('subscription_worker_failed', { error: error.message });
  }
}, 60 * 1000).unref();
setInterval(
  () =>
    resetExpiredSessions(db).catch((error) =>
      logger.error('session_worker_failed', { code: error.code }),
    ),
  60 * 60 * 1000,
).unref();
setInterval(
  async () =>
    processNotificationQueue(db, config).catch((error) =>
      logger.error('notification_worker_failed', { error: error.message }),
    ),
  60 * 1000,
).unref();
let backupRunning = false;
if (config.production && config.backupIntervalHours > 0)
  setInterval(() => {
    if (backupRunning) return;
    backupRunning = true;
    const child = spawn(process.execPath, ['scripts/postgres-backup.js'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.resume();
    child.once('error', () => {
      backupRunning = false;
      logger.error('backup_failed', { reason: 'No se pudo iniciar el respaldo' });
    });
    child.once('exit', (code) => {
      backupRunning = false;
      (code === 0 ? logger.info : logger.error)('backup_finished', { success: code === 0 });
    });
  }, config.backupIntervalHours * 3600000).unref();

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};
const permissions = PERMISSIONS.map(([code, name]) => [code, name]);
const dummyPasswordHash = hashPassword('TimingOnly123!');

function headers(type = 'text/html; charset=utf-8') {
  const values = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'private, no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: https:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
  if (config.secureTransport)
    values['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return values;
}
function send(res, status, body, type) {
  res.writeHead(status, headers(type));
  res.end(body);
}
function redirect(res, location, cookie = null) {
  const h = { Location: location, ...headers() };
  if (cookie) h['Set-Cookie'] = cookie;
  res.writeHead(303, h);
  res.end();
}
function withMessage(pathname, message, type = 'ok') {
  const sep = pathname.includes('?') ? '&' : '?';
  return `${pathname}${sep}${type}=${encodeURIComponent(message)}`;
}
function match(pattern, pathname) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((part) =>
      part.startsWith(':')
        ? (keys.push(part.slice(1)), '([^/]+)')
        : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  const found = pathname.match(new RegExp(`^${source}$`));
  if (!found) return null;
  return Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(found[index + 1])]));
}
async function body(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 10_000_000)
      throw Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      throw Object.assign(new Error('El contenido enviado no es válido.'), { status: 400 });
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}
function flash(url) {
  return url.searchParams.get('error')
    ? { type: 'error', message: url.searchParams.get('error') }
    : url.searchParams.get('ok')
      ? { type: 'ok', message: url.searchParams.get('ok') }
      : null;
}
function render(res, title, content, req, url, area = 'public') {
  send(
    res,
    200,
    layout({
      title,
      body: content,
      context: req.context,
      area,
      csrf: req.session?.csrf_token || '',
      path: url.pathname,
      flash: flash(url),
    }),
  );
}
function guestCsrf(req) {
  return parseCookies(req.headers.cookie).mecan_guest_csrf || id().replaceAll('-', '');
}
function guestCookie(token) {
  return `mecan_guest_csrf=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${config.secureTransport ? '; Secure' : ''}`;
}
function renderGuest(res, title, content, req, url, token) {
  res.writeHead(200, { ...headers(), 'Set-Cookie': guestCookie(token) });
  res.end(
    layout({
      title,
      body: content,
      context: req.context,
      area: 'public',
      path: url.pathname,
      flash: flash(url),
    }),
  );
}
function checkGuestCsrf(req, data) {
  const cookie = parseCookies(req.headers.cookie).mecan_guest_csrf;
  if (!cookie || !data.guestCsrf || cookie !== data.guestCsrf)
    throw Object.assign(new Error('La página expiró. Recárgala e intenta nuevamente.'), {
      status: 403,
    });
}
function requireAuth(req) {
  if (!req.session) throw Object.assign(new Error('AUTH'), { status: 401 });
}
function requireWorkshop(req) {
  requireAuth(req);
  if (!req.context?.tenant)
    throw Object.assign(new Error('No hay taller asociado a la sesión.'), { status: 403 });
}
function requirePlatform(req) {
  requireAuth(req);
  if (req.session.kind !== 'PLATFORM' || req.session.platform_role !== 'SUPER_ADMIN')
    throw Object.assign(new Error('Acceso reservado al equipo de plataforma.'), { status: 403 });
}
function checkCsrf(req, data) {
  if (!req.session || !data.csrf || data.csrf !== req.session.csrf_token)
    throw Object.assign(new Error('La sesión del formulario expiró. Recargue la página.'), {
      status: 403,
    });
}
function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}
function refererPath(req, fallback) {
  try {
    return req.headers.referer ? new URL(req.headers.referer, config.appUrl).pathname : fallback;
  } catch {
    return fallback;
  }
}
function tenantAuditActor(req) {
  return {
    actorUserId: req.session.user_id,
    impersonatorUserId: req.context?.isImpersonating ? req.session.user_id : null,
    ip: clientIp(req),
    requestId: req.requestId,
  };
}
const storageRoot = path.resolve(config.storagePath);
function resolveStorageKey(key) {
  const target = path.resolve(storageRoot, String(key || ''));
  if (target === storageRoot || !target.startsWith(`${storageRoot}${path.sep}`))
    throw Object.assign(new Error('Ruta de archivo inválida.'), { status: 400 });
  return target;
}
async function plansPublic() {
  return await db
    .prepare(
      `SELECT p.*,
  (SELECT CAST(limit_value AS INTEGER) FROM plan_features pf JOIN features f ON f.id=pf.feature_id WHERE pf.plan_id=p.id AND f.code='branches') branch_limit,
  (SELECT CAST(limit_value AS INTEGER) FROM plan_features pf JOIN features f ON f.id=pf.feature_id WHERE pf.plan_id=p.id AND f.code='employees') employee_limit,
  (SELECT CAST(limit_value AS INTEGER) FROM plan_features pf JOIN features f ON f.id=pf.feature_id WHERE pf.plan_id=p.id AND f.code='orders_monthly') order_limit
  FROM plans p WHERE p.active=1 AND p.public=1 ORDER BY p.price_monthly`,
    )
    .all();
}
function optionRows(rows, value = 'id', text = 'name') {
  return rows.map((row) => [row[value], row[text]]);
}
async function workshopStatusNotice(context) {
  if (['ACTIVE'].includes(context.tenant.status)) return '';
  const sub = await db
    .prepare('SELECT * FROM subscriptions WHERE tenant_id=?')
    .get(context.tenant.id);
  const text =
    context.tenant.status === 'TRIAL'
      ? `Tu prueba termina el ${shortDate(sub?.next_charge_at)}.`
      : ['SUSPENDED', 'BLOCKED', 'CANCELED'].includes(context.tenant.status)
        ? 'Tu cuenta está en modo consulta. Regulariza la suscripción para crear operaciones.'
        : `Tu pago está ${context.tenant.status === 'GRACE' ? 'en período de gracia' : 'pendiente'}. Próximo límite: ${shortDate(sub?.grace_until)}.`;
  return `<div class="status-banner"><p>${text}</p><a class="button button-small" href="/workshop/subscription">Ver suscripción</a></div>`;
}

async function workshopDashboard(req) {
  const t = req.context.tenant.id;
  const timezone = (
    await db.prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?').get(t)
  )?.timezone;
  const current = now(),
    monthStart = startOfLocalDate(calendarDate(current, timezone).slice(0, 7) + '-01', timezone);
  const counts = {
    orders: (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM work_orders WHERE tenant_id=? AND status NOT IN ('DELIVERED','CLOSED','CANCELED')",
        )
        .get(t)
    ).n,
    overdue: (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM work_orders WHERE tenant_id=? AND promised_at<? AND status NOT IN ('READY','INVOICED','PAID','DELIVERED','CLOSED','CANCELED')",
        )
        .get(t, now())
    ).n,
    approval: (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM work_orders WHERE tenant_id=? AND status='AWAITING_APPROVAL'",
        )
        .get(t)
    ).n,
    waiting: (
      await db
        .prepare("SELECT COUNT(*) n FROM work_orders WHERE tenant_id=? AND status='WAITING_PARTS'")
        .get(t)
    ).n,
    ready: (
      await db
        .prepare(
          "SELECT COUNT(*) n FROM work_orders WHERE tenant_id=? AND status IN ('READY','INVOICED','PARTIALLY_PAID','PAID')",
        )
        .get(t)
    ).n,
    revenue: (
      await db
        .prepare(
          "SELECT COALESCE(SUM(amount),0) n FROM cash_movements WHERE tenant_id=? AND type='INCOME' AND voided_at IS NULL AND created_at BETWEEN ? AND ?",
        )
        .get(t, monthStart, current)
    ).n,
    expenses: (
      await db
        .prepare(
          "SELECT COALESCE(SUM(amount),0) n FROM cash_movements WHERE tenant_id=? AND type='EXPENSE' AND voided_at IS NULL AND created_at BETWEEN ? AND ?",
        )
        .get(t, monthStart, current)
    ).n,
  };
  const orders = await db
    .prepare(
      `SELECT o.*,c.name customer,v.plate,v.make,v.model FROM work_orders o JOIN customers c ON c.id=o.customer_id JOIN vehicles v ON v.id=o.vehicle_id WHERE o.tenant_id=? ORDER BY o.created_at DESC LIMIT 7`,
    )
    .all(t);
  const stock = await db
    .prepare(
      'SELECT * FROM inventory_items WHERE tenant_id=? AND quantity<=minimum_stock ORDER BY quantity LIMIT 5',
    )
    .all(t);
  const technicians = await db
    .prepare(
      `SELECT u.name,COUNT(a.id) jobs FROM users u JOIN memberships m ON m.user_id=u.id LEFT JOIN work_assignments a ON a.technician_user_id=u.id AND a.tenant_id=m.tenant_id AND a.status IN ('ASSIGNED','IN_PROGRESS','PAUSED','BLOCKED') WHERE m.tenant_id=? AND m.status='ACTIVE' GROUP BY u.id,u.name HAVING COUNT(a.id)>0 ORDER BY jobs DESC LIMIT 6`,
    )
    .all(t);
  const recent = can(req.context, 'orders.view')
    ? card(
        'Órdenes recientes',
        dataTable(
          [
            { label: 'N°', render: (r) => `<a href="/workshop/orders/${r.id}">#${r.number}</a>` },
            { label: 'Cliente', key: 'customer' },
            {
              label: 'Vehículo',
              render: (r) => `${esc(r.plate)} · ${esc(r.make || '')} ${esc(r.model || '')}`,
            },
            { label: 'Estado', render: (r) => badge(r.status) },
            ...(can(req.context, 'billing.view')
              ? [{ label: 'Total', render: (r) => money(r.total) }]
              : []),
          ],
          orders,
        ),
        '<a href="/workshop/orders">Ver todas →</a>',
      )
    : '';
  const shortcuts = `<div class="quick-actions">${[
    ['search.use', '/workshop/search', 'Buscar'],
    ['orders.create', '/workshop/orders', 'Nueva recepción'],
    ['orders.execute', '/workshop/my-work', 'Mis trabajos'],
    ['purchases.manage', '/workshop/purchases', 'Compras pendientes'],
  ]
    .filter(([permission]) => can(req.context, permission))
    .map(([, href, label]) => `<a href="${href}">${label}</a>`)
    .join('')}</div>
    ${can(req.context, 'inventory.view') && stock.length ? `<h3>Stock crítico</h3>${stock.map((x) => `<p><b>${esc(x.name)}</b> · ${x.quantity} disponibles</p>`).join('')}` : ''}
    ${can(req.context, 'orders.view') && technicians.length ? `<h3>Carga técnica</h3>${technicians.map((x) => `<p><b>${esc(x.name)}</b> · ${x.jobs} trabajo(s)</p>`).join('')}` : ''}`;

  return (
    (await workshopStatusNotice(req.context)) +
    pageHead(
      'OPERACIÓN',
      'Resumen del taller',
      `Hola, ${req.session.name}. Prioridades reales de la operación.`,
      can(req.context, 'orders.create')
        ? '<a class="button" href="/workshop/orders">+ Nueva recepción</a>'
        : '',
    ) +
    metricGrid([
      ...(can(req.context, 'orders.view')
        ? [
            {
              label: 'Vehículos en taller',
              value: counts.orders,
              note: `${counts.overdue} orden(es) atrasadas`,
            },
            {
              label: 'Esperando autorización',
              value: counts.approval,
              note: 'Requieren seguimiento',
            },
            { label: 'Esperando repuestos', value: counts.waiting, note: 'Bloqueo operativo' },
            { label: 'Listos / por cobrar', value: counts.ready, note: 'Próximas entregas' },
          ]
        : []),
      ...(can(req.context, 'billing.view')
        ? [
            {
              label: 'Entradas de caja del mes',
              value: money(counts.revenue),
              note: 'Incluye aportes y correcciones',
            },
            {
              label: 'Flujo neto',
              value: money(Number(counts.revenue) - Number(counts.expenses)),
              note: 'Entradas menos salidas; no es utilidad',
            },
          ]
        : []),
    ]) +
    `<div class="dashboard-grid">${recent}${card('Prioridades', shortcuts)}</div>`
  );
}

async function onboardingPage(req) {
  const t = req.context.tenant;
  const settings = await db.prepare('SELECT * FROM tenant_settings WHERE tenant_id=?').get(t.id);
  const percent = Math.min(100, Number(t.onboarding_step) * 10);
  return (
    pageHead(
      'PRIMEROS PASOS',
      'Configura tu taller',
      'Completa lo esencial ahora; puedes volver cuando quieras.',
    ) +
    card(
      `Progreso · ${percent}%`,
      `<progress class="onboarding-progress" max="100" value="${percent}" aria-label="Progreso de configuración">${percent}%</progress>`,
    ) +
    formCard(
      'Datos operativos',
      '/workshop/onboarding',
      req.session.csrf_token,
      field('legalName', 'Razón social', 'text', t.legal_name) +
        field('taxId', 'Documento / RUC', 'text', t.tax_id) +
        field('phone', 'Teléfono', 'tel', t.phone) +
        field('address', 'Dirección', 'text', t.address) +
        field('city', 'Ciudad', 'text', t.city) +
        field('currency', 'Moneda', 'text', settings.currency) +
        field('timezone', 'Zona horaria', 'text', settings.timezone) +
        field('taxRate', 'Impuesto %', 'number', settings.tax_rate) +
        field(
          'openingHours',
          'Horarios',
          'text',
          JSON.parse(settings.opening_hours || '{}').weekdays || '',
        ) +
        field('logoUrl', 'URL del logo', 'url', t.logo_url) +
        field('primaryColor', 'Color principal', 'color', t.primary_color),
      'Guardar y continuar',
    )
  );
}

async function branchesPage(req) {
  const rows = await db
    .prepare('SELECT * FROM branches WHERE tenant_id=? ORDER BY is_main DESC,name')
    .all(req.context.tenant.id);
  return (
    pageHead('ORGANIZACIÓN', 'Sucursales', 'Sedes aisladas operativamente con vista consolidada.') +
    formCard(
      'Agregar sucursal',
      '/workshop/branches',
      req.session.csrf_token,
      field('name', 'Nombre', 'text', '', { required: true }) +
        field('phone', 'Teléfono', 'tel') +
        field('address', 'Dirección') +
        field('city', 'Ciudad'),
      'Crear sucursal',
    ) +
    card(
      'Sucursales',
      dataTable(
        [
          { label: 'Nombre', key: 'name' },
          { label: 'Ciudad', key: 'city' },
          { label: 'Teléfono', key: 'phone' },
          { label: 'Tipo', render: (r) => (r.is_main ? 'Principal' : 'Sucursal') },
          { label: 'Acciones', render: (r) => catalogActions('branches', req, r) },
          { label: 'Estado', render: (r) => badge(r.active ? 'ACTIVE' : 'SUSPENDED') },
        ],
        rows,
      ),
    )
  );
}
async function employeesPage(req) {
  const tenantId = req.context.tenant.id;
  const rows = await db
    .prepare(
      `SELECT m.*,u.name,u.email,r.name role,r.code role_code,b.name branch
    FROM memberships m JOIN users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id
    LEFT JOIN branches b ON b.id=m.branch_id WHERE m.tenant_id=? ORDER BY u.name`,
    )
    .all(tenantId);
  const roles = await db
    .prepare("SELECT * FROM roles WHERE tenant_id=? AND code<>'OWNER' ORDER BY system DESC,name")
    .all(tenantId);
  const branches = await db
    .prepare('SELECT * FROM branches WHERE tenant_id=? AND active=1 ORDER BY name')
    .all(tenantId);
  const create = formCard(
    'Invitar empleado',
    '/workshop/employees',
    req.session.csrf_token,
    field('name', 'Nombre', 'text', '', { required: true }) +
      field('email', 'Email', 'email', '', { required: true, autocomplete: 'email' }) +
      field('jobTitle', 'Cargo') +
      select('branchId', 'Sucursal', optionRows(branches), '', { required: true }) +
      select('roleId', 'Rol', optionRows(roles), '', { required: true }) +
      field('password', 'Clave temporal', 'password', '', {
        required: true,
        minlength: 10,
        autocomplete: 'new-password',
      }),
    'Crear acceso',
  );
  const grantable = permissions.filter(([permission]) => can(req.context, permission));
  const roleForm = formCard(
    'Crear rol personalizado',
    '/workshop/roles',
    req.session.csrf_token,
    field('name', 'Nombre del rol', 'text', '', { required: true }) +
      `<div class="field-wide check-grid">${grantable.map(([value, label]) => `<label class="check"><input type="checkbox" name="perm_${esc(value)}" value="1">${esc(label)}</label>`).join('')}</div>`,
    'Crear rol',
  );
  const action = (row) =>
    row.role_code === 'OWNER' || row.user_id === req.session.user_id
      ? '<span class="muted">Protegido</span>'
      : `<a href="/workshop/employees/${row.id}/edit">Editar</a><form method="post" action="/workshop/employees/${row.id}/toggle" data-confirm="¿Cambiar el acceso de este empleado?">${csrfInput(req.session.csrf_token)}<button class="link-button">${row.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}</button></form>`;
  return (
    pageHead(
      'PERSONAS',
      'Equipo y permisos',
      'Invita empleados y controla el acceso por rol y sucursal.',
    ) +
    create +
    card(
      'Equipo',
      dataTable(
        [
          { label: 'Nombre', key: 'name' },
          { label: 'Email', key: 'email' },
          { label: 'Rol', key: 'role' },
          { label: 'Sucursal', key: 'branch' },
          { label: 'Estado', render: (row) => badge(row.status) },
          { label: 'Acción', render: action },
        ],
        rows,
      ),
    ) +
    roleForm +
    card(
      'Roles disponibles',
      dataTable(
        [
          { label: 'Rol', key: 'name' },
          {
            label: 'Acción',
            render: (r) => `<a href="/workshop/roles/${r.id}/edit">Editar permisos</a>`,
          },
        ],
        roles,
      ),
    )
  );
}
async function customersPage(req) {
  const rows = await pagedRows(
    db,
    req,
    'SELECT * FROM customers WHERE tenant_id=? ORDER BY created_at DESC',
    [req.context.tenant.id],
    ['name', 'document', 'phone', 'email'],
    { key: 'customers' },
  );
  return (
    pageHead('RELACIONES', 'Clientes', 'La ficha central de quienes confían en tu taller.') +
    (can(req.context, 'customers.create')
      ? formCard(
          'Nuevo cliente',
          '/workshop/customers',
          req.session.csrf_token,
          field('name', 'Nombre completo', 'text', '', { required: true }) +
            field('document', 'Documento / RUC') +
            field('phone', 'Teléfono', 'tel') +
            field('email', 'Email', 'email') +
            field('address', 'Dirección') +
            textarea('notes', 'Notas'),
          'Registrar cliente',
        )
      : '') +
    card(
      'Clientes',
      dataTable(
        [
          {
            label: 'Nombre',
            render: (r) => `<a href="/workshop/customers/${r.id}">${esc(r.name)}</a>`,
          },
          { label: 'Documento', key: 'document' },
          { label: 'Teléfono', key: 'phone' },
          { label: 'Email', key: 'email' },
          { label: 'Alta', render: (r) => shortDate(r.created_at) },
          { label: 'Acciones', render: (r) => catalogActions('customers', req, r) },
        ],
        rows,
      ),
    )
  );
}
async function vehiclesPage(req) {
  const t = req.context.tenant.id;
  const customers = await db
    .prepare('SELECT id,name FROM customers WHERE tenant_id=? AND active=1 ORDER BY name')
    .all(t);
  const rows = await pagedRows(
    db,
    req,
    'SELECT v.*,c.name customer FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE v.tenant_id=? ORDER BY v.created_at DESC',
    [t],
    ['plate', 'vin', 'make', 'model', 'customer'],
    { key: 'vehicles' },
  );
  return (
    pageHead('PARQUE AUTOMOTOR', 'Vehículos', 'Historial por patente y propietario.') +
    (can(req.context, 'vehicles.create')
      ? formCard(
          'Nuevo vehículo',
          '/workshop/vehicles',
          req.session.csrf_token,
          select('customerId', 'Cliente', optionRows(customers), '', { required: true }) +
            field('plate', 'Patente', 'text', '', { required: true }) +
            field('make', 'Marca') +
            field('model', 'Modelo') +
            field('year', 'Año', 'number') +
            field('color', 'Color') +
            field('vin', 'VIN / Chasis') +
            field('odometer', 'Kilometraje', 'number', 0, { min: 0 }),
          'Registrar vehículo',
        )
      : '') +
    card(
      'Vehículos',
      dataTable(
        [
          {
            label: 'Patente',
            render: (r) => `<a href="/workshop/vehicles/${r.id}">${esc(r.plate)}</a>`,
          },
          { label: 'Vehículo', render: (r) => `${esc(r.make || '')} ${esc(r.model || '')}` },
          { label: 'Año', key: 'year' },
          { label: 'Cliente', key: 'customer' },
          {
            label: 'Kilometraje',
            render: (r) => `${Number(r.odometer || 0).toLocaleString('es-PY')} km`,
          },
          { label: 'Acciones', render: (r) => catalogActions('vehicles', req, r) },
        ],
        rows,
      ),
    )
  );
}
async function servicesPage(req) {
  const rows = await db
    .prepare('SELECT * FROM services WHERE tenant_id=? ORDER BY name')
    .all(req.context.tenant.id);
  return (
    pageHead('CATÁLOGO', 'Servicios', 'Precios y tiempos base para presupuestar con agilidad.') +
    (can(req.context, 'settings.manage')
      ? formCard(
          'Nuevo servicio',
          '/workshop/services',
          req.session.csrf_token,
          field('name', 'Nombre', 'text', '', { required: true }) +
            field('price', 'Precio', 'number', 0, { required: true, min: 0 }) +
            field('duration', 'Duración (min)', 'number', 60, { min: 1 }) +
            textarea('description', 'Descripción'),
          'Crear servicio',
        )
      : '') +
    card(
      'Catálogo',
      dataTable(
        [
          { label: 'Servicio', key: 'name' },
          { label: 'Descripción', key: 'description' },
          { label: 'Duración', render: (r) => `${r.duration_minutes} min` },
          { label: 'Precio', render: (r) => money(r.price) },
          { label: 'Acciones', render: (r) => catalogActions('services', req, r) },
          { label: 'Estado', render: (r) => badge(r.active ? 'ACTIVE' : 'SUSPENDED') },
        ],
        rows,
      ),
    )
  );
}
async function ordersPage(req, url) {
  const t = req.context.tenant.id,
    q = String(url.searchParams.get('q') || '').trim(),
    page = Math.max(1, Number(url.searchParams.get('page') || 1)),
    limit = 50,
    offset = (page - 1) * limit,
    like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const customers = await db
    .prepare('SELECT id,name FROM customers WHERE tenant_id=? AND active=1 ORDER BY name')
    .all(t);
  const vehicles = await db
    .prepare(
      'SELECT id,customer_id,plate,make,model FROM vehicles WHERE tenant_id=? AND active=1 ORDER BY plate',
    )
    .all(t);
  const branches = await db
    .prepare('SELECT id,name FROM branches WHERE tenant_id=? AND active=1')
    .all(t);
  const rows = q
    ? await db
        .prepare(
          `SELECT o.*,c.name customer,v.plate,v.make,v.model,b.name branch FROM work_orders o JOIN customers c ON c.id=o.customer_id JOIN vehicles v ON v.id=o.vehicle_id JOIN branches b ON b.id=o.branch_id WHERE o.tenant_id=? AND (c.name ILIKE ? ESCAPE '\\' OR v.plate ILIKE ? ESCAPE '\\' OR CAST(o.number AS TEXT)=?) ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(t, like, like, q.replace('#', ''), limit, offset)
    : await db
        .prepare(
          `SELECT o.*,c.name customer,v.plate,v.make,v.model,b.name branch FROM work_orders o JOIN customers c ON c.id=o.customer_id JOIN vehicles v ON v.id=o.vehicle_id JOIN branches b ON b.id=o.branch_id WHERE o.tenant_id=? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(t, limit, offset);
  const customerSelect = `<label class="field"><span>Cliente *</span><select name="customerId" data-customer-source required><option value="">Seleccionar</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>`;
  const vehicleSelect = `<label class="field"><span>Vehículo *</span><select name="vehicleId" data-vehicle-target required><option value="">Seleccionar cliente primero</option>${vehicles.map((v) => `<option value="${v.id}" data-customer="${v.customer_id}">${esc(v.plate)} · ${esc(v.make || '')} ${esc(v.model || '')}</option>`).join('')}</select></label>`;
  const form = can(req.context, 'orders.create')
    ? formCard(
        'Recepción rápida',
        '/workshop/orders',
        req.session.csrf_token,
        select('branchId', 'Sucursal', optionRows(branches), req.context.membership?.branch_id, {
          required: true,
        }) +
          customerSelect +
          vehicleSelect +
          field('odometer', 'Kilometraje', 'number', 0, { min: 0 }) +
          field('fuelLevel', 'Combustible %', 'number', '', { min: 0 }) +
          field('promisedAt', 'Entrega prometida', 'datetime-local') +
          textarea('complaint', 'Motivo de ingreso', '', { required: true }) +
          textarea('visibleDamage', 'Daños visibles') +
          field('accessories', 'Accesorios', 'text', 'Llave, rueda de auxilio') +
          textarea('notes', 'Notas'),
        'Crear recepción',
      )
    : '';
  return (
    pageHead(
      'FLUJO DE TRABAJO',
      'Órdenes de servicio',
      'Cada orden avanza mediante reglas verificadas por el backend.',
    ) +
    `<form class="global-search-page" method="get"><input name="q" value="${esc(q)}" placeholder="Orden, cliente o patente"><button class="button">Buscar</button></form>` +
    form +
    card(
      'Órdenes',
      dataTable(
        [
          { label: 'Orden', render: (r) => `<a href="/workshop/orders/${r.id}">#${r.number}</a>` },
          { label: 'Cliente', key: 'customer' },
          { label: 'Vehículo', render: (r) => `${esc(r.plate)} · ${esc(r.make || '')}` },
          { label: 'Sucursal', key: 'branch' },
          { label: 'Total', render: (r) => money(r.total) },
          {
            label: 'Estado',
            render: (r) =>
              `<span class="badge badge-${esc(r.status.toLowerCase())}">${esc(ORDER_LABELS[r.status] || r.status)}</span>`,
          },
        ],
        rows,
      ) +
        `<div class="pagination">${page > 1 ? `<a href="?q=${encodeURIComponent(q)}&page=${page - 1}">← Anterior</a>` : ''}${rows.length === limit ? `<a href="?q=${encodeURIComponent(q)}&page=${page + 1}">Siguiente →</a>` : ''}</div>`,
    )
  );
}
async function inventoryPage(req) {
  const t = req.context.tenant.id,
    cap = await entitlement(db, t, 'inventory'),
    branches = await db
      .prepare('SELECT id,name FROM branches WHERE tenant_id=? AND active=1')
      .all(t),
    rows = await pagedRows(
      db,
      req,
      'SELECT i.*,b.name branch FROM inventory_items i JOIN branches b ON b.id=i.branch_id WHERE i.tenant_id=? ORDER BY i.name',
      [t],
      ['name', 'sku', 'branch'],
      { key: 'stock' },
    ),
    suppliers = await pagedRows(
      db,
      req,
      'SELECT * FROM suppliers WHERE tenant_id=? ORDER BY name',
      [t],
      ['name', 'tax_id', 'phone', 'email'],
      { key: 'suppliers' },
    );
  const forms =
    cap.enabled && can(req.context, 'inventory.adjust')
      ? `<div class="dashboard-grid">${formCard('Nuevo artículo', '/workshop/inventory', req.session.csrf_token, select('branchId', 'Sucursal', optionRows(branches), '', { required: true }) + field('sku', 'SKU') + field('name', 'Nombre', 'text', '', { required: true }) + (can(req.context, 'inventory.cost') ? field('quantity', 'Existencia inicial', 'number', 0, { min: 0 }) : '<p class="field-wide">El artículo se crea sin existencias. Una compra o ajuste posterior registrará el ingreso.</p>') + field('minimum', 'Stock mínimo', 'number', 0, { min: 0 }) + (can(req.context, 'inventory.cost') ? field('cost', 'Costo', 'number', 0, { min: 0 }) : '') + field('price', 'Precio de venta', 'number', 0, { min: 0 }) + `<input type="hidden" name="idempotencyKey" value="${id()}">`, 'Crear artículo')}${can(req.context, 'purchases.manage') ? formCard('Nuevo proveedor', '/workshop/suppliers', req.session.csrf_token, field('name', 'Nombre', 'text', '', { required: true }) + field('taxId', 'RUC') + field('phone', 'Teléfono', 'tel') + field('email', 'Email', 'email') + field('address', 'Dirección'), 'Crear proveedor') : ''}</div>`
      : '';
  return (
    pageHead(
      'REPUESTOS',
      'Inventario',
      cap.enabled
        ? 'Existencias trazables por sucursal. Las compras se procesan en su módulo específico.'
        : 'Actualiza tu plan para habilitar inventario avanzado.',
    ) +
    forms +
    card(
      'Existencias',
      dataTable(
        [
          {
            label: 'Artículo',
            render: (r) => `<a href="/workshop/inventory/${r.id}/movements">${esc(r.name)}</a>`,
          },
          { label: 'SKU', key: 'sku' },
          { label: 'Sucursal', key: 'branch' },
          {
            label: 'Cantidad',
            render: (r) =>
              `<b>${r.quantity}</b>${r.quantity <= r.minimum_stock ? ' · stock crítico' : ''}`,
          },
          {
            label: 'Costo',
            render: (r) => (can(req.context, 'inventory.cost') ? money(r.cost) : 'Restringido'),
          },
          { label: 'Venta', render: (r) => money(r.sale_price) },
          { label: 'Acciones', render: (r) => catalogActions('inventory', req, r) },
        ],
        rows,
      ),
    ) +
    (can(req.context, 'purchases.manage')
      ? card(
          'Proveedores',
          dataTable(
            [
              { label: 'Nombre', key: 'name' },
              { label: 'RUC', key: 'tax_id' },
              { label: 'Acciones', render: (r) => catalogActions('suppliers', req, r) },
              { label: 'Teléfono', key: 'phone' },
              { label: 'Email', key: 'email' },
              { label: 'Estado', render: (r) => badge(r.active ? 'ACTIVE' : 'SUSPENDED') },
            ],
            suppliers,
          ),
        )
      : '')
  );
}
async function schedulePage(req) {
  const t = req.context.tenant.id;
  const branches = await db
    .prepare('SELECT id,name FROM branches WHERE tenant_id=? AND active=1')
    .all(t);
  const customers = await db
    .prepare('SELECT id,name FROM customers WHERE tenant_id=? AND active=1 ORDER BY name')
    .all(t);
  const vehicles = await db
    .prepare('SELECT id,plate,make,model FROM vehicles WHERE tenant_id=? ORDER BY plate')
    .all(t);
  const appointments = await db
    .prepare(
      `SELECT a.*,c.name customer,v.plate,b.name branch FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN vehicles v ON v.id=a.vehicle_id JOIN branches b ON b.id=a.branch_id WHERE a.tenant_id=? ORDER BY a.scheduled_at`,
    )
    .all(t);
  const bays = await db
    .prepare(
      'SELECT y.*,b.name branch FROM bays y JOIN branches b ON b.id=y.branch_id WHERE y.tenant_id=? ORDER BY b.name,y.name',
    )
    .all(t);
  return (
    pageHead(
      'PLANIFICACIÓN',
      'Agenda y bahías',
      'Coordina turnos y capacidad física de cada sucursal.',
    ) +
    `<div class="dashboard-grid">${formCard('Agendar turno', '/workshop/appointments', req.session.csrf_token, select('branchId', 'Sucursal', optionRows(branches)) + select('customerId', 'Cliente', optionRows(customers)) + select('vehicleId', 'Vehículo', [['', 'Sin vehículo'], ...vehicles.map((v) => [v.id, `${v.plate} · ${v.make || ''} ${v.model || ''}`])]) + field('scheduledAt', 'Fecha y hora', 'datetime-local', '', { required: true }) + textarea('reason', 'Motivo'), 'Agendar')}${formCard('Agregar bahía', '/workshop/bays', req.session.csrf_token, select('branchId', 'Sucursal', optionRows(branches)) + field('name', 'Nombre', 'text', '', { required: true }), 'Agregar')}</div>` +
    card(
      'Próximos turnos',
      dataTable(
        [
          { label: 'Fecha', render: (r) => new Date(r.scheduled_at).toLocaleString('es-PY') },
          { label: 'Cliente', key: 'customer' },
          { label: 'Vehículo', key: 'plate' },
          { label: 'Sucursal', key: 'branch' },
          { label: 'Motivo', key: 'reason' },
          { label: 'Estado', render: (r) => badge(r.status) },
          {
            label: 'Acciones',
            render: (r) =>
              r.status === 'SCHEDULED' && can(req.context, 'orders.create')
                ? `<a href="/workshop/appointments/${r.id}/receive">Recibir vehículo</a><details><summary>Reprogramar o cancelar</summary><form method="post" action="/workshop/appointments/${r.id}/change">${csrfInput(req.session.csrf_token)}${field('scheduledAt', 'Nueva fecha y hora', 'datetime-local', '')}<button class="link-button" name="action" value="reschedule">Reprogramar</button><button class="link-button" name="action" value="cancel" formnovalidate>Cancelar turno</button></form></details>`
                : '—',
          },
        ],
        appointments,
      ),
    ) +
    card(
      'Bahías',
      dataTable(
        [
          { label: 'Nombre', key: 'name' },
          { label: 'Sucursal', key: 'branch' },
          { label: 'Estado', render: (r) => badge(r.status) },
        ],
        bays,
      ),
    )
  );
}
async function documentsPage(req) {
  const t = req.context.tenant.id,
    cap = await entitlement(db, t, 'storage_mb'),
    rows = await pagedRows(
      db,
      req,
      'SELECT * FROM files WHERE tenant_id=? ORDER BY created_at DESC',
      [t],
      ['name', 'mime_type'],
      { key: 'files' },
    ),
    used =
      Number(
        (await db.prepare('SELECT storage_used_bytes FROM tenants WHERE id=?').get(t))
          .storage_used_bytes || 0,
      ) / 1048576;
  const upload = can(req.context, 'documents.upload')
    ? card(
        'Subir documento',
        `<form class="form-grid" method="post" action="/workshop/documents" data-upload>${csrfInput(req.session.csrf_token)}<label class="field field-wide"><span>Archivo (PDF o imagen, máximo 7 MB)</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required></label><div class="form-actions"><button class="button">Subir archivo</button></div></form>`,
      )
    : '';
  return (
    pageHead(
      'ARCHIVOS',
      'Documentos',
      `Almacenamiento privado del taller · ${used.toFixed(2)} MB de ${cap.limit || 0} MB.`,
    ) +
    upload +
    card(
      'Archivos privados',
      dataTable(
        [
          {
            label: 'Nombre',
            render: (r) =>
              `<a href="/api/files/${r.id}" target="_blank" rel="noopener">${esc(r.name)}</a>`,
          },
          { label: 'Tipo', key: 'mime_type' },
          { label: 'Tamaño', render: (r) => `${(r.size_bytes / 1024).toFixed(1)} KB` },
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          {
            label: 'Acción',
            render: (r) =>
              can(req.context, 'documents.delete')
                ? `<form method="post" action="/workshop/documents/${r.id}/delete" data-confirm="¿Eliminar este archivo?">${csrfInput(req.session.csrf_token)}<button class="link-button">Eliminar</button></form>`
                : '—',
          },
        ],
        rows,
      ),
    )
  );
}
async function notificationsPage(req) {
  const rows = await notificationsForContext(db, req.context);
  return (
    pageHead(
      'ACTIVIDAD',
      'Notificaciones',
      'Avisos operativos, de cobranza y seguimiento del taller.',
    ) +
    card(
      'Bandeja',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          {
            label: 'Aviso',
            render: (r) => `<b>${esc(r.title)}</b><br><small>${esc(r.message)}</small>`,
          },
          { label: 'Canal', key: 'channel' },
          { label: 'Estado', render: (r) => badge(r.status) },
          {
            label: 'Acción',
            render: (r) =>
              r.status === 'READ'
                ? 'Leída'
                : `<form method="post" action="/workshop/notifications/${r.id}/read">${csrfInput(req.session.csrf_token)}<button class="link-button">Marcar leída</button></form>`,
          },
        ],
        rows,
      ),
    )
  );
}
async function workshopBillingPage(req) {
  const t = req.context.tenant.id,
    branches = await db
      .prepare('SELECT id,name FROM branches WHERE tenant_id=? AND active=1')
      .all(t),
    invoices = await db
      .prepare(
        'SELECT i.*,c.name customer,o.number order_number FROM workshop_invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN work_orders o ON o.id=i.work_order_id WHERE i.tenant_id=? AND i.voided_at IS NULL ORDER BY i.created_at DESC LIMIT 200',
      )
      .all(t),
    moves = await db
      .prepare(
        'SELECT m.*,b.name branch FROM cash_movements m JOIN branches b ON b.id=m.branch_id WHERE m.tenant_id=? AND m.voided_at IS NULL ORDER BY m.created_at DESC LIMIT 100',
      )
      .all(t);
  const manual = can(req.context, 'cash.manage')
    ? formCard(
        'Gasto u otro ingreso',
        '/workshop/cash',
        req.session.csrf_token,
        select('branchId', 'Sucursal', optionRows(branches)) +
          select('type', 'Tipo', [
            ['EXPENSE', 'Gasto'],
            ['INCOME', 'Otro ingreso'],
          ]) +
          select('category', 'Categoría', [
            ['OPERATING_EXPENSE', 'Gasto operativo'],
            ['OTHER_INCOME', 'Otro ingreso'],
            ['WITHDRAWAL', 'Retiro'],
            ['CAPITAL', 'Aporte'],
          ]) +
          field('amount', 'Importe', 'number', 0, { min: 1 }) +
          field('reference', 'Referencia') +
          textarea('notes', 'Notas') +
          `<input type="hidden" name="idempotencyKey" value="${id()}">`,
        'Registrar movimiento',
      )
    : '';
  return (
    pageHead(
      'FINANZAS DEL TALLER',
      'Facturación y caja',
      'Las facturas nacen exclusivamente de órdenes terminadas y los cobros actualizan caja de forma atómica.',
    ) +
    manual +
    card(
      'Facturas',
      dataTable(
        [
          {
            label: 'N°',
            render: (r) =>
              r.order_number
                ? `<a href="/workshop/orders/${r.work_order_id}">#${r.number}</a>`
                : `#${r.number}`,
          },
          { label: 'Orden', render: (r) => (r.order_number ? `#${r.order_number}` : '—') },
          { label: 'Cliente', key: 'customer' },
          { label: 'Total', render: (r) => money(r.amount) },
          { label: 'Cobrado', render: (r) => money(r.paid_amount) },
          { label: 'Saldo', render: (r) => money(r.balance) },
          { label: 'Vence', render: (r) => shortDate(r.due_at) },
          { label: 'Estado', render: (r) => badge(r.status) },
        ],
        invoices,
      ),
    ) +
    card(
      'Movimientos de caja',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          { label: 'Sucursal', key: 'branch' },
          { label: 'Tipo', render: (r) => (r.type === 'INCOME' ? 'Ingreso' : 'Egreso') },
          { label: 'Categoría', render: (r) => esc(label(r.category)) },
          { label: 'Referencia', key: 'reference' },
          { label: 'Importe', render: (r) => money(r.amount) },
        ],
        moves,
      ),
    )
  );
}
async function subscriptionPage(req) {
  const s = await db
    .prepare(
      'SELECT s.*,p.name plan,p.description FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.tenant_id=?',
    )
    .get(req.context.tenant.id);
  const trial = await db
    .prepare('SELECT * FROM trials WHERE tenant_id=? ORDER BY starts_at DESC LIMIT 1')
    .get(req.context.tenant.id);
  const payments = await db
    .prepare('SELECT * FROM saas_payments WHERE tenant_id=? ORDER BY paid_at DESC')
    .all(req.context.tenant.id);
  const caps = await db
    .prepare(
      `SELECT f.name,f.code,pf.enabled,pf.limit_value FROM subscriptions s JOIN plan_features pf ON pf.plan_id=s.plan_id JOIN features f ON f.id=pf.feature_id WHERE s.tenant_id=? AND f.global_enabled=1 ORDER BY f.name`,
    )
    .all(req.context.tenant.id);
  return (
    pageHead('CUENTA', 'Mi suscripción', 'Estado, renovación y capacidades de tu plan.') +
    metricGrid([
      { label: 'Plan', value: s.plan, note: label(s.billing_cycle) },
      {
        label: 'Estado',
        value: labelText(s.status),
        note: `Taller: ${labelText(req.context.tenant.status)}`,
      },
      {
        label: 'Próximo vencimiento',
        value: shortDate(s.next_charge_at),
        note: trial?.active ? 'Período de prueba' : '',
      },
      {
        label: 'Precio',
        value: money(s.price, s.currency),
        note: s.discount_percent
          ? `${s.discount_percent}% descuento · ${s.promotion || ''}`
          : 'Pago manual verificado por la plataforma',
      },
    ]) +
    card(
      'Cómo pagar',
      config.paymentInstructions
        ? `<p class="preserve-lines">${esc(config.paymentInstructions)}</p>`
        : '<p>El propietario de la plataforma debe configurar las instrucciones de pago antes de habilitar la venta.</p>',
    ) +
    card(
      'Capacidades incluidas',
      `<div class="check-grid">${caps.map((c) => `<div class="check">${c.enabled ? '✓' : '—'} ${esc(c.name)} ${c.limit_value != null ? `<b>${Number(c.limit_value).toLocaleString('es-PY')}</b>` : ''}</div>`).join('')}</div>`,
    ) +
    card(
      'Historial de pagos',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.paid_at) },
          {
            label: 'Período',
            render: (r) => `${shortDate(r.period_start)} – ${shortDate(r.period_end)}`,
          },
          { label: 'Importe', render: (r) => money(r.amount, r.currency) },
          { label: 'Método', render: (r) => esc(label(r.method)) },
          { label: 'Referencia', key: 'reference' },
          { label: 'Estado', render: (r) => badge(r.status) },
        ],
        payments,
      ),
    )
  );
}
function labelText(value) {
  return (
    {
      TRIAL: 'En prueba',
      ACTIVE: 'Activo',
      OVERDUE: 'Vencido',
      GRACE: 'En gracia',
      SUSPENDED: 'Suspendido',
      CANCELED: 'Cancelado',
      BLOCKED: 'Bloqueado',
    }[value] || value
  );
}
async function supportPage(req) {
  const rows = await db
    .prepare('SELECT * FROM support_tickets WHERE tenant_id=? ORDER BY updated_at DESC')
    .all(req.context.tenant.id);
  return (
    pageHead(
      'AYUDA',
      'Soporte',
      'Reporta un problema, realiza una consulta o sugiere una mejora.',
    ) +
    formCard(
      'Nuevo ticket',
      '/workshop/support',
      req.session.csrf_token,
      select('type', 'Tipo', [
        ['PROBLEM', 'Problema'],
        ['QUESTION', 'Consulta'],
        ['IDEA', 'Sugerencia'],
      ]) +
        select('priority', 'Prioridad', [
          ['NORMAL', 'Normal'],
          ['HIGH', 'Alta'],
          ['URGENT', 'Urgente'],
        ]) +
        field('subject', 'Asunto', 'text', '', { required: true }) +
        textarea('description', 'Detalle', '', { required: true }),
      'Enviar ticket',
    ) +
    card(
      'Mis tickets',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          { label: 'Tipo', key: 'type' },
          { label: 'Asunto', key: 'subject' },
          { label: 'Prioridad', key: 'priority' },
          { label: 'Estado', render: (r) => badge(r.status) },
          { label: 'Resolución', key: 'resolution' },
        ],
        rows,
      ),
    )
  );
}
async function settingsPage(req) {
  const t = req.context.tenant;
  const s = await db.prepare('SELECT * FROM tenant_settings WHERE tenant_id=?').get(t.id);
  return (
    pageHead(
      'PREFERENCIAS',
      'Configuración del taller',
      'Tu marca y reglas comerciales sin alterar la identidad de la plataforma.',
    ) +
    formCard(
      'Identidad y documentos',
      '/workshop/settings',
      req.session.csrf_token,
      field('name', 'Nombre comercial', 'text', t.name, { required: true }) +
        field('legalName', 'Razón social', 'text', t.legal_name) +
        field('taxId', 'RUC', 'text', t.tax_id) +
        field('phone', 'Teléfono', 'tel', t.phone) +
        field('email', 'Email', 'email', t.email) +
        field('address', 'Dirección', 'text', t.address) +
        field('logoUrl', 'URL del logo', 'url', t.logo_url) +
        field('primaryColor', 'Color principal', 'color', t.primary_color) +
        field('currency', 'Moneda', 'text', s.currency) +
        field('taxRate', 'Impuesto %', 'number', s.tax_rate) +
        field('timezone', 'Zona horaria', 'text', s.timezone) +
        field(
          'openingHours',
          'Horarios',
          'text',
          JSON.parse(s.opening_hours || '{}').weekdays || '',
        ) +
        field('warrantyDays', 'Garantía (días)', 'number', s.warranty_days, { min: 0, max: 3650 }) +
        textarea('warrantyTerms', 'Condiciones de garantía', s.warranty_terms) +
        textarea('documentHeader', 'Encabezado de documentos', s.document_header) +
        textarea('documentFooter', 'Pie de documentos', s.document_footer),
      'Guardar configuración',
    )
  );
}

async function saasDashboard() {
  const m = await platformMetrics(db);
  const recent = await db
    .prepare(
      `SELECT t.*,p.name plan,s.next_charge_at FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN plans p ON p.id=s.plan_id ORDER BY t.created_at DESC LIMIT 8`,
    )
    .all();
  const overdue = (await billingRows(db)).filter((r) => r.days_late > 0).slice(0, 6);
  return (
    pageHead(
      'PLATAFORMA',
      'Control general',
      'Salud comercial, cobranza y actividad de todos los talleres.',
    ) +
    metricGrid([
      { label: 'Clientes activos', value: m.active, note: `${m.newThisMonth} nuevos este mes` },
      {
        label: 'Cancelaciones en 30 días',
        value: `${m.churn.toFixed(1)}%`,
        note: 'Respecto de los talleres existentes al inicio del período',
      },
      {
        label: 'Trials activos',
        value: m.trials,
        note: `Conversión ${m.trialConversion.toFixed(1)}%`,
      },
      { label: 'Próximas renovaciones', value: m.renewals, note: 'En los próximos 7 días' },
      { label: 'Usuarios activos', value: m.activeUsers, note: `${m.branches} sucursales` },
      {
        label: 'Almacenamiento',
        value: `${(m.storageBytes / 1048576).toFixed(1)} MB`,
        note: `${m.cancellations} cancelaciones totales`,
      },
    ]) +
    card(
      'Ingresos SaaS por moneda',
      '<p>MRR y ARPU excluyen pruebas gratuitas y planes sin cargo. No se mezclan monedas ni se simulan conversiones.</p>' +
        dataTable(
          [
            { label: 'Moneda', key: 'currency' },
            { label: 'Suscripciones con cargo', key: 'payingCustomers' },
            { label: 'MRR', render: (r) => money(r.mrr, r.currency) },
            { label: 'ARR', render: (r) => money(r.arr, r.currency) },
            { label: 'ARPU', render: (r) => money(r.arpu, r.currency) },
            { label: 'Cobrado este mes', render: (r) => money(r.revenue, r.currency) },
            { label: 'Variación mensual', render: (r) => `${r.growth.toFixed(1)}%` },
          ],
          m.financials,
        ),
    ) +
    `<div class="dashboard-grid">${card(
      'Registros recientes',
      dataTable(
        [
          { label: 'Taller', render: (r) => `<a href="/saas/tenants/${r.id}">${esc(r.name)}</a>` },
          { label: 'Propietario', key: 'owner_name' },
          { label: 'Plan', key: 'plan' },
          { label: 'Estado', render: (r) => badge(r.status) },
          { label: 'Alta', render: (r) => shortDate(r.created_at) },
        ],
        recent,
      ),
      '<a href="/saas/tenants">Ver todos →</a>',
    )}${card(
      'Cobranza prioritaria',
      dataTable(
        [
          { label: 'Taller', render: (r) => `<a href="/saas/tenants/${r.id}">${esc(r.name)}</a>` },
          { label: 'Atraso', render: (r) => `${r.days_late} días` },
          { label: 'Deuda', render: (r) => money(r.debt, r.currency) },
        ],
        overdue,
      ),
      '<a href="/saas/collections">Abrir cobranza →</a>',
    )}</div>`
  );
}
async function tenantsPage() {
  const rows = await db
    .prepare(
      `SELECT t.*,p.name plan,s.next_charge_at,s.price,(SELECT COUNT(*) FROM memberships m WHERE m.tenant_id=t.id) employees,(SELECT COUNT(*) FROM branches b WHERE b.tenant_id=t.id) branches FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN plans p ON p.id=s.plan_id ORDER BY t.created_at DESC`,
    )
    .all();
  return (
    pageHead('CLIENTES SaaS', 'Talleres', 'Todos los tenants, su estado y nivel de uso.') +
    card(
      'Cartera de clientes',
      dataTable(
        [
          { label: 'Taller', render: (r) => `<a href="/saas/tenants/${r.id}">${esc(r.name)}</a>` },
          { label: 'Propietario', key: 'owner_name' },
          { label: 'Plan', key: 'plan' },
          { label: 'Estado', render: (r) => badge(r.status) },
          { label: 'Renovación', render: (r) => shortDate(r.next_charge_at) },
          { label: 'Empleados', key: 'employees' },
          { label: 'Sucursales', key: 'branches' },
        ],
        rows,
      ),
    )
  );
}
async function tenantDetailPage(req, tenantId) {
  const t = await db
    .prepare(
      `SELECT t.*,s.id subscription_id,s.plan_id,s.billing_cycle,s.price,s.currency,s.started_at,s.next_charge_at,s.status subscription_status,s.grace_until,s.auto_renew,s.discount_percent,s.promotion,p.name plan FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN plans p ON p.id=s.plan_id WHERE t.id=?`,
    )
    .get(tenantId);
  if (!t) throw Object.assign(new Error('Taller no encontrado.'), { status: 404 });
  const usage = {
    employees: (
      await db.prepare('SELECT COUNT(*) n FROM memberships WHERE tenant_id=?').get(tenantId)
    ).n,
    branches: (await db.prepare('SELECT COUNT(*) n FROM branches WHERE tenant_id=?').get(tenantId))
      .n,
    orders: (await db.prepare('SELECT COUNT(*) n FROM work_orders WHERE tenant_id=?').get(tenantId))
      .n,
    customers: (
      await db.prepare('SELECT COUNT(*) n FROM customers WHERE tenant_id=?').get(tenantId)
    ).n,
    vehicles: (await db.prepare('SELECT COUNT(*) n FROM vehicles WHERE tenant_id=?').get(tenantId))
      .n,
  };
  const payments = await db
    .prepare('SELECT * FROM saas_payments WHERE tenant_id=? ORDER BY paid_at DESC')
    .all(tenantId);
  const history = await db
    .prepare('SELECT * FROM audit_logs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20')
    .all(tenantId);
  const plans = await db.prepare('SELECT * FROM plans WHERE active=1 ORDER BY price_monthly').all();
  return (
    pageHead(
      'FICHA 360°',
      t.name,
      `${t.owner_name} · ${t.email}`,
      `<form method="post" action="/saas/tenants/${t.id}/impersonate">${csrfInput(req.session.csrf_token)}<button class="button">Entrar para soporte</button></form>`,
    ) +
    metricGrid([
      {
        label: 'Estado SaaS',
        value: labelText(t.status),
        note: `Suscripción ${labelText(t.subscription_status)}`,
      },
      { label: 'Plan', value: t.plan, note: money(t.price, t.currency) },
      {
        label: 'Próximo cobro',
        value: shortDate(t.next_charge_at),
        note: t.grace_until ? `Gracia: ${shortDate(t.grace_until)}` : '',
      },
      {
        label: 'Uso',
        value: `${usage.orders} órdenes`,
        note: `${usage.employees} empleados · ${usage.branches} sedes`,
      },
    ]) +
    `<div class="detail-grid">${card('Datos del taller', `<div class="stat-list"><div><span>Razón social</span><b>${esc(t.legal_name || '—')}</b></div><div><span>RUC</span><b>${esc(t.tax_id || '—')}</b></div><div><span>Teléfono</span><b>${esc(t.phone || '—')}</b></div><div><span>Dirección</span><b>${esc([t.address, t.city, t.country].filter(Boolean).join(', '))}</b></div><div><span>Registro</span><b>${shortDate(t.created_at)}</b></div><div><span>Última actividad</span><b>${shortDate(t.last_activity_at)}</b></div></div>`)}${formCard(
      'Cambiar plan',
      `/saas/tenants/${t.id}/subscription`,
      req.session.csrf_token,
      select('planId', 'Plan', optionRows(plans), t.plan_id) +
        select(
          'billingCycle',
          'Ciclo',
          [
            ['MONTHLY', 'Mensual'],
            ['QUARTERLY', 'Trimestral'],
            ['SEMIANNUAL', 'Semestral'],
            ['ANNUAL', 'Anual'],
          ],
          t.billing_cycle,
        ) +
        field('price', 'Precio acordado', 'number', t.price) +
        field('discount', 'Descuento %', 'number', t.discount_percent) +
        field('promotion', 'Promoción', 'text', t.promotion) +
        '<p>Los pagos de esta suscripción se registran manualmente. No se ejecutan cargos automáticos.</p>',
      'Actualizar',
    )}${formCard(
      'Control administrativo',
      `/saas/tenants/${t.id}/status`,
      req.session.csrf_token,
      select(
        'status',
        'Estado',
        [
          ['ACTIVE', 'Activo'],
          ['PAYMENT_PENDING', 'Pago pendiente'],
          ['OVERDUE', 'Vencido'],
          ['GRACE', 'Período de gracia'],
          ['SUSPENDED', 'Suspendido'],
          ['CANCELED', 'Cancelado'],
          ['BLOCKED', 'Bloqueado'],
        ],
        t.status,
      ) + field('reason', 'Motivo'),
      'Aplicar estado',
    )}</div>` +
    card(
      'Pagos SaaS',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.paid_at) },
          { label: 'Monto', render: (r) => money(r.amount, r.currency) },
          { label: 'Método', key: 'method' },
          { label: 'Referencia', key: 'reference' },
          {
            label: 'Comprobante',
            render: (r) => `<a href="/saas/payments/${r.id}/receipt">Ver</a>`,
          },
        ],
        payments,
      ),
    ) +
    (await tenantOverridesCard(req, tenantId)) +
    card(
      'Historial administrativo',
      `<ul class="timeline">${history.map((h) => `<li><b>${esc(h.action)}</b><small>${shortDate(h.created_at)} · ${esc(h.entity_type || 'plataforma')}</small></li>`).join('')}</ul>`,
    )
  );
}
async function collectionsPage(req) {
  const rows = await billingRows(db);
  const tenants = await db.prepare('SELECT id,name FROM tenants ORDER BY name').all();
  return (
    pageHead(
      'INGRESOS SaaS',
      'Cobranza',
      'Identifica vencimientos y registra pagos sin mezclar la caja del taller.',
    ) +
    formCard(
      'Registrar pago manual',
      '/saas/payments',
      req.session.csrf_token,
      select('tenantId', 'Taller', optionRows(tenants), '', { required: true }) +
        field('amount', 'Monto', 'number', 0, { required: true, min: 1 }) +
        select('method', 'Método', [
          ['TRANSFER', 'Transferencia'],
          ['CASH', 'Efectivo'],
          ['CARD', 'Tarjeta'],
          ['OTHER', 'Otro'],
        ]) +
        field('paidAt', 'Fecha', 'date', calendarDate(), { max: calendarDate() }) +
        field('reference', 'Referencia', 'text', '', { required: true }) +
        textarea('notes', 'Observación'),
      'Registrar pago',
    ) +
    card(
      'Estado de cobranza',
      `<div class="report-filters"><label class="field"><span>Buscar taller</span><input type="search" placeholder="Nombre o propietario" data-table-search="#billing-rows tr"></label><label class="field"><span>Prioridad</span><select data-filter="#billing-rows tr"><option value="">Todos</option><option value="CURRENT">Al día</option><option value="DUE_SOON">Vence en 7 días</option><option value="OVERDUE">Vencido</option><option value="GRACE">Moroso</option><option value="SUSPENDED">Suspendido</option></select></label></div><div class="table-wrap"><table><thead><tr><th>Taller</th><th>Propietario</th><th>Plan</th><th>Monto</th><th>Último pago</th><th>Próximo vencimiento</th><th>Estado</th><th>Atraso</th><th>Deuda</th></tr></thead><tbody id="billing-rows">${rows.map((r) => `<tr data-status="${esc(r.collectionState)}" data-search="${esc(`${r.name} ${r.owner_name} ${r.plan}`.toLowerCase())}"><td><a href="/saas/tenants/${r.id}">${esc(r.name)}</a></td><td>${esc(r.owner_name)}</td><td>${esc(r.plan)}</td><td>${money(r.price, r.currency)}</td><td>${shortDate(r.last_payment)}</td><td>${shortDate(r.next_charge_at)}</td><td>${badge(r.status)}${r.collectionState === 'DUE_SOON' ? ' · vence pronto' : ''}</td><td>${r.days_late} días</td><td>${money(r.debt, r.currency)}</td></tr>`).join('')}</tbody></table></div>`,
    )
  );
}
async function plansPage(req) {
  const plans = await db.prepare('SELECT * FROM plans ORDER BY active DESC,price_monthly').all();
  const features = await db.prepare('SELECT * FROM features ORDER BY kind,name').all();
  const editors = (
    await Promise.all(
      plans.map(async (plan) => {
        const current = new Map(
          (await db.prepare('SELECT * FROM plan_features WHERE plan_id=?').all(plan.id)).map(
            (x) => [x.feature_id, x],
          ),
        );
        const capabilityFields = features
          .map((feature) => {
            const value = current.get(feature.id);
            return feature.kind === 'limit'
              ? field(`limit_${feature.id}`, feature.name, 'number', value?.limit_value ?? 0, {
                  min: 0,
                })
              : `<label class="check"><input type="checkbox" name="enabled_${feature.id}" value="1" ${value?.enabled ? 'checked' : ''}>${esc(feature.name)}</label>`;
          })
          .join('');
        return card(
          plan.name,
          `<form class="form-grid" method="post" action="/saas/plans/${plan.id}/capabilities">${csrfInput(req.session.csrf_token)}${field('price', 'Precio mensual', 'number', plan.price_monthly, { min: 0 })}${field('currency', 'Moneda', 'text', plan.currency)}${select(
            'public',
            'Visible al público',
            [
              ['1', 'Sí'],
              ['0', 'No'],
            ],
            String(plan.public),
          )}<div class="field-wide check-grid">${capabilityFields}</div><div class="form-actions"><button class="button">Guardar capacidades</button></div></form>`,
        );
      }),
    )
  ).join('');
  return (
    pageHead('OFERTA', 'Planes', 'Crea, modifica y retira planes sin validaciones hardcodeadas.') +
    formCard(
      'Crear plan',
      '/saas/plans',
      req.session.csrf_token,
      field('name', 'Nombre', 'text', '', { required: true }) +
        field('code', 'Código', 'text', '', { required: true }) +
        field('description', 'Descripción') +
        field('price', 'Precio mensual', 'number', 0, { required: true, min: 0 }) +
        field('currency', 'Moneda', 'text', 'PYG') +
        select('public', 'Visible al público', [
          ['1', 'Sí'],
          ['0', 'No'],
        ]),
      'Crear plan',
    ) +
    card(
      'Planes configurados',
      dataTable(
        [
          { label: 'Nombre', key: 'name' },
          { label: 'Código', key: 'code' },
          { label: 'Precio', render: (r) => money(r.price_monthly, r.currency) },
          { label: 'Público', render: (r) => (r.public ? 'Sí' : 'No') },
          { label: 'Estado', render: (r) => badge(r.active ? 'ACTIVE' : 'CANCELED') },
          {
            label: 'Acción',
            render: (r) =>
              `<form method="post" action="/saas/plans/${r.id}/toggle">${csrfInput(req.session.csrf_token)}<button class="link-button">${r.active ? 'Retirar' : 'Activar'}</button></form>`,
          },
        ],
        plans,
      ),
    ) +
    editors
  );
}

async function tenantOverridesCard(req, tenantId) {
  const rows = await db
    .prepare(
      `SELECT f.*,tf.enabled tenant_enabled,tf.limit_value tenant_limit FROM features f LEFT JOIN tenant_features tf ON tf.feature_id=f.id AND tf.tenant_id=? ORDER BY f.kind,f.name`,
    )
    .all(tenantId);
  const fields = rows
    .map((feature) =>
      feature.kind === 'limit'
        ? field(
            `limit_${feature.id}`,
            `${feature.name} (vacío = plan)`,
            'number',
            feature.tenant_limit ?? '',
            { min: 0 },
          )
        : select(
            `enabled_${feature.id}`,
            feature.name,
            [
              ['', 'Heredar del plan'],
              ['1', 'Forzar activada'],
              ['0', 'Forzar desactivada'],
            ],
            feature.tenant_enabled == null ? '' : String(feature.tenant_enabled),
          ),
    )
    .join('');
  return formCard(
    'Excepciones de funcionalidades',
    `/saas/tenants/${tenantId}/features`,
    req.session.csrf_token,
    fields,
    'Guardar excepciones',
  );
}
async function featuresAdminPage(req) {
  const rows = await db
    .prepare(
      `SELECT f.*,(SELECT COUNT(*) FROM plan_features pf WHERE pf.feature_id=f.id AND pf.enabled=1) plan_count FROM features f ORDER BY f.name`,
    )
    .all();
  return (
    pageHead(
      'ENTITLEMENTS',
      'Funcionalidades',
      'Control global, por plan y excepciones por tenant.',
    ) +
    formCard(
      'Nueva funcionalidad',
      '/saas/features',
      req.session.csrf_token,
      field('name', 'Nombre', 'text', '', { required: true }) +
        field('code', 'Código', 'text', '', { required: true }) +
        field('description', 'Descripción') +
        select('kind', 'Tipo', [
          ['boolean', 'Activar/desactivar'],
          ['limit', 'Límite numérico'],
        ]),
      'Crear funcionalidad',
    ) +
    card(
      'Catálogo global',
      dataTable(
        [
          { label: 'Funcionalidad', key: 'name' },
          { label: 'Código', key: 'code' },
          { label: 'Tipo', key: 'kind' },
          { label: 'Planes activos', key: 'plan_count' },
          { label: 'Global', render: (r) => badge(r.global_enabled ? 'ACTIVE' : 'SUSPENDED') },
          {
            label: 'Acción',
            render: (r) =>
              `<form method="post" action="/saas/features/${r.id}/toggle">${csrfInput(req.session.csrf_token)}<button class="link-button">${r.global_enabled ? 'Desactivar' : 'Activar'}</button></form>`,
          },
        ],
        rows,
      ),
    )
  );
}
async function saasSupportPage(req) {
  const rows = await db
    .prepare(
      'SELECT st.*,t.name tenant,u.name creator FROM support_tickets st JOIN tenants t ON t.id=st.tenant_id JOIN users u ON u.id=st.created_by ORDER BY st.updated_at DESC',
    )
    .all();
  return (
    pageHead(
      'ATENCIÓN',
      'Soporte a talleres',
      'Incidencias, consultas y mejoras en una bandeja única.',
    ) +
    card(
      'Tickets',
      dataTable(
        [
          { label: 'Taller', key: 'tenant' },
          { label: 'Asunto', key: 'subject' },
          { label: 'Tipo', key: 'type' },
          { label: 'Prioridad', key: 'priority' },
          {
            label: 'Estado',
            render: (r) =>
              `<form class="inline-form" method="post" action="/saas/support/${r.id}">${csrfInput(req.session.csrf_token)}${select(
                'status',
                '',
                [
                  ['NEW', 'Nuevo'],
                  ['IN_REVIEW', 'En revisión'],
                  ['IN_PROGRESS', 'En progreso'],
                  ['RESOLVED', 'Resuelto'],
                  ['CLOSED', 'Cerrado'],
                ],
                r.status,
              )}<input name="resolution" placeholder="Resolución" value="${esc(r.resolution || '')}"><button class="link-button">Guardar</button></form>`,
          },
        ],
        rows,
      ),
    )
  );
}
async function auditPage() {
  const rows = await db
    .prepare(
      'SELECT a.*,u.name actor,t.name tenant FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN tenants t ON t.id=a.tenant_id ORDER BY a.created_at DESC LIMIT 250',
    )
    .all();
  return (
    pageHead(
      'TRAZABILIDAD',
      'Auditoría',
      'Acciones críticas con actor, alcance, fecha y entidad.',
    ) +
    card(
      'Registro administrativo',
      dataTable(
        [
          { label: 'Fecha', render: (r) => new Date(r.created_at).toLocaleString('es-PY') },
          { label: 'Acción', key: 'action' },
          { label: 'Taller', key: 'tenant' },
          { label: 'Actor', key: 'actor' },
          {
            label: 'Entidad',
            render: (r) => `${esc(r.entity_type || '—')} ${esc(r.entity_id || '')}`,
          },
          { label: 'IP', key: 'ip_address' },
        ],
        rows,
      ),
    )
  );
}
async function platformSettingsPage(req) {
  const settings = Object.fromEntries(
    (await db.prepare('SELECT key,value FROM platform_settings').all()).map((x) => [
      x.key,
      x.value,
    ]),
  );
  return (
    pageHead(
      'GOBIERNO',
      'Configuración global',
      'Prueba, gracia, suspensión y retención controlados centralmente.',
    ) +
    formCard(
      'Reglas de plataforma',
      '/saas/settings',
      req.session.csrf_token,
      field('platform_name', 'Nombre de plataforma', 'text', settings.platform_name) +
        field('support_email', 'Email de soporte', 'email', settings.support_email) +
        field('trial_days', 'Días de prueba', 'number', settings.trial_days, { min: 0 }) +
        field('grace_days', 'Días de aviso', 'number', settings.grace_days, { min: 0 }) +
        field('suspension_days', 'Días hasta suspensión', 'number', settings.suspension_days, {
          min: 0,
        }) +
        field('retention_days', 'Retención tras cancelar', 'number', settings.retention_days, {
          min: 30,
        }),
      'Guardar reglas',
    )
  );
}

async function handleGet(req, res, url) {
  configureUi({
    name: await platformSetting(db, 'platform_name', config.appName),
    trialDays: Number(await platformSetting(db, 'trial_days', 14)),
  });
  const p = url.pathname;
  if (await releaseGet(req, res, url, releaseApi())) return;
  if (await mobileGet(req, res, url, releaseApi())) return;
  let workshopParams;
  if (p.startsWith('/assets/')) {
    const relative = p.slice('/assets/'.length);
    if (relative.includes('..')) return send(res, 404, 'No encontrado', 'text/plain');
    const file = path.resolve('public', relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      return send(res, 404, 'No encontrado', 'text/plain');
    return send(
      res,
      200,
      fs.readFileSync(file),
      mime[path.extname(file)] || 'application/octet-stream',
    );
  }
  if (p === '/health') {
    const database = (await db.prepare('SELECT 1 ok').get())?.ok === 1,
      migrations = (await db.prepare('SELECT COUNT(*) total FROM schema_migrations').get()).total;
    return send(
      res,
      database ? 200 : 503,
      JSON.stringify({
        status: database ? 'ok' : 'degraded',
        database: database ? 'ok' : 'error',
        migrations: Number(migrations),
        time: now(),
      }),
      'application/json; charset=utf-8',
    );
  }
  if (p === '/')
    return render(res, 'Software para talleres', publicHome(await plansPublic()), req, url);
  if (p === '/features') return render(res, 'Funcionalidades', featuresPage(), req, url);
  if (p === '/pricing') return render(res, 'Precios', pricingPage(await plansPublic()), req, url);
  if (p === '/faq') return render(res, 'Preguntas frecuentes', faqPage(), req, url);
  if (p === '/contact') {
    const token = guestCsrf(req);
    return renderGuest(
      res,
      'Contacto',
      `<section class="public-heading"><span class="eyebrow">HABLEMOS</span><h1>Tu taller tiene una forma propia de trabajar.</h1><p>Cuéntanos qué necesitas y te ayudaremos a configurar Mecan Cloud.</p></section><section class="faq">${formCard('Enviar consulta', '/contact', token, field('name', 'Nombre', 'text', '', { required: true }) + field('email', 'Email', 'email', '', { required: true }) + field('workshop', 'Taller') + textarea('message', 'Mensaje', '', { required: true }), 'Enviar').replace('name="csrf"', 'name="guestCsrf"')}</section>`,
      req,
      url,
      token,
    );
  }
  if (p === '/login') {
    const token = guestCsrf(req);
    return renderGuest(res, 'Ingresar', authPage('login', [], '', token), req, url, token);
  }
  if (p === '/signup') {
    const token = guestCsrf(req);
    return renderGuest(
      res,
      'Crear taller',
      authPage('signup', await plansPublic(), url.searchParams.get('plan'), token),
      req,
      url,
      token,
    );
  }
  if (p === '/forgot-password') {
    const token = guestCsrf(req);
    return renderGuest(
      res,
      'Recuperar acceso',
      `<section class="auth-shell"><div class="auth-story"><a class="logo logo-light" href="/"><span class="brand-mark">M</span>${esc(config.appName)}</a><div><span class="eyebrow">RECUPERAR ACCESO</span><h1>Vuelve a tu taller de forma segura.</h1><p>Si el email existe enviaremos un enlace de un solo uso, válido por 30 minutos.</p></div></div><div class="auth-panel"><form method="post" action="/forgot-password" class="auth-form"><input type="hidden" name="guestCsrf" value="${token}"><h2>Recuperar contraseña</h2>${field('email', 'Email', 'email', '', { required: true })}<button class="button button-large">Enviar enlace</button><small><a href="/login">Volver al acceso</a></small></form></div></section>`,
      req,
      url,
      token,
    );
  }
  if (p === '/reset-password') {
    const token = guestCsrf(req),
      resetToken = url.searchParams.get('token') || '';
    return renderGuest(
      res,
      'Nueva contraseña',
      `<section class="auth-shell"><div class="auth-story"><a class="logo logo-light" href="/"><span class="brand-mark">M</span>${esc(config.appName)}</a><div><span class="eyebrow">SEGURIDAD</span><h1>Elige una nueva contraseña.</h1><p>Debe tener al menos 10 caracteres, mayúscula, minúscula y número.</p></div></div><div class="auth-panel"><form method="post" action="/reset-password" class="auth-form"><input type="hidden" name="guestCsrf" value="${token}"><input type="hidden" name="token" value="${esc(resetToken)}"><h2>Nueva contraseña</h2>${field('password', 'Contraseña', 'password', '', { required: true })}${field('confirmation', 'Confirmar contraseña', 'password', '', { required: true })}<button class="button button-large">Cambiar contraseña</button></form></div></section>`,
      req,
      url,
      token,
    );
  }
  if (p === '/app') {
    requireAuth(req);
    return redirect(res, req.session.kind === 'PLATFORM' ? '/saas' : '/workshop');
  }
  if (p === '/workshop') {
    requireWorkshop(req);
    assertPermission(req.context, 'dashboard.view');
    return render(res, 'Resumen', await workshopDashboard(req), req, url, 'workshop');
  }
  if (p === '/workshop/onboarding') {
    requireWorkshop(req);
    assertPermission(req.context, 'settings.manage');
    return render(res, 'Configuración inicial', await onboardingPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/branches') {
    requireWorkshop(req);
    assertPermission(req.context, 'branches.manage');
    return render(res, 'Sucursales', await branchesPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/employees') {
    requireWorkshop(req);
    assertPermission(req.context, 'employees.manage');
    return render(res, 'Equipo', await employeesPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/customers') {
    requireWorkshop(req);
    assertPermission(req.context, 'customers.view');
    return render(res, 'Clientes', await customersPage(req), req, url, 'workshop');
  }
  workshopParams = match('/workshop/customers/:id', p);
  if (workshopParams) {
    requireWorkshop(req);
    assertPermission(req.context, 'customers.view');
    return render(
      res,
      'Cliente',
      await customerDetailPage(db, req, workshopParams.id),
      req,
      url,
      'workshop',
    );
  }
  if (p === '/workshop/vehicles') {
    requireWorkshop(req);
    assertPermission(req.context, 'vehicles.view');
    return render(res, 'Vehículos', await vehiclesPage(req), req, url, 'workshop');
  }
  workshopParams = match('/workshop/vehicles/:id', p);
  if (workshopParams) {
    requireWorkshop(req);
    assertPermission(req.context, 'vehicles.view');
    return render(
      res,
      'Vehículo',
      await vehicleDetailPage(db, req, workshopParams.id),
      req,
      url,
      'workshop',
    );
  }
  if (p === '/workshop/services') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.view');
    return render(res, 'Servicios', await servicesPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/search') {
    requireWorkshop(req);
    assertPermission(req.context, 'search.use');
    return render(
      res,
      'Buscar',
      await globalSearchPage(db, req, url.searchParams.get('q')),
      req,
      url,
      'workshop',
    );
  }
  if (p === '/workshop/my-work') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.execute');
    return render(res, 'Mis trabajos', await myWorkPage(db, req), req, url, 'workshop');
  }
  if (p === '/workshop/orders') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.view');
    return render(res, 'Órdenes', await ordersPage(req, url), req, url, 'workshop');
  }
  workshopParams = match('/workshop/orders/:id', p);
  if (workshopParams) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.view');
    return render(
      res,
      `Orden`,
      await orderDetailPage(db, req, workshopParams.id),
      req,
      url,
      'workshop',
    );
  }
  if (p === '/workshop/schedule') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.view');
    return render(res, 'Agenda y bahías', await schedulePage(req), req, url, 'workshop');
  }
  if (p === '/workshop/inventory') {
    requireWorkshop(req);
    assertPermission(req.context, 'inventory.view');
    return render(res, 'Inventario', await inventoryPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/purchases') {
    requireWorkshop(req);
    if (!can(req.context, 'purchases.manage')) assertPermission(req.context, 'purchases.pay');
    return render(res, 'Compras', await purchasesPage(db, req), req, url, 'workshop');
  }
  if (p === '/workshop/billing') {
    requireWorkshop(req);
    assertPermission(req.context, 'billing.view');
    return render(res, 'Facturación y caja', await workshopBillingPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/reports') {
    requireWorkshop(req);
    assertPermission(req.context, 'reports.view');
    await assertEntitlement(db, req.context.tenant.id, 'reports');
    return render(res, 'Reportes', await reportsPage(db, req, url), req, url, 'workshop');
  }
  if (p === '/workshop/reports/export') {
    requireWorkshop(req);
    assertPermission(req.context, 'reports.export');
    await assertEntitlement(db, req.context.tenant.id, 'reports');
    const { start, end, from, to } = reportPeriod(
      url,
      (
        await db
          .prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?')
          .get(req.context.tenant.id)
      )?.timezone,
    );
    const finance = can(req.context, 'billing.view');
    const rows = await db
      .prepare(
        `SELECT o.number,o.created_at,o.status,c.name customer,v.plate,o.subtotal,o.tax,o.total,COALESCE(i.paid_amount,0) paid,COALESCE(i.balance,0) balance FROM work_orders o JOIN customers c ON c.id=o.customer_id JOIN vehicles v ON v.id=o.vehicle_id LEFT JOIN workshop_invoices i ON i.work_order_id=o.id AND i.tenant_id=o.tenant_id AND i.voided_at IS NULL WHERE o.tenant_id=? AND o.created_at BETWEEN ? AND ? ORDER BY o.created_at`,
      )
      .all(req.context.tenant.id, from, to);
    const csv = [
      finance
        ? 'orden,fecha,estado,cliente,patente,subtotal,impuesto,total,cobrado,saldo'
        : 'orden,fecha,estado,cliente,patente',
      ...rows.map((row) =>
        [
          row.number,
          row.created_at,
          row.status,
          row.customer,
          row.plate,
          ...(finance ? [row.subtotal, row.tax, row.total, row.paid, row.balance] : []),
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n');
    res.writeHead(200, {
      ...headers('text/csv; charset=utf-8'),
      'Content-Disposition': `attachment; filename="reporte-${start}-${end}.csv"`,
    });
    return res.end(`\ufeff${csv}`);
  }
  if (p === '/workshop/documents') {
    requireWorkshop(req);
    assertPermission(req.context, 'documents.view');
    return render(res, 'Documentos', await documentsPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/notifications') {
    requireWorkshop(req);
    assertPermission(req.context, 'dashboard.view');
    return render(res, 'Notificaciones', await notificationsPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/subscription') {
    requireWorkshop(req);
    assertPermission(req.context, 'settings.manage');
    return render(res, 'Mi suscripción', await subscriptionPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/support') {
    requireWorkshop(req);
    assertPermission(req.context, 'support.manage');
    return render(res, 'Soporte', await supportPage(req), req, url, 'workshop');
  }
  if (p === '/workshop/settings') {
    requireWorkshop(req);
    assertPermission(req.context, 'settings.manage');
    return render(res, 'Configuración', await settingsPage(req), req, url, 'workshop');
  }
  if (p === '/saas') {
    requirePlatform(req);
    return render(res, 'Control SaaS', await saasDashboard(), req, url, 'saas');
  }
  if (p === '/saas/tenants') {
    requirePlatform(req);
    return render(res, 'Talleres', await tenantsPage(), req, url, 'saas');
  }
  let params = match('/saas/tenants/:id', p);
  if (params) {
    requirePlatform(req);
    return render(
      res,
      'Ficha del taller',
      await tenantDetailPage(req, params.id),
      req,
      url,
      'saas',
    );
  }
  if (p === '/saas/collections') {
    requirePlatform(req);
    return render(res, 'Cobranza', await collectionsPage(req), req, url, 'saas');
  }
  if (p === '/saas/plans') {
    requirePlatform(req);
    return render(res, 'Planes', await plansPage(req), req, url, 'saas');
  }
  if (p === '/saas/features') {
    requirePlatform(req);
    return render(res, 'Funcionalidades', await featuresAdminPage(req), req, url, 'saas');
  }
  if (p === '/saas/support') {
    requirePlatform(req);
    return render(res, 'Soporte', await saasSupportPage(req), req, url, 'saas');
  }
  if (p === '/saas/audit') {
    requirePlatform(req);
    return render(res, 'Auditoría', await auditPage(), req, url, 'saas');
  }
  if (p === '/saas/settings') {
    requirePlatform(req);
    return render(res, 'Configuración', await platformSettingsPage(req), req, url, 'saas');
  }
  params = match('/saas/payments/:id/receipt', p);
  if (params) {
    requirePlatform(req);
    const pay = await db
      .prepare(
        'SELECT sp.*,t.name,t.legal_name,t.tax_id,si.number invoice_number FROM saas_payments sp JOIN tenants t ON t.id=sp.tenant_id LEFT JOIN saas_invoices si ON si.id=sp.invoice_id WHERE sp.id=?',
      )
      .get(params.id);
    if (!pay) throw Object.assign(new Error('Pago no encontrado.'), { status: 404 });
    return render(
      res,
      'Comprobante',
      pageHead('COMPROBANTE', pay.invoice_number || 'Pago SaaS', `Pago recibido de ${pay.name}`) +
        card(
          'Detalle',
          `<div class="stat-list"><div><span>Taller</span><b>${esc(pay.legal_name || pay.name)}</b></div><div><span>RUC</span><b>${esc(pay.tax_id || '—')}</b></div><div><span>Fecha</span><b>${shortDate(pay.paid_at)}</b></div><div><span>Método</span><b>${esc(pay.method)}</b></div><div><span>Referencia</span><b>${esc(pay.reference || '—')}</b></div><div><span>Total</span><b>${money(pay.amount, pay.currency)}</b></div></div>`,
        ),
      req,
      url,
      'saas',
    );
  }
  params = match('/api/files/:id', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'documents.view');
    const file = await db
      .prepare('SELECT * FROM files WHERE id=? AND tenant_id=?')
      .get(params.id, req.context.tenant.id);
    if (!file) return send(res, 404, 'No encontrado', 'text/plain');
    const storage = resolveStorageKey(file.storage_key);
    if (!fs.existsSync(storage)) return send(res, 404, 'No encontrado', 'text/plain');
    res.writeHead(200, {
      ...headers(file.mime_type),
      'Content-Disposition': `attachment; filename="documento"; filename*=UTF-8\'\'${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, no-store',
    });
    return res.end(fs.readFileSync(storage));
  }
  params = match('/saas/tenants/:id/export', p);
  if (params) {
    requirePlatform(req);
    const tenant = await db.prepare('SELECT * FROM tenants WHERE id=?').get(params.id);
    if (!tenant) throw Object.assign(new Error('Taller no encontrado.'), { status: 404 });
    const exported = {
      tenant,
      branches: await db.prepare('SELECT * FROM branches WHERE tenant_id=?').all(params.id),
      customers: await db.prepare('SELECT * FROM customers WHERE tenant_id=?').all(params.id),
      vehicles: await db.prepare('SELECT * FROM vehicles WHERE tenant_id=?').all(params.id),
      orders: await db.prepare('SELECT * FROM work_orders WHERE tenant_id=?').all(params.id),
      exportedAt: now(),
    };
    return send(res, 200, JSON.stringify(exported, null, 2), 'application/json; charset=utf-8');
  }
  send(
    res,
    404,
    layout({
      title: 'No encontrado',
      body: '<section class="public-heading"><h1>Página no encontrada</h1><p>La dirección solicitada no existe.</p><a class="button" href="/">Volver al inicio</a></section>',
      area: 'public',
    }),
  );
}

async function handlePost(req, res, url, data) {
  const p = url.pathname;
  if (await releasePost(req, res, url, data, releaseApi())) return;
  if (p === '/login') {
    checkGuestCsrf(req, data);
    const loginEmail = String(data.email || '')
        .trim()
        .toLowerCase(),
      ip = clientIp(req);
    await assertLoginAllowed(db, loginEmail, ip);
    const user = await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(loginEmail),
      valid =
        verifyPassword(data.password, user?.password_hash || dummyPasswordHash) && Boolean(user);
    await recordLoginAttempt(db, loginEmail, ip, valid);
    if (!valid)
      return redirect(res, withMessage('/login', 'Email o contraseña incorrectos.', 'error'));
    const session = await createSession(db, user.id, config.sessionDays, {
      ip,
      userAgent: req.headers['user-agent'],
    });
    await audit(db, {
      scope: user.kind === 'PLATFORM' ? 'PLATFORM' : 'TENANT',
      actorUserId: user.id,
      action: 'LOGIN',
      ip,
      requestId: req.requestId,
    });
    return redirect(
      res,
      safeNext(data.next),
      sessionCookie(session.id, config.secureTransport, config.sessionDays),
    );
  }
  if (p === '/signup') {
    checkGuestCsrf(req, data);
    if (
      config.production &&
      (!legalDocument('terms') || !legalDocument('privacy') || data.acceptLegal !== '1')
    )
      throw new AppError('Debes aceptar los términos y la política de privacidad vigentes.', {
        status: 422,
      });
    try {
      const ip = clientIp(req),
        created = await provisionWorkshop(db, data, { ip });
      if (data.acceptLegal === '1' && legalDocument('terms') && legalDocument('privacy'))
        await db
          .prepare(
            'INSERT INTO legal_acceptances (id,user_id,tenant_id,terms_version,privacy_version,accepted_at) VALUES (?,?,?,?,?,?)',
          )
          .run(
            id(),
            created.userId,
            created.tenantId,
            legalDocument('terms').version,
            legalDocument('privacy').version,
            now(),
          );
      const session = await createSession(db, created.userId, config.sessionDays, {
        ip,
        userAgent: req.headers['user-agent'],
      });
      return redirect(
        res,
        '/workshop/onboarding',
        sessionCookie(session.id, config.secureTransport, config.sessionDays),
      );
    } catch (error) {
      const friendly = publicError(error);
      return redirect(res, withMessage('/signup', friendly.message, 'error'));
    }
  }
  if (p === '/contact') {
    checkGuestCsrf(req, data);
    const ipHash = opaqueHash(clientIp(req)),
      since = new Date(Date.now() - 60 * 60_000).toISOString(),
      count = (
        await db
          .prepare('SELECT COUNT(*) total FROM contact_inquiries WHERE ip_hash=? AND created_at>=?')
          .get(ipHash, since)
      ).total;
    if (Number(count) >= 5)
      throw Object.assign(
        new Error('Recibimos varias consultas desde esta conexión. Intenta nuevamente más tarde.'),
        { status: 429 },
      );
    const name = required(data.name, 'El nombre', { max: 150 }),
      contactEmail = validEmail(data.email),
      message = required(data.message, 'El mensaje', { min: 10, max: 4000 });
    await db
      .prepare(
        "INSERT INTO contact_inquiries (id,name,email,workshop,message,status,ip_hash,created_at) VALUES (?,?,?,?,?,'NEW',?,?)",
      )
      .run(id(), name, contactEmail, optional(data.workshop, { max: 180 }), message, ipHash, now());
    return redirect(
      res,
      withMessage('/contact', 'Gracias. Recibimos tu consulta y te contactaremos pronto.'),
    );
  }
  if (p === '/forgot-password') {
    checkGuestCsrf(req, data);
    const email = String(data.email || '')
        .trim()
        .toLowerCase(),
      ip = clientIp(req),
      identityHash = opaqueHash(email),
      ipHash = opaqueHash(ip),
      since = new Date(Date.now() - 60 * 60_000).toISOString(),
      attempts = (
        await db
          .prepare(
            'SELECT COUNT(*) total FROM password_reset_requests WHERE requested_at>=? AND (identity_hash=? OR ip_hash=?)',
          )
          .get(since, identityHash, ipHash)
      ).total;
    if (Number(attempts) >= 5)
      throw Object.assign(
        new Error('Recibimos varias solicitudes. Espera una hora antes de intentarlo nuevamente.'),
        { status: 429 },
      );
    await db
      .prepare(
        'INSERT INTO password_reset_requests (id,identity_hash,ip_hash,requested_at) VALUES (?,?,?,?)',
      )
      .run(id(), identityHash, ipHash, now());
    const user = await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
    if (user) {
      const token = await createPasswordReset(db, user.id),
        membership = await db
          .prepare('SELECT tenant_id FROM memberships WHERE user_id=? LIMIT 1')
          .get(user.id);
      await queueNotification(db, {
        tenantId: membership?.tenant_id || null,
        userId: user.id,
        channel: 'EMAIL',
        eventType: 'PASSWORD_RESET',
        title: 'Recupera tu acceso a Mecan Cloud',
        message: 'Recibimos una solicitud para cambiar tu contraseña.',
        payload: {
          to: user.email,
          resetUrl: `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
        },
        idempotencyKey: `password-reset:${opaqueHash(token)}`,
      });
      await audit(db, {
        scope: user.kind === 'PLATFORM' ? 'PLATFORM' : 'TENANT',
        tenantId: membership?.tenant_id || null,
        actorUserId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        ip,
        requestId: req.requestId,
      });
    }
    return redirect(
      res,
      withMessage('/login', 'Si el email está registrado, recibirás un enlace de recuperación.'),
    );
  }
  if (p === '/reset-password') {
    checkGuestCsrf(req, data);
    if (data.password !== data.confirmation)
      throw Object.assign(new Error('Las contraseñas no coinciden.'), { status: 422 });
    const password = String(data.password || '');
    if (
      password.length < 10 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    )
      throw Object.assign(
        new Error(
          'La contraseña debe tener al menos 10 caracteres, mayúscula, minúscula y número.',
        ),
        { status: 422 },
      );
    if (!(await consumePasswordReset(db, data.token, hashPassword(password))))
      throw Object.assign(new Error('El enlace expiró o ya fue utilizado. Solicita uno nuevo.'), {
        status: 422,
      });
    return redirect(
      res,
      withMessage('/login', 'Contraseña actualizada. Inicia sesión nuevamente.'),
    );
  }
  requireAuth(req);
  checkCsrf(req, data);
  if (p === '/logout') {
    await db.prepare('DELETE FROM sessions WHERE id=?').run(req.session.id);
    return redirect(res, '/', clearSessionCookie(config.secureTransport));
  }

  if (p === '/workshop/branches') {
    requireWorkshop(req);
    assertPermission(req.context, 'branches.manage');
    assertTenantWritable(req.context);
    await createBranch(db, req.context, data);
    return redirect(res, withMessage(p, 'Sucursal creada.'));
  }
  if (p === '/workshop/employees') {
    requireWorkshop(req);
    assertPermission(req.context, 'employees.manage');
    assertTenantWritable(req.context);
    await createEmployee(db, req.context, data);
    return redirect(
      res,
      withMessage(p, 'Empleado creado. Comparte la clave temporal de forma segura.'),
    );
  }
  let params;
  if (p === '/workshop/roles') {
    requireWorkshop(req);
    assertPermission(req.context, 'employees.manage');
    assertTenantWritable(req.context);
    const roleName = required(data.name, 'El nombre del rol', { max: 100 }),
      selected = permissions.filter(([code]) => data[`perm_${code}`]).map(([code]) => code),
      code = roleName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    for (const permission of selected) assertPermission(req.context, permission);
    await db
      .prepare('INSERT INTO roles (id,tenant_id,code,name,permissions,system) VALUES (?,?,?,?,?,0)')
      .run(id(), req.context.tenant.id, code, roleName, JSON.stringify(selected));
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      action: 'ROLE_CREATED',
      entityType: 'role',
      after: { name: roleName, permissions: selected },
    });
    return redirect(res, withMessage('/workshop/employees', 'Rol creado.'));
  }
  if (p === '/workshop/customers') {
    requireWorkshop(req);
    assertPermission(req.context, 'customers.create');
    assertTenantWritable(req.context);
    const branch =
        req.context.membership?.branch_id ||
        (
          await db
            .prepare('SELECT id FROM branches WHERE tenant_id=? AND is_main=1')
            .get(req.context.tenant.id)
        ).id,
      name = required(data.name, 'El nombre del cliente', { max: 180 }),
      customerEmail = data.email ? validEmail(data.email) : null,
      customerId = id();
    await db
      .prepare(
        'INSERT INTO customers (id,tenant_id,branch_id,name,document,phone,email,address,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        customerId,
        req.context.tenant.id,
        branch,
        name,
        optional(data.document, { max: 80 }),
        optional(data.phone, { max: 60 }),
        customerEmail,
        optional(data.address, { max: 500 }),
        optional(data.notes, { max: 3000 }),
        now(),
      );
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: customerId,
      after: { name, document: data.document || null },
    });
    return redirect(res, withMessage(p, 'Cliente registrado.'));
  }
  params = match('/workshop/customers/:id/communications', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'customers.update');
    assertTenantWritable(req.context);
    if (
      !(await db
        .prepare('SELECT 1 FROM customers WHERE id=? AND tenant_id=?')
        .get(params.id, req.context.tenant.id))
    )
      throw Object.assign(new Error('Cliente no encontrado.'), { status: 404 });
    const allowedChannels = ['PHONE', 'EMAIL', 'WHATSAPP', 'SMS', 'IN_PERSON', 'OTHER'],
      allowedDirections = ['INBOUND', 'OUTBOUND'];
    if (
      !allowedChannels.includes(data.channel) ||
      !allowedDirections.includes(data.direction) ||
      !String(data.body || '').trim()
    )
      throw Object.assign(new Error('Completa canal, dirección y detalle de la comunicación.'), {
        status: 422,
      });
    const communicationId = id();
    await db
      .prepare(
        'INSERT INTO customer_communications (id,tenant_id,customer_id,channel,direction,subject,body,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,' +
          "'RECORDED'" +
          ',?,?)',
      )
      .run(
        communicationId,
        req.context.tenant.id,
        params.id,
        data.channel,
        data.direction,
        data.subject || null,
        String(data.body).trim(),
        req.session.user_id,
        now(),
      );
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      action: 'CUSTOMER_COMMUNICATION_RECORDED',
      entityType: 'customer_communication',
      entityId: communicationId,
      after: { customerId: params.id, channel: data.channel, direction: data.direction },
    });
    return redirect(
      res,
      withMessage(`/workshop/customers/${params.id}`, 'Comunicación registrada.'),
    );
  }
  if (p === '/workshop/vehicles') {
    requireWorkshop(req);
    assertPermission(req.context, 'vehicles.create');
    assertTenantWritable(req.context);
    const count = (
      await db
        .prepare('SELECT COUNT(*) n FROM vehicles WHERE tenant_id=?')
        .get(req.context.tenant.id)
    ).n;
    await assertEntitlement(db, req.context.tenant.id, 'vehicles', count);
    if (
      !(await db
        .prepare('SELECT 1 FROM customers WHERE id=? AND tenant_id=?')
        .get(data.customerId, req.context.tenant.id))
    )
      throw Object.assign(new Error('Cliente inválido.'), { status: 422 });
    const plate = required(data.plate, 'La patente', { max: 30 }).toUpperCase(),
      vehicleId = id(),
      year = data.year
        ? integer(data.year, 'El año', { min: 1886, max: new Date().getFullYear() + 1 })
        : null,
      odometer = integer(data.odometer || 0, 'El kilometraje');
    await db
      .prepare(
        'INSERT INTO vehicles (id,tenant_id,customer_id,plate,make,model,year,vin,color,odometer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        vehicleId,
        req.context.tenant.id,
        data.customerId,
        plate,
        optional(data.make, { max: 100 }),
        optional(data.model, { max: 100 }),
        year,
        optional(data.vin, { max: 80 }),
        optional(data.color, { max: 60 }),
        odometer,
        now(),
      );
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      action: 'VEHICLE_CREATED',
      entityType: 'vehicle',
      entityId: vehicleId,
      after: { plate },
    });
    return redirect(res, withMessage(p, 'Vehículo registrado.'));
  }
  if (p === '/workshop/services') {
    requireWorkshop(req);
    assertPermission(req.context, 'settings.manage');
    assertTenantWritable(req.context);
    const name = required(data.name, 'El nombre del servicio', { max: 180 }),
      price = moneyAmount(
        data.price,
        await tenantCurrency(db, req.context.tenant.id),
        'El precio',
        {
          allowZero: true,
        },
      ),
      duration = integer(data.duration || 60, 'La duración', { min: 1, max: 100000 });
    await db
      .prepare(
        'INSERT INTO services (id,tenant_id,name,description,price,duration_minutes,created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        id(),
        req.context.tenant.id,
        name,
        optional(data.description, { max: 2000 }),
        price,
        duration,
        now(),
      );
    return redirect(res, withMessage(p, 'Servicio creado.'));
  }
  if (p === '/workshop/orders') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.create');
    const created = await receiveVehicle(db, req.context, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(
        `/workshop/orders/${created.orderId}`,
        'Recepción creada. Continúa con la inspección.',
      ),
    );
  }
  params = match('/workshop/orders/:id/inspection', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.inspect');
    await completeInspection(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(res, withMessage(`/workshop/orders/${params.id}`, 'Inspección completada.'));
  }
  params = match('/workshop/orders/:id/diagnosis', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.diagnose');
    await completeDiagnosis(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(res, withMessage(`/workshop/orders/${params.id}`, 'Diagnóstico completado.'));
  }
  params = match('/workshop/orders/:id/estimate/items', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.estimate');
    await addEstimateItem(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Concepto agregado al presupuesto.'),
    );
  }
  params = match('/workshop/orders/:id/estimate/send', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.estimate');
    await sendEstimate(db, req.context, params.id, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Presupuesto enviado para autorización.'),
    );
  }
  params = match('/workshop/orders/:id/estimate/approve', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.approve');
    await approveEstimate(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(res, withMessage(`/workshop/orders/${params.id}`, 'Autorización registrada.'));
  }
  params = match('/workshop/orders/:id/assignments', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.assign');
    await assignTechnician(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(res, withMessage(`/workshop/orders/${params.id}`, 'Trabajo asignado.'));
  }
  params = match('/workshop/assignments/:id/:action', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.execute');
    await updateAssignment(
      db,
      req.context,
      params.id,
      String(params.action).toUpperCase(),
      data,
      tenantAuditActor(req),
    );
    return redirect(
      res,
      withMessage(refererPath(req, '/workshop/my-work'), 'Trabajo actualizado.'),
    );
  }
  params = match('/workshop/orders/:id/parts', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'inventory.consume');
    await consumePart(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Repuesto descontado e incorporado a la orden.'),
    );
  }
  params = match('/workshop/orders/:id/part-requests', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'inventory.request');
    await requestPart(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Solicitud de compra creada.'),
    );
  }
  params = match('/workshop/orders/:id/quality/start', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.quality');
    await sendToQuality(db, req.context, params.id, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Orden enviada a control de calidad.'),
    );
  }
  params = match('/workshop/orders/:id/quality', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.quality');
    await recordQualityCheck(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Control de calidad registrado.'),
    );
  }
  params = match('/workshop/orders/:id/invoice', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'billing.invoice');
    await invoiceOrder(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Factura emitida sin duplicados.'),
    );
  }
  params = match('/workshop/invoices/:id/void', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'billing.void');
    await voidInvoice(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(
        refererPath(req, '/workshop/billing'),
        'Factura anulada. La orden volvió a lista para facturar.',
      ),
    );
  }
  params = match('/workshop/orders/:id/cancel', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.cancel');
    await cancelOrder(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Orden cancelada con trazabilidad.'),
    );
  }
  params = match('/workshop/invoices/:id/payments', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'billing.collect');
    await recordCustomerPayment(db, req.context, params.id, data, tenantAuditActor(req));
    const invoice = await db
      .prepare('SELECT work_order_id FROM workshop_invoices WHERE id=? AND tenant_id=?')
      .get(params.id, req.context.tenant.id);
    return redirect(
      res,
      withMessage(
        `/workshop/orders/${invoice.work_order_id}`,
        'Cobro registrado y caja actualizada.',
      ),
    );
  }
  params = match('/workshop/orders/:id/delivery', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.deliver');
    await deliverVehicle(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Vehículo entregado y garantía registrada.'),
    );
  }
  params = match('/workshop/purchase-requests/:id/order', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'purchases.manage');
    await createPurchaseOrder(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(res, withMessage('/workshop/purchases', 'Orden de compra creada.'));
  }
  params = match('/workshop/purchase-orders/:id/receive', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'purchases.manage');
    await receivePurchaseOrder(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage('/workshop/purchases', 'Compra recibida, stock y cuenta por pagar actualizados.'),
    );
  }
  params = match('/workshop/payables/:id/payments', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'purchases.pay');
    await paySupplier(db, req.context, params.id, data, tenantAuditActor(req));
    return redirect(
      res,
      withMessage('/workshop/purchases', 'Pago al proveedor registrado en caja.'),
    );
  }
  if (p === '/workshop/appointments') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.create');
    assertTenantWritable(req.context);
    const customer = await db
      .prepare('SELECT 1 FROM customers WHERE id=? AND tenant_id=?')
      .get(data.customerId, req.context.tenant.id);
    const branch = await db
      .prepare('SELECT 1 FROM branches WHERE id=? AND tenant_id=?')
      .get(data.branchId, req.context.tenant.id);
    const vehicle =
      !data.vehicleId ||
      (await db
        .prepare('SELECT 1 FROM vehicles WHERE id=? AND tenant_id=? AND customer_id=?')
        .get(data.vehicleId, req.context.tenant.id, data.customerId));
    if (!customer || !branch || !vehicle)
      throw Object.assign(new Error('Cliente, vehículo o sucursal inválidos.'), { status: 422 });
    const scheduled = new Date(await tenantDateTime(db, req.context.tenant.id, data.scheduledAt));
    if (Number.isNaN(scheduled.getTime()))
      throw Object.assign(new Error('Selecciona una fecha y hora válidas.'), { status: 422 });
    const appointmentId = id();
    await db
      .prepare(
        'INSERT INTO appointments (id,tenant_id,branch_id,customer_id,vehicle_id,scheduled_at,reason,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,' +
          "'SCHEDULED'" +
          ',?,?)',
      )
      .run(
        appointmentId,
        req.context.tenant.id,
        data.branchId,
        data.customerId,
        data.vehicleId || null,
        scheduled.toISOString(),
        data.reason || null,
        req.session.user_id,
        now(),
      );
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      branchId: data.branchId,
      action: 'APPOINTMENT_CREATED',
      entityType: 'appointment',
      entityId: appointmentId,
      after: { scheduledAt: scheduled.toISOString() },
    });
    return redirect(res, withMessage('/workshop/schedule', 'Turno agendado.'));
  }
  if (p === '/workshop/bays') {
    requireWorkshop(req);
    assertPermission(req.context, 'branches.manage');
    assertTenantWritable(req.context);
    if (
      !(await db
        .prepare('SELECT 1 FROM branches WHERE id=? AND tenant_id=?')
        .get(data.branchId, req.context.tenant.id))
    )
      throw Object.assign(new Error('Sucursal inválida.'), { status: 422 });
    const name = required(data.name, 'El nombre de la bahía', { max: 100 });
    await db
      .prepare(
        "INSERT INTO bays (id,tenant_id,branch_id,name,status,active) VALUES (?,?,?,?,'AVAILABLE',1)",
      )
      .run(id(), req.context.tenant.id, data.branchId, name);
    return redirect(res, withMessage('/workshop/schedule', 'Bahía agregada.'));
  }
  if (p === '/workshop/inventory') {
    requireWorkshop(req);
    assertPermission(req.context, 'inventory.adjust');
    assertTenantWritable(req.context);
    if (data.cost !== undefined || Number(data.quantity || 0) > 0)
      assertPermission(req.context, 'inventory.cost');
    await assertEntitlement(db, req.context.tenant.id, 'inventory');
    if (
      !(await db
        .prepare('SELECT 1 FROM branches WHERE id=? AND tenant_id=? AND active=1')
        .get(data.branchId, req.context.tenant.id))
    )
      throw Object.assign(new Error('Sucursal inválida.'), { status: 422 });
    const name = required(data.name, 'El nombre del artículo', { max: 180 }),
      quantity = positive(data.quantity || 0, 'La existencia', { allowZero: true }),
      minimum = positive(data.minimum || 0, 'El stock mínimo', { allowZero: true }),
      cost = moneyAmount(
        data.cost || 0,
        await tenantCurrency(db, req.context.tenant.id),
        'El costo',
        {
          allowZero: true,
        },
      ),
      price = moneyAmount(
        data.price || 0,
        await tenantCurrency(db, req.context.tenant.id),
        'El precio',
        {
          allowZero: true,
        },
      );

    try {
      await db.transaction(
        async () => {
          const itemId = id();
          await db
            .prepare(
              'INSERT INTO inventory_items (id,tenant_id,branch_id,sku,name,quantity,minimum_stock,cost,sale_price,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              itemId,
              req.context.tenant.id,
              data.branchId,
              optional(data.sku, { max: 80 }),
              name,
              quantity,
              minimum,
              cost,
              price,
              now(),
            );
          if (quantity > 0)
            await db
              .prepare(
                `INSERT INTO inventory_movements (id,tenant_id,branch_id,inventory_item_id,movement_type,quantity,previous_quantity,resulting_quantity,unit_cost,reference_type,reference_id,reason,actor_user_id,idempotency_key,created_at) VALUES (?,?,?,?,'OPENING',?,0,?,?, 'INVENTORY_ITEM',?,'Existencia inicial',?,?,?)`,
              )
              .run(
                id(),
                req.context.tenant.id,
                data.branchId,
                itemId,
                quantity,
                quantity,
                cost,
                itemId,
                req.session.user_id,
                `opening:${data.idempotencyKey || itemId}`,
                now(),
              );
          await audit(db, {
            tenantId: req.context.tenant.id,
            ...tenantAuditActor(req),
            branchId: data.branchId,
            action: 'INVENTORY_ITEM_CREATED',
            entityType: 'inventory_item',
            entityId: itemId,
            after: { quantity, cost, price },
          });
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      throw error;
    }
    return redirect(res, withMessage(p, 'Artículo creado con movimiento inicial trazable.'));
  }
  if (p === '/workshop/suppliers') {
    requireWorkshop(req);
    assertPermission(req.context, 'purchases.manage');
    assertTenantWritable(req.context);
    await assertEntitlement(db, req.context.tenant.id, 'inventory');
    const name = required(data.name, 'El nombre del proveedor', { max: 180 }),
      supplierEmail = data.email ? validEmail(data.email) : null,
      supplierId = id();
    await db
      .prepare(
        'INSERT INTO suppliers (id,tenant_id,name,tax_id,phone,email,address,created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        supplierId,
        req.context.tenant.id,
        name,
        optional(data.taxId, { max: 80 }),
        optional(data.phone, { max: 60 }),
        supplierEmail,
        optional(data.address, { max: 500 }),
        now(),
      );
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      action: 'SUPPLIER_CREATED',
      entityType: 'supplier',
      entityId: supplierId,
      after: { name },
    });
    return redirect(res, withMessage('/workshop/inventory', 'Proveedor creado.'));
  }
  if (p === '/workshop/cash') {
    requireWorkshop(req);
    assertPermission(req.context, 'cash.manage');
    assertTenantWritable(req.context);
    if (
      !(await db
        .prepare('SELECT 1 FROM branches WHERE id=? AND tenant_id=?')
        .get(data.branchId, req.context.tenant.id))
    )
      throw Object.assign(new Error('Sucursal inválida.'), { status: 422 });
    const allowedTypes = ['INCOME', 'EXPENSE'],
      allowedCategories = ['OPERATING_EXPENSE', 'OTHER_INCOME', 'WITHDRAWAL', 'CAPITAL'];
    if (!allowedTypes.includes(data.type) || !allowedCategories.includes(data.category))
      throw Object.assign(new Error('Tipo o categoría de movimiento inválidos.'), { status: 422 });
    const amount = moneyAmount(
      data.amount,
      await tenantCurrency(db, req.context.tenant.id),
      'El importe',
    );
    if (
      (['OPERATING_EXPENSE', 'WITHDRAWAL'].includes(data.category) ? 'EXPENSE' : 'INCOME') !==
      data.type
    )
      throw new AppError('El tipo de movimiento no corresponde con su categoría.', { status: 422 });
    const key = required(data.idempotencyKey, 'La referencia de operación', { max: 200 });
    const duplicate = await db
      .prepare('SELECT * FROM cash_movements WHERE tenant_id=? AND idempotency_key=?')
      .get(req.context.tenant.id, key);
    if (
      duplicate &&
      (Number(duplicate.amount) !== amount ||
        duplicate.type !== data.type ||
        duplicate.category !== data.category ||
        duplicate.branch_id !== data.branchId)
    )
      throw new AppError('La referencia ya se utilizó con otro movimiento.', { status: 409 });

    try {
      await db.transaction(
        async () => {
          if (
            !(await db
              .prepare('SELECT 1 FROM cash_movements WHERE tenant_id=? AND idempotency_key=?')
              .get(req.context.tenant.id, key))
          ) {
            const movementId = id();
            await db
              .prepare(
                'INSERT INTO cash_movements (id,tenant_id,branch_id,type,category,amount,reference,notes,created_by,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
              )
              .run(
                movementId,
                req.context.tenant.id,
                data.branchId,
                data.type,
                data.category,
                amount,
                data.reference || null,
                data.notes || null,
                req.session.user_id,
                now(),
                key,
              );
            await audit(db, {
              tenantId: req.context.tenant.id,
              ...tenantAuditActor(req),
              branchId: data.branchId,
              action: 'CASH_MOVEMENT_CREATED',
              entityType: 'cash_movement',
              entityId: movementId,
              after: { type: data.type, category: data.category, amount },
            });
          }
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      throw error;
    }
    return redirect(res, withMessage('/workshop/billing', 'Movimiento registrado.'));
  }
  if (p === '/workshop/documents') {
    requireWorkshop(req);
    assertPermission(req.context, 'documents.upload');
    assertTenantWritable(req.context);
    let bytes;
    try {
      bytes = Buffer.from(String(data.content || ''), 'base64');
    } catch {
      throw Object.assign(new Error('Archivo inválido.'), { status: 422 });
    }
    if (!bytes.length || bytes.length > 7_000_000)
      throw Object.assign(new Error('El archivo debe pesar menos de 7 MB.'), { status: 422 });
    const actualType = detectFileType(bytes);
    if (!actualType || actualType !== data.mimeType)
      throw Object.assign(
        new Error('El contenido del archivo no coincide con un PDF o imagen permitida.'),
        { status: 422 },
      );
    const cap = await entitlement(db, req.context.tenant.id, 'storage_mb');
    if (!cap.enabled)
      throw Object.assign(new Error('El plan no incluye almacenamiento de documentos.'), {
        status: 402,
      });
    const originalName = safeUploadName(data.name, actualType),
      safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100),
      fileId = id(),
      storageKey = `${req.context.tenant.id}/${fileId}-${safeName}`,
      target = resolveStorageKey(storageKey);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    try {
      await db.transaction(
        async () => {
          const currentUsage = Number(
            (
              await db
                .prepare('SELECT storage_used_bytes FROM tenants WHERE id=?')
                .get(req.context.tenant.id)
            ).storage_used_bytes,
          );
          if (currentUsage + bytes.length > Number(cap.limit || 0) * 1048576)
            throw Object.assign(
              new Error('El archivo supera la cuota de almacenamiento del plan.'),
              {
                status: 402,
              },
            );
          await db
            .prepare(
              'INSERT INTO files (id,tenant_id,name,mime_type,storage_key,size_bytes,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
            )
            .run(
              fileId,
              req.context.tenant.id,
              originalName,
              actualType,
              storageKey,
              bytes.length,
              req.session.user_id,
              now(),
            );
          if (data.entityType && data.entityId) {
            const allowedEntities = new Set(['WORK_ORDER', 'VEHICLE', 'CUSTOMER']);
            if (!allowedEntities.has(data.entityType))
              throw Object.assign(new Error('Tipo de vínculo inválido.'), { status: 422 });
            const table = { WORK_ORDER: 'work_orders', VEHICLE: 'vehicles', CUSTOMER: 'customers' }[
              data.entityType
            ];
            if (
              !(await db
                .prepare(`SELECT 1 FROM ${table} WHERE id=? AND tenant_id=?`)
                .get(data.entityId, req.context.tenant.id))
            )
              throw Object.assign(new Error('El registro vinculado no existe.'), { status: 404 });
            await db
              .prepare(
                'INSERT INTO file_links (file_id,tenant_id,entity_type,entity_id,category) VALUES (?,?,?,?,?)',
              )
              .run(
                fileId,
                req.context.tenant.id,
                data.entityType,
                data.entityId,
                data.category || 'DOCUMENT',
              );
          }
          await db
            .prepare('UPDATE tenants SET storage_used_bytes=storage_used_bytes+? WHERE id=?')
            .run(bytes.length, req.context.tenant.id);
          await audit(db, {
            tenantId: req.context.tenant.id,
            ...tenantAuditActor(req),
            action: 'FILE_UPLOADED',
            entityType: 'file',
            entityId: fileId,
            after: { name: originalName, size: bytes.length, mimeType: actualType },
          });
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      try {
        fs.unlinkSync(target);
      } catch {}
      throw error;
    }
    return redirect(
      res,
      withMessage(
        data.entityType === 'WORK_ORDER' && data.entityId
          ? `/workshop/orders/${data.entityId}`
          : '/workshop/documents',
        'Archivo subido de forma privada.',
      ),
    );
  }
  params = match('/workshop/documents/:id/delete', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'documents.delete');
    assertTenantWritable(req.context);
    const file = await db
      .prepare('SELECT * FROM files WHERE id=? AND tenant_id=?')
      .get(params.id, req.context.tenant.id);
    if (!file) throw Object.assign(new Error('Archivo no encontrado.'), { status: 404 });
    const target = resolveStorageKey(file.storage_key);

    try {
      await db.transaction(
        async () => {
          await db
            .prepare('DELETE FROM files WHERE id=? AND tenant_id=?')
            .run(file.id, req.context.tenant.id);
          await db
            .prepare(
              'UPDATE tenants SET storage_used_bytes=GREATEST(0,storage_used_bytes-?) WHERE id=?',
            )
            .run(file.size_bytes, req.context.tenant.id);
          await audit(db, {
            tenantId: req.context.tenant.id,
            ...tenantAuditActor(req),
            action: 'FILE_DELETED',
            entityType: 'file',
            entityId: file.id,
            before: { name: file.name, size: file.size_bytes },
          });
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      throw error;
    }
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return redirect(res, withMessage('/workshop/documents', 'Archivo eliminado.'));
  }
  params = match('/workshop/notifications/:id/read', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'dashboard.view');
    const result = await markNotificationRead(db, params.id, req.context);
    if (!result.found)
      throw Object.assign(new Error('Notificación no encontrada.'), { status: 404 });
    return redirect(
      res,
      withMessage('/workshop/notifications', 'Notificación marcada como leída.'),
    );
  }
  if (p === '/workshop/support') {
    requireWorkshop(req);
    assertPermission(req.context, 'support.manage');
    const ticketId = id(),
      type = oneOf(data.type, ['PROBLEM', 'QUESTION', 'IDEA'], 'El tipo'),
      priority = oneOf(data.priority || 'NORMAL', ['NORMAL', 'HIGH', 'URGENT'], 'La prioridad'),
      subject = required(data.subject, 'El asunto', { max: 200 }),
      description = required(data.description, 'El detalle', { max: 5000 });
    await db
      .prepare(
        'INSERT INTO support_tickets (id,tenant_id,created_by,type,subject,description,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,' +
          "'NEW'" +
          ',?,?)',
      )
      .run(
        ticketId,
        req.context.tenant.id,
        req.session.user_id,
        type,
        subject,
        description,
        priority,
        now(),
        now(),
      );
    await audit(db, {
      tenantId: req.context.tenant.id,
      ...tenantAuditActor(req),
      action: 'SUPPORT_TICKET_CREATED',
      entityType: 'support_ticket',
      entityId: ticketId,
    });
    return redirect(res, withMessage(p, 'Ticket enviado.'));
  }
  requirePlatform(req);
  if (p === '/saas/payments') {
    const payment = await recordManualPayment(db, data, req.session.user_id, clientIp(req));
    return redirect(
      res,
      withMessage(
        '/saas/collections',
        payment.duplicate
          ? 'El pago ya estaba registrado; no se duplicó.'
          : payment.reactivated
            ? 'Pago registrado, deuda cancelada y cuenta reactivada.'
            : `Pago parcial registrado. Saldo pendiente: ${money(payment.balance)}.`,
      ),
    );
  }
  params = match('/saas/tenants/:id/subscription', p);
  if (params) {
    await changeSubscription(db, params.id, data, req.session.user_id);
    return redirect(res, withMessage(`/saas/tenants/${params.id}`, 'Plan actualizado.'));
  }
  params = match('/saas/tenants/:id/status', p);
  if (params) {
    await setTenantStatus(db, params.id, data.status, req.session.user_id, data.reason);
    return redirect(
      res,
      withMessage(`/saas/tenants/${params.id}`, 'Estado actualizado sin eliminar datos.'),
    );
  }
  params = match('/saas/tenants/:id/impersonate', p);
  if (params) {
    if (!(await db.prepare('SELECT 1 FROM tenants WHERE id=?').get(params.id)))
      throw Object.assign(new Error('Taller no encontrado.'), { status: 404 });
    await db
      .prepare('UPDATE sessions SET impersonated_tenant_id=? WHERE id=?')
      .run(params.id, req.session.id);
    await audit(db, {
      scope: 'PLATFORM',
      tenantId: params.id,
      actorUserId: req.session.user_id,
      impersonatorUserId: req.session.user_id,
      action: 'IMPERSONATION_STARTED',
      entityType: 'tenant',
      entityId: params.id,
      ip: req.socket.remoteAddress,
    });
    return redirect(res, '/workshop');
  }
  if (p === '/saas/impersonation/stop') {
    const tenantId = req.session.impersonated_tenant_id;
    await db
      .prepare('UPDATE sessions SET impersonated_tenant_id=NULL WHERE id=?')
      .run(req.session.id);
    await audit(db, {
      scope: 'PLATFORM',
      tenantId,
      actorUserId: req.session.user_id,
      impersonatorUserId: req.session.user_id,
      action: 'IMPERSONATION_ENDED',
      entityType: 'tenant',
      entityId: tenantId,
    });
    return redirect(res, '/saas/tenants');
  }
  if (p === '/saas/plans') {
    const planId = id(),
      name = required(data.name, 'El nombre del plan', { max: 120 }),
      code = required(data.code, 'El código', { max: 80 })
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_'),
      currency = currencyCode(data.currency || 'PYG'),
      price = moneyAmount(data.price || 0, currency, 'El precio', { allowZero: true });
    await db
      .prepare(
        'INSERT INTO plans (id,code,name,description,price_monthly,currency,active,public,created_at) VALUES (?,?,?,?,?,?,1,?,?)',
      )
      .run(
        planId,
        code,
        name,
        optional(data.description, { max: 1000 }),
        price,
        currency,
        Number(data.public === '1'),
        now(),
      );
    for (const f of await db.prepare('SELECT * FROM features').all())
      await db
        .prepare(
          'INSERT INTO plan_features (plan_id,feature_id,enabled,limit_value) VALUES (?,?,0,NULL)',
        )
        .run(planId, f.id);
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: 'PLAN_CREATED',
      entityType: 'plan',
      entityId: planId,
      after: { code, name, price, currency },
    });
    return redirect(
      res,
      withMessage(p, 'Plan creado. Configure sus capacidades en los editores de esta página.'),
    );
  }
  params = match('/saas/plans/:id/capabilities', p);
  if (params) {
    const plan = await db.prepare('SELECT * FROM plans WHERE id=?').get(params.id);
    if (!plan) throw Object.assign(new Error('Plan no encontrado.'), { status: 404 });
    const currency = currencyCode(data.currency || 'PYG'),
      price = moneyAmount(data.price || 0, currency, 'El precio', { allowZero: true });

    try {
      await db.transaction(
        async () => {
          await db
            .prepare('UPDATE plans SET price_monthly=?,currency=?,public=? WHERE id=?')
            .run(price, currency, Number(data.public === '1'), params.id);
          for (const feature of await db.prepare('SELECT * FROM features').all()) {
            const enabled =
              feature.kind === 'limit' ? 1 : Number(Boolean(data[`enabled_${feature.id}`]));
            const limit =
              feature.kind === 'limit'
                ? positive(data[`limit_${feature.id}`] || 0, `El límite de ${feature.name}`, {
                    allowZero: true,
                  })
                : null;
            await db
              .prepare(
                `INSERT INTO plan_features (plan_id,feature_id,enabled,limit_value) VALUES (?,?,?,?) ON CONFLICT(plan_id,feature_id) DO UPDATE SET enabled=excluded.enabled,limit_value=excluded.limit_value`,
              )
              .run(params.id, feature.id, enabled, limit);
          }
          await audit(db, {
            scope: 'PLATFORM',
            actorUserId: req.session.user_id,
            action: 'PLAN_CAPABILITIES_CHANGED',
            entityType: 'plan',
            entityId: params.id,
            before: { price: plan.price_monthly, currency: plan.currency },
            after: { price, currency },
          });
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      throw error;
    }
    return redirect(res, withMessage('/saas/plans', 'Precio y capacidades actualizados.'));
  }
  params = match('/saas/plans/:id/toggle', p);
  if (params) {
    const plan = await db.prepare('SELECT * FROM plans WHERE id=?').get(params.id);
    if (!plan) throw Object.assign(new Error('Plan no encontrado.'), { status: 404 });
    await db
      .prepare('UPDATE plans SET active=?,retired_at=? WHERE id=?')
      .run(plan.active ? 0 : 1, plan.active ? now() : null, params.id);
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: plan.active ? 'PLAN_RETIRED' : 'PLAN_ACTIVATED',
      entityType: 'plan',
      entityId: params.id,
    });
    return redirect(res, withMessage('/saas/plans', 'Estado del plan actualizado.'));
  }
  if (p === '/saas/features') {
    const featureId = id(),
      name = required(data.name, 'El nombre de la funcionalidad', { max: 150 }),
      code = required(data.code, 'El código', { max: 80 })
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_'),
      kind = oneOf(data.kind, ['boolean', 'limit'], 'El tipo');
    await db
      .prepare(
        'INSERT INTO features (id,code,name,description,kind,global_enabled) VALUES (?,?,?,?,?,1)',
      )
      .run(featureId, code, name, optional(data.description, { max: 1000 }), kind);
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: 'FEATURE_CREATED',
      entityType: 'feature',
      entityId: featureId,
      after: { code, name, kind },
    });
    return redirect(res, withMessage(p, 'Funcionalidad creada.'));
  }
  params = match('/saas/features/:id/toggle', p);
  if (params) {
    const feature = await db.prepare('SELECT * FROM features WHERE id=?').get(params.id);
    if (!feature) throw Object.assign(new Error('Función no encontrada.'), { status: 404 });
    await db
      .prepare('UPDATE features SET global_enabled=? WHERE id=?')
      .run(feature.global_enabled ? 0 : 1, params.id);
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: 'FEATURE_GLOBAL_TOGGLED',
      entityType: 'feature',
      entityId: params.id,
      metadata: { enabled: !feature.global_enabled },
    });
    return redirect(res, withMessage('/saas/features', 'Disponibilidad global actualizada.'));
  }
  params = match('/saas/tenants/:id/features', p);
  if (params) {
    if (!(await db.prepare('SELECT 1 FROM tenants WHERE id=?').get(params.id)))
      throw Object.assign(new Error('Taller no encontrado.'), { status: 404 });

    try {
      await db.transaction(
        async () => {
          for (const feature of await db.prepare('SELECT * FROM features').all()) {
            const raw = data[`${feature.kind === 'limit' ? 'limit' : 'enabled'}_${feature.id}`];
            if (raw == null || raw === '') {
              await db
                .prepare('DELETE FROM tenant_features WHERE tenant_id=? AND feature_id=?')
                .run(params.id, feature.id);
              continue;
            }
            const enabled = feature.kind === 'limit' ? 1 : Number(raw);
            const limit = feature.kind === 'limit' ? asNumber(raw) : null;
            await db
              .prepare(
                `INSERT INTO tenant_features (tenant_id,feature_id,enabled,limit_value,reason) VALUES (?,?,?,?,?) ON CONFLICT(tenant_id,feature_id) DO UPDATE SET enabled=excluded.enabled,limit_value=excluded.limit_value,reason=excluded.reason`,
              )
              .run(params.id, feature.id, enabled, limit, 'Excepción administrativa');
          }
          await audit(db, {
            scope: 'PLATFORM',
            tenantId: params.id,
            actorUserId: req.session.user_id,
            action: 'TENANT_FEATURES_CHANGED',
            entityType: 'tenant',
            entityId: params.id,
          });
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      throw error;
    }
    return redirect(res, withMessage(`/saas/tenants/${params.id}`, 'Excepciones actualizadas.'));
  }
  params = match('/saas/support/:id', p);
  if (params) {
    const status = oneOf(
        data.status,
        ['NEW', 'IN_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
        'El estado',
      ),
      resolution = optional(data.resolution, { max: 5000 }),
      result = await db
        .prepare(
          'UPDATE support_tickets SET status=?,resolution=?,assigned_to=?,updated_at=? WHERE id=?',
        )
        .run(status, resolution, req.session.user_id, now(), params.id);
    if (!result.changes) throw Object.assign(new Error('Ticket no encontrado.'), { status: 404 });
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: 'SUPPORT_TICKET_UPDATED',
      entityType: 'support_ticket',
      entityId: params.id,
      after: { status },
    });
    return redirect(res, withMessage('/saas/support', 'Ticket actualizado.'));
  }
  if (p === '/saas/settings') {
    const values = {
      platform_name: required(data.platform_name, 'El nombre de plataforma', { max: 120 }),
      support_email: validEmail(data.support_email),
      trial_days: integer(data.trial_days, 'Los días de prueba', { min: 0, max: 365 }),
      grace_days: integer(data.grace_days, 'Los días de gracia', { min: 0, max: 365 }),
      suspension_days: integer(data.suspension_days, 'Los días hasta suspensión', {
        min: 0,
        max: 730,
      }),
      retention_days: integer(data.retention_days, 'Los días de retención', { min: 30, max: 3650 }),
    };
    if (values.suspension_days < values.grace_days)
      throw Object.assign(
        new Error('La suspensión no puede ocurrir antes de terminar el período de gracia.'),
        { status: 422 },
      );
    for (const [key, value] of Object.entries(values))
      await db
        .prepare(
          'INSERT INTO platform_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
        )
        .run(key, String(value), now());
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: 'PLATFORM_SETTINGS_CHANGED',
      entityType: 'platform_settings',
      after: values,
    });
    return redirect(res, withMessage(p, 'Reglas actualizadas.'));
  }
  throw Object.assign(new Error('Ruta no encontrada.'), { status: 404 });
}

function releaseApi() {
  return {
    db,
    render,
    redirect,
    withMessage,
    requireAuth,
    requireWorkshop,
    requirePlatform,
    checkCsrf,
    match,
    tenantAuditActor,
  };
}
export const server = http.createServer(async (req, res) => {
  let url = new URL('/', config.appUrl);
  try {
    url = new URL(req.url, config.appUrl);
    req.requestId = requestId();
    const cookies = parseCookies(req.headers.cookie);
    req.session = await readSession(db, cookies.mecan_session);
    req.context = await resolveContext(db, req.session);
    if (
      req.session?.must_change_password &&
      !['/account/password', '/logout', '/health'].includes(url.pathname) &&
      !(req.method === 'GET' && url.pathname === '/workshop/theme.css') &&
      !url.pathname.startsWith('/assets/')
    )
      return redirect(res, '/account/password');
    if (
      req.method === 'POST' &&
      req.headers.origin &&
      req.headers.origin !== new URL(config.appUrl).origin
    )
      throw new AppError('El origen de la solicitud no es válido.', { status: 403 });
    const presentation = req.context?.tenant
      ? await db
          .prepare('SELECT currency,timezone FROM tenant_settings WHERE tenant_id=?')
          .get(req.context.tenant.id)
      : {};
    return await withUiSettings(presentation, async () => {
      if (req.method === 'GET') return await handleGet(req, res, url);
      if (req.method === 'POST') {
        if (
          [
            '/signup',
            '/contact',
            '/forgot-password',
            '/reset-password',
            '/account/password',
          ].includes(url.pathname)
        )
          await assertRequestRate(
            db,
            url.pathname === '/account/password' && req.session?.user_id
              ? 'user:' + req.session.user_id
              : clientIp(req),
            url.pathname,
          );
        return await handlePost(req, res, url, await body(req));
      }
      send(res, 405, 'Método no permitido', 'text/plain; charset=utf-8');
    });
  } catch (error) {
    if (error.status === 401)
      return redirect(
        res,
        withMessage(
          `/login?next=${encodeURIComponent(url.pathname)}`,
          'Inicia sesión para continuar.',
          'error',
        ),
      );
    const friendly = publicError(error);
    (friendly.status >= 500 ? logger.error : logger.warn)('request_failed', {
      requestId: req.requestId,
      method: req.method,
      path: url.pathname,
      status: friendly.status,
      code: friendly.code,
      userId: req.session?.user_id,
      tenantId: req.context?.tenant?.id,
      ...(friendly.status >= 500 ? { error: error?.stack || String(error) } : {}),
    });
    const area = url.pathname.startsWith('/saas')
      ? 'saas'
      : url.pathname.startsWith('/workshop')
        ? 'workshop'
        : 'public';
    if (req.method === 'POST')
      return redirect(
        res,
        withMessage(
          refererPath(req, area === 'public' ? '/' : '/' + area),
          friendly.message,
          'error',
        ),
      );
    send(
      res,
      friendly.status,
      layout({
        title: 'No se pudo completar',
        area,
        context: req.context,
        csrf: req.session?.csrf_token,
        path: url.pathname,
        body: `${pageHead('ERROR', friendly.status === 404 ? 'No encontrado' : 'No se pudo completar', friendly.message)}<a class="button" href="${area === 'public' ? '/' : `/${area}`}">Volver</a>`,
      }),
    );
  }
});

if (process.env.NODE_ENV !== 'test')
  server.listen(config.port, config.host, () =>
    logger.info('server_started', {
      app: config.appName,
      url: config.appUrl,
      environment: config.production ? 'production' : 'development',
    }),
  );
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    logger.info('server_stopping', { signal });
    server.close(async () => {
      try {
        await db.close();
      } finally {
        process.exit(0);
      }
    });
  });
