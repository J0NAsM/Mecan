import {
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
} from '../ui.js';
import { AppError } from '../errors.js';
import { ORDER_LABELS } from '../workflow.js';
import { can } from '../tenancy.js';
import { id, now, addDays } from '../utils.js';
import { orderProfitability } from '../services/workshop-operations.js';
import { calendarDate, startOfLocalDate } from '../time.js';
import { pagedRows } from '../pagination.js';

const statusBadge = (status) =>
  `<span class="badge badge-${esc(status.toLowerCase())}">${esc(ORDER_LABELS[status] || status)}</span>`;
const actionForm = (action, csrf, content, label, confirm = '') =>
  `<form class="form-grid" method="post" action="${action}" ${confirm ? `data-confirm="${esc(confirm)}"` : ''}>${csrfInput(csrf)}${content}<div class="form-actions"><button class="button">${esc(label)}</button></div></form>`;

function paymentHistory(payments, req, kind) {
  const supplier = kind === 'supplier';
  const permission = supplier ? 'purchases.reverse' : 'billing.reverse';
  const columns = [
    { label: 'Fecha', render: (r) => shortDate(r.paid_at) },
    ...(supplier
      ? [
          {
            label: 'Proveedor / compra',
            render: (r) => `${esc(r.supplier)} · OC-${r.purchase_number}`,
          },
        ]
      : []),
    { label: 'Método', render: (r) => esc(label(r.method)) },
    { label: 'Referencia', key: 'reference' },
    { label: 'Importe', render: (r) => money(r.amount) },
    {
      label: 'Estado',
      render: (r) =>
        r.reversed_at
          ? `${badge('REVERSED')}<details><summary>Ver motivo</summary><p>${esc(r.reversal_reason)}</p><small>${shortDate(r.reversed_at)}</small></details>`
          : badge('RECORDED'),
    },
  ];
  if (can(req.context, permission))
    columns.push({
      label: 'Corrección',
      render: (r) =>
        r.reversed_at
          ? '—'
          : `<details><summary>Corregir registro</summary><p>Revierte el registro completo y restablece la deuda. No devuelve dinero ni cancela transferencias en el banco.</p>${actionForm(`/workshop/${supplier ? 'purchase-payments' : 'payments'}/${r.id}/reverse`, req.session.csrf_token, textarea('reason', 'Motivo de la corrección', '', { required: true, maxlength: 1000 }) + `<input type="hidden" name="idempotencyKey" value="${id()}">`, 'Revertir registro', '¿Confirmas que este registro de pago es incorrecto? Se restablecerá la deuda y quedará una contrapartida en caja. No se ejecutará una devolución bancaria.')}</details>`,
    });
  return dataTable(columns, payments, {
    emptyTitle: 'Sin pagos registrados',
    emptyText: 'Los pagos y sus correcciones aparecerán aquí.',
    stacked: true,
  });
}

