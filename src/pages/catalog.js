import { catalogs, catalogRecord } from '../services/catalog.js';
import {
  pageHead,
  card,
  formCard,
  field,
  textarea,
  select,
  dataTable,
  esc,
  badge,
  csrfInput,
  money,
  shortDate,
} from '../ui.js';
import { can } from '../tenancy.js';
import { id } from '../utils.js';

export async function catalogEditPage(db, req, kind, recordId) {
  const definition = catalogs[kind],
    row = await catalogRecord(db, req.context, kind, recordId);
  const fields = (
    await Promise.all(
      definition.fields
        .filter(
          ([name]) => kind !== 'inventory' || name !== 'cost' || can(req.context, 'inventory.cost'),
        )
        .map(async ([name, label, type = 'text', required = false]) => {
          if (type === 'customers') {
            const options = (
              await db
                .prepare(
                  'SELECT id,name FROM customers WHERE tenant_id=? AND active=1 ORDER BY name',
                )
                .all(req.context.tenant.id)
            ).map((c) => [c.id, c.name]);
            return select(name, label, options, row[name], { required });
          }
          return type === 'textarea'
            ? textarea(name, label, row[name] || '')
            : field(name, label, type, row[name] ?? '', {
                required,
                min: type === 'number' ? 0 : undefined,
                step: type === 'number' ? 'any' : undefined,
              });
        }),
    )
  ).join('');
  return (
    pageHead(
      definition.title,
      'Editar ' + (row.name || row.plate || 'registro'),
      'Los cambios quedan registrados en la auditoría.',
      `<a class="button button-outline" href="/workshop/${kind === 'suppliers' ? 'inventory' : kind}">Volver</a>`,
    ) +
    formCard(
      'Datos del registro',
      `/workshop/${kind}/${row.id}/edit`,
      req.session.csrf_token,
      fields,
      'Guardar cambios',
    ) +
    (row.active && (kind !== 'customers' || can(req.context, 'customers.delete'))
      ? card(
          'Archivar',
          `<p>El registro deja de estar disponible para nuevas operaciones y conserva su historial.</p><form method="post" action="/workshop/${kind}/${row.id}/archive" data-confirm="¿Archivar este registro conservando su historial?">${csrfInput(req.session.csrf_token)}<button class="button button-outline">Archivar registro</button></form>`,
        )
      : row.active
        ? ''
        : card(
            'Reactivar',
            `<p>El registro volverá a estar disponible para nuevas operaciones.</p><form method="post" action="/workshop/${kind}/${row.id}/restore">${csrfInput(req.session.csrf_token)}<button class="button">Reactivar registro</button></form>`,
          ))
  );
}

export function catalogActions(kind, req, row) {
  const definition = catalogs[kind];
  return can(req.context, definition.permission)
    ? `<a href="/workshop/${kind}/${row.id}/edit">Editar</a>`
    : '—';
}
export async function stockPage(db, req, itemId) {
  const t = req.context.tenant.id,
    item = await catalogRecord(db, req.context, 'inventory', itemId),
    csrf = req.session.csrf_token;
  const moves = await db
    .prepare(
      'SELECT m.*,u.name actor FROM inventory_movements m JOIN users u ON u.id=m.actor_user_id WHERE m.tenant_id=? AND m.inventory_item_id=? ORDER BY m.created_at DESC LIMIT 200',
    )
    .all(t, item.id);
  const destinations = await db
    .prepare(
      'SELECT i.id,i.name,b.name branch FROM inventory_items i JOIN branches b ON b.id=i.branch_id AND b.tenant_id=i.tenant_id WHERE i.tenant_id=? AND i.branch_id<>? AND i.active=1 AND b.active=1 ORDER BY b.name,i.name',
    )
    .all(t, item.branch_id);
  const reservations = await db
    .prepare(
      "SELECT r.*,o.number FROM stock_reservations r JOIN work_orders o ON o.id=r.work_order_id AND o.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.inventory_item_id=? AND r.status='ACTIVE'",
    )
    .all(t, item.id);
  const token = () => `<input type="hidden" name="idempotencyKey" value="${id()}">`;
  return (
    pageHead(
      'INVENTARIO',
      item.name,
      `Existencia: ${item.quantity} · Reservado: ${reservations.reduce((total, r) => total + Number(r.quantity), 0)}`,
      `<a class="button button-outline" href="/workshop/inventory">Volver</a>`,
    ) +
    (can(req.context, 'inventory.adjust')
      ? `<div class="dashboard-grid">${formCard('Ajuste por conteo', `/workshop/inventory/${item.id}/adjust`, csrf, field('quantity', 'Existencia real contada', 'number', item.quantity, { required: true, min: 0, step: 'any' }) + textarea('reason', 'Motivo del ajuste', '', { required: true }) + token(), 'Registrar ajuste')}${
          destinations.length
            ? formCard(
                'Transferir a otra sucursal',
                `/workshop/inventory/${item.id}/transfer`,
                csrf,
                select(
                  'destinationItemId',
                  'Artículo equivalente en destino',
                  destinations.map((r) => [r.id, r.branch + ' · ' + r.name]),
                ) +
                  field('quantity', 'Cantidad', 'number', 1, {
                    required: true,
                    min: 0.001,
                    step: 'any',
                  }) +
                  textarea('reason', 'Motivo', '', { required: true }) +
                  token(),
                'Transferir',
              )
            : '<p>Crea el artículo equivalente en otra sucursal para transferir existencias.</p>'
        }</div>`
      : '') +
    card(
      'Reservas activas',
      dataTable(
        [
          {
            label: 'Orden',
            render: (r) => `<a href="/workshop/orders/${r.work_order_id}">#${r.number}</a>`,
          },
          { label: 'Cantidad', key: 'quantity' },
          {
            label: 'Acción',
            render: (r) =>
              can(req.context, 'inventory.consume')
                ? `<form method="post" action="/workshop/reservations/${r.id}/release">${csrfInput(csrf)}<button class="link-button">Liberar reserva</button></form>`
                : '—',
          },
        ],
        reservations,
      ),
    ) +
    card(
      'Movimientos',
      dataTable(
        [
          { label: 'Fecha', render: (r) => shortDate(r.created_at) },
          { label: 'Tipo', render: (r) => badge(r.movement_type) },
          { label: 'Cantidad', key: 'quantity' },
          { label: 'Antes', key: 'previous_quantity' },
          { label: 'Después', key: 'resulting_quantity' },
          { label: 'Motivo', key: 'reason' },
          { label: 'Responsable', key: 'actor' },
        ],
        moves,
      ),
    )
  );
}
