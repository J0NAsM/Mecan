import { id, now, json } from '../utils.js';
import { AppError } from '../errors.js';
import { optional, oneOf, integer, positive } from '../validation.js';
import { audit } from '../domain.js';
import {
  withTenantWrite,
  assertPermission,
  assertTenantWritable,
  can,
  TENANT_WRITABLE_STATUSES,
} from '../tenancy.js';
import { moneyAmount, tenantCurrency } from '../money.js';
import { ORDER_LABELS, assertOrderState } from '../workflow.js';
import { tenantDateTime } from '../time.js';
import {
  completeInspection,
  completeDiagnosis,
  insertEstimateItem,
} from './workshop-operations.js';
import {
  BODY_TYPES,
  BODY_TYPE_CODES,
  VEHICLE_PARTS,
  VEHICLE_PART_CODES,
  DAMAGE_SEVERITIES,
  SEVERITY_CODES,
  partsForBody,
  partLabel,
  severityLabel,
  bodyTypeLabel,
} from '../vehicle-diagnosis.js';

// The damage map is part of the diagnosis: it can change until the estimate leaves the workshop.
export const DIAGNOSIS_EDITABLE_STATES = ['RECEIVED', 'INSPECTION', 'DIAGNOSIS', 'ESTIMATE'];
const FINISHABLE_STATES = ['RECEIVED', 'INSPECTION', 'DIAGNOSIS'];
const MAX_STAMPS_PER_PART = 6000;
const severityRank = (code) => DAMAGE_SEVERITIES.find((s) => s.code === code)?.rank || 0;

function actorMeta(context, meta = {}) {
  return {
    tenantId: context.tenant.id,
    actorUserId: context.user.user_id,
    impersonatorUserId: context.isImpersonating ? context.user.user_id : null,
    branchId: context.membership?.branch_id || meta.branchId || null,
    ip: meta.ip,
    requestId: meta.requestId,
  };
}
async function orderRow(db, tenantId, orderId) {
  const order = await db
    .prepare('SELECT * FROM work_orders WHERE id=? AND tenant_id=?')
    .get(orderId, tenantId);
  if (!order) throw new AppError('Orden no encontrada.', { status: 404, code: 'NOT_FOUND' });
  return order;
}

// Brush stamps: [x, y, z] normalised to the part's own box (-0.5…0.5, tolerance ±1),
// radius in centimetres (6–60) and severity rank (0 erases). Replaying them rebuilds the map
// on any body type, independent of the scene kept in the browser.
export function normalizeStrokes(value, label) {
  if (value == null || value === '') return [];
  if (!Array.isArray(value) || value.length > MAX_STAMPS_PER_PART)
    throw new AppError(`El mapa de daños de ${label} no es válido o es demasiado extenso.`, {
      status: 422,
    });
  const round = (number) => Math.round(number * 1000) / 1000;
  return value.map((stamp) => {
    const numbers = Array.isArray(stamp) ? stamp.map(Number) : [];
    const [x, y, z, radius, severity] = numbers;
    if (
      numbers.length !== 5 ||
      ![x, y, z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1) ||
      !Number.isInteger(radius) ||
      radius < 6 ||
      radius > 60 ||
      !Number.isInteger(severity) ||
      severity < 0 ||
      severity > 4
    )
      throw new AppError(`El mapa de daños de ${label} contiene trazos no válidos.`, {
        status: 422,
      });
    return [round(x), round(y), round(z), radius, severity];
  });
}

function hasData(part) {
  return (
    part.severity !== 'NONE' ||
    part.pressure > 0 ||
    part.repairCost > 0 ||
    part.laborCost > 0 ||
    part.strokes !== '[]' ||
    Boolean(part.affectedZone || part.description || part.notes || part.materials)
  );
}
function serializePart(row, imported = []) {
  return {
    id: row?.id || null,
    severity: row?.severity || 'NONE',
    pressure: Number(row?.pressure || 0),
    affectedZone: row?.affected_zone || '',
    description: row?.description || '',
    notes: row?.notes || '',
    materials: row?.materials || '',
    repairCost: Number(row?.repair_cost || 0),
    laborCost: Number(row?.labor_cost || 0),
    strokes: json(row?.paint_strokes, []),
    diagnosedBy: row?.diagnosed_by_name || null,
    diagnosedAt: row?.diagnosed_at || null,
    imported: imported
      .filter((item) => row?.id && item.damage_part_id === row.id)
      .map((item) => ({
        type: item.item_type,
        estimate: `#${item.number} v${item.version}`,
        status: item.status,
      })),
  };
}