export async function orderDetailPage(db, req, orderId) {
  const tenantId = req.context.tenant.id,
    csrf = req.session.csrf_token;
  const order = await db
    .prepare(
      `SELECT o.*,c.name customer,c.phone customer_phone,v.plate,v.make,v.model,v.year,v.odometer,b.name branch
    FROM work_orders o JOIN customers c ON c.id=o.customer_id JOIN vehicles v ON v.id=o.vehicle_id JOIN branches b ON b.id=o.branch_id
    WHERE o.id=? AND o.tenant_id=?`,
    )
    .get(orderId, tenantId);
  if (!order) throw new AppError('Orden no encontrada.', { status: 404 });
  const settings = await db
    .prepare('SELECT warranty_days,warranty_terms,timezone FROM tenant_settings WHERE tenant_id=?')
    .get(tenantId);
  const reception = await db
    .prepare('SELECT * FROM receptions WHERE tenant_id=? AND work_order_id=?')
    .get(tenantId, order.id);
  const inspections = await db
    .prepare(
      'SELECT i.*,u.name inspector FROM inspections i JOIN users u ON u.id=i.inspector_user_id WHERE i.tenant_id=? AND i.work_order_id=? ORDER BY i.created_at DESC',
    )
    .all(tenantId, order.id);
  const diagnoses = await db
    .prepare(
      'SELECT d.*,u.name technician FROM diagnoses d LEFT JOIN users u ON u.id=d.technician_user_id WHERE d.tenant_id=? AND d.work_order_id=? ORDER BY d.created_at DESC',
    )
    .all(tenantId, order.id);
  const estimate = await db
    .prepare(
      'SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? ORDER BY version DESC LIMIT 1',
    )
    .get(tenantId, order.id);
  const estimateItems = estimate
    ? await db
        .prepare(
          'SELECT ei.*,i.name inventory_name FROM estimate_items ei LEFT JOIN inventory_items i ON i.id=ei.inventory_item_id WHERE ei.tenant_id=? AND ei.estimate_id=?',
        )
        .all(tenantId, estimate.id)
    : [];
  const assignments = await db
    .prepare(
      `SELECT a.*,u.name technician,(SELECT COALESCE(SUM(duration_minutes),0) FROM time_entries te WHERE te.assignment_id=a.id AND te.tenant_id=a.tenant_id) minutes
    FROM work_assignments a JOIN users u ON u.id=a.technician_user_id WHERE a.tenant_id=? AND a.work_order_id=? ORDER BY a.created_at`,
    )
    .all(tenantId, order.id);
  const parts = await db
    .prepare(
      'SELECT p.*,i.name,i.sku FROM active_work_order_parts p JOIN inventory_items i ON i.id=p.inventory_item_id WHERE p.tenant_id=? AND p.work_order_id=?',
    )
    .all(tenantId, order.id);
  const labor = await db
    .prepare(
      'SELECT l.*,u.name technician FROM work_order_labor l LEFT JOIN users u ON u.id=l.technician_user_id WHERE l.tenant_id=? AND l.work_order_id=?',
    )
    .all(tenantId, order.id);
  const checks = await db
    .prepare(
      'SELECT q.*,u.name inspector FROM quality_checks q JOIN users u ON u.id=q.inspector_user_id WHERE q.tenant_id=? AND q.work_order_id=? ORDER BY q.created_at DESC',
    )
    .all(tenantId, order.id);
  const invoice = await db
    .prepare(
      'SELECT * FROM workshop_invoices WHERE tenant_id=? AND work_order_id=? AND voided_at IS NULL',
    )
    .get(tenantId, order.id);
  const payments = invoice
    ? await db
        .prepare(
          'SELECT p.*,r.created_at reversed_at,r.reason reversal_reason FROM workshop_payments p LEFT JOIN payment_reversals r ON r.customer_payment_id=p.id AND r.tenant_id=p.tenant_id WHERE p.tenant_id=? AND p.invoice_id=? ORDER BY p.paid_at,p.created_at,p.id',
        )
        .all(tenantId, invoice.id)
    : [];
  const delivery = await db
    .prepare('SELECT * FROM deliveries WHERE tenant_id=? AND work_order_id=?')
    .get(tenantId, order.id);
  const warranty = await db
    .prepare(
      'SELECT * FROM warranties WHERE tenant_id=? AND work_order_id=? ORDER BY created_at DESC LIMIT 1',
    )
    .get(tenantId, order.id);
  const requests = await db
    .prepare(
      'SELECT * FROM purchase_requests WHERE tenant_id=? AND work_order_id=? ORDER BY created_at DESC',
    )
    .all(tenantId, order.id);
  const technicians = await db
    .prepare(
      `SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.status='ACTIVE' ORDER BY u.name`,
    )
    .all(tenantId);
  const inventory = await db
    .prepare(
      'SELECT id,name,sku,quantity,sale_price FROM inventory_items WHERE tenant_id=? AND branch_id=? AND active=1 ORDER BY name',
    )
    .all(tenantId, order.branch_id);
  const profit = await orderProfitability(db, tenantId, order.id);
  const steps = [
    'RECEIVED',
    'DIAGNOSIS',
    'AWAITING_APPROVAL',
    'AUTHORIZED',
    'IN_PROGRESS',
    'QUALITY_CONTROL',
    'READY',
    'INVOICED',
    'PAID',
    'DELIVERED',
  ];
  const index = steps.indexOf(order.status);
  const stepper = `<ol class="workflow-steps">${steps.map((step, i) => `<li class="${i < index ? 'done' : i === index ? 'current' : ''}"><span>${i < index ? '✓' : i + 1}</span><small>${esc(ORDER_LABELS[step])}</small></li>`).join('')}</ol>`;
  let actions = '';
  if (['RECEIVED', 'INSPECTION'].includes(order.status) && can(req.context, 'orders.inspect'))
    actions += formCard(
      'Completar inspección',
      `/workshop/orders/${order.id}/inspection`,
      csrf,
      field('checklist', 'Checklist realizado', 'text', 'Luces, frenos, fluidos, neumáticos') +
        textarea('findings', 'Hallazgos', '', { required: true }),
      'Guardar inspección',
    );
  if (order.status === 'DIAGNOSIS' && can(req.context, 'orders.diagnose'))
    actions += formCard(
      'Registrar diagnóstico',
      `/workshop/orders/${order.id}/diagnosis`,
      csrf,
      textarea('summary', 'Diagnóstico', '', { required: true }) +
        textarea('recommendations', 'Recomendaciones'),
      'Completar diagnóstico',
    );
  if (order.status === 'ESTIMATE' && can(req.context, 'orders.estimate')) {
    actions += formCard(
      'Agregar concepto al presupuesto',
      `/workshop/orders/${order.id}/estimate/items`,
      csrf,
      select('itemType', 'Tipo', [
        ['LABOR', 'Mano de obra'],
        ['PART', 'Repuesto'],
        ['SERVICE', 'Servicio'],
        ['OTHER', 'Otro'],
      ]) +
        field('description', 'Descripción', 'text', '', { required: true }) +
        select('inventoryItemId', 'Artículo', [
          ['', 'Seleccione si el concepto es un repuesto'],
          ...inventory.map((x) => [x.id, `${x.name} · stock ${x.quantity}`]),
        ]) +
        field('quantity', 'Cantidad', 'number', 1, { min: 0.01, step: 0.01 }) +
        (can(req.context, 'billing.cost')
          ? field(
              'unitCost',
              'Costo de mano de obra / servicio (repuestos: costo de inventario)',
              'number',
              0,
              { min: 0, step: 0.01 },
            )
          : '') +
        field('unitPrice', 'Precio unitario', 'number', 0, { min: 0, step: 0.01 }) +
        field('validUntil', 'Válido hasta', 'date', addDays(now(), 7).slice(0, 10)),
      'Agregar concepto',
    );
    if (estimateItems.length)
      actions += card(
        'Enviar presupuesto',
        actionForm(
          `/workshop/orders/${order.id}/estimate/send`,
          csrf,
          '',
          'Enviar al cliente',
          'Una vez enviado deberá registrar la decisión del cliente.',
        ),
      );
  }
  if (
    order.status === 'AWAITING_APPROVAL' &&
    can(req.context, 'orders.approve') &&
    (Number(estimate?.total) !== 0 || can(req.context, 'orders.no_charge'))
  )
    actions += formCard(
      'Registrar autorización',
      `/workshop/orders/${order.id}/estimate/approve`,
      csrf,
      field('approvedBy', 'Autorizado por', 'text', order.customer, { required: true }) +
        textarea(
          'notes',
          Number(estimate?.total) === 0 ? 'Motivo del trabajo sin cargo' : 'Observaciones',
          '',
          { required: Number(estimate?.total) === 0 },
        ),
      'Autorizar presupuesto',
    );
  if (
    order.status === 'AWAITING_APPROVAL' &&
    Number(estimate?.total) === 0 &&
    !can(req.context, 'orders.no_charge')
  )
    actions += card(
      'Autorización de trabajo sin cargo',
      '<p>El propietario o una persona con permiso para autorizar trabajos sin cargo debe aprobar este presupuesto y registrar el motivo.</p>',
    );
  if (
    ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(order.status) &&
    can(req.context, 'orders.assign')
  )
    actions += formCard(
      'Asignar trabajo',
      `/workshop/orders/${order.id}/assignments`,
      csrf,
      select(
        'technicianId',
        'Técnico',
        technicians.map((x) => [x.id, x.name]),
      ) +
        field('description', 'Trabajo', 'text', '', { required: true }) +
        select('priority', 'Prioridad', [
          ['NORMAL', 'Normal'],
          ['HIGH', 'Alta'],
          ['URGENT', 'Urgente'],
          ['LOW', 'Baja'],
        ]) +
        textarea('instructions', 'Instrucciones'),
      'Asignar',
    );
  if (['AUTHORIZED', 'IN_PROGRESS'].includes(order.status) && can(req.context, 'inventory.consume'))
    actions += formCard(
      'Utilizar repuesto',
      `/workshop/orders/${order.id}/parts`,
      csrf,
      select(
        'inventoryItemId',
        'Repuesto',
        inventory.map((x) => [x.id, `${x.name} · ${x.quantity} disponibles`]),
      ) +
        field('quantity', 'Cantidad', 'number', 1, { min: 0.01 }) +
        '<p>Se aplicará el precio autorizado en el presupuesto.</p>' +
        field('notes', 'Observación') +
        `<input type="hidden" name="idempotencyKey" value="${id()}">`,
      'Descontar y agregar',
    );
  if (
    ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(order.status) &&
    can(req.context, 'inventory.request')
  )
    actions += inventory.length
      ? formCard(
          'Solicitar repuesto faltante',
          `/workshop/orders/${order.id}/part-requests`,
          csrf,
          select(
            'inventoryItemId',
            'Artículo',
            inventory.map((x) => [x.id, `${x.name} · stock ${x.quantity}`]),
            '',
            { required: true },
          ) +
            field('description', 'Repuesto requerido', 'text', '', { required: true }) +
            field('quantity', 'Cantidad', 'number', 1, { min: 0.01, step: 0.01 }) +
            select('priority', 'Prioridad', [
              ['NORMAL', 'Normal'],
              ['HIGH', 'Alta'],
              ['URGENT', 'Urgente'],
            ]),
          'Crear solicitud',
        )
      : card(
          'Solicitar repuesto',
          '<p>Primero crea el artículo con existencia cero para mantener trazabilidad de compras y costos.</p><a class="button button-outline" href="/workshop/inventory">Crear artículo</a>',
        );
  if (order.status === 'IN_PROGRESS' && can(req.context, 'orders.quality'))
    actions += card(
      'Finalizar reparación',
      actionForm(
        `/workshop/orders/${order.id}/quality/start`,
        csrf,
        '',
        'Enviar a control de calidad',
        'Todos los trabajos deben estar completados.',
      ),
    );
  if (order.status === 'QUALITY_CONTROL' && can(req.context, 'orders.quality'))
    actions += formCard(
      'Control de calidad',
      `/workshop/orders/${order.id}/quality`,
      csrf,
      select('result', 'Resultado', [
        ['PASSED', 'Aprobado'],
        ['FAILED', 'Requiere corrección'],
      ]) +
        field('checklist', 'Controles', 'text', 'Prueba de ruta, sin fugas, limpieza') +
        textarea('notes', 'Observaciones'),
      'Registrar control',
    );
  if (order.status === 'READY' && can(req.context, 'billing.invoice'))
    actions += card(
      'Facturar orden',
      actionForm(
        `/workshop/orders/${order.id}/invoice`,
        csrf,
        field('dueAt', 'Vencimiento', 'date', now().slice(0, 10)) +
          `<input type="hidden" name="idempotencyKey" value="${id()}">`,
        'Emitir factura',
        'Se utilizarán los trabajos y repuestos reales de la orden.',
      ),
    );
  if (
    (order.status === 'INVOICED' || (order.status === 'PAID' && Number(invoice?.amount) === 0)) &&
    invoice &&
    Number(invoice.paid_amount) === 0 &&
    can(req.context, 'billing.void')
  )
    actions += card(
      'Anular factura',
      actionForm(
        `/workshop/invoices/${invoice.id}/void`,
        csrf,
        textarea('reason', 'Motivo', '', { required: true }),
        'Anular factura',
        'La operación quedará auditada y la orden podrá facturarse nuevamente.',
      ),
    );
  if (
    ['INVOICED', 'PARTIALLY_PAID', 'DELIVERED', 'CLOSED'].includes(order.status) &&
    invoice &&
    Number(invoice.balance) > 0 &&
    can(req.context, 'billing.collect')
  )
    actions += formCard(
      'Registrar cobro',
      `/workshop/invoices/${invoice.id}/payments`,
      csrf,
      field('amount', 'Importe', 'number', invoice.balance, { min: 0.01 }) +
        select('method', 'Método', [
          ['CASH', 'Efectivo'],
          ['TRANSFER', 'Transferencia'],
          ['CARD', 'Tarjeta'],
          ['OTHER', 'Otro'],
        ]) +
        field('reference', 'Referencia') +
        field('paidAt', 'Fecha', 'date', calendarDate(now(), settings?.timezone), {
          max: calendarDate(now(), settings?.timezone),
        }) +
        `<input type="hidden" name="idempotencyKey" value="${id()}">`,
      'Registrar cobro',
    );
  if (order.status === 'PAID' && can(req.context, 'orders.deliver'))
    actions += formCard(
      'Entregar vehículo',
      `/workshop/orders/${order.id}/delivery`,
      csrf,
      field('receivedBy', 'Recibido por', 'text', order.customer, { required: true }) +
        field('odometer', 'Kilometraje de salida', 'number', order.odometer, { min: 0 }) +
        field('warrantyDays', 'Garantía (días)', 'number', settings.warranty_days, { min: 0 }) +
        textarea('warrantyTerms', 'Condiciones', settings.warranty_terms) +
        textarea('notes', 'Observaciones'),
      'Confirmar entrega',
    );
  if (
    ['RECEIVED', 'INSPECTION', 'DIAGNOSIS', 'ESTIMATE', 'AWAITING_APPROVAL'].includes(
      order.status,
    ) &&
    can(req.context, 'orders.cancel')
  )
    actions += card(
      'Cancelar orden',
      actionForm(
        `/workshop/orders/${order.id}/cancel`,
        csrf,
        textarea('reason', 'Motivo', '', { required: true }),
        'Cancelar orden',
        'La cancelación es definitiva y quedará auditada.',
      ),
    );
  if (can(req.context, 'documents.upload'))
    actions += card(
      'Fotografías y documentos',
      `<form class="form-grid" method="post" action="/workshop/documents" data-upload>${csrfInput(csrf)}<input type="hidden" name="entityType" value="WORK_ORDER"><input type="hidden" name="entityId" value="${order.id}"><input type="hidden" name="category" value="EVIDENCE"><label class="field field-wide"><span>PDF o imagen (máximo 7 MB)</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required></label><div class="form-actions"><button class="button">Adjuntar evidencia</button></div></form>`,
    );
  const linkedFiles = await db
    .prepare(
      `SELECT f.* FROM files f JOIN file_links l ON l.file_id=f.id WHERE l.tenant_id=? AND l.entity_type='WORK_ORDER' AND l.entity_id=? ORDER BY f.created_at DESC`,
    )
    .all(tenantId, order.id);
  const assignmentsTable = dataTable(
    [
      { label: 'Técnico', key: 'technician' },
      { label: 'Trabajo', key: 'description' },
      { label: 'Prioridad', key: 'priority' },
      { label: 'Tiempo', render: (r) => `${r.minutes || 0} min` },
      { label: 'Estado', render: (r) => badge(r.status) },
      {
        label: 'Acciones',
        render: (r) => {
          if (!(can(req.context, 'orders.assign') || r.technician_user_id === req.session.user_id))
            return '—';
          const buttons = [];
          if (['ASSIGNED', 'PAUSED'].includes(r.status)) buttons.push(['START', 'Iniciar']);
          if (r.status === 'IN_PROGRESS')
            buttons.push(['PAUSE', 'Pausar'], ['COMPLETE', 'Finalizar']);
          return buttons
            .map(
              ([action, text]) =>
                `<form method="post" action="/workshop/assignments/${r.id}/${action.toLowerCase()}">${csrfInput(csrf)}<button class="link-button">${text}</button></form>`,
            )
            .join(' ');
        },
      },
    ],
    assignments,
  );
  if (order.status === 'AWAITING_APPROVAL' && can(req.context, 'orders.estimate'))
    actions += formCard(
      'Revisar presupuesto',
      `/workshop/orders/${order.id}/revise-estimate`,
      csrf,
      textarea('reason', 'Motivo de rechazo o revisión', '', { required: true }),
      'Crear nueva versión',
    );
  if (
    ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(order.status) &&
    can(req.context, 'inventory.consume') &&
    inventory.length
  )
    actions += formCard(
      'Reservar repuesto',
      `/workshop/orders/${order.id}/reservations`,
      csrf,
      select(
        'inventoryItemId',
        'Repuesto',
        inventory.map((x) => [x.id, x.name]),
      ) +
        field('quantity', 'Cantidad', 'number', 1, { min: 0.001, step: 'any', required: true }) +
        `<input type="hidden" name="idempotencyKey" value="${id()}">`,
      'Reservar',
    );
  const estimateCard = estimate
    ? card(
        `Presupuesto #${estimate.number}`,
        dataTable(
          [
            { label: 'Tipo', key: 'item_type' },
            { label: 'Concepto', key: 'description' },
            { label: 'Cantidad', key: 'quantity' },
            {
              label: 'Costo',
              render: (r) =>
                can(req.context, 'billing.cost') ? money(r.unit_cost) : 'Restringido',
            },
            { label: 'Precio', render: (r) => money(r.unit_price) },
            { label: 'Total', render: (r) => money(r.total) },
            {
              label: 'Acción',
              render: (r) =>
                estimate.status === 'DRAFT' && can(req.context, 'orders.estimate')
                  ? `<form method="post" action="/workshop/estimate-items/${r.id}/remove" data-confirm="¿Quitar este concepto del borrador?"><input type="hidden" name="csrf" value="${csrf}"><button class="link-button">Quitar</button></form>`
                  : '',
            },
          ],
          estimateItems,
        ) +
          `<div class="totals"><span>Subtotal <b>${money(estimate.subtotal)}</b></span><span>Impuesto <b>${money(estimate.tax)}</b></span><span>Total <strong>${money(estimate.total)}</strong></span>${statusBadge(estimate.status)}</div>`,
      )
    : '';
  const financial =
    invoice && can(req.context, 'billing.view')
      ? card(
          `Factura #${invoice.number}`,
          `<div class="stat-list"><div><span>Total</span><b>${money(invoice.amount)}</b></div><div><span>Cobrado</span><b>${money(invoice.paid_amount)}</b></div><div><span>Saldo</span><b>${money(invoice.balance)}</b></div><div><span>Estado</span>${badge(Number(invoice.amount) === 0 ? 'NO_CHARGE' : invoice.status)}</div></div>${paymentHistory(payments, req, 'customer')}`,
        )
      : '';
  return (
    pageHead(
      'ORDEN DE TRABAJO',
      `Orden #${order.number}`,
      `${order.plate} · ${order.make || ''} ${order.model || ''} · ${order.customer}`,
      `<a class="button button-outline" href="/workshop/orders">Volver</a>${estimate && can(req.context, 'orders.print') ? `<a class="button button-outline" href="/workshop/orders/${order.id}/print?type=estimate">Presupuesto PDF</a>` : ''}${invoice && can(req.context, 'billing.print') ? `<a class="button button-outline" href="/workshop/orders/${order.id}/print?type=invoice">Comprobante PDF</a>` : ''}${delivery && can(req.context, 'orders.print') ? `<a class="button button-outline" href="/workshop/orders/${order.id}/print?type=delivery">Entrega PDF</a>` : ''}`,
    ) +
    stepper +
    metricGrid([
      { label: 'Estado', value: ORDER_LABELS[order.status] || order.status, note: order.branch },
      { label: 'Prometida', value: shortDate(order.promised_at), note: order.customer_phone || '' },
      {
        label: 'Total actual',
        value: money(order.total),
        note: `Mano de obra ${money(profit.revenue - parts.reduce((s, x) => s + x.total, 0))}`,
      },
      {
        label: 'Margen estimado',
        value: can(req.context, 'billing.cost') ? money(profit.margin) : 'Restringido',
        note: can(req.context, 'billing.cost')
          ? `${profit.marginPercent.toFixed(1)}%`
          : 'Requiere permiso',
      },
    ]) +
    `<div class="dashboard-grid"><div>${card('Recepción', `<div class="stat-list"><div><span>Motivo</span><b>${esc(order.complaint || '—')}</b></div><div><span>Kilometraje</span><b>${reception?.odometer?.toLocaleString('es-PY') || '—'} km</b></div><div><span>Combustible</span><b>${reception?.fuel_level ?? '—'}%</b></div><div><span>Daños visibles</span><b>${esc(reception?.visible_damage || 'Ninguno registrado')}</b></div></div>`)}${inspections.length ? card('Inspección', inspections.map((x) => `<p><b>${esc(x.inspector)}</b> · ${esc(x.findings)}</p>`).join('')) : ''}${diagnoses.length ? card('Diagnóstico', diagnoses.map((x) => `<p><b>${esc(x.technician || 'Equipo')}</b> · ${esc(x.summary)}</p>`).join('')) : ''}${estimateCard}${card('Trabajos asignados', assignmentsTable)}${
      parts.length
        ? card(
            'Repuestos utilizados',
            dataTable(
              [
                { label: 'Repuesto', key: 'name' },
                { label: 'Cantidad', key: 'quantity' },
                {
                  label: 'Costo',
                  render: (r) =>
                    can(req.context, 'billing.cost') ? money(r.unit_cost) : 'Restringido',
                },
                { label: 'Precio', render: (r) => money(r.total) },
                {
                  label: 'Devolución',
                  render: (r) =>
                    ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'].includes(order.status) &&
                    can(req.context, 'inventory.consume')
                      ? `<form method="post" action="/workshop/parts/${r.id}/return" data-confirm="Confirma que este repuesto NO se utilizó y regresa físicamente al inventario.">${csrfInput(csrf)}${field('reason', 'Motivo', 'text', '', { required: true })}<input type="hidden" name="idempotencyKey" value="${id()}"><button class="link-button">Devolver consumo completo</button></form>`
                      : '—',
                },
              ],
              parts,
            ),
          )
        : ''
    }${
      linkedFiles.length && can(req.context, 'documents.view')
        ? card(
            'Evidencias',
            dataTable(
              [
                {
                  label: 'Archivo',
                  render: (r) =>
                    `<a href="/api/files/${r.id}" target="_blank" rel="noopener">${esc(r.name)}</a>`,
                },
                { label: 'Tipo', key: 'mime_type' },
                { label: 'Fecha', render: (r) => shortDate(r.created_at) },
              ],
              linkedFiles,
            ),
          )
        : ''
    }${
      checks.length
        ? card(
            'Control de calidad',
            dataTable(
              [
                { label: 'Fecha', render: (r) => shortDate(r.created_at) },
                { label: 'Responsable', key: 'inspector' },
                { label: 'Resultado', render: (r) => badge(r.result) },
                { label: 'Notas', key: 'notes' },
              ],
              checks,
            ),
          )
        : ''
    }${financial}${delivery ? card('Entrega y garantía', `<p>Entregado a <b>${esc(delivery.received_by_name)}</b> el ${shortDate(delivery.delivered_at)}.</p>${warranty ? `<p>Garantía hasta <b>${shortDate(warranty.ends_at)}</b>: ${esc(warranty.terms)}</p>` : ''}`) : ''}</div><aside>${actions || card('Sin acciones pendientes', '<p>El flujo de esta orden está completo o tu rol no permite realizar la siguiente acción.</p>')}${
      requests.length
        ? card(
            'Solicitudes de compra',
            dataTable(
              [
                { label: 'Repuesto', key: 'description' },
                { label: 'Cantidad', key: 'quantity' },
                { label: 'Estado', render: (r) => badge(r.status) },
                { label: 'Compra', render: (r) => `<a href="/workshop/purchases">Gestionar</a>` },
              ],
              requests,
            ),
          )
        : ''
    }</aside></div>`
  );
}

