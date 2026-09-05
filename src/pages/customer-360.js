import {
  esc,
  money,
  shortDate,
  badge,
  field,
  textarea,
  select,
  csrfInput,
  pageHead,
  card,
  dataTable,
  metricGrid,
  empty,
} from '../ui.js';
import { AppError } from '../errors.js';
import { ORDER_LABELS } from '../workflow.js';
import { can } from '../tenancy.js';

export async function customerDetailPage(db, req, customerId) {
  const t = req.context.tenant.id;
  const visibleCard = (permission, ...args) => (can(req.context, permission) ? card(...args) : '');
  const customer = await db
    .prepare('SELECT * FROM customers WHERE id=? AND tenant_id=?')
    .get(customerId, t);
  if (!customer) throw new AppError('Cliente no encontrado.', { status: 404 });
  const vehicles = can(req.context, 'vehicles.view')
    ? await db
        .prepare(
          'SELECT * FROM vehicles WHERE tenant_id=? AND customer_id=? ORDER BY created_at DESC',
        )
        .all(t, customer.id)
    : [];
  const orders = can(req.context, 'orders.view')
    ? await db
        .prepare(
          `SELECT o.*,v.plate,v.make,v.model FROM work_orders o JOIN vehicles v ON v.id=o.vehicle_id WHERE o.tenant_id=? AND o.customer_id=? ORDER BY o.created_at DESC`,
        )
        .all(t, customer.id)
    : [];
  const invoices = can(req.context, 'billing.view')
    ? await db
        .prepare(
          'SELECT * FROM workshop_invoices WHERE tenant_id=? AND customer_id=? AND voided_at IS NULL ORDER BY created_at DESC',
        )
        .all(t, customer.id)
    : [];
  const payments = can(req.context, 'billing.view')
    ? await db
        .prepare(
          `SELECT p.*,i.number invoice_number FROM effective_workshop_payments p JOIN workshop_invoices i ON i.id=p.invoice_id WHERE p.tenant_id=? AND i.customer_id=? ORDER BY p.paid_at DESC`,
        )
        .all(t, customer.id)
    : [];
  const warranties = can(req.context, 'orders.view')
    ? await db
        .prepare(
          `SELECT w.*,o.number order_number,v.plate FROM warranties w JOIN work_orders o ON o.id=w.work_order_id JOIN vehicles v ON v.id=o.vehicle_id WHERE w.tenant_id=? AND o.customer_id=? ORDER BY w.created_at DESC`,
        )
        .all(t, customer.id)
    : [];
  const communications = await db
    .prepare(
      'SELECT cc.*,u.name author FROM customer_communications cc JOIN users u ON u.id=cc.created_by WHERE cc.tenant_id=? AND cc.customer_id=? ORDER BY cc.created_at DESC',
    )
    .all(t, customer.id);
  const totalBilled = invoices.reduce((sum, row) => sum + Number(row.amount), 0),
    debt = invoices.reduce((sum, row) => sum + Number(row.balance), 0);
  const communicationForm = can(req.context, 'customers.update')
    ? card(
        'Registrar comunicación',
        `<form class="form-grid" method="post" action="/workshop/customers/${customer.id}/communications">${csrfInput(req.session.csrf_token)}${select(
          'channel',
          'Canal',
          [
            ['PHONE', 'Teléfono'],
            ['WHATSAPP', 'WhatsApp'],
            ['EMAIL', 'Email'],
            ['SMS', 'SMS'],
            ['IN_PERSON', 'En persona'],
            ['OTHER', 'Otro'],
          ],
        )}${select('direction', 'Dirección', [
          ['OUTBOUND', 'Saliente'],
          ['INBOUND', 'Entrante'],
        ])}${field('subject', 'Asunto')}${textarea('body', 'Detalle', '', { required: true })}<div class="form-actions"><button class="button">Registrar</button></div></form>`,
      )
    : '';
  return (
    pageHead(
      'CLIENTE 360°',
      customer.name,
      [customer.document, customer.phone, customer.email].filter(Boolean).join(' · '),
      '<a class="button button-outline" href="/workshop/customers">Volver</a>',
    ) +
    metricGrid([
      ...(can(req.context, 'vehicles.view')
        ? [{ label: 'Vehículos', value: vehicles.length, note: 'Registrados' }]
        : []),
      ...(can(req.context, 'orders.view')
        ? [
            {
              label: 'Órdenes',
              value: orders.length,
              note: `${orders.filter((x) => !['DELIVERED', 'CLOSED', 'CANCELED'].includes(x.status)).length} abiertas`,
            },
          ]
        : []),
      ...(can(req.context, 'billing.view')
        ? [
            { label: 'Facturado', value: money(totalBilled), note: `${payments.length} cobro(s)` },
            {
              label: 'Deuda',
              value: money(debt),
              note: debt ? 'Requiere seguimiento' : 'Sin saldo pendiente',
            },
          ]
        : []),
    ]) +
    `<div class="dashboard-grid"><div>${visibleCard(
      'vehicles.view',
      'Vehículos',
      dataTable(
        [
          {
            label: 'Patente',
            render: (r) => `<a href="/workshop/vehicles/${r.id}">${esc(r.plate)}</a>`,
          },
          { label: 'Vehículo', render: (r) => `${esc(r.make || '')} ${esc(r.model || '')}` },
          { label: 'Año', key: 'year' },
          {
            label: 'Kilometraje',
            render: (r) => `${Number(r.odometer || 0).toLocaleString('es-PY')} km`,
          },
        ],
        vehicles,
      ),
    )}${visibleCard(
      'orders.view',
      'Órdenes e historial',
      dataTable(
        [
          { label: 'Orden', render: (r) => `<a href="/workshop/orders/${r.id}">#${r.number}</a>` },
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          { label: 'Vehículo', render: (r) => `${esc(r.plate)} · ${esc(r.make || '')}` },
          {
            label: 'Estado',
            render: (r) => `<span class="badge">${esc(ORDER_LABELS[r.status] || r.status)}</span>`,
          },
          ...(can(req.context, 'billing.view')
            ? [{ label: 'Total', render: (r) => money(r.total) }]
            : []),
        ],
        orders,
      ),
    )}${
      can(req.context, 'billing.view')
        ? card(
            'Facturas y pagos',
            dataTable(
              [
                { label: 'Factura', render: (r) => `#${r.number}` },
                { label: 'Fecha', render: (r) => shortDate(r.created_at) },
                { label: 'Total', render: (r) => money(r.amount) },
                { label: 'Cobrado', render: (r) => money(r.paid_amount) },
                { label: 'Saldo', render: (r) => money(r.balance) },
                { label: 'Estado', render: (r) => badge(r.status) },
              ],
              invoices,
            ),
          )
        : ''
    }</div><aside>${card('Datos', `<div class="stat-list"><div><span>Documento</span><b>${esc(customer.document || '—')}</b></div><div><span>Teléfono</span><b>${esc(customer.phone || '—')}</b></div><div><span>Email</span><b>${esc(customer.email || '—')}</b></div><div><span>Dirección</span><b>${esc(customer.address || '—')}</b></div><div><span>Notas</span><b>${esc(customer.notes || '—')}</b></div></div>`)}${communicationForm}${card('Comunicaciones', communications.length ? `<ul class="timeline">${communications.map((x) => `<li><b>${esc(x.channel)} · ${esc(x.subject || 'Sin asunto')}</b><small>${shortDate(x.created_at)} · ${esc(x.author)}</small><p>${esc(x.body)}</p></li>`).join('')}</ul>` : empty('Sin comunicaciones', 'Las llamadas y mensajes registrados aparecerán aquí.'))}${
      warranties.length
        ? card(
            'Garantías',
            dataTable(
              [
                {
                  label: 'Orden',
                  render: (r) =>
                    `<a href="/workshop/orders/${r.work_order_id}">#${r.order_number}</a>`,
                },
                { label: 'Vehículo', key: 'plate' },
                { label: 'Hasta', render: (r) => shortDate(r.ends_at) },
                { label: 'Estado', render: (r) => badge(r.status) },
              ],
              warranties,
            ),
          )
        : ''
    }</aside></div>`
  );
}

export async function vehicleDetailPage(db, req, vehicleId) {
  const t = req.context.tenant.id;
  const vehicle = await db
    .prepare(
      `SELECT v.*,c.name customer,c.id customer_id,c.phone customer_phone FROM vehicles v JOIN customers c ON c.id=v.customer_id WHERE v.id=? AND v.tenant_id=?`,
    )
    .get(vehicleId, t);
  if (!vehicle) throw new AppError('Vehículo no encontrado.', { status: 404 });
  const orders = can(req.context, 'orders.view')
    ? await db
        .prepare(
          'SELECT * FROM work_orders WHERE tenant_id=? AND vehicle_id=? ORDER BY created_at DESC',
        )
        .all(t, vehicle.id)
    : [];
  const diagnoses = can(req.context, 'orders.view')
    ? await db
        .prepare(
          `SELECT d.summary,d.recommendations,d.completed_at,o.number order_number,o.id order_id,u.name technician FROM diagnoses d JOIN work_orders o ON o.id=d.work_order_id LEFT JOIN users u ON u.id=d.technician_user_id WHERE d.tenant_id=? AND o.vehicle_id=?`,
        )
        .all(t, vehicle.id)
    : [];
  const parts = can(req.context, 'orders.view')
    ? await db
        .prepare(
          `SELECT p.*,i.name,o.number order_number,o.id order_id FROM active_work_order_parts p JOIN work_orders o ON o.id=p.work_order_id JOIN inventory_items i ON i.id=p.inventory_item_id WHERE p.tenant_id=? AND o.vehicle_id=?`,
        )
        .all(t, vehicle.id)
    : [];
  const warranties = can(req.context, 'orders.view')
    ? await db
        .prepare(
          `SELECT w.*,o.number order_number,o.id order_id FROM warranties w JOIN work_orders o ON o.id=w.work_order_id WHERE w.tenant_id=? AND o.vehicle_id=?`,
        )
        .all(t, vehicle.id)
    : [];
  const files = can(req.context, 'documents.view')
    ? await db
        .prepare(
          `SELECT f.*,l.category FROM files f JOIN file_links l ON l.file_id=f.id WHERE l.tenant_id=? AND ((l.entity_type='VEHICLE' AND l.entity_id=?) OR (l.entity_type='WORK_ORDER' AND l.entity_id IN (SELECT id FROM work_orders WHERE tenant_id=? AND vehicle_id=?))) ORDER BY f.created_at DESC`,
        )
        .all(t, vehicle.id, t, vehicle.id)
    : [];
  const timeline = [
    ...orders.map((x) => ({
      date: x.created_at,
      title: `Orden #${x.number}`,
      text: `${ORDER_LABELS[x.status] || x.status} · ${x.complaint || ''}`,
      href: `/workshop/orders/${x.id}`,
    })),
    ...diagnoses.map((x) => ({
      date: x.completed_at,
      title: `Diagnóstico · orden #${x.order_number}`,
      text: x.summary,
      href: `/workshop/orders/${x.order_id}`,
    })),
    ...parts.map((x) => ({
      date: x.consumed_at,
      title: `Repuesto · ${x.name}`,
      text: `${x.quantity} unidad(es) · orden #${x.order_number}`,
      href: `/workshop/orders/${x.order_id}`,
    })),
    ...warranties.map((x) => ({
      date: x.starts_at,
      title: `Garantía · orden #${x.order_number}`,
      text: `Vigente hasta ${shortDate(x.ends_at)}`,
      href: `/workshop/orders/${x.order_id}`,
    })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return (
    pageHead(
      'VEHÍCULO 360°',
      vehicle.plate,
      `${vehicle.make || ''} ${vehicle.model || ''} ${vehicle.year || ''}`,
      can(req.context, 'customers.view')
        ? `<a class="button button-outline" href="/workshop/customers/${vehicle.customer_id}">Ver cliente</a>`
        : '<a class="button button-outline" href="/workshop/vehicles">Volver</a>',
    ) +
    metricGrid([
      {
        label: 'Kilometraje',
        value: `${Number(vehicle.odometer || 0).toLocaleString('es-PY')} km`,
        note: 'Último registro',
      },
      ...(can(req.context, 'orders.view')
        ? [
            { label: 'Órdenes', value: orders.length, note: 'Historial completo' },
            {
              label: 'Repuestos',
              value: parts.reduce((s, x) => s + Number(x.quantity), 0),
              note: 'Unidades utilizadas',
            },
            {
              label: 'Garantías',
              value: warranties.filter((x) => x.status === 'ACTIVE').length,
              note: 'Activas',
            },
          ]
        : []),
    ]) +
    `<div class="dashboard-grid">${can(req.context, 'orders.view') ? card('Historial del vehículo', timeline.length ? `<ul class="timeline">${timeline.map((x) => `<li><a href="${x.href}"><b>${esc(x.title)}</b></a><small>${shortDate(x.date)}</small><p>${esc(x.text)}</p></li>`).join('')}</ul>` : empty('Sin historial', 'Las recepciones, diagnósticos y reparaciones aparecerán aquí.')) : ''}<aside>${card('Identificación', `<div class="stat-list">${can(req.context, 'customers.view') ? `<div><span>Propietario</span><a href="/workshop/customers/${vehicle.customer_id}"><b>${esc(vehicle.customer)}</b></a></div>` : ''}<div><span>VIN / Chasis</span><b>${esc(vehicle.vin || '—')}</b></div><div><span>Color</span><b>${esc(vehicle.color || '—')}</b></div><div><span>Año</span><b>${esc(vehicle.year || '—')}</b></div></div>`)}${
      files.length && can(req.context, 'documents.view')
        ? card(
            'Fotos y documentos',
            dataTable(
              [
                {
                  label: 'Archivo',
                  render: (r) =>
                    `<a href="/api/files/${r.id}" target="_blank" rel="noopener">${esc(r.name)}</a>`,
                },
                { label: 'Categoría', key: 'category' },
                { label: 'Fecha', render: (r) => shortDate(r.created_at) },
              ],
              files,
            ),
          )
        : ''
    }</aside></div>`
  );
}