// Read model shared by the 3D studio, the order card, the vehicle history and the documents.
export async function damageReport(db, tenantId, orderId) {
  const assessment = await db
    .prepare(
      `SELECT a.*,u.name updated_by_name,c.name created_by_name FROM damage_assessments a
      LEFT JOIN users u ON u.id=a.updated_by LEFT JOIN users c ON c.id=a.created_by
      WHERE a.tenant_id=? AND a.work_order_id=?`,
    )
    .get(tenantId, orderId);
  if (!assessment) return null;
  const rows = await db
    .prepare(
      'SELECT p.*,u.name diagnosed_by_name FROM damage_assessment_parts p LEFT JOIN users u ON u.id=p.diagnosed_by WHERE p.tenant_id=? AND p.assessment_id=?',
    )
    .all(tenantId, assessment.id);
  const imported = await db
    .prepare(
      `SELECT ei.damage_part_id,ei.item_type,e.number,e.version,e.status FROM estimate_items ei
      JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id
      WHERE ei.tenant_id=? AND e.work_order_id=? AND ei.damage_part_id IS NOT NULL ORDER BY e.version`,
    )
    .all(tenantId, orderId);
  const parts = Object.fromEntries(
    VEHICLE_PART_CODES.map((code) => [
      code,
      serializePart(
        rows.find((row) => row.part_code === code),
        imported,
      ),
    ]),
  );
  const damaged = partsForBody(assessment.body_type)
    .map((part) => ({ ...part, ...parts[part.code] }))
    .filter((part) => part.severity !== 'NONE');
  return {
    assessment,
    parts,
    damaged,
    totals: {
      damagedParts: damaged.length,
      repair: damaged.reduce((sum, part) => sum + part.repairCost, 0),
      labor: damaged.reduce((sum, part) => sum + part.laborCost, 0),
      worst: damaged.reduce(
        (worst, part) =>
          severityRank(part.severity) > severityRank(worst) ? part.severity : worst,
        'NONE',
      ),
    },
  };
}

export async function loadDamageAssessment(db, context, orderId) {
  assertPermission(context, 'orders.view');
  const tenantId = context.tenant.id;
  const order = await db
    .prepare(
      `SELECT o.id,o.number,o.status,o.vehicle_id,o.customer_id,o.complaint,o.promised_at,
      v.plate,v.make,v.model,v.year,v.color,v.body_type,v.model_3d_id,v.odometer,c.name customer
      FROM work_orders o JOIN vehicles v ON v.id=o.vehicle_id AND v.tenant_id=o.tenant_id
      JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id WHERE o.id=? AND o.tenant_id=?`,
    )
    .get(orderId, tenantId);
  if (!order) throw new AppError('Orden no encontrada.', { status: 404, code: 'NOT_FOUND' });
  const report = await damageReport(db, tenantId, order.id);
  const photos = can(context, 'documents.view')
    ? await db
        .prepare(
          `SELECT f.id,f.name,l.category FROM files f JOIN file_links l ON l.file_id=f.id AND l.tenant_id=f.tenant_id
          WHERE l.tenant_id=? AND l.entity_type='WORK_ORDER' AND l.entity_id=? AND l.category LIKE 'DAMAGE:%' ORDER BY f.created_at`,
        )
        .all(tenantId, order.id)
    : [];
  const history = (await vehicleDamageHistory(db, tenantId, order.vehicle_id)).filter(
    (entry) => entry.orderId !== order.id,
  );
  const writable = TENANT_WRITABLE_STATUSES.has(context.tenant.status);
  const canDiagnose = writable && can(context, 'orders.diagnose');
  return {
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      statusLabel: ORDER_LABELS[order.status] || order.status,
      complaint: order.complaint || '',
    },
    customer: { name: order.customer },
    vehicle: {
      id: order.vehicle_id,
      plate: order.plate,
      make: order.make || '',
      model: order.model || '',
      year: order.year || null,
      color: order.color || '',
      bodyType: order.body_type || null,
      model3dId: order.model_3d_id || null,
    },
    assessment: report
      ? {
          id: report.assessment.id,
          revision: Number(report.assessment.revision),
          bodyType: report.assessment.body_type,
          paintColor: report.assessment.paint_color,
          notes: report.assessment.notes || '',
          updatedAt: report.assessment.updated_at,
          updatedBy: report.assessment.updated_by_name,
        }
      : null,
    parts: report?.parts || Object.fromEntries(VEHICLE_PART_CODES.map((c) => [c, serializePart()])),
    totals: report?.totals || { damagedParts: 0, repair: 0, labor: 0, worst: 'NONE' },
    photos: photos.map((photo) => ({
      id: photo.id,
      name: photo.name,
      part: photo.category.slice('DAMAGE:'.length),
      url: `/api/files/${photo.id}`,
    })),
    history,
    currency: await tenantCurrency(db, tenantId),
    permissions: {
      edit: canDiagnose && DIAGNOSIS_EDITABLE_STATES.includes(order.status),
      finish:
        canDiagnose &&
        FINISHABLE_STATES.includes(order.status) &&
        (order.status === 'DIAGNOSIS' || can(context, 'orders.inspect')),
      importEstimate: writable && order.status === 'ESTIMATE' && can(context, 'orders.estimate'),
      upload: writable && can(context, 'documents.upload'),
      print: can(context, 'orders.print'),
    },
    vocabulary: { bodyTypes: BODY_TYPES, parts: VEHICLE_PARTS, severities: DAMAGE_SEVERITIES },
  };
}