export async function myWorkPage(db, req) {
  const rows = await db
    .prepare(
      `SELECT a.*,o.number,o.status order_status,v.plate,v.make,v.model,c.name customer
    FROM work_assignments a JOIN work_orders o ON o.id=a.work_order_id JOIN vehicles v ON v.id=o.vehicle_id JOIN customers c ON c.id=o.customer_id
    WHERE a.tenant_id=? AND a.technician_user_id=? AND a.status NOT IN ('COMPLETED','CANCELED') ORDER BY CASE a.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END,a.created_at`,
    )
    .all(req.context.tenant.id, req.session.user_id);
  return (
    pageHead('MECÁNICO', 'Mis trabajos', 'Solo lo que necesitas para avanzar con seguridad.') +
    card(
      'Trabajo pendiente',
      dataTable(
        [
          { label: 'Prioridad', render: (r) => badge(r.priority) },
          {
            label: 'Orden',
            render: (r) => `<a href="/workshop/orders/${r.work_order_id}">#${r.number}</a>`,
          },
          {
            label: 'Vehículo',
            render: (r) => `${esc(r.plate)} · ${esc(r.make || '')} ${esc(r.model || '')}`,
          },
          { label: 'Cliente', key: 'customer' },
          { label: 'Trabajo', key: 'description' },
          { label: 'Estado', render: (r) => badge(r.status) },
          {
            label: 'Acción',
            render: (r) => `<a href="/workshop/orders/${r.work_order_id}">Abrir →</a>`,
          },
        ],
        rows,
      ),
    )
  );
}

