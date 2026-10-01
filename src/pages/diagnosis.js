import {
  esc,
  money,
  shortDate,
  pageHead,
  card,
  empty,
  dataTable,
  csrfInput,
  metricGrid,
} from '../ui.js';
import { AppError } from '../errors.js';
import { can } from '../tenancy.js';
import { ORDER_LABELS } from '../workflow.js';
import { damageReport, DIAGNOSIS_EDITABLE_STATES } from '../services/damage-assessments.js';
import {
  loadModelCatalog,
  publicModel,
  modelEntry,
  NOT_AVAILABLE,
} from '../services/vehicle-models.js';
import { severityLabel, bodyTypeLabel, partLabel } from '../vehicle-diagnosis.js';

// Hay algo para pasar al presupuesto en preparación si falta el concepto de reparación o de mano de obra.
const pendingImport = (report) =>
  (report?.damaged || []).some(
    (part) =>
      (part.repairCost > 0 &&
        !part.imported.some((i) => i.type === 'SERVICE' && i.status === 'DRAFT')) ||
      (part.laborCost > 0 &&
        !part.imported.some((i) => i.type === 'LABOR' && i.status === 'DRAFT')),
  );
const chip = (severity, text) =>
  `<span class="damage-chip sev-${esc(String(severity).toLowerCase())}">${esc(text)}</span>`;

function damageTable(report) {
  return dataTable(
    [
      { label: 'Pieza', key: 'label' },
      { label: 'Gravedad', render: (r) => chip(r.severity, severityLabel(r.severity)) },
      { label: 'Presión', render: (r) => `${r.pressure}` },
      { label: 'Zona', render: (r) => esc(r.affectedZone || '—') },
      { label: 'Reparación', render: (r) => money(r.repairCost) },
      { label: 'Mano de obra', render: (r) => money(r.laborCost) },
      {
        label: 'Presupuesto',
        render: (r) =>
          r.imported.length ? esc(r.imported.map((i) => i.estimate).join(', ')) : '—',
      },
    ],
    report?.damaged || [],
    {
      emptyTitle: 'Sin daños registrados',
      emptyText: 'Las piezas marcadas en el diagnóstico 3D aparecerán aquí.',
    },
  );
}

export async function diagnosisStudioPage(db, req, orderId) {
  const tenantId = req.context.tenant.id,
    csrf = req.session.csrf_token;
  const order = await db
    .prepare(
      `SELECT o.*,c.name customer,v.plate,v.make,v.model,v.year FROM work_orders o
      JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id
      JOIN vehicles v ON v.id=o.vehicle_id AND v.tenant_id=o.tenant_id WHERE o.id=? AND o.tenant_id=?`,
    )
    .get(orderId, tenantId);
  if (!order) throw new AppError('Orden no encontrada.', { status: 404 });
  const report = await damageReport(db, tenantId, order.id);
  const actions = [];
  if (
    ['RECEIVED', 'INSPECTION', 'DIAGNOSIS'].includes(order.status) &&
    can(req.context, 'orders.diagnose') &&
    (order.status === 'DIAGNOSIS' || can(req.context, 'orders.inspect'))
  )
    actions.push(
      `<details class="studio-finish"><summary class="button">Finalizar diagnóstico</summary><form class="form-grid" method="post" action="/workshop/orders/${order.id}/damage-assessment/finish" data-save-first data-confirm="Se completarán la inspección y el diagnóstico de la orden con los daños registrados.">${csrfInput(csrf)}<label class="field field-wide"><span>Detalles técnicos adicionales</span><textarea name="summary" rows="2" maxlength="1500"></textarea></label><label class="field field-wide"><span>Recomendaciones</span><textarea name="recommendations" rows="2"></textarea></label>${can(req.context, 'orders.estimate') ? '<label class="field"><span><input type="checkbox" name="importEstimate" value="1" checked> Pasar costos al presupuesto</span></label>' : ''}<div class="form-actions"><button class="button">Finalizar y continuar</button></div></form></details>`,
    );
  if (order.status === 'ESTIMATE' && can(req.context, 'orders.estimate') && pendingImport(report))
    actions.push(
      `<form method="post" action="/workshop/orders/${order.id}/damage-assessment/estimate" data-save-first>${csrfInput(csrf)}<button class="button">Pasar al presupuesto</button></form>`,
    );
  if (can(req.context, 'orders.print'))
    actions.push(
      `<a class="button button-outline" href="/workshop/orders/${order.id}/print?type=damage">Imprimir diagnóstico</a>`,
    );
  return `<section class="studio" data-studio data-api="/workshop/orders/${esc(order.id)}/damage-assessment" data-csrf="${esc(csrf)}">
    <header class="studio-head"><div><span class="eyebrow">DIAGNÓSTICO 3D · ORDEN #${order.number}</span><h1>${esc(order.plate)} · ${esc([order.make, order.model, order.year].filter(Boolean).join(' ') || 'Vehículo')}</h1><p>${esc(order.customer)} · ${esc(ORDER_LABELS[order.status] || order.status)}${DIAGNOSIS_EDITABLE_STATES.includes(order.status) ? '' : ' · solo lectura'}</p></div>
    <div class="studio-head-actions"><span class="studio-status" data-save-status>Cargando…</span><a class="button button-outline" href="/workshop/orders/${order.id}">Volver a la orden</a>${actions.join('')}</div></header>
    <div class="studio-stage"><div class="studio-loader">Cargando escena…</div><div class="studio-error" role="alert" hidden></div></div>
    <div class="studio-summary">${card(
      'Resumen guardado',
      `${report ? `<p>Carrocería: <b>${esc(bodyTypeLabel(report.assessment.body_type))}</b> · Última actualización ${shortDate(report.assessment.updated_at)} por ${esc(report.assessment.updated_by_name || '—')} · Revisión ${report.assessment.revision}</p>` : '<p>Todavía no se guardó un diagnóstico visual para esta orden.</p>'}${damageTable(report)}`,
    )}</div>
  </section><link rel="stylesheet" href="/assets/diagnosis3d/studio.css"><script type="module" src="/assets/diagnosis3d/studio.js"></script>`;
}