export async function saveDamageAssessment(db, context, orderId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.diagnose');
    assertTenantWritable(context);
    const tenantId = context.tenant.id;
    const order = await orderRow(db, tenantId, orderId);
    assertOrderState(order, DIAGNOSIS_EDITABLE_STATES, 'modificar el diagnóstico visual');
    const bodyType = oneOf(input.bodyType, BODY_TYPE_CODES, 'El tipo de carrocería');
    const paintColor = String(input.paintColor || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(paintColor))
      throw new AppError('El color de pintura no es válido.', { status: 422 });
    const notes = optional(input.notes, { max: 5000 });
    const currency = await tenantCurrency(db, tenantId);
    const incoming = input.parts && typeof input.parts === 'object' ? input.parts : {};
    const unknown = Object.keys(incoming).find((code) => !VEHICLE_PART_CODES.includes(code));
    if (unknown)
      throw new AppError('La pieza indicada no existe en el diagnóstico.', { status: 422 });
    const available = new Set(partsForBody(bodyType).map((part) => part.code));
    const parts = VEHICLE_PART_CODES.map((code) => {
      const raw = incoming[code] || {},
        label = partLabel(code);
      const part = {
        code,
        severity: oneOf(raw.severity || 'NONE', SEVERITY_CODES, `La gravedad de ${label}`),
        pressure: integer(raw.pressure ?? 0, `La presión de ${label}`, { min: 0, max: 100 }),
        affectedZone: optional(raw.affectedZone, { max: 500 }),
        description: optional(raw.description, { max: 3000 }),
        notes: optional(raw.notes, { max: 3000 }),
        materials: optional(raw.materials, { max: 2000 }),
        repairCost: moneyAmount(
          raw.repairCost || 0,
          currency,
          `El costo de reparación de ${label}`,
          {
            allowZero: true,
          },
        ),
        laborCost: moneyAmount(raw.laborCost || 0, currency, `La mano de obra de ${label}`, {
          allowZero: true,
        }),
        strokes: JSON.stringify(normalizeStrokes(raw.strokes, label)),
      };
      if (!available.has(code) && hasData(part))
        throw new AppError(
          `La carrocería ${bodyTypeLabel(bodyType)} no tiene ${label.toLowerCase()}. Quita ese registro o elige una carrocería de cuatro puertas.`,
          { status: 422 },
        );
      return part;
    });
    const at = now(),
      actor = context.user.user_id;
    let assessment = await db
      .prepare('SELECT * FROM damage_assessments WHERE tenant_id=? AND work_order_id=?')
      .get(tenantId, order.id);
    const expectedRevision = Number.isInteger(Number(input.revision)) ? Number(input.revision) : -1;
    if (assessment) {
      const updated = await db
        .prepare(
          'UPDATE damage_assessments SET body_type=?,paint_color=?,notes=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND revision=?',
        )
        .run(bodyType, paintColor, notes, actor, at, assessment.id, tenantId, expectedRevision);
      if (!updated.changes)
        throw new AppError(
          'Otra persona guardó este diagnóstico mientras lo editabas. Recarga para ver la versión vigente; tus cambios no se aplicaron.',
          { status: 409, code: 'STALE_REVISION' },
        );
    } else {
      assessment = { id: id(), revision: 0 };
      await db
        .prepare(
          `INSERT INTO damage_assessments (id,tenant_id,work_order_id,vehicle_id,body_type,paint_color,notes,revision,created_by,created_at,updated_by,updated_at)
          VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,
        )
        .run(
          assessment.id,
          tenantId,
          order.id,
          order.vehicle_id,
          bodyType,
          paintColor,
          notes,
          actor,
          at,
          actor,
          at,
        );
    }
    const existing = await db
      .prepare('SELECT * FROM damage_assessment_parts WHERE tenant_id=? AND assessment_id=?')
      .all(tenantId, assessment.id);
    let changed = 0;
    for (const part of parts) {
      const row = existing.find((entry) => entry.part_code === part.code);
      const values = [
        part.severity,
        part.pressure,
        part.affectedZone,
        part.description,
        part.notes,
        part.materials,
        part.repairCost,
        part.laborCost,
        part.strokes,
      ];
      if (row) {
        const previous = [
          row.severity,
          Number(row.pressure),
          row.affected_zone,
          row.description,
          row.notes,
          row.materials,
          Number(row.repair_cost),
          Number(row.labor_cost),
          row.paint_strokes,
        ];
        if (JSON.stringify(previous) === JSON.stringify(values)) continue;
        await db
          .prepare(
            'UPDATE damage_assessment_parts SET severity=?,pressure=?,affected_zone=?,description=?,notes=?,materials=?,repair_cost=?,labor_cost=?,paint_strokes=?,diagnosed_by=?,diagnosed_at=? WHERE id=? AND tenant_id=?',
          )
          .run(...values, actor, at, row.id, tenantId);
        changed++;
      } else if (hasData(part)) {
        await db
          .prepare(
            `INSERT INTO damage_assessment_parts (id,tenant_id,assessment_id,part_code,severity,pressure,affected_zone,description,notes,materials,repair_cost,labor_cost,paint_strokes,diagnosed_by,diagnosed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(id(), tenantId, assessment.id, part.code, ...values, actor, at);
        changed++;
      }
    }
    // The first diagnosis records which body the vehicle has; later changes stay in the vehicle form.
    await db
      .prepare('UPDATE vehicles SET body_type=? WHERE id=? AND tenant_id=? AND body_type IS NULL')
      .run(bodyType, order.vehicle_id, tenantId);
    const revision = Number(assessment.revision) + 1;
    await audit(db, {
      ...actorMeta(context, meta),
      branchId: order.branch_id,
      action: 'DAMAGE_ASSESSMENT_SAVED',
      entityType: 'damage_assessment',
      entityId: assessment.id,
      after: {
        orderId: order.id,
        revision,
        bodyType,
        changedParts: changed,
        damagedParts: parts.filter((part) => part.severity !== 'NONE').length,
      },
    });
    return { assessmentId: assessment.id, revision, savedAt: at, changedParts: changed };
  });
}