export async function purchasesPage(db, req) {
  const t = req.context.tenant.id,
    csrf = req.session.csrf_token;
  const requests = await db
    .prepare(
      `SELECT pr.*,o.number order_number,i.name item FROM purchase_requests pr LEFT JOIN work_orders o ON o.id=pr.work_order_id LEFT JOIN inventory_items i ON i.id=pr.inventory_item_id WHERE pr.tenant_id=? ORDER BY pr.created_at DESC`,
    )
    .all(t);
  const suppliers = await db
    .prepare('SELECT id,name FROM suppliers WHERE tenant_id=? AND active=1 ORDER BY name')
    .all(t);
  const orders = await db
    .prepare(
      `SELECT po.*,s.name supplier,pr.description request_description FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN purchase_requests pr ON pr.id=po.purchase_request_id WHERE po.tenant_id=? ORDER BY po.created_at DESC`,
    )
    .all(t);
  const payables = await db
    .prepare(
      `SELECT ap.*,s.name supplier,po.number purchase_number FROM accounts_payable ap JOIN suppliers s ON s.id=ap.supplier_id JOIN purchase_orders po ON po.id=ap.purchase_order_id WHERE ap.tenant_id=? ORDER BY ap.status,ap.due_at`,
    )
    .all(t);
  const paymentRows =
    can(req.context, 'purchases.pay') || can(req.context, 'purchases.reverse')
      ? await pagedRows(
          db,
          req,
          `SELECT p.*,s.name supplier,po.number purchase_number,r.created_at reversed_at,r.reason reversal_reason
        FROM purchase_payments p JOIN accounts_payable a ON a.id=p.payable_id AND a.tenant_id=p.tenant_id
        JOIN suppliers s ON s.id=a.supplier_id JOIN purchase_orders po ON po.id=a.purchase_order_id
        LEFT JOIN payment_reversals r ON r.purchase_payment_id=p.id AND r.tenant_id=p.tenant_id
        WHERE p.tenant_id=? ORDER BY p.created_at DESC,p.id`,
          [t],
          ['supplier', 'purchase_number', 'reference'],
          { key: 'payments' },
        )
      : [];
  return (
    pageHead(
      'ABASTECIMIENTO',
      'Compras y cuentas por pagar',
      'Desde la necesidad del taller hasta el pago al proveedor.',
    ) +
    (can(req.context, 'purchases.manage')
      ? formCard(
          'Reponer inventario',
          '/workshop/restock',
          csrf,
          select(
            'inventoryItemId',
            'Artículo',
            (
              await db
                .prepare(
                  'SELECT id,name FROM inventory_items WHERE tenant_id=? AND active=1 ORDER BY name',
                )
                .all(t)
            ).map((x) => [x.id, x.name]),
          ) +
            field('quantity', 'Cantidad', 'number', 1, {
              min: 0.001,
              step: 'any',
              required: true,
            }) +
            field('description', 'Motivo') +
            `<input type="hidden" name="idempotencyKey" value="${id()}">`,
          'Solicitar compra',
        )
      : '') +
    card(
      'Solicitudes',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          {
            label: 'Orden',
            render: (r) =>
              r.order_number
                ? `<a href="/workshop/orders/${r.work_order_id}">#${r.order_number}</a>`
                : 'Stock',
          },
          { label: 'Repuesto', render: (r) => esc(r.item || r.description) },
          { label: 'Cantidad', key: 'quantity' },
          { label: 'Prioridad', render: (r) => badge(r.priority) },
          { label: 'Estado', render: (r) => badge(r.status) },
          {
            label: 'Acción',
            render: (r) =>
              ['REQUESTED', 'QUOTING'].includes(r.status) &&
              suppliers.length &&
              can(req.context, 'purchases.manage')
                ? `<form class="inline-form" method="post" action="/workshop/purchase-requests/${r.id}/order">${csrfInput(csrf)}${select(
                    'supplierId',
                    'Proveedor',
                    suppliers.map((x) => [x.id, x.name]),
                  )}${field('unitCost', 'Costo', 'number', 0, { min: 0 })}<button class="button button-small">Ordenar</button></form>`
                : '—',
          },
        ],
        requests,
      ),
    ) +
    card(
      'Órdenes de compra',
      dataTable(
        [
          { label: 'N°', render: (r) => `OC-${r.number}` },
          { label: 'Proveedor', key: 'supplier' },
          { label: 'Solicitud', key: 'request_description' },
          { label: 'Total', render: (r) => money(r.total) },
          { label: 'Esperada', render: (r) => shortDate(r.expected_at) },
          { label: 'Estado', render: (r) => badge(r.status) },
          {
            label: 'Acción',
            render: (r) =>
              ['SENT', 'PARTIAL'].includes(r.status) && can(req.context, 'purchases.manage')
                ? `<form method="post" action="/workshop/purchase-orders/${r.id}/receive">${csrfInput(csrf)}<input type="hidden" name="idempotencyKey" value="${id()}"><button class="link-button">Recibir</button></form>`
                : '—',
          },
        ],
        orders,
      ),
    ) +
    card(
      'Cuentas por pagar',
      dataTable(
        [
          { label: 'Proveedor', key: 'supplier' },
          { label: 'Compra', render: (r) => `OC-${r.purchase_number}` },
          { label: 'Vence', render: (r) => shortDate(r.due_at) },
          { label: 'Total', render: (r) => money(r.amount) },
          { label: 'Saldo', render: (r) => money(r.balance) },
          { label: 'Estado', render: (r) => badge(r.status) },
          {
            label: 'Pagar',
            render: (r) =>
              r.balance > 0 && can(req.context, 'purchases.pay')
                ? `<form class="inline-form" method="post" action="/workshop/payables/${r.id}/payments">${csrfInput(csrf)}${field('amount', 'Importe', 'number', r.balance, { min: 0.01 })}${select(
                    'method',
                    'Método',
                    [
                      ['TRANSFER', 'Transferencia'],
                      ['CASH', 'Efectivo'],
                      ['CARD', 'Tarjeta'],
                    ],
                  )}${field('reference', 'Referencia')}<input type="hidden" name="idempotencyKey" value="${id()}"><button class="button button-small">Pagar</button></form>`
                : '—',
          },
        ],
        payables,
      ),
    ) +
    (can(req.context, 'purchases.pay') || can(req.context, 'purchases.reverse')
      ? card('Historial de pagos a proveedores', paymentHistory(paymentRows, req, 'supplier'))
      : '')
  );
}