// Tarjeta del diagnóstico visual dentro de la orden de trabajo.
export async function damageOrderCard(db, req, order) {
  const report = await damageReport(db, req.context.tenant.id, order.id);
  const csrf = req.session.csrf_token;
  const buttons = [
    `<a class="button" href="/workshop/orders/${order.id}/diagnosis-3d">${report ? 'Abrir diagnóstico 3D' : DIAGNOSIS_EDITABLE_STATES.includes(order.status) && can(req.context, 'orders.diagnose') ? 'Iniciar diagnóstico 3D' : 'Ver diagnóstico 3D'}</a>`,
  ];
  if (pendingImport(report) && order.status === 'ESTIMATE' && can(req.context, 'orders.estimate'))
    buttons.push(
      `<form method="post" action="/workshop/orders/${order.id}/damage-assessment/estimate">${csrfInput(csrf)}<button class="button button-outline">Pasar daños al presupuesto</button></form>`,
    );
  const summary = report
    ? `<p>${report.damaged.length ? report.damaged.map((part) => chip(part.severity, `${part.label} · ${severityLabel(part.severity)}`)).join('') : 'Sin daños de carrocería registrados.'}</p><div class="stat-list"><div><span>Reparación</span><b>${money(report.totals.repair)}</b></div><div><span>Mano de obra</span><b>${money(report.totals.labor)}</b></div><div><span>Carrocería</span><b>${esc(bodyTypeLabel(report.assessment.body_type))}</b></div></div>`
    : '<p>Registra los daños por pieza sobre el modelo 3D: gravedad, zona, costos y fotografías alimentan el presupuesto y los documentos.</p>';
  return card(
    'Diagnóstico visual 3D',
    `${summary}<div class="button-row">${buttons.join('')}</div>`,
  );
}

export function workshopDocumentLinks(req, order, estimate) {
  if (!can(req.context, 'orders.print')) return '';
  const links = [
    ['materials', 'Control de materiales e insumos'],
    ['damage', 'Presupuesto y diagnóstico visual'],
    ...(estimate ? [['service', 'Presupuesto del servicio']] : []),
  ];
  return card(
    'Documentos del taller',
    `<div class="button-row">${links.map(([type, text]) => `<a class="button button-outline" href="/workshop/orders/${order.id}/print?type=${type}">${esc(text)}</a>`).join('')}</div>`,
  );
}

export function vehicleDamageHistoryCard(history) {
  if (!history.length) return '';
  return card(
    'Historial de daños (diagnóstico 3D)',
    dataTable(
      [
        {
          label: 'Orden',
          render: (r) =>
            `<a href="/workshop/orders/${esc(r.orderId)}/diagnosis-3d">#${r.orderNumber}</a>`,
        },
        { label: 'Fecha', render: (r) => shortDate(r.updatedAt) },
        {
          label: 'Piezas',
          render: (r) =>
            r.parts.length
              ? r.parts
                  .map((p) => chip(p.severity, `${partLabel(p.code)} · ${p.severityLabel}`))
                  .join('')
              : 'Sin daños',
        },
        { label: 'Estimado', render: (r) => money(r.total) },
        { label: 'Estado', render: (r) => esc(r.orderStatus) },
      ],
      history,
      { stacked: true },
    ),
  );
}