// Converts diagnosed damage into estimate concepts. Each part feeds the estimate once per
// concept type; the estimate keeps its own amounts, calculated by the existing estimate logic.
// Returns how many concepts were added; it never fails for "nothing pending", so a caller inside
// a larger transaction (finishing the diagnosis) is not rolled back by an empty import.
async function insertDamageConcepts(db, context, order, report, meta) {
  const linked = await db
    .prepare(
      `SELECT ei.damage_part_id,ei.item_type FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id
      WHERE ei.tenant_id=? AND e.work_order_id=? AND e.status='DRAFT' AND ei.damage_part_id IS NOT NULL`,
    )
    .all(context.tenant.id, order.id);
  const already = (partId, type) =>
    linked.some((item) => item.damage_part_id === partId && item.item_type === type);
  let created = 0;
  for (const part of report.damaged) {
    const zone = part.affectedZone ? ` · ${part.affectedZone}` : '';
    if (part.repairCost > 0 && !already(part.id, 'SERVICE')) {
      await insertEstimateItem(
        db,
        context,
        order,
        {
          itemType: 'SERVICE',
          description: `Reparación ${part.label} · daño ${severityLabel(part.severity).toLowerCase()}${zone}`,
          quantity: 1,
          unitPrice: part.repairCost,
          vehiclePart: part.code,
          damagePartId: part.id,
        },
        meta,
      );
      created++;
    }
    if (part.laborCost > 0 && !already(part.id, 'LABOR')) {
      await insertEstimateItem(
        db,
        context,
        order,
        {
          itemType: 'LABOR',
          description: `Mano de obra · ${part.label}`,
          quantity: 1,
          unitPrice: part.laborCost,
          vehiclePart: part.code,
          damagePartId: part.id,
        },
        meta,
      );
      created++;
    }
  }
  if (created)
    await audit(db, {
      ...actorMeta(context, meta),
      branchId: order.branch_id,
      action: 'DAMAGE_IMPORTED_TO_ESTIMATE',
      entityType: 'damage_assessment',
      entityId: report.assessment.id,
      after: { orderId: order.id, concepts: created },
    });
  return created;
}