export async function globalSearchPage(db, req, query) {
  const t = req.context.tenant.id,
    q = String(query || '')
      .trim()
      .slice(0, 150),
    like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const groups = [];
  const search = async (permission, title, sql, args, columns) => {
    if (can(req.context, permission) && q.length >= 2)
      groups.push(card(title, dataTable(columns, await db.prepare(sql).all(t, ...args))));
  };
  await search(
    'customers.view',
    'Clientes',
    "SELECT id,name,phone,document FROM customers WHERE tenant_id=? AND (name ILIKE ? ESCAPE '\\' OR phone ILIKE ? ESCAPE '\\' OR document ILIKE ? ESCAPE '\\') ORDER BY name LIMIT 20",
    [like, like, like],
    [
      {
        label: 'Nombre',
        render: (r) => `<a href="/workshop/customers/${r.id}">${esc(r.name)}</a>`,
      },
      { label: 'Teléfono', key: 'phone' },
      { label: 'Documento', key: 'document' },
    ],
  );
  await search(
    'vehicles.view',
    'Vehículos',
    "SELECT id,plate,make,model,vin FROM vehicles WHERE tenant_id=? AND (plate ILIKE ? ESCAPE '\\' OR vin ILIKE ? ESCAPE '\\' OR make ILIKE ? ESCAPE '\\' OR model ILIKE ? ESCAPE '\\') ORDER BY plate LIMIT 20",
    [like, like, like, like],
    [
      {
        label: 'Patente',
        render: (r) => `<a href="/workshop/vehicles/${r.id}">${esc(r.plate)}</a>`,
      },
      { label: 'Vehículo', render: (r) => esc([r.make, r.model].filter(Boolean).join(' ')) },
      { label: 'VIN', key: 'vin' },
    ],
  );
  await search(
    'orders.view',
    'Órdenes',
    "SELECT o.id,o.number,o.status,v.plate,c.name customer FROM work_orders o JOIN vehicles v ON v.id=o.vehicle_id JOIN customers c ON c.id=o.customer_id WHERE o.tenant_id=? AND (CAST(o.number AS TEXT)=? OR v.plate ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\') ORDER BY o.created_at DESC LIMIT 20",
    [q.replace('#', ''), like, like],
    [
      { label: 'Orden', render: (r) => `<a href="/workshop/orders/${r.id}">#${r.number}</a>` },
      { label: 'Cliente', key: 'customer' },
      { label: 'Patente', key: 'plate' },
      { label: 'Estado', render: (r) => statusBadge(r.status) },
    ],
  );
  await search(
    'inventory.view',
    'Inventario',
    "SELECT id,sku,name,quantity FROM inventory_items WHERE tenant_id=? AND (name ILIKE ? ESCAPE '\\' OR sku ILIKE ? ESCAPE '\\') ORDER BY name LIMIT 20",
    [like, like],
    [
      {
        label: 'Producto',
        render: (r) => `<a href="/workshop/inventory/${r.id}/movements">${esc(r.name)}</a>`,
      },
      { label: 'SKU', key: 'sku' },
      { label: 'Stock', key: 'quantity' },
    ],
  );
  for (const [table, title, permission] of [
    ['estimates', 'Presupuestos', 'orders.estimate'],
    ['workshop_invoices', 'Facturas', 'billing.view'],
  ]) {
    await search(
      permission,
      title,
      `SELECT d.*,o.number order_number,c.name customer FROM ${table} d JOIN work_orders o ON o.id=d.work_order_id JOIN customers c ON c.id=o.customer_id WHERE d.tenant_id=? AND (CAST(d.number AS TEXT)=? OR c.name ILIKE ? ESCAPE '\\') ORDER BY d.created_at DESC LIMIT 20`,
      [q.replace('#', ''), like],
      [
        {
          label: 'Número',
          render: (r) => `<a href="/workshop/orders/${r.work_order_id}">#${r.number}</a>`,
        },
        { label: 'Cliente', key: 'customer' },
        { label: 'Orden', key: 'order_number' },
        { label: 'Estado', render: (r) => badge(r.status) },
      ],
    );
  }
  return (
    pageHead(
      'BÚSQUEDA',
      'Buscar en el taller',
      'Clientes, teléfonos, documentos, vehículos, órdenes, presupuestos, facturas y repuestos según tus permisos.',
    ) +
    `<form class="global-search-page" method="get"><label class="sr-only" for="global-query">Buscar</label><input id="global-query" name="q" maxlength="150" value="${esc(q)}" placeholder="Nombre, teléfono, patente, VIN, número…" autofocus><button class="button">Buscar</button></form>` +
    (q.length < 2
      ? empty(
          'Escribe al menos 2 caracteres',
          'Los resultados pertenecen exclusivamente a tu taller.',
        )
      : groups.join(''))
  );
}

