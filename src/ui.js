import { config } from './config.js';
import { can } from './tenancy.js';
import { AsyncLocalStorage } from 'node:async_hooks';
const presentation = new AsyncLocalStorage();
export const withUiSettings = (settings, fn) => presentation.run(settings, fn);
let uiSettings = { name: config.appName, trialDays: 14 };
export function configureUi(values) {
  uiSettings = { ...uiSettings, ...values };
}

export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>'"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char],
  );
const moneyFormats = new Map();
export const money = (value, currency = presentation.getStore()?.currency || 'PYG') => {
  if (!moneyFormats.has(currency))
    moneyFormats.set(currency, new Intl.NumberFormat('es-PY', { style: 'currency', currency }));
  return moneyFormats.get(currency).format(Number(value || 0));
};
export const shortDate = (value) =>
  value
    ? new Intl.DateTimeFormat('es-PY', {
        dateStyle: 'medium',
        timeZone: presentation.getStore()?.timezone || 'America/Asuncion',
      }).format(new Date(value))
    : '—';
const labels = {
  TRIAL: 'En prueba',
  ACTIVE: 'Activo',
  INCOMPLETE: 'Registro incompleto',
  PAYMENT_PENDING: 'Pago pendiente',
  OVERDUE: 'Vencido',
  GRACE: 'En gracia',
  SUSPENDED: 'Suspendido',
  CANCELED: 'Cancelado',
  BLOCKED: 'Bloqueado',
  NEW: 'Nuevo',
  IN_REVIEW: 'En revisión',
  IN_PROGRESS: 'En progreso',
  RESOLVED: 'Resuelto',
  CLOSED: 'Cerrado',
  RECEIVED: 'Recibida',
  INSPECTION: 'Inspección',
  DIAGNOSIS: 'Diagnóstico',
  ESTIMATE: 'Presupuesto',
  AWAITING_APPROVAL: 'Esperando autorización',
  AUTHORIZED: 'Autorizada',
  WAITING_PARTS: 'Esperando repuestos',
  QUALITY_CONTROL: 'Control de calidad',
  APPROVED: 'Aprobada',
  WORKING: 'En trabajo',
  READY: 'Lista',
  INVOICED: 'Facturada',
  PARTIALLY_PAID: 'Pago parcial',
  DELIVERED: 'Entregada',
  PENDING: 'Pendiente',
  PARTIAL: 'Parcial',
  PAID: 'Pagada',
  PASSED: 'Aprobado',
  FAILED: 'Rechazado',
  ASSIGNED: 'Asignado',
  PAUSED: 'Pausado',
  COMPLETED: 'Completado',
  LOW: 'Baja',
  NORMAL: 'Normal',
  HIGH: 'Alta',
  URGENT: 'Urgente',
  REQUESTED: 'Solicitado',
  ORDERED: 'Ordenado',
  SENT: 'Enviado',
  READ: 'Leída',
  NO_CHARGE: 'Sin cargo',
  REVERSED: 'Revertido',
  RECORDED: 'Registrado',
  VOID: 'Anulado',
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
  MONTHLY: 'Mensual',
  YEARLY: 'Anual',
  CUSTOMER_PAYMENT: 'Cobro a cliente',
  SUPPLIER_PAYMENT: 'Pago a proveedor',
  CUSTOMER_PAYMENT_REVERSAL: 'Reversión de cobro',
  SUPPLIER_PAYMENT_REVERSAL: 'Reversión de pago a proveedor',
  OPERATING_EXPENSE: 'Gasto operativo',
  OTHER_INCOME: 'Otro ingreso',
  CAPITAL: 'Aporte de capital',
  WITHDRAWAL: 'Retiro',
};
export const label = (value) => labels[value] || String(value || '—').replaceAll('_', ' ');
export const badge = (value) =>
  `<span class="badge badge-${esc(String(value || '').toLowerCase())}">${esc(label(value))}</span>`;