export async function importDamageToEstimate(db, context, orderId, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.estimate');
    assertTenantWritable(context);
    const tenantId = context.tenant.id;
    const order = await orderRow(db, tenantId, orderId);
    assertOrderState(order, ['ESTIMATE'], 'preparar el presupuesto');
    const report = await damageReport(db, tenantId, order.id);
    if (!report)
      throw new AppError('Guarda primero el diagnóstico visual de la orden.', { status: 409 });
    const created = await insertDamageConcepts(db, context, order, report, meta);
    if (!created)
      throw new AppError(
        'No hay daños con costo pendientes de pasar al presupuesto. Asigna costos en el diagnóstico visual o revisa los conceptos ya agregados.',
        { status: 409, code: 'NOTHING_TO_IMPORT' },
      );
    return { created };
  });
}

export function damageSummaryText(report, currency = 'PYG') {
  if (!report?.damaged.length) return 'Diagnóstico visual 3D: sin daños de carrocería registrados.';
  const format = new Intl.NumberFormat('es-PY', { style: 'currency', currency });
  const lines = report.damaged.map(
    (part) =>
      `${part.label}: ${severityLabel(part.severity)}${part.affectedZone ? ` (${part.affectedZone})` : ''}${part.description ? ` — ${part.description}` : ''}`,
  );
  const total = report.totals.repair + report.totals.labor;
  return `Diagnóstico visual 3D (${report.damaged.length} pieza/s con daño):\n${lines.join('\n')}${total ? `\nEstimación: ${format.format(total)}` : ''}`;
}

// Completes the existing inspection/diagnosis steps with the damage map as their content.
export async function finishDamageDiagnosis(db, context, orderId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.diagnose');
    assertTenantWritable(context);
    const tenantId = context.tenant.id;
    const order = await orderRow(db, tenantId, orderId);
    assertOrderState(order, FINISHABLE_STATES, 'finalizar el diagnóstico');
    const report = await damageReport(db, tenantId, order.id);
    if (!report)
      throw new AppError('Guarda el diagnóstico visual antes de finalizarlo.', { status: 409 });
    const summary = damageSummaryText(report, await tenantCurrency(db, tenantId));
    if (order.status !== 'DIAGNOSIS')
      await completeInspection(
        db,
        context,
        order.id,
        { checklist: 'Inspección de carrocería 3D', findings: summary.slice(0, 4000) },
        meta,
      );
    const extra = optional(input.summary, { max: 1500 });
    await completeDiagnosis(
      db,
      context,
      order.id,
      {
        summary: `${summary}${extra ? `\n${extra}` : ''}`.slice(0, 5000),
        recommendations: optional(input.recommendations, { max: 5000 }),
      },
      meta,
    );
    let imported = 0;
    if (input.importEstimate && can(context, 'orders.estimate')) {
      const current = await orderRow(db, tenantId, order.id);
      assertOrderState(current, ['ESTIMATE'], 'preparar el presupuesto');
      imported = await insertDamageConcepts(db, context, current, report, meta);
    }
    return { imported };
  });
}