export function reportPeriod(url, timezone = 'America/Asuncion') {
  const end = url.searchParams.get('to') || calendarDate(new Date(), timezone);
  const valid = (d) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d;
  if (!valid(end)) throw new AppError('Selecciona una fecha final válida.', { status: 422 });
  const start = url.searchParams.get('from') || addDays(end, -30).slice(0, 10);
  if (!valid(start) || start > end)
    throw new AppError('Selecciona un período válido: la fecha inicial no puede superar la final.');
  return {
    start,
    end,
    from: startOfLocalDate(start, timezone),
    to: new Date(
      Date.parse(startOfLocalDate(addDays(end, 1).slice(0, 10), timezone)) - 1,
    ).toISOString(),
  };
}
export async function reportsPage(db, req, url) {
  const t = req.context.tenant.id,
    { start, end, from, to } = reportPeriod(
      url,
      (await db.prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?').get(t))?.timezone,
    );
  const finance = can(req.context, 'billing.view'),
    costAccess = finance && can(req.context, 'billing.cost');
  const summary = await db
    .prepare(
      `SELECT COUNT(*) invoices,COALESCE(SUM(o.subtotal),0) revenue,COALESCE(SUM(o.tax),0) tax
    FROM workshop_invoices i JOIN work_orders o ON o.id=i.work_order_id AND o.tenant_id=i.tenant_id
    WHERE i.tenant_id=? AND i.voided_at IS NULL AND i.created_at BETWEEN ? AND ?`,
    )
    .get(t, from, to);
  const costs = (
    await db
      .prepare(
        `SELECT COALESCE(SUM((SELECT COALESCE(SUM(p.quantity*p.unit_cost),0) FROM active_work_order_parts p WHERE p.tenant_id=i.tenant_id AND p.work_order_id=i.work_order_id)+
    (SELECT COALESCE(SUM(l.hours*l.hourly_cost),0) FROM work_order_labor l WHERE l.tenant_id=i.tenant_id AND l.work_order_id=i.work_order_id)),0) total
    FROM workshop_invoices i WHERE i.tenant_id=? AND i.voided_at IS NULL AND i.created_at BETWEEN ? AND ?`,
      )
      .get(t, from, to)
  ).total;
  const cash = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='INCOME' AND category IN ('CUSTOMER_PAYMENT','OTHER_INCOME') THEN amount WHEN type='EXPENSE' AND category='CUSTOMER_PAYMENT_REVERSAL' THEN -amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN category='OPERATING_EXPENSE' AND type='EXPENSE' THEN amount ELSE 0 END),0) expenses
    FROM cash_movements WHERE tenant_id=? AND voided_at IS NULL AND created_at BETWEEN ? AND ?`,
    )
    .get(t, from, to);
  const services = await db
    .prepare(
      `SELECT l.description,COUNT(*) uses,SUM(l.total) revenue,SUM(l.hours*l.hourly_cost) cost
    FROM work_order_labor l JOIN workshop_invoices i ON i.tenant_id=l.tenant_id AND i.work_order_id=l.work_order_id
    WHERE l.tenant_id=? AND i.voided_at IS NULL AND i.created_at BETWEEN ? AND ? GROUP BY l.description ORDER BY revenue DESC LIMIT 30`,
    )
    .all(t, from, to);
  const technicians = await db
    .prepare(
      `SELECT u.name,COUNT(DISTINCT a.work_order_id) orders,COALESCE(SUM(te.duration_minutes),0) minutes
    FROM work_assignments a JOIN users u ON u.id=a.technician_user_id LEFT JOIN time_entries te ON te.assignment_id=a.id AND te.tenant_id=a.tenant_id
    WHERE a.tenant_id=? AND a.created_at BETWEEN ? AND ? GROUP BY u.id,u.name ORDER BY orders DESC`,
    )
    .all(t, from, to);
  const stock = await db
    .prepare(
      'SELECT i.name,b.name branch,i.quantity,i.minimum_stock FROM inventory_items i JOIN branches b ON b.id=i.branch_id WHERE i.tenant_id=? AND i.active=1 AND i.quantity<=i.minimum_stock ORDER BY i.quantity LIMIT 100',
    )
    .all(t);
  const metrics = finance
    ? [
        {
          label: 'Ventas netas facturadas',
          value: money(summary.revenue),
          note: `${summary.invoices} comprobante(s), sin impuestos`,
        },
        { label: 'Impuestos facturados', value: money(summary.tax), note: 'No son utilidad' },
        {
          label: 'Cobros del período',
          value: money(cash.income),
          note: 'Flujo de caja; no equivale a ventas',
        },
      ]
    : [];
  if (costAccess)
    metrics.push(
      {
        label: 'Costos de ventas',
        value: money(costs),
        note: 'Repuestos y mano de obra de esas facturas',
      },
      {
        label: 'Margen bruto',
        value: money(summary.revenue - costs),
        note: 'Ventas netas menos costos directos',
      },
      {
        label: 'Resultado operativo estimado',
        value: money(summary.revenue - costs - cash.expenses),
        note: `Descontando ${money(cash.expenses)} de gastos registrados. No es contabilidad fiscal.`,
      },
    );
  const serviceColumns = [
    { label: 'Servicio', key: 'description' },
    { label: 'Veces', key: 'uses' },
  ];
  if (finance) serviceColumns.push({ label: 'Venta neta', render: (r) => money(r.revenue) });
  if (costAccess)
    serviceColumns.push(
      { label: 'Costo', render: (r) => money(r.cost) },
      { label: 'Margen', render: (r) => money(r.revenue - r.cost) },
    );
  return (
    pageHead(
      'DECISIONES',
      'Reportes',
      'Resultados del período, separados de los cobros y del inventario.',
    ) +
    `<form class="report-filters" method="get">${field('from', 'Desde', 'date', start)}${field('to', 'Hasta', 'date', end)}<button class="button">Aplicar</button>${can(req.context, 'reports.export') ? `<a class="button button-outline" href="/workshop/reports/export?from=${start}&to=${end}">Exportar CSV</a>` : ''}<button type="button" class="button button-outline" data-print>Imprimir / PDF</button></form>` +
    (metrics.length ? metricGrid(metrics) : '') +
    card('Servicios facturados', dataTable(serviceColumns, services)) +
    card(
      'Carga técnica',
      dataTable(
        [
          { label: 'Técnico', key: 'name' },
          { label: 'Órdenes', key: 'orders' },
          { label: 'Tiempo registrado', render: (r) => `${r.minutes} min` },
        ],
        technicians,
      ),
    ) +
    (can(req.context, 'inventory.view')
      ? card(
          'Stock crítico actual',
          dataTable(
            [
              { label: 'Producto', key: 'name' },
              { label: 'Sucursal', key: 'branch' },
              { label: 'Existencia', key: 'quantity' },
              { label: 'Mínimo', key: 'minimum_stock' },
            ],
            stock,
          ),
        )
      : '')
  );
}
