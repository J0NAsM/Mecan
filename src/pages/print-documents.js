import { assertPermission } from '../tenancy.js';
import { AppError } from '../errors.js';
import { pageHead, esc, shortDate, money, dataTable } from '../ui.js';
import { oneOf } from '../validation.js';
import { audit } from '../domain.js';

export async function printableOrder(db, req, orderId, type) {
  oneOf(type, ['estimate', 'invoice', 'delivery'], 'El documento');
  assertPermission(req.context, type === 'invoice' ? 'billing.print' : 'orders.print');
  const t = req.context.tenant,
    order = await db
      .prepare(
        'SELECT o.*,c.name customer,c.document,c.address customer_address,v.plate,v.make,v.model FROM work_orders o JOIN customers c ON c.id=o.customer_id JOIN vehicles v ON v.id=o.vehicle_id WHERE o.id=? AND o.tenant_id=?',
      )
      .get(orderId, t.id);
  if (!order) throw new AppError('Orden no encontrada.', { status: 404 });
  const settings = await db.prepare('SELECT * FROM tenant_settings WHERE tenant_id=?').get(t.id);
  const document =
    type === 'estimate'
      ? await db
          .prepare(
            'SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? ORDER BY version DESC LIMIT 1',
          )
          .get(t.id, orderId)
      : type === 'invoice'
        ? await db
            .prepare(
              'SELECT * FROM workshop_invoices WHERE tenant_id=? AND work_order_id=? AND voided_at IS NULL',
            )
            .get(t.id, orderId)
        : await db
            .prepare('SELECT * FROM deliveries WHERE tenant_id=? AND work_order_id=?')
            .get(t.id, orderId);
  if (!document) throw new AppError('Este documento todavía no existe.', { status: 404 });
  const title =
    type === 'estimate'
      ? `Presupuesto #${document.number} · versión ${document.version}`
      : type === 'invoice'
        ? `Comprobante interno #${document.number}`
        : `Constancia de entrega · orden #${order.number}`;
  const items =
    type === 'estimate'
      ? await db
          .prepare(
            'SELECT description,quantity,unit_price,total FROM estimate_items WHERE tenant_id=? AND estimate_id=?',
          )
          .all(t.id, document.id)
      : type === 'invoice'
        ? await db
            .prepare(
              'SELECT description,quantity,unit_price,total FROM workshop_invoice_items WHERE tenant_id=? AND invoice_id=?',
            )
            .all(t.id, document.id)
        : [];
  await audit(db, {
    tenantId: t.id,
    branchId: order.branch_id,
    actorUserId: req.session.user_id,
    action: 'DOCUMENT_PRINTED',
    entityType: type,
    entityId: document.id,
  });
  const total = type === 'estimate' ? document.total : type === 'invoice' ? document.amount : 0;
  const warranty =
    type === 'delivery'
      ? await db
          .prepare(
            'SELECT * FROM warranties WHERE tenant_id=? AND work_order_id=? ORDER BY created_at DESC LIMIT 1',
          )
          .get(t.id, orderId)
      : null;
  return (
    pageHead(
      'DOCUMENTO',
      title,
      'Versión para entregar al cliente, sin costos internos.',
      `<a class="button button-outline" href="/workshop/orders/${order.id}">Volver</a><button class="button" type="button" data-print>Imprimir / guardar PDF</button>`,
    ) +
    `<article class="print-document"><header>${t.logo_url && /^https:\/\//.test(t.logo_url) ? `<img class="document-logo" src="${esc(t.logo_url)}" alt="Logo del taller" referrerpolicy="no-referrer">` : ''}<h2>${esc(t.legal_name || t.name)}</h2><p>${esc([t.tax_id, t.address, t.phone, t.email].filter(Boolean).join(' · '))}</p><p class="preserve-lines">${esc(settings.document_header || '')}</p></header><h2>${esc(title)}</h2><p>Fecha: ${shortDate(document.created_at || document.delivered_at)} · Orden #${order.number}</p><p>Cliente: <b>${esc(order.customer)}</b> · Documento: ${esc(order.document || '—')}</p><p>Vehículo: <b>${esc(order.plate)}</b> · ${esc([order.make, order.model].filter(Boolean).join(' '))}</p>${
      items.length
        ? dataTable(
            [
              { label: 'Concepto', key: 'description' },
              { label: 'Cantidad', key: 'quantity' },
              { label: 'Precio unitario', render: (r) => money(r.unit_price) },
              { label: 'Total', render: (r) => money(r.total) },
            ],
            items,
          ) +
          `<p class="document-total">Subtotal: ${money(type === 'estimate' ? document.subtotal : order.subtotal)} · Impuestos: ${money(type === 'estimate' ? document.tax : order.tax)} · Total: <b>${money(total)}</b></p>`
        : ''
    }
    ${type === 'invoice' ? `${Number(document.amount) === 0 ? '<p><b>Trabajo sin cargo autorizado.</b> No se registró un cobro al cliente.</p>' : `<p>Pagado: ${money(document.paid_amount)} · Saldo: ${money(document.balance)}</p>`}<p>Comprobante de gestión interna. No sustituye una factura fiscal autorizada.</p>` : ''}
    ${type === 'estimate' ? `<p>Válido hasta: ${shortDate(document.valid_until)}</p><p>${document.approved_at ? 'Autorizado por ' + esc(document.approved_by_name) + ' el ' + shortDate(document.approved_at) : 'Autorización del cliente: ____________________'}</p>` : ''}
    ${type === 'delivery' ? `<p>Recibido por: <b>${esc(document.received_by_name)}</b> · Kilometraje: ${document.odometer ?? '—'}</p><p>${esc(document.notes || '')}</p>${warranty ? `<h3>Garantía hasta ${shortDate(warranty.ends_at)}</h3><p>${esc(warranty.terms)}</p>` : ''}<p>Firma de conformidad: ____________________</p>` : ''}
    <footer class="preserve-lines">${esc(settings.document_footer || '')}</footer></article>`
  );
}
