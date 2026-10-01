// Documentos operativos del taller generados desde la orden (una sola fuente de datos):
// control de materiales e insumos, presupuesto con diagnóstico visual y presupuesto del servicio.
import { assertPermission } from '../tenancy.js';
import { AppError } from '../errors.js';
import { pageHead, esc, money, shortDate } from '../ui.js';
import { audit } from '../domain.js';
import { damageReport } from '../services/damage-assessments.js';
import { partLabel, severityLabel } from '../vehicle-diagnosis.js';
import {
  documentHeader,
  placeDate,
  docMeta,
  sectionTitle,
  totals,
  signatures,
  simpleTable,
  damageMapSvg,
} from './document-parts.js';

export const WORKSHOP_DOCUMENTS = {
  materials: 'Control de materiales e insumos',
  damage: 'Presupuesto y diagnóstico visual',
  service: 'Presupuesto del servicio',
};
const quantity = (value) => Number(value).toLocaleString('es-PY', { maximumFractionDigits: 3 });

export async function printWorkshopDocument(db, req, orderId, type) {
  if (!WORKSHOP_DOCUMENTS[type]) throw new AppError('El documento no es válido.', { status: 422 });
  assertPermission(req.context, 'orders.print');
  const tenant = req.context.tenant;
  const order = await db
    .prepare(
      `SELECT o.*,c.name customer,c.document,c.tax_id customer_tax_id,c.phone,c.email,c.address customer_address,
      v.plate,v.make,v.model,v.year,v.color,v.body_type,r.received_at,d.delivered_at
      FROM work_orders o JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id
      JOIN vehicles v ON v.id=o.vehicle_id AND v.tenant_id=o.tenant_id
      LEFT JOIN receptions r ON r.work_order_id=o.id AND r.tenant_id=o.tenant_id
      LEFT JOIN deliveries d ON d.work_order_id=o.id AND d.tenant_id=o.tenant_id
      WHERE o.id=? AND o.tenant_id=?`,
    )
    .get(orderId, tenant.id);
  if (!order) throw new AppError('Orden no encontrada.', { status: 404 });
  const settings = await db
    .prepare('SELECT * FROM tenant_settings WHERE tenant_id=?')
    .get(tenant.id);
  const estimate = await db
    .prepare(
      'SELECT e.*,u.name responsible FROM estimates e LEFT JOIN users u ON u.id=e.created_by WHERE e.tenant_id=? AND e.work_order_id=? ORDER BY e.version DESC LIMIT 1',
    )
    .get(tenant.id, order.id);
  const items = estimate
    ? await db
        .prepare(
          `SELECT ei.*,i.name inventory_name,u.name responsible FROM estimate_items ei
          LEFT JOIN inventory_items i ON i.id=ei.inventory_item_id AND i.tenant_id=ei.tenant_id
          LEFT JOIN users u ON u.id=ei.responsible_user_id WHERE ei.tenant_id=? AND ei.estimate_id=?
          ORDER BY ei.vehicle_part NULLS LAST,CASE ei.item_type WHEN 'SERVICE' THEN 0 WHEN 'LABOR' THEN 1 WHEN 'OTHER' THEN 2 ELSE 3 END,ei.description`,
        )
        .all(tenant.id, estimate.id)
    : [];
  const used = await db
    .prepare(
      `SELECT p.inventory_item_id,i.name,SUM(p.quantity) quantity,SUM(p.total) total FROM active_work_order_parts p
      JOIN inventory_items i ON i.id=p.inventory_item_id AND i.tenant_id=p.tenant_id
      WHERE p.tenant_id=? AND p.work_order_id=? GROUP BY p.inventory_item_id,i.name ORDER BY i.name`,
    )
    .all(tenant.id, order.id);
  const timezone = settings?.timezone || 'America/Asuncion';
  const vehicleName = [order.make, order.model].filter(Boolean).join(' ') || '—';
  let title, body;

  if (type === 'materials') {
    // Materiales (insumos) y mano de obra se controlan por separado.
    const budgetedParts = items.filter((item) => item.item_type === 'PART');
    const materialRows = used.length
      ? used.map((row, index) => [
          index + 1,
          esc(row.name),
          quantity(row.quantity),
          money(Number(row.total) / Number(row.quantity)),
          money(row.total),
        ])
      : budgetedParts.map((row, index) => [
          index + 1,
          esc(row.inventory_name || row.description),
          quantity(row.quantity),
          money(row.unit_price),
          money(row.total),
        ]);
    const materialsTotal = (used.length ? used : budgetedParts).reduce(
      (sum, row) => sum + Number(row.total),
      0,
    );
    const labor = await db
      .prepare(
        'SELECT l.description,l.total,u.name technician FROM work_order_labor l LEFT JOIN users u ON u.id=l.technician_user_id WHERE l.tenant_id=? AND l.work_order_id=? ORDER BY l.created_at',
      )
      .all(tenant.id, order.id);
    const laborRows = labor.length
      ? labor
      : items
          .filter((item) => item.item_type !== 'PART')
          .map((item) => ({
            description: item.description,
            total: item.total,
            technician: item.responsible,
          }));
    const laborTotal = laborRows.reduce((sum, row) => sum + Number(row.total), 0);
    title = 'CONTROL DE MATERIALES E INSUMOS';
    body =
      sectionTitle('Datos del vehículo') +
      docMeta([
        ['Marca', order.make],
        ['Modelo', order.model],
        ['Color', order.color],
        ['Año', order.year],
        ['Chapa', order.plate],
        ['Orden', `#${order.number}`],
      ]) +
      sectionTitle('Datos del cliente') +
      docMeta([
        ['Nombre', order.customer],
        ['Teléfono', order.phone],
        ['C.I.', order.document],
      ]) +
      sectionTitle(
        used.length ? 'Materiales utilizados' : 'Materiales presupuestados (todavía sin utilizar)',
      ) +
      simpleTable(['Nº', 'Producto', 'Cantidad', 'Precio', 'Monto'], materialRows, 3) +
      sectionTitle('Mano de obra') +
      simpleTable(
        ['Nº', 'Trabajo', 'Responsable', 'Monto'],
        laborRows.map((row, index) => [
          index + 1,
          esc(row.description),
          esc(row.technician || '—'),
          money(row.total),
        ]),
        2,
      ) +
      sectionTitle('Observaciones') +
      `<div class="doc-notes preserve-lines">${esc(order.notes || '')}</div>` +
      totals([
        ['Materiales', materialsTotal],
        ['Mano de obra', laborTotal],
        ['MONTO TOTAL', materialsTotal + laborTotal, true],
      ]) +
      signatures([
        { title: 'Verificado por', lines: ['Nombre y firma'] },
        { title: 'Firma y sello', lines: [tenant.legal_name || tenant.name] },
      ]);
  }

  if (type === 'damage') {
    const report = await damageReport(db, tenant.id, order.id);
    const diagnosis = await db
      .prepare(
        'SELECT summary,recommendations FROM diagnoses WHERE tenant_id=? AND work_order_id=? ORDER BY created_at DESC LIMIT 1',
      )
      .get(tenant.id, order.id);
    const damaged = report?.damaged || [];
    const total = (report?.totals.repair || 0) + (report?.totals.labor || 0);
    title = 'PRESUPUESTO';
    body =
      placeDate(tenant, report?.assessment.updated_at || order.created_at, timezone) +
      `<p><b>Diagnóstico visual del automóvil</b> · Orden #${order.number}</p>` +
      sectionTitle('Datos del cliente') +
      docMeta([
        ['Interesado', order.customer],
        ['Dirección', order.customer_address],
        ['Nº C.I.', order.document],
        ['Teléfono/s / Email', [order.phone, order.email].filter(Boolean).join(' · ')],
      ]) +
      sectionTitle('Datos del vehículo') +
      docMeta([
        ['Vehículo', vehicleName],
        ['Matrícula', order.plate],
        ['Color', order.color],
        ['Año', order.year],
      ]) +
      sectionTitle('Mapeo de daños') +
      (report
        ? damageMapSvg(report, report.assessment.body_type) +
          simpleTable(
            ['Pieza', 'Gravedad', 'Zona', 'Descripción', 'Reparación', 'Mano de obra'],
            damaged.map((part) => [
              esc(part.label),
              `<span class="damage-chip sev-${esc(part.severity.toLowerCase())}">${esc(severityLabel(part.severity))}</span>`,
              esc(part.affectedZone || '—'),
              esc(part.description || '—'),
              money(part.repairCost),
              money(part.laborCost),
            ]),
          )
        : '<p>Esta orden todavía no tiene un diagnóstico visual guardado.</p>' +
          damageMapSvg(null, order.body_type)) +
      sectionTitle('Detalles') +
      `<div class="doc-notes preserve-lines">${esc(
        [report?.assessment.notes, diagnosis?.summary, diagnosis?.recommendations]
          .filter(Boolean)
          .join('\n\n'),
      )}</div>` +
      // Con presupuesto, el monto total es el del presupuesto (el mismo que imprime «Presupuesto
      // del servicio»); sin él, la suma del mapeo se rotula como estimación sin IVA.
      totals(
        estimate
          ? [
              ['Suma del mapeo de daños', total],
              ['Subtotal del presupuesto', estimate.subtotal],
              [`IVA (${quantity(estimate.tax_rate ?? settings?.tax_rate ?? 0)}%)`, estimate.tax],
              ['Monto total', estimate.total, true],
            ]
          : [['Monto total estimado (sin IVA)', total, true]],
      ) +
      signatures([
        { title: 'Firma del cliente', lines: ['Aclaración', 'Nº de C.I.', 'Firma'] },
        { title: 'Firma del encargado', lines: ['Aclaración', 'Nº de C.I.', 'Firma'] },
      ]);
  }

  if (type === 'service') {
    if (!estimate)
      throw new AppError('Esta orden todavía no tiene un presupuesto.', { status: 404 });
    const work = items.filter((item) => item.item_type !== 'PART');
    const parts = items.filter((item) => item.item_type === 'PART');
    const consumed = new Map(used.map((row) => [row.inventory_item_id, Number(row.quantity)]));
    const workTime = estimate.work_time_value
      ? `${quantity(estimate.work_time_value)} ${estimate.work_time_unit === 'DAYS' ? 'día(s)' : 'hora(s)'}`
      : 'A confirmar';
    title = 'PRESUPUESTO DEL SERVICIO';
    body =
      docMeta([
        ['Fecha', shortDate(estimate.created_at)],
        ['Número de folio', `${estimate.number}-${estimate.version}`],
        ['Responsable', estimate.responsible],
        [
          'Estado',
          estimate.status === 'APPROVED'
            ? 'Autorizado'
            : estimate.status === 'SENT'
              ? 'Enviado'
              : 'En preparación',
        ],
      ]) +
      sectionTitle('Datos del cliente') +
      docMeta([
        ['Nombre', order.customer],
        ['C.I.', order.document],
        ['RUC', order.customer_tax_id],
        ['Teléfono', order.phone],
        ['Email', order.email],
        ['Forma de pago', estimate.payment_terms],
      ]) +
      sectionTitle('Datos del vehículo') +
      docMeta([
        ['Marca', order.make],
        ['Modelo', order.model],
        ['Chapa', order.plate],
        ['Color', order.color],
        ['Entrada', shortDate(order.received_at || order.created_at)],
        [
          'Salida',
          order.delivered_at
            ? shortDate(order.delivered_at)
            : `Estimada: ${shortDate(order.promised_at)}`,
        ],
      ]) +
      sectionTitle('Detalle del servicio') +
      simpleTable(
        ['Nº', 'Pieza', 'Trabajo', 'Responsable', 'Importe'],
        work.map((item, index) => [
          index + 1,
          esc(item.vehicle_part ? partLabel(item.vehicle_part) : '—'),
          esc(item.description),
          esc(item.responsible || '—'),
          money(item.total),
        ]),
        2,
      ) +
      sectionTitle('Tiempo estimado de trabajo') +
      `<p>${esc(workTime)} · Entrega estimada: ${esc(shortDate(order.promised_at))}</p>` +
      sectionTitle('Lista de materiales') +
      simpleTable(
        ['Nº', 'Detalle', 'Cantidad', 'Recibido', 'Precio'],
        parts.map((item, index) => {
          const received = Math.min(
            consumed.get(item.inventory_item_id) || 0,
            Number(item.quantity),
          );
          return [
            index + 1,
            esc(item.inventory_name || item.description),
            quantity(item.quantity),
            received >= Number(item.quantity)
              ? '✓ Completo'
              : received
                ? `${quantity(received)} de ${quantity(item.quantity)}`
                : 'Pendiente',
            money(item.total),
          ];
        }),
        3,
      ) +
      totals([
        ['Subtotal', estimate.subtotal],
        [`IVA (${quantity(estimate.tax_rate ?? settings?.tax_rate ?? 0)}%)`, estimate.tax],
        ['TOTAL', estimate.total, true],
      ]) +
      `<p>Válido hasta: ${shortDate(estimate.valid_until)} · ${estimate.approved_at ? `Autorizado por ${esc(estimate.approved_by_name)} el ${shortDate(estimate.approved_at)}` : 'Autorización del cliente: ____________________'}</p>` +
      signatures([
        { title: 'Firma del cliente', lines: ['Aclaración', 'Nº de C.I.'] },
        { title: 'Firma del responsable', lines: [estimate.responsible || 'Aclaración'] },
      ]);
  }

  await audit(db, {
    tenantId: tenant.id,
    branchId: order.branch_id,
    actorUserId: req.session.user_id,
    action: 'DOCUMENT_PRINTED',
    entityType: type === 'service' ? 'estimate' : 'work_order',
    entityId: type === 'service' ? estimate.id : order.id,
    metadata: { document: type },
  });
  return (
    pageHead(
      'DOCUMENTO',
      WORKSHOP_DOCUMENTS[type],
      `Orden #${order.number} · ${order.plate} · ${vehicleName}`,
      `<a class="button button-outline" href="/workshop/orders/${order.id}">Volver</a><button class="button" type="button" data-print>Imprimir / guardar PDF</button>`,
    ) +
    `<article class="print-document">${documentHeader(tenant, settings)}<h2>${esc(title)}</h2>${body}<footer class="preserve-lines">${esc(settings?.document_footer || '')}</footer></article>`
  );
}