const workshopNav = [
  ['/workshop', 'Resumen', 'grid', 'dashboard.view'],
  ['/workshop/search', 'Buscar', 'sparkles', 'search.use'],
  ['/workshop/my-work', 'Mis trabajos', 'wrench', 'orders.execute'],
  ['/workshop/onboarding', 'Configuración inicial', 'sparkles', 'settings.manage'],
  ['/workshop/orders', 'Órdenes', 'wrench', 'orders.view'],
  ['/workshop/warranties', 'Garantías', 'clipboard', 'orders.view'],
  ['/workshop/customers', 'Clientes', 'users', 'customers.view'],
  ['/workshop/vehicles', 'Vehículos', 'car', 'vehicles.view'],
  ['/workshop/services', 'Servicios', 'clipboard', 'orders.view'],
  ['/workshop/schedule', 'Agenda y bahías', 'grid', 'orders.view'],
  ['/workshop/inventory', 'Inventario', 'box', 'inventory.view'],
  ['/workshop/purchases', 'Compras y pagos', 'box', ['purchases.manage', 'purchases.pay']],
  ['/workshop/billing', 'Facturación y caja', 'wallet', 'billing.view'],
  ['/workshop/reports', 'Reportes', 'grid', 'reports.view'],
  ['/workshop/documents', 'Documentos', 'clipboard', 'documents.view'],
  ['/workshop/notifications', 'Notificaciones', 'sparkles', 'dashboard.view'],
  ['/workshop/employees', 'Equipo', 'user-plus', 'employees.manage'],
  ['/workshop/branches', 'Sucursales', 'building', 'branches.manage'],
  ['/workshop/subscription', 'Mi suscripción', 'credit-card', 'settings.manage'],
  ['/workshop/support', 'Soporte', 'life-buoy', 'support.manage'],
  ['/workshop/settings', 'Configuración', 'settings', 'settings.manage'],
  ['/workshop/audit', 'Auditoría', 'shield', 'employees.manage'],
  ['/account/password', 'Mi contraseña', 'shield', 'dashboard.view'],
];
const saasNav = [
  ['/saas', 'Métricas', 'grid'],
  ['/saas/tenants', 'Talleres', 'building'],
  ['/saas/collections', 'Cobranza', 'wallet'],
  ['/saas/plans', 'Planes', 'layers'],
  ['/saas/features', 'Funcionalidades', 'toggle'],
  ['/saas/support', 'Soporte', 'life-buoy'],
  ['/saas/audit', 'Auditoría', 'shield'],
  ['/saas/settings', 'Configuración', 'settings'],
  ['/saas/readiness', 'Operación', 'shield'],
  ['/account/password', 'Mi contraseña', 'shield'],
];