// Terms of the formal service estimate («Presupuesto del servicio»): payment and working time.
export async function updateEstimateTerms(db, context, orderId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.estimate');
    assertTenantWritable(context);
    const tenantId = context.tenant.id;
    const order = await orderRow(db, tenantId, orderId);
    assertOrderState(order, ['ESTIMATE'], 'editar las condiciones del presupuesto');
    const estimate = await db
      .prepare(
        "SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='DRAFT' ORDER BY version DESC LIMIT 1",
      )
      .get(tenantId, order.id);
    if (!estimate)
      throw new AppError('Agrega un concepto para crear el borrador del presupuesto.', {
        status: 409,
      });
    const hasTime = input.workTimeValue !== undefined && String(input.workTimeValue).trim() !== '';
    const workTime = hasTime
      ? positive(input.workTimeValue, 'El tiempo estimado', { max: 10000 })
      : null;
    const unit = hasTime
      ? oneOf(input.workTimeUnit, ['HOURS', 'DAYS'], 'La unidad de tiempo')
      : null;
    const paymentTerms = optional(input.paymentTerms, { max: 200 });
    await db
      .prepare(
        'UPDATE estimates SET payment_terms=?,work_time_value=?,work_time_unit=?,updated_at=? WHERE id=? AND tenant_id=?',
      )
      .run(paymentTerms, workTime, unit, now(), estimate.id, tenantId);
    if (input.promisedAt)
      await db
        .prepare('UPDATE work_orders SET promised_at=? WHERE id=? AND tenant_id=?')
        .run(await tenantDateTime(db, tenantId, input.promisedAt), order.id, tenantId);
    await audit(db, {
      ...actorMeta(context, meta),
      branchId: order.branch_id,
      action: 'ESTIMATE_TERMS_UPDATED',
      entityType: 'estimate',
      entityId: estimate.id,
      before: {
        paymentTerms: estimate.payment_terms,
        workTime: estimate.work_time_value,
        unit: estimate.work_time_unit,
      },
      after: { paymentTerms, workTime, unit, promisedAt: input.promisedAt || null },
    });
    return estimate.id;
  });
}

export async function vehicleDamageHistory(db, tenantId, vehicleId) {
  const rows = await db
    .prepare(
      `SELECT a.id,a.work_order_id,a.body_type,a.updated_at,o.number,o.status,
      COUNT(p.id) FILTER (WHERE p.severity<>'NONE') damaged,
      COALESCE(SUM(p.repair_cost+p.labor_cost) FILTER (WHERE p.severity<>'NONE'),0) total,
      string_agg(p.part_code||':'||p.severity, ',') FILTER (WHERE p.severity<>'NONE') parts
      FROM damage_assessments a JOIN work_orders o ON o.id=a.work_order_id AND o.tenant_id=a.tenant_id
      LEFT JOIN damage_assessment_parts p ON p.assessment_id=a.id AND p.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.vehicle_id=? GROUP BY a.id,o.number,o.status ORDER BY a.updated_at DESC`,
    )
    .all(tenantId, vehicleId);
  return rows.map((row) => ({
    assessmentId: row.id,
    orderId: row.work_order_id,
    orderNumber: row.number,
    orderStatus: ORDER_LABELS[row.status] || row.status,
    bodyType: row.body_type,
    updatedAt: row.updated_at,
    damagedParts: Number(row.damaged || 0),
    total: Number(row.total || 0),
    parts: String(row.parts || '')
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [code, severity] = entry.split(':');
        return { code, label: partLabel(code), severity, severityLabel: severityLabel(severity) };
      }),
  }));
}