export function vehicleModelCard(resolution) {
  const model = resolution.model;
  if (!resolution.libraryAvailable)
    return card(
      'Modelo 3D',
      '<p>La biblioteca local «Mecan 1.1 Offline» no está disponible en este servidor. El diagnóstico usa la carrocería paramétrica.</p>',
    );
  if (!model)
    return card(
      'Modelo 3D',
      `<p><b>${NOT_AVAILABLE}</b>: no hay un modelo legalmente reutilizable de esta marca y modelo en el catálogo local. El diagnóstico usa la carrocería paramétrica.</p>${resolution.generic.length ? `<p>Modelos genéricos de referencia disponibles: ${resolution.generic.length}. <a href="/workshop/models3d">Ver catálogo</a></p>` : ''}`,
    );
  return card(
    'Modelo 3D',
    `${model.thumbnail ? `<img class="document-logo" src="${esc(model.thumbnail)}" alt="">` : ''}<p><b>${esc(model.brand)} ${esc(model.model)}${model.year ? ' ' + esc(model.year) : ''}</b>${resolution.status === 'VARIANT' ? ' (variante compatible)' : ''} · ${esc(model.license)} · ${esc(model.author)}</p>`,
  );
}

export function modelLibraryPage(req) {
  const catalog = loadModelCatalog();
  if (!catalog.available)
    return (
      pageHead(
        'MODELOS 3D',
        'Biblioteca local',
        'Modelos 3D disponibles sin conexión a internet.',
      ) +
      card(
        catalog.unreadable ? 'Catálogo ilegible' : 'Biblioteca no encontrada',
        empty(
          catalog.unreadable ? 'catalog/models.json no se pudo leer' : 'Sin catálogo local',
          catalog.unreadable
            ? 'El archivo está dañado o fue editado a mano. Restáuralo desde una copia de «Mecan 1.1 Offline». El diagnóstico 3D sigue funcionando con las carrocerías paramétricas.'
            : 'Configura MODEL_LIBRARY_PATH o copia la carpeta «Mecan 1.1 Offline» junto a la aplicación. El diagnóstico 3D sigue funcionando con las carrocerías paramétricas.',
        ),
      )
    );
  // Solo lo que está en disco: una entrada cuyo archivo falta no se ofrece como disponible.
  const models = catalog.models
    .filter((entry) => modelEntry(entry.id, catalog))
    .map((entry) => ({ ...publicModel(entry), entry }));
  const categories = [...new Set(models.map((m) => m.category))];
  const unavailable = catalog.vehicles.filter((vehicle) => vehicle.status === NOT_AVAILABLE);
  return (
    pageHead(
      'MODELOS 3D',
      'Biblioteca local de modelos',
      'Archivos almacenados en «Mecan 1.1 Offline». Se muestran sin conexión y con su licencia y atribución.',
    ) +
    metricGrid([
      { label: 'Modelos válidos', value: models.length, note: 'Formato GLB' },
      { label: 'Categorías', value: categories.length, note: categories.join(', ') },
      {
        label: 'Marcas',
        value: new Set(models.filter((m) => !m.generic).map((m) => m.brand)).size,
        note: `${models.filter((m) => m.generic).length} genéricos`,
      },
      { label: 'Sin modelo 3D', value: unavailable.length, note: NOT_AVAILABLE },
    ]) +
    card(
      'Modelos',
      models.length
        ? `<div class="model-library">${models
            .map(
              (m) =>
                `<article class="model-card">${m.thumbnail ? `<img src="${esc(m.thumbnail)}" alt="${esc(m.model)}" loading="lazy">` : ''}<b>${esc(m.generic ? 'Genérico' : m.brand)} · ${esc(m.model)}${m.year ? ' ' + esc(m.year) : ''}</b><small>${esc(m.category)} · ${esc(m.vehicleType || '—')} · ${m.triangles ? `${Number(m.triangles).toLocaleString('es-PY')} triángulos` : ''}</small><small>${esc(m.license)} · ${esc(m.author)}</small>${m.attribution ? `<small>${esc(m.attribution)}</small>` : ''}${m.sourceUrl ? `<small>Fuente: ${esc(m.sourceUrl)}</small>` : ''}</article>`,
            )
            .join('')}</div>`
        : empty(
            'Sin modelos',
            'Ejecuta la recopilación inicial (npm run models:collect) con conexión a internet.',
          ),
    ) +
    (unavailable.length
      ? card(
          `Vehículos sin modelo 3D (${NOT_AVAILABLE})`,
          `<p>${unavailable.map((v) => esc(`${v.brand} ${v.model}`)).join(' · ')}</p>`,
        )
      : '')
  );
}