const icons = {
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  wrench:
    '<path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L5 16l-2 5 5-2 7.3-7.3a4 4 0 0 0 5-5L18 9l-2.4-2.4z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6"/>',
  car: '<path d="m5 17-2-2V9l2-5h14l2 5v6l-2 2M5 11h14M7 17v3M17 17v3M7 14h.01M17 14h.01"/>',
  clipboard: '<path d="M9 5h6M9 3h6v4H9zM6 5H4v16h16V5h-2M8 12h8M8 16h6"/>',
  box: '<path d="m21 8-9 5-9-5M3 8l9-5 9 5v8l-9 5-9-5zM12 13v8"/>',
  wallet: '<path d="M3 6h16v14H3zM3 9h18v7h-5a3 3 0 0 1 0-6h5M16 13h.01"/>',
  'user-plus':
    '<path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6"/>',
  building: '<path d="M3 21h18M6 21V3h12v18M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  'credit-card': '<path d="M2 6h20v14H2zM2 10h20M6 16h4"/>',
  'life-buoy':
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.9 4.9 4.3 4.3M14.8 14.8l4.3 4.3M19.1 4.9l-4.3 4.3M9.2 14.8l-4.3 4.3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5"/>',
  toggle: '<rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4"/>',
  sparkles:
    '<path d="m12 3-1.2 3.8L7 8l3.8 1.2L12 13l1.2-3.8L17 8l-3.8-1.2zM5 14l-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8zM19 13l-.7 1.3L17 15l1.3.7L19 17l.7-1.3L21 15l-1.3-.7z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`;

export function layout({
  title,
  body,
  context = null,
  area = 'public',
  csrf = '',
  path = '/',
  flash = null,
}) {
  const appName = uiSettings.name;
  const isApp = area !== 'public';
  const nav =
    area === 'saas'
      ? saasNav
      : workshopNav.filter(([, , , permission]) =>
          [permission].flat().some((p) => can(context, p)),
        );
  const brandName = area === 'workshop' ? context?.tenant?.name || appName : appName;
  const notice = flash
    ? `<div class="flash ${flash.type === 'error' ? 'flash-error' : 'flash-ok'}">${esc(flash.message)}</div>`
    : '';
  const sidebar = isApp
    ? `<aside class="sidebar" id="app-sidebar"><a class="side-brand" href="/${area === 'saas' ? 'saas' : 'workshop'}">${context?.tenant?.logo_url && /^https:\/\//.test(context.tenant.logo_url) ? `<img class="document-logo" src="${esc(context.tenant.logo_url)}" alt="Logo del taller" referrerpolicy="no-referrer">` : '<span class="brand-mark">M</span>'}<span><b>${esc(brandName)}</b><small>${area === 'saas' ? 'Control SaaS' : 'Gestión del taller'}</small></span></a><nav>${nav.map(([href, text, ic]) => `<a href="${href}" class="${path === href || (href !== '/workshop' && href !== '/saas' && path.startsWith(`${href}/`)) ? 'active' : ''}">${icon(ic)}<span>${text}</span></a>`).join('')}</nav><div class="side-user"><span class="avatar">${esc(context?.user?.name?.[0] || 'U')}</span><span><b>${esc(context?.user?.name)}</b><small>${esc(area === 'saas' ? 'Super Admin' : context?.membership?.role_name || 'Soporte')}</small></span><form method="post" action="/logout"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="icon-button" title="Cerrar sesión">↗</button></form></div></aside>`
    : '';
  const publicNav = !isApp
    ? `<header class="public-nav"><a class="logo" href="/"><span class="brand-mark">M</span>${esc(appName)}</a><button class="nav-toggle" aria-label="Abrir menú">☰</button><nav><a href="/features">Funciones</a><a href="/pricing">Precios</a><a href="/faq">Preguntas</a><a href="/contact">Contacto</a><a href="/login">Ingresar</a><a class="button button-small" href="/signup">Probar gratis</a></nav></header>`
    : '';
  const impersonation = context?.isImpersonating
    ? `<div class="impersonation">Modo soporte: está viendo <b>${esc(context.tenant.name)}</b>. Todas las acciones quedan auditadas. <form method="post" action="/saas/impersonation/stop"><input type="hidden" name="csrf" value="${esc(csrf)}"><button>Salir</button></form></div>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Software integral para talleres mecánicos"><title>${esc(title)} · ${esc(appName)}</title><link rel="stylesheet" href="/assets/app.css">${area === 'workshop' ? '<link rel="stylesheet" href="/workshop/theme.css">' : ''}<script src="/assets/app.js" defer></script></head><body class="area-${area}"><a class="skip-link" href="#main-content">Saltar al contenido</a>${isApp ? '<button class="app-menu-toggle button" type="button" aria-controls="app-sidebar" aria-expanded="false">Menú</button>' : ''}${publicNav}${sidebar}${impersonation}<main id="main-content" class="${isApp ? 'app-main' : 'public-main'}">${notice}${body}</main>${!isApp ? `<footer><a class="logo" href="/"><span class="brand-mark">M</span>${esc(appName)}</a><p>La operación de tu taller, ordenada de punta a punta.</p><small>© ${new Date().getFullYear()} ${esc(appName)} · <a href="/movil">App móvil</a> · <a href="/privacy">Privacidad</a> · <a href="/terms">Términos</a></small></footer>` : ''}</body></html>`;
}

export const field = (name, labelText, type = 'text', value = '', options = {}) =>
  `<label class="field"><span>${esc(labelText)}${options.required ? ' *' : ''}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ''} ${options.required ? 'required' : ''} ${options.min != null ? `min="${esc(options.min)}"` : ''} ${options.max != null ? `max="${esc(options.max)}"` : ''} ${options.step != null ? `step="${esc(options.step)}"` : type === 'number' ? 'step="any"' : ''} ${options.minlength != null ? `minlength="${esc(options.minlength)}"` : ''} ${options.maxlength != null ? `maxlength="${esc(options.maxlength)}"` : ''} ${options.autocomplete ? `autocomplete="${esc(options.autocomplete)}"` : ''} ${options.inputmode ? `inputmode="${esc(options.inputmode)}"` : ''} ${options.pattern ? `pattern="${esc(options.pattern)}"` : ''}></label>`;
export const textarea = (name, labelText, value = '', options = {}) =>
  `<label class="field field-wide"><span>${esc(labelText)}${options.required ? ' *' : ''}</span><textarea name="${esc(name)}" rows="${options.rows || 3}" ${options.required ? 'required' : ''} ${options.maxlength ? `maxlength="${esc(options.maxlength)}"` : ''}>${esc(value)}</textarea></label>`;
export const select = (name, labelText, items, value = '', options = {}) =>
  `<label class="field"><span>${esc(labelText)}${options.required ? ' *' : ''}</span><select name="${esc(name)}" ${options.required ? 'required' : ''}>${items
    .map((item) => {
      const [v, t] = Array.isArray(item) ? item : [item, item];
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`;
    })
    .join('')}</select></label>`;
export const csrfInput = (csrf) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
export const pageHead = (eyebrow, title, description, action = '') =>
  `<div class="page-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`;
export const card = (title, content, extra = '') =>
  `<section class="card"><div class="card-head"><h2>${esc(title)}</h2>${extra}</div>${content}</section>`;
export const empty = (title, text) =>
  `<div class="empty"><span>◇</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
export function dataTable(columns, rows, { emptyTitle, emptyText, stacked = false } = {}) {
  const p = rows.pagination,
    controls = p
      ? `<form class="global-search-page" method="get" action="${esc(p.path)}"><label class="sr-only" for="${p.queryKey}">Buscar en la lista</label><input id="${p.queryKey}" name="${p.queryKey}" value="${esc(p.query)}" placeholder="Buscar en esta lista"><button class="button button-small">Buscar</button></form>`
      : '',
    pagination = p
      ? `<nav class="pagination" aria-label="Páginas de resultados">${p.page > 1 ? `<a href="${esc(p.previousUrl)}">← Anterior</a>` : ''}<span>Página ${p.page}</span>${p.next ? `<a href="${esc(p.nextUrl)}">Siguiente →</a>` : ''}</nav>`
      : '';
  if (!rows.length)
    return (
      controls +
      empty(
        emptyTitle || (p?.query ? 'Sin resultados' : 'Todavía no hay registros'),
        emptyText ||
          (p?.query
            ? 'Prueba con otro nombre o modifica la búsqueda.'
            : 'No hay registros para mostrar en esta sección.'),
      ) +
      pagination
    );
  return (
    controls +
    `<div class="table-wrap${stacked ? ' table-stacked' : ''}"><table role="table"><thead><tr role="row">${columns.map((c) => `<th scope="col" role="columnheader">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr role="row">${columns.map((c) => `<td role="cell">${stacked ? `<span class="cell-label" aria-hidden="true">${esc(c.label)}</span><div class="cell-value">` : ''}${c.render ? c.render(row) : esc(row[c.key] ?? '—')}${stacked ? '</div>' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` +
    pagination
  );
}
export const formCard = (title, action, csrf, fields, button = 'Guardar') =>
  card(
    title,
    `<form class="form-grid" method="post" action="${esc(action)}">${csrfInput(csrf)}${fields}<div class="form-actions"><button class="button" type="submit">${esc(button)}</button></div></form>`,
  );
export const metricGrid = (metrics) =>
  `<div class="metric-grid">${metrics.map((m) => `<article class="metric"><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong><small>${esc(m.note || '')}</small></article>`).join('')}</div>`;

export function publicHome(plans) {
  return `<section class="hero"><div class="hero-copy"><span class="pill">Software hecho para talleres que avanzan</span><h1>Tu taller bajo control.<br><em>Tu negocio en marcha.</em></h1><p>Órdenes, clientes, vehículos, inventario y equipo en un solo lugar. Sin planillas dispersas ni información perdida.</p><div class="hero-actions"><a class="button button-large" href="/signup">${uiSettings.trialDays > 0 ? 'Comenzar ' + uiSettings.trialDays + ' días gratis' : 'Crear mi taller'}</a><a class="text-link" href="/features">Ver cómo funciona →</a></div><div class="trust-row"><span>✓ Sin tarjeta</span><span>✓ Configuración guiada</span><span>✓ Datos protegidos</span></div></div><div class="hero-visual"><ol class="public-workflow"><li><span>01</span><div><b>Recibe el vehículo</b><p>Cliente, historial y motivo de ingreso.</p></div></li><li><span>02</span><div><b>Diagnostica y autoriza</b><p>Presupuesto claro y aprobación registrada.</p></div></li><li><span>03</span><div><b>Coordina la reparación</b><p>Técnicos, tiempos y repuestos conectados.</p></div></li><li><span>04</span><div><b>Entrega con control</b><p>Calidad, cobro y garantía en la misma orden.</p></div></li></ol></div></section><section class="logos"><span>Con todo lo que necesitas para operar</span><div><b>Órdenes</b><b>Inventario</b><b>Clientes</b><b>Facturación</b><b>Equipo</b></div></section><section class="split"><div><span class="eyebrow">MENOS CAOS. MÁS CONTROL.</span><h2>Desde que entra el vehículo hasta que sale del taller.</h2><p>Cada dato queda conectado: el historial del cliente, la unidad, el diagnóstico, los repuestos y el cobro.</p><a class="text-link" href="/features">Explorar funcionalidades →</a></div><div class="feature-stack"><article><span>01</span><div><h3>Recepción simple</h3><p>Registra al cliente y su vehículo en segundos.</p></div></article><article><span>02</span><div><h3>Trabajo visible</h3><p>Sigue cada orden y evita cuellos de botella.</p></div></article><article><span>03</span><div><h3>Números claros</h3><p>Conoce ingresos, pendientes y rentabilidad.</p></div></article></div></section><section class="cta"><span class="eyebrow">EMPIEZA HOY</span><h2>El próximo nivel de tu taller<br>comienza con una orden.</h2><p>Configura tu cuenta en pocos minutos y trabaja con el sistema desde el primer día.</p><a class="button button-light button-large" href="/signup">Crear mi taller</a></section>`;
}

export function pricingPage(plans) {
  return `<section class="public-heading"><span class="eyebrow">PLANES TRANSPARENTES</span><h1>Elige el ritmo de tu taller.</h1><p>Todos los planes incluyen registro autónomo, seguridad multiempresa y soporte.</p></section><section class="pricing-grid">${plans.map((p, i) => `<article class="price-card ${i === 1 ? 'featured' : ''}">${i === 1 ? '<span class="popular">Profesional</span>' : ''}<h2>${esc(p.name)}</h2><p>${esc(p.description)}</p><strong>${money(p.price_monthly, p.currency)}</strong><small>por mes</small><ul><li>✓ ${p.branch_limit || '—'} sucursal(es)</li><li>✓ Hasta ${p.employee_limit || '—'} empleados</li><li>✓ ${p.order_limit || '—'} órdenes/mes</li><li>✓ Soporte incluido</li></ul><a class="button ${i === 1 ? '' : 'button-outline'}" href="/signup?plan=${esc(p.id)}">Comenzar prueba</a></article>`).join('')}</section>`;
}

export const featuresPage = () =>
  `<section class="public-heading"><span class="eyebrow">UNA OPERACIÓN CONECTADA</span><h1>Todo el taller, en una sola vista.</h1><p>Herramientas pensadas para trabajar mejor hoy y crecer sin cambiar de sistema mañana.</p></section><section class="public-features">${[
    [
      'Órdenes sin puntos ciegos',
      'Estados, diagnóstico, costos y fechas visibles para todo el equipo.',
    ],
    ['Clientes y vehículos', 'Historial completo de cada relación y cada unidad.'],
    ['Inventario útil', 'Existencias, mínimos, costos y precios por sucursal.'],
    ['Facturación y caja', 'Cobros del taller completamente separados de tu suscripción SaaS.'],
    ['Equipo y permisos', 'Cada persona ve y hace solamente lo que corresponde.'],
    ['Multi-sucursal', 'Operación por sede y lectura consolidada para propietarios.'],
    ['Marca propia', 'Logo, colores y documentos con la identidad de tu negocio.'],
    ['Soporte integrado', 'Consultas e incidencias sin salir de la plataforma.'],
  ]
    .map(
      ([t, p], i) =>
        `<article><span>${String(i + 1).padStart(2, '0')}</span><h2>${t}</h2><p>${p}</p></article>`,
    )
    .join('')}</section>`;
export const faqPage = () =>
  `<section class="public-heading"><span class="eyebrow">PREGUNTAS FRECUENTES</span><h1>Respuestas antes de comenzar.</h1></section><section class="faq">${[
    [
      '¿Necesito instalar algo?',
      'No. Mecan Cloud funciona desde el navegador y mantiene tu información centralizada.',
    ],
    [
      '¿Mis datos se mezclan con otros talleres?',
      'No. Cada operación se filtra por el taller autenticado y existen pruebas específicas contra accesos cruzados.',
    ],
    [
      '¿Qué pasa si vence mi pago?',
      'Recibirás avisos y un período de gracia configurable. Una suspensión nunca elimina tus datos.',
    ],
    [
      '¿Puedo cambiar de plan?',
      'Sí. El cambio conserva toda tu información y ajusta las capacidades disponibles.',
    ],
    ['¿Puedo tener varias sucursales?', 'Sí, según el límite configurado en tu plan.'],
    [
      '¿La prueba pide tarjeta?',
      'No. Puedes probar la plataforma y registrar el pago posteriormente.',
    ],
  ]
    .map(([q, a]) => `<details><summary>${q}<span>+</span></summary><p>${a}</p></details>`)
    .join('')}</section>`;

export function authPage(mode, plans = [], selected = '', guestCsrf = '') {
  const signup = mode === 'signup';
  return `<section class="auth-shell"><div class="auth-story"><a class="logo logo-light" href="/"><span class="brand-mark">M</span>${esc(uiSettings.name)}</a><div><span class="eyebrow">${signup ? 'EMPIEZA TU PRUEBA' : 'BIENVENIDO DE VUELTA'}</span><h1>${signup ? 'Un taller más ordenado empieza aquí.' : 'Tu taller te está esperando.'}</h1><p>${signup ? 'Crea tu espacio de trabajo. La sucursal principal, el administrador y el plan quedarán listos automáticamente.' : 'Ingresa a tu operación o a la consola de plataforma desde el mismo acceso seguro.'}</p></div><small>Seguridad multi-tenant · Auditoría · Respaldo operativo</small></div><div class="auth-panel"><form method="post" action="/${mode}" class="auth-form"><input type="hidden" name="guestCsrf" value="${esc(guestCsrf)}"><h2>${signup ? 'Crear mi taller' : 'Iniciar sesión'}</h2><p>${signup ? (uiSettings.trialDays > 0 ? uiSettings.trialDays + ' días para probar las funciones de tu plan.' : 'Crea tu cuenta con el plan seleccionado.') : 'Usa las credenciales de tu cuenta.'}</p>${signup ? `${field('ownerName', 'Tu nombre', 'text', '', { required: true, maxlength: 150, autocomplete: 'name' })}${field('workshopName', 'Nombre del taller', 'text', '', { required: true, maxlength: 180, autocomplete: 'organization' })}${field('phone', 'Teléfono', 'tel', '', { maxlength: 60, autocomplete: 'tel' })}` : ''}${field('email', 'Email', 'email', '', { required: true, maxlength: 254, autocomplete: 'email' })}${field('password', 'Contraseña', 'password', '', { required: true, minlength: signup ? 10 : undefined, autocomplete: signup ? 'new-password' : 'current-password' })}${
    signup
      ? select(
          'planId',
          'Plan inicial',
          plans.map((p) => [p.id, `${p.name} · ${money(p.price_monthly, p.currency)}/mes`]),
          selected || plans[0]?.id,
          { required: true },
        )
      : ''
  } ${signup ? '<label class="check"><input type="checkbox" name="acceptLegal" value="1" required> Acepto los <a href="/terms" target="_blank">términos</a> y la <a href="/privacy" target="_blank">política de privacidad</a>.</label>' : ''}<button class="button button-large" type="submit">${signup ? 'Crear cuenta' : 'Ingresar'}</button><small>${signup ? '¿Ya tienes una cuenta? <a href="/login">Ingresar</a>' : '<a href="/forgot-password">¿Olvidaste tu contraseña?</a><br>¿Nuevo en Mecan? <a href="/signup">Crear taller</a>'}</small></form></div></section>`;
}
