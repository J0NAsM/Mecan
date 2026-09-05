import { id, now, addDays } from '../utils.js';
import { AppError } from '../errors.js';
import { required, optional, positive, integer, oneOf, isoDate } from '../validation.js';
import { audit } from '../domain.js';
import {
  withTenantWrite,
  assertPermission,
  assertEntitlement,
  assertTenantWritable,
  can,
} from '../tenancy.js';
import { ORDER_STATUS, assertTransition, assertOrderState } from '../workflow.js';
import { queueNotification } from '../notifications.js';
import { roundMoney, moneyAmount, tenantCurrency } from '../money.js';
import { reservedStock } from './inventory.js';
import { tenantDateTime, paymentTimestamp } from '../time.js';
import { allocateNumber } from './document-sequences.js';

async function transaction(db, operation) {
  try {
    return await db.transaction(async () => {
      const result = await operation();

      return result;
    }, {});
  } catch (error) {
    throw error;
  }
}
async function tenantRow(db, table, idValue, tenantId, label = 'Registro') {
  const allowed = new Set([
    'branches',
    'customers',
    'vehicles',
    'appointments',
    'work_orders',
    'inventory_items',
    'suppliers',
    'purchase_requests',
    'purchase_orders',
    'accounts_payable',
    'workshop_invoices',
    'work_assignments',
  ]);
  if (!allowed.has(table)) throw new Error('Repositorio no permitido');
  const row = await db
    .prepare(`SELECT * FROM ${table} WHERE id=? AND tenant_id=?`)
    .get(idValue, tenantId);
  if (!row) throw new AppError(`${label} no encontrado.`, { status: 404, code: 'NOT_FOUND' });
  return row;
}
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
async function transition(db, context, order, to, action, meta = {}, beforeExtra = {}) {
  if (order.status !== to) assertTransition(order.status, to, { action, total: order.total });
  await db
    .prepare('UPDATE work_orders SET status=? WHERE id=? AND tenant_id=?')
    .run(to, order.id, context.tenant.id);
  await audit(db, {
    ...actorMeta(context, meta),
    action,
    entityType: 'work_order',
    entityId: order.id,
    before: { status: order.status, ...beforeExtra },
    after: { status: to },
  });
  return { ...order, status: to };
}
export async function recalculateOrder(db, tenantId, orderId) {
  const labor = (
    await db
      .prepare(
        'SELECT COALESCE(SUM(total),0) total FROM work_order_labor WHERE tenant_id=? AND work_order_id=?',
      )
      .get(tenantId, orderId)
  ).total;
  const parts = (
    await db
      .prepare(
        'SELECT COALESCE(SUM(total),0) total FROM active_work_order_parts WHERE tenant_id=? AND work_order_id=?',
      )
      .get(tenantId, orderId)
  ).total;
  const currency = await tenantCurrency(db, tenantId);
  const subtotal = roundMoney(Number(labor) + Number(parts), currency);
  const approved = await db
    .prepare(
      "SELECT tax_rate FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='APPROVED' ORDER BY version DESC LIMIT 1",
    )
    .get(tenantId, orderId);
  const rate = Number(
    approved?.tax_rate ??
      (await db.prepare('SELECT tax_rate FROM tenant_settings WHERE tenant_id=?').get(tenantId))
        ?.tax_rate ??
      0,
  );
  const tax = roundMoney((subtotal * rate) / 100, currency);
  const total = roundMoney(subtotal + tax, currency);
  await db
    .prepare('UPDATE work_orders SET subtotal=?,tax=?,total=? WHERE id=? AND tenant_id=?')
    .run(subtotal, tax, total, orderId, tenantId);
  return { subtotal, tax, total, labor: Number(labor), parts: Number(parts) };
}

export async function receiveVehicle(db, context, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.create');
    assertTenantWritable(context);
    const tenantId = context.tenant.id;
    const customer = await tenantRow(db, 'customers', input.customerId, tenantId, 'Cliente');
    const vehicle = await tenantRow(db, 'vehicles', input.vehicleId, tenantId, 'Vehículo');
    const branch = await tenantRow(db, 'branches', input.branchId, tenantId, 'Sucursal');
    if (!branch.active || !customer.active || !vehicle.active)
      throw new AppError('Selecciona una sucursal, cliente y vehículo activos.', { status: 422 });
    if (vehicle.customer_id !== customer.id)
      throw new AppError('El vehículo no pertenece al cliente seleccionado.', { status: 422 });
    const monthly = (
      await db
        .prepare(
          'SELECT COUNT(*) total FROM work_orders WHERE tenant_id=? AND substr(created_at,1,7)=substr(?,1,7)',
        )
        .get(tenantId, now())
    ).total;
    await assertEntitlement(db, tenantId, 'orders_monthly', monthly);
    return await transaction(db, async () => {
      const orderId = id(),
        receptionId = id(),
        created = now(),
        number = await allocateNumber(db, tenantId, 'WORK_ORDER', 'work_orders');
      if (
        input.appointmentId &&
        !(await db
          .prepare(
            "SELECT 1 FROM appointments WHERE id=? AND tenant_id=? AND customer_id=? AND branch_id=? AND (vehicle_id IS NULL OR vehicle_id=?) AND status='SCHEDULED'",
          )
          .get(input.appointmentId, tenantId, customer.id, branch.id, vehicle.id))
      )
        throw new AppError(
          'El turno ya fue recibido, cancelado o no coincide con el cliente y vehículo.',
          { status: 409 },
        );
      await db
        .prepare(
          `INSERT INTO work_orders (id,tenant_id,branch_id,customer_id,vehicle_id,number,status,complaint,notes,subtotal,tax,total,promised_at,created_by,created_at)
      VALUES (?,?,?,?,?,?,'RECEIVED',?,?,0,0,0,?,?,?)`,
        )
        .run(
          orderId,
          tenantId,
          branch.id,
          customer.id,
          vehicle.id,
          number,
          required(input.complaint, 'El motivo de ingreso', { max: 2000 }),
          optional(input.notes, { max: 4000 }),
          input.promisedAt
            ? /Z$|[+-]\d{2}:\d{2}$/.test(input.promisedAt)
              ? isoDate(input.promisedAt, 'La fecha prometida')
              : await tenantDateTime(db, tenantId, input.promisedAt)
            : null,
          context.user.user_id,
          created,
        );
      await db
        .prepare(
          `INSERT INTO receptions (id,tenant_id,branch_id,work_order_id,received_by,fuel_level,odometer,accessories,visible_damage,customer_notes,received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          receptionId,
          tenantId,
          branch.id,
          orderId,
          context.user.user_id,
          input.fuelLevel === '' || input.fuelLevel == null
            ? null
            : integer(input.fuelLevel, 'El nivel de combustible', { min: 0, max: 100 }),
          integer(input.odometer || 0, 'El kilometraje'),
          JSON.stringify(
            String(input.accessories || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          ),
          optional(input.visibleDamage, { max: 3000 }),
          optional(input.customerNotes, { max: 3000 }),
          created,
        );
      if (input.appointmentId)
        await db
          .prepare(
            "UPDATE appointments SET status='CONVERTED' WHERE id=? AND tenant_id=? AND customer_id=?",
          )
          .run(input.appointmentId, tenantId, customer.id);
      await db
        .prepare('UPDATE vehicles SET odometer=GREATEST(odometer,?) WHERE id=? AND tenant_id=?')
        .run(integer(input.odometer || 0, 'El kilometraje'), vehicle.id, tenantId);
      await audit(db, {
        ...actorMeta(context, meta),
        branchId: branch.id,
        action: 'VEHICLE_RECEIVED',
        entityType: 'work_order',
        entityId: orderId,
        after: { status: 'RECEIVED', number, customerId: customer.id, vehicleId: vehicle.id },
      });
      return { orderId, number, receptionId };
    });
  });
}

export async function completeInspection(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.inspect');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['RECEIVED', 'INSPECTION'], 'completar la inspección');
    return await transaction(db, async () => {
      const inspectionId = id(),
        created = now();
      await db
        .prepare(
          `INSERT INTO inspections (id,tenant_id,work_order_id,inspector_user_id,checklist,findings,status,completed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'COMPLETED',?,?,?)`,
        )
        .run(
          inspectionId,
          context.tenant.id,
          order.id,
          context.user.user_id,
          JSON.stringify(
            String(input.checklist || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          ),
          required(input.findings, 'Los hallazgos', { max: 4000 }),
          created,
          created,
          created,
        );
      if (order.status === 'RECEIVED')
        await transition(db, context, order, 'INSPECTION', 'ORDER_INSPECTION_STARTED', meta);
      const fresh = { ...order, status: 'INSPECTION' };
      await transition(db, context, fresh, 'DIAGNOSIS', 'INSPECTION_COMPLETED', meta);
      return inspectionId;
    });
  });
}

export async function completeDiagnosis(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.diagnose');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['DIAGNOSIS'], 'registrar el diagnóstico');
    const technicianId = input.technicianId || context.user.user_id;
    if (
      !(await db
        .prepare("SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=? AND status='ACTIVE'")
        .get(context.tenant.id, technicianId))
    )
      throw new AppError('El técnico seleccionado no pertenece al taller o está inactivo.', {
        status: 422,
      });
    return await transaction(db, async () => {
      const diagnosisId = id(),
        created = now();
      await db
        .prepare(
          `INSERT INTO diagnoses (id,tenant_id,work_order_id,technician_user_id,summary,recommendations,status,completed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'COMPLETED',?,?,?)`,
        )
        .run(
          diagnosisId,
          context.tenant.id,
          order.id,
          technicianId,
          required(input.summary, 'El diagnóstico', { max: 5000 }),
          optional(input.recommendations, { max: 5000 }),
          created,
          created,
          created,
        );
      await db
        .prepare('UPDATE work_orders SET diagnosis=? WHERE id=? AND tenant_id=?')
        .run(input.summary, order.id, context.tenant.id);
      await transition(db, context, order, 'ESTIMATE', 'DIAGNOSIS_COMPLETED', meta);
      return diagnosisId;
    });
  });
}

export async function addEstimateItem(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.estimate');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['ESTIMATE'], 'preparar el presupuesto');
    return await transaction(db, async () => {
      let estimate = await db
        .prepare(
          "SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='DRAFT' ORDER BY version DESC LIMIT 1",
        )
        .get(context.tenant.id, order.id);
      if (!estimate) {
        const estimateId = id(),
          number = await allocateNumber(db, context.tenant.id, 'ESTIMATE');
        await db
          .prepare(
            `INSERT INTO estimates (id,tenant_id,work_order_id,number,version,status,valid_until,created_by,created_at,updated_at)
      VALUES (?,?,?,?,1,'DRAFT',?,?,?,?)`,
          )
          .run(
            estimateId,
            context.tenant.id,
            order.id,
            number,
            input.validUntil ? isoDate(input.validUntil) : addDays(now(), 7),
            context.user.user_id,
            now(),
            now(),
          );
        estimate = await db.prepare('SELECT * FROM estimates WHERE id=?').get(estimateId);
      }
      const type = oneOf(
        input.itemType,
        ['LABOR', 'PART', 'SERVICE', 'OTHER'],
        'El tipo de concepto',
      );
      const quantity = positive(input.quantity || 1, 'La cantidad');
      if (input.unitCost !== undefined) assertPermission(context, 'billing.cost');
      let unitCost = positive(input.unitCost || 0, 'El costo', { allowZero: true });
      const currency = await tenantCurrency(db, context.tenant.id);
      const unitPrice = moneyAmount(input.unitPrice, currency, 'El precio', { allowZero: true });
      let inventoryId = null;
      if (input.inventoryItemId) {
        const item = await tenantRow(
          db,
          'inventory_items',
          input.inventoryItemId,
          context.tenant.id,
          'Repuesto',
        );
        if (item.branch_id !== order.branch_id)
          throw new AppError('El repuesto pertenece a otra sucursal.', { status: 409 });
        inventoryId = item.id;
        if (type === 'PART') unitCost = Number(item.cost);
      }
      if (type === 'PART' && !inventoryId)
        throw new AppError(
          'Selecciona un artículo de inventario para cada repuesto presupuestado.',
          {
            status: 422,
          },
        );
      await db
        .prepare(
          `INSERT INTO estimate_items (id,tenant_id,estimate_id,item_type,description,inventory_item_id,quantity,unit_cost,unit_price,approved,total)
      VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
        )
        .run(
          id(),
          context.tenant.id,
          estimate.id,
          type,
          required(input.description, 'La descripción', { max: 1000 }),
          inventoryId,
          quantity,
          unitCost,
          unitPrice,
          roundMoney(quantity * unitPrice, currency),
        );
      const totals = await db
        .prepare(
          'SELECT COALESCE(SUM(total),0) subtotal FROM estimate_items WHERE tenant_id=? AND estimate_id=?',
        )
        .get(context.tenant.id, estimate.id);
      const rate = Number(
          (
            await db
              .prepare('SELECT tax_rate FROM tenant_settings WHERE tenant_id=?')
              .get(context.tenant.id)
          )?.tax_rate || 0,
        ),
        tax = roundMoney((Number(totals.subtotal) * rate) / 100, currency);
      await db
        .prepare(
          'UPDATE estimates SET subtotal=?,tax=?,total=?,updated_at=?,tax_rate=? WHERE id=? AND tenant_id=?',
        )
        .run(
          totals.subtotal,
          tax,
          roundMoney(Number(totals.subtotal) + tax, currency),
          now(),
          rate,
          estimate.id,
          context.tenant.id,
        );
      await audit(db, {
        ...actorMeta(context, meta),
        action: 'ESTIMATE_ITEM_ADDED',
        entityType: 'estimate',
        entityId: estimate.id,
        after: { type, quantity, unitPrice },
      });
      return estimate.id;
    });
  });
}

export async function sendEstimate(db, context, orderId, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.estimate');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['ESTIMATE'], 'enviar el presupuesto');
    return await transaction(db, async () => {
      const estimate = await db
        .prepare(
          "SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='DRAFT' ORDER BY version DESC LIMIT 1",
        )
        .get(context.tenant.id, order.id);
      if (
        !estimate ||
        !(await db
          .prepare('SELECT 1 FROM estimate_items WHERE tenant_id=? AND estimate_id=?')
          .get(context.tenant.id, estimate.id))
      )
        throw new AppError('Agrega al menos un concepto antes de enviar el presupuesto.', {
          status: 409,
        });
      await db
        .prepare(
          "UPDATE estimates SET status='SENT',sent_at=?,updated_at=? WHERE id=? AND tenant_id=?",
        )
        .run(now(), now(), estimate.id, context.tenant.id);
      await transition(db, context, order, 'AWAITING_APPROVAL', 'ESTIMATE_SENT', meta);
      await queueNotification(db, {
        tenantId: context.tenant.id,
        eventType: 'ESTIMATE_SENT',
        title: `Presupuesto #${estimate.number} enviado`,
        message: 'El presupuesto está esperando autorización del cliente.',
        payload: { orderId, estimateId: estimate.id },
        idempotencyKey: `estimate-sent:${estimate.id}`,
      });
      return estimate.id;
    });
  });
}

export async function approveEstimate(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.approve');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['AWAITING_APPROVAL'], 'autorizar el presupuesto');
    return await transaction(db, async () => {
      const estimate = await db
        .prepare(
          "SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='SENT' ORDER BY version DESC LIMIT 1",
        )
        .get(context.tenant.id, order.id);
      if (!estimate)
        throw new AppError('No existe un presupuesto enviado para autorizar.', { status: 409 });
      const noCharge = Number(estimate.total) === 0;
      const approvalNotes = noCharge
        ? required(input.notes, 'El motivo del trabajo sin cargo', { max: 2000 })
        : optional(input.notes, { max: 2000 });
      if (noCharge) assertPermission(context, 'orders.no_charge');
      await db
        .prepare(
          "UPDATE estimates SET status='APPROVED',approved_at=?,approved_by_name=?,approval_notes=?,updated_at=?,no_charge_approved_by=?,no_charge_reason=? WHERE id=? AND tenant_id=?",
        )
        .run(
          now(),
          required(input.approvedBy, 'La persona que autoriza', { max: 200 }),
          approvalNotes,
          now(),
          noCharge ? context.user.user_id : null,
          noCharge ? approvalNotes : null,
          estimate.id,
          context.tenant.id,
        );
      for (const item of await db
        .prepare(
          "SELECT * FROM estimate_items WHERE tenant_id=? AND estimate_id=? AND approved=1 AND item_type IN ('LABOR','SERVICE','OTHER')",
        )
        .all(context.tenant.id, estimate.id)) {
        await db
          .prepare(
            `INSERT INTO work_order_labor (id,tenant_id,work_order_id,description,hours,hourly_cost,hourly_price,total,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id(),
            context.tenant.id,
            order.id,
            item.description,
            item.quantity,
            item.unit_cost,
            item.unit_price,
            item.total,
            context.user.user_id,
            now(),
          );
      }
      await recalculateOrder(db, context.tenant.id, order.id);
      if (noCharge)
        await audit(db, {
          ...actorMeta(context, meta),
          action: 'NO_CHARGE_AUTHORIZED',
          entityType: 'estimate',
          entityId: estimate.id,
          after: { reason: approvalNotes, approvedBy: context.user.user_id },
        });
      await transition(db, context, order, 'AUTHORIZED', 'ESTIMATE_APPROVED', meta);
      await queueNotification(db, {
        tenantId: context.tenant.id,
        eventType: 'ESTIMATE_APPROVED',
        title: `Orden #${order.number} autorizada`,
        message: 'El cliente autorizó el presupuesto. Ya puede iniciar la reparación.',
        payload: { orderId },
        idempotencyKey: `estimate-approved:${estimate.id}`,
      });
      return estimate.id;
    });
  });
}

export async function assignTechnician(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.assign');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'], 'asignar trabajo');
    const member = await db
      .prepare(
        "SELECT m.*,u.name,r.permissions FROM memberships m JOIN users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='ACTIVE' AND u.active=1",
      )
      .get(context.tenant.id, input.technicianId);
    if (!member || !JSON.parse(member.permissions).some((p) => ['*', 'orders.execute'].includes(p)))
      throw new AppError('El técnico seleccionado no pertenece al taller o está inactivo.', {
        status: 422,
      });
    return await transaction(db, async () => {
      const assignmentId = id();
      await db
        .prepare(
          `INSERT INTO work_assignments (id,tenant_id,work_order_id,technician_user_id,description,priority,status,instructions,created_at)
    VALUES (?,?,?,?,?,?,'ASSIGNED',?,?)`,
        )
        .run(
          assignmentId,
          context.tenant.id,
          order.id,
          member.user_id,
          required(input.description, 'El trabajo', { max: 1000 }),
          oneOf(input.priority || 'NORMAL', ['LOW', 'NORMAL', 'HIGH', 'URGENT'], 'La prioridad'),
          optional(input.instructions, { max: 3000 }),
          now(),
        );
      await audit(db, {
        ...actorMeta(context, meta),
        action: 'TECHNICIAN_ASSIGNED',
        entityType: 'work_assignment',
        entityId: assignmentId,
        after: { orderId, technicianId: member.user_id },
      });
      await queueNotification(db, {
        tenantId: context.tenant.id,
        userId: member.user_id,
        eventType: 'WORK_ASSIGNED',
        title: `Nuevo trabajo en orden #${order.number}`,
        message: input.description,
        payload: { orderId, assignmentId },
        idempotencyKey: `assignment:${assignmentId}`,
      });
      return assignmentId;
    });
  });
}

export async function updateAssignment(db, context, assignmentId, action, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.execute');
    assertTenantWritable(context);
    const assignment = await tenantRow(
      db,
      'work_assignments',
      assignmentId,
      context.tenant.id,
      'Trabajo',
    );
    assertOrderState(
      await tenantRow(db, 'work_orders', assignment.work_order_id, context.tenant.id, 'Orden'),
      ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'],
      'registrar avances',
    );
    const manages = can(context, 'orders.assign');
    if (!manages && assignment.technician_user_id !== context.user.user_id)
      throw new AppError('Este trabajo está asignado a otro técnico.', { status: 403 });
    const map = {
      START: { from: ['ASSIGNED', 'PAUSED'], to: 'IN_PROGRESS' },
      PAUSE: { from: ['IN_PROGRESS'], to: 'PAUSED' },
      COMPLETE: { from: ['IN_PROGRESS'], to: 'COMPLETED' },
    };
    const rule = map[action];
    if (!rule || !rule.from.includes(assignment.status))
      throw new AppError('La acción no es válida para el estado actual del trabajo.', {
        status: 409,
      });
    return await transaction(db, async () => {
      const target = rule.to,
        timestamp = now();
      if (action === 'START') {
        await db
          .prepare(
            'UPDATE time_entries SET ended_at=?,duration_minutes=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (?::timestamptz-started_at::timestamptz))/60)::integer) WHERE assignment_id=? AND tenant_id=? AND ended_at IS NULL',
          )
          .run(timestamp, timestamp, assignment.id, context.tenant.id);
        await db
          .prepare(
            'INSERT INTO time_entries (id,tenant_id,assignment_id,technician_user_id,started_at,notes) VALUES (?,?,?,?,?,?)',
          )
          .run(
            id(),
            context.tenant.id,
            assignment.id,
            assignment.technician_user_id,
            timestamp,
            optional(input.notes),
          );
      } else {
        await db
          .prepare(
            'UPDATE time_entries SET ended_at=?,duration_minutes=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (?::timestamptz-started_at::timestamptz))/60)::integer),notes=COALESCE(?,notes) WHERE assignment_id=? AND tenant_id=? AND ended_at IS NULL',
          )
          .run(timestamp, timestamp, optional(input.notes), assignment.id, context.tenant.id);
      }
      await db
        .prepare(
          `UPDATE work_assignments SET status=?,started_at=COALESCE(started_at,?),paused_at=?,completed_at=? WHERE id=? AND tenant_id=?`,
        )
        .run(
          target,
          timestamp,
          action === 'PAUSE' ? timestamp : null,
          action === 'COMPLETE' ? timestamp : null,
          assignment.id,
          context.tenant.id,
        );
      const order = await tenantRow(
        db,
        'work_orders',
        assignment.work_order_id,
        context.tenant.id,
        'Orden',
      );
      if (action === 'START' && order.status === 'AUTHORIZED')
        await transition(db, context, order, 'IN_PROGRESS', 'REPAIR_STARTED', meta);
      await audit(db, {
        ...actorMeta(context, meta),
        action: `ASSIGNMENT_${action}`,
        entityType: 'work_assignment',
        entityId: assignment.id,
        before: { status: assignment.status },
        after: { status: target, notes: optional(input.notes) },
      });
      return target;
    });
  });
}

export async function consumePart(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.consume');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['AUTHORIZED', 'IN_PROGRESS'], 'utilizar repuestos');
    const quantity = positive(input.quantity, 'La cantidad');
    const key = required(input.idempotencyKey, 'La clave de operación', { max: 200 });
    return await transaction(db, async () => {
      const duplicate = await db
        .prepare('SELECT * FROM work_order_parts WHERE tenant_id=? AND idempotency_key=?')
        .get(context.tenant.id, key);
      if (duplicate) {
        if (
          duplicate.work_order_id !== order.id ||
          duplicate.inventory_item_id !== input.inventoryItemId ||
          Number(duplicate.quantity) !== quantity
        )
          throw new AppError('La referencia de consumo ya se utilizó con otros datos.', {
            status: 409,
          });
        return { partId: duplicate.id, duplicate: true };
      }
      const item = await tenantRow(
        db,
        'inventory_items',
        input.inventoryItemId,
        context.tenant.id,
        'Repuesto',
      );
      if (item.branch_id !== order.branch_id)
        throw new AppError('El repuesto pertenece a otra sucursal.', { status: 409 });
      const authorized = Number(
          (
            await db
              .prepare(
                "SELECT COALESCE(SUM(ei.quantity),0) total FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id WHERE ei.tenant_id=? AND e.work_order_id=? AND e.status='APPROVED' AND ei.approved=1 AND ei.item_type='PART' AND ei.inventory_item_id=?",
              )
              .get(context.tenant.id, order.id, item.id)
          ).total,
        ),
        already = Number(
          (
            await db
              .prepare(
                'SELECT COALESCE(SUM(quantity),0) total FROM active_work_order_parts WHERE tenant_id=? AND work_order_id=? AND inventory_item_id=?',
              )
              .get(context.tenant.id, order.id, item.id)
          ).total,
        );
      if (!authorized || already + quantity > authorized)
        throw new AppError(
          `La cantidad excede lo autorizado en el presupuesto (${authorized - already} disponible).`,
          { status: 409, code: 'PART_NOT_AUTHORIZED' },
        );
      if (
        Number(item.quantity) - (await reservedStock(db, context.tenant.id, item.id, order.id)) <
        quantity
      )
        throw new AppError(
          'Stock insuficiente: comprueba las existencias y las reservas de otras órdenes.',
          { status: 409 },
        );
      const updated = await db
        .prepare(
          'UPDATE inventory_items SET quantity=quantity-? WHERE id=? AND tenant_id=? AND quantity>=?',
        )
        .run(quantity, item.id, context.tenant.id, quantity);
      if (!updated.changes)
        throw new AppError(`Stock insuficiente. Disponible: ${item.quantity}.`, {
          status: 409,
          code: 'INSUFFICIENT_STOCK',
        });
      let remainingReservation = quantity;
      for (const reservation of await db
        .prepare(
          "SELECT * FROM stock_reservations WHERE tenant_id=? AND inventory_item_id=? AND work_order_id=? AND status='ACTIVE' ORDER BY created_at",
        )
        .all(context.tenant.id, item.id, order.id)) {
        if (remainingReservation <= 0) break;
        const used = Math.min(Number(reservation.quantity), remainingReservation);
        remainingReservation -= used;
        if (used === Number(reservation.quantity))
          await db
            .prepare("UPDATE stock_reservations SET status='CONSUMED',released_at=? WHERE id=?")
            .run(now(), reservation.id);
        else
          await db
            .prepare('UPDATE stock_reservations SET quantity=quantity-? WHERE id=?')
            .run(used, reservation.id);
      }
      const authorizedPrice = (
        await db
          .prepare(
            "SELECT SUM(ei.total)/SUM(ei.quantity) price FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id WHERE ei.tenant_id=? AND e.work_order_id=? AND e.status='APPROVED' AND ei.approved=1 AND ei.item_type='PART' AND ei.inventory_item_id=?",
          )
          .get(context.tenant.id, order.id, item.id)
      ).price;
      const resulting = Number(item.quantity) - quantity,
        partId = id(),
        unitPrice = Number(authorizedPrice),
        currency = await tenantCurrency(db, context.tenant.id);
      const previousTotal = Number(
        (
          await db
            .prepare(
              'SELECT COALESCE(SUM(total),0) total FROM active_work_order_parts WHERE tenant_id=? AND work_order_id=? AND inventory_item_id=?',
            )
            .get(context.tenant.id, order.id, item.id)
        ).total,
      );
      await db
        .prepare(
          `INSERT INTO work_order_parts (id,tenant_id,work_order_id,inventory_item_id,quantity,unit_cost,unit_price,total,consumed_by,consumed_at,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          partId,
          context.tenant.id,
          order.id,
          item.id,
          quantity,
          item.cost,
          unitPrice,
          roundMoney((already + quantity) * unitPrice, currency) - previousTotal,
          context.user.user_id,
          now(),
          key,
        );
      await db
        .prepare(
          `INSERT INTO inventory_movements (id,tenant_id,branch_id,inventory_item_id,movement_type,quantity,previous_quantity,resulting_quantity,unit_cost,reference_type,reference_id,reason,actor_user_id,idempotency_key,created_at)
      VALUES (?,?,?,?,'CONSUMPTION',?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id(),
          context.tenant.id,
          order.branch_id,
          item.id,
          -quantity,
          item.quantity,
          resulting,
          item.cost,
          'WORK_ORDER',
          order.id,
          input.notes || null,
          context.user.user_id,
          `movement:${key}`,
          now(),
        );
      await recalculateOrder(db, context.tenant.id, order.id);
      await audit(db, {
        ...actorMeta(context, meta),
        branchId: order.branch_id,
        action: 'PART_CONSUMED',
        entityType: 'inventory_item',
        entityId: item.id,
        before: { quantity: item.quantity },
        after: { quantity: resulting, orderId: order.id },
      });
      return { partId, duplicate: false };
    });
  });
}

export async function requestPart(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'inventory.request');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['AUTHORIZED', 'IN_PROGRESS', 'WAITING_PARTS'], 'solicitar repuestos');
    const inventoryItem = await tenantRow(
      db,
      'inventory_items',
      required(input.inventoryItemId, 'El artículo'),
      context.tenant.id,
      'Artículo',
    );
    if (inventoryItem && inventoryItem.branch_id !== order.branch_id)
      throw new AppError('El artículo pertenece a otra sucursal.', { status: 409 });
    return await transaction(db, async () => {
      const requestId = id();
      await db
        .prepare(
          `INSERT INTO purchase_requests (id,tenant_id,branch_id,work_order_id,inventory_item_id,description,quantity,priority,status,requested_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,'REQUESTED',?,?)`,
        )
        .run(
          requestId,
          context.tenant.id,
          order.branch_id,
          order.id,
          inventoryItem?.id || null,
          required(input.description, 'El repuesto requerido', { max: 1000 }),
          positive(input.quantity, 'La cantidad'),
          oneOf(input.priority || 'NORMAL', ['LOW', 'NORMAL', 'HIGH', 'URGENT']),
          context.user.user_id,
          now(),
        );
      if (order.status !== 'WAITING_PARTS')
        await transition(db, context, order, 'WAITING_PARTS', 'ORDER_WAITING_PARTS', meta);
      await audit(db, {
        ...actorMeta(context, meta),
        action: 'PURCHASE_REQUEST_CREATED',
        entityType: 'purchase_request',
        entityId: requestId,
        after: { orderId, quantity: Number(input.quantity) },
      });
      return requestId;
    });
  });
}

export async function sendToQuality(db, context, orderId, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.quality');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['IN_PROGRESS'], 'finalizar la reparación');
    const assignments = await db
      .prepare(
        "SELECT COUNT(*) total,SUM(CASE WHEN status NOT IN ('COMPLETED','CANCELED') THEN 1 ELSE 0 END) pending FROM work_assignments WHERE tenant_id=? AND work_order_id=?",
      )
      .get(context.tenant.id, order.id);
    if (!Number(assignments.total))
      throw new AppError(
        'Asigna al menos un trabajo a un técnico antes de finalizar la reparación.',
        { status: 409 },
      );
    if (Number(assignments.pending || 0))
      throw new AppError(`Hay ${assignments.pending} trabajo(s) todavía sin completar.`, {
        status: 409,
      });
    if (
      !(await db
        .prepare(
          "SELECT 1 FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='APPROVED'",
        )
        .get(context.tenant.id, order.id))
    )
      throw new AppError('La orden no tiene un presupuesto autorizado.', { status: 409 });
    const missing = await db
      .prepare(
        `SELECT i.name,authorized.quantity-COALESCE(consumed.quantity,0) missing
    FROM (SELECT ei.inventory_item_id,SUM(ei.quantity) quantity FROM estimate_items ei
      JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id
      WHERE ei.tenant_id=? AND e.work_order_id=? AND e.status='APPROVED' AND ei.approved=1 AND ei.item_type='PART'
      GROUP BY ei.inventory_item_id) authorized
    JOIN inventory_items i ON i.id=authorized.inventory_item_id AND i.tenant_id=?
    LEFT JOIN (SELECT inventory_item_id,SUM(quantity) quantity FROM active_work_order_parts
      WHERE tenant_id=? AND work_order_id=? GROUP BY inventory_item_id) consumed
      ON consumed.inventory_item_id=authorized.inventory_item_id
    WHERE COALESCE(consumed.quantity,0)<authorized.quantity LIMIT 1`,
      )
      .get(context.tenant.id, order.id, context.tenant.id, context.tenant.id, order.id);
    if (missing)
      throw new AppError(
        `Falta registrar el consumo de ${missing.missing} unidad(es) de ${missing.name}.`,
        { status: 409, code: 'MISSING_AUTHORIZED_PART' },
      );
    return await transaction(
      db,
      async () => await transition(db, context, order, 'QUALITY_CONTROL', 'REPAIR_COMPLETED', meta),
    );
  });
}

export async function recordQualityCheck(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.quality');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['QUALITY_CONTROL'], 'registrar el control de calidad');
    const result = oneOf(input.result, ['PASSED', 'FAILED'], 'El resultado');
    return await transaction(db, async () => {
      const checkId = id();
      await db
        .prepare(
          'INSERT INTO quality_checks (id,tenant_id,work_order_id,inspector_user_id,checklist,notes,result,created_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          checkId,
          context.tenant.id,
          order.id,
          context.user.user_id,
          JSON.stringify(
            String(input.checklist || '')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          ),
          optional(input.notes, { max: 3000 }),
          result,
          now(),
        );
      await transition(
        db,
        context,
        order,
        result === 'PASSED' ? 'READY' : 'IN_PROGRESS',
        result === 'PASSED' ? 'QUALITY_CHECK_PASSED' : 'QUALITY_CHECK_FAILED',
        meta,
      );
      if (result === 'PASSED')
        await queueNotification(db, {
          tenantId: context.tenant.id,
          eventType: 'VEHICLE_READY',
          title: `Vehículo listo · orden #${order.number}`,
          message: 'La reparación superó el control de calidad y está lista para facturar.',
          payload: { orderId },
          idempotencyKey: `vehicle-ready:${checkId}`,
        });
      return checkId;
    });
  });
}

export async function invoiceOrder(db, context, orderId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'billing.invoice');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    const key = required(input.idempotencyKey, 'La clave de operación', { max: 200 });
    return await transaction(db, async () => {
      const duplicate = await db
        .prepare('SELECT * FROM workshop_invoices WHERE tenant_id=? AND idempotency_key=?')
        .get(context.tenant.id, key);
      if (duplicate) {
        if (duplicate.work_order_id !== order.id)
          throw new AppError('La clave ya corresponde a otra orden.', { status: 409 });
        return { invoiceId: duplicate.id, duplicate: true };
      }
      assertOrderState(order, ['READY'], 'facturar la orden');
      if (
        await db
          .prepare(
            'SELECT 1 FROM workshop_invoices WHERE tenant_id=? AND work_order_id=? AND voided_at IS NULL',
          )
          .get(context.tenant.id, order.id)
      )
        throw new AppError('La orden ya posee una factura vigente.', { status: 409 });
      const totals = await recalculateOrder(db, context.tenant.id, order.id);
      const approved = await db
        .prepare(
          "SELECT * FROM estimates WHERE tenant_id=? AND work_order_id=? AND status='APPROVED' ORDER BY version DESC LIMIT 1",
        )
        .get(context.tenant.id, order.id);
      if (
        !approved ||
        roundMoney(approved.total, await tenantCurrency(db, context.tenant.id)) !== totals.total
      )
        throw new AppError(
          'Los importes no coinciden con el presupuesto autorizado. Revisa los conceptos y repuestos antes de facturar.',
          { status: 409 },
        );
      if (totals.total === 0 && (!approved.no_charge_approved_by || !approved.no_charge_reason))
        throw new AppError(
          'El trabajo sin cargo requiere autorización explícita y motivo registrado.',
          { status: 409 },
        );
      const invoiceId = id(),
        number = await allocateNumber(db, context.tenant.id, 'INVOICE', 'workshop_invoices'),
        created = now();
      await db
        .prepare(
          `INSERT INTO workshop_invoices (id,tenant_id,branch_id,customer_id,work_order_id,number,amount,status,due_at,created_at,subtotal,tax,paid_amount,balance,idempotency_key,currency)
      VALUES (?,?,?,?,?,?,?,'PENDING',?,?,?,?,0,?,?,?)`,
        )
        .run(
          invoiceId,
          context.tenant.id,
          order.branch_id,
          order.customer_id,
          order.id,
          number,
          totals.total,
          input.dueAt ? isoDate(input.dueAt) : created,
          created,
          totals.subtotal,
          totals.tax,
          totals.total,
          key,
          await tenantCurrency(db, context.tenant.id),
        );
      for (const labor of await db
        .prepare('SELECT * FROM work_order_labor WHERE tenant_id=? AND work_order_id=?')
        .all(context.tenant.id, order.id))
        await db
          .prepare(
            'INSERT INTO workshop_invoice_items (id,tenant_id,invoice_id,item_type,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(
            id(),
            context.tenant.id,
            invoiceId,
            'LABOR',
            labor.description,
            labor.hours,
            labor.hourly_price,
            labor.total,
          );
      for (const part of await db
        .prepare(
          'SELECT p.*,i.name FROM active_work_order_parts p JOIN inventory_items i ON i.id=p.inventory_item_id WHERE p.tenant_id=? AND p.work_order_id=?',
        )
        .all(context.tenant.id, order.id))
        await db
          .prepare(
            'INSERT INTO workshop_invoice_items (id,tenant_id,invoice_id,item_type,description,quantity,unit_price,total) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(
            id(),
            context.tenant.id,
            invoiceId,
            'PART',
            part.name,
            part.quantity,
            part.unit_price,
            part.total,
          );
      const invoiced = await transition(db, context, order, 'INVOICED', 'ORDER_INVOICED', meta, {
        total: order.total,
      });
      if (totals.total === 0) {
        await db
          .prepare("UPDATE workshop_invoices SET status='PAID' WHERE id=? AND tenant_id=?")
          .run(invoiceId, context.tenant.id);
        await transition(db, context, invoiced, 'PAID', 'NO_CHARGE_SETTLED', meta, {
          reason: approved.no_charge_reason,
        });
      }
      return { invoiceId, number, duplicate: false };
    });
  });
}

export async function voidInvoice(db, context, invoiceId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'billing.void');
    assertTenantWritable(context);
    const invoice = await tenantRow(
      db,
      'workshop_invoices',
      invoiceId,
      context.tenant.id,
      'Factura',
    );
    if (invoice.voided_at) throw new AppError('La factura ya está anulada.', { status: 409 });
    if (
      Number(invoice.paid_amount) > 0 ||
      Number(
        (
          await db
            .prepare(
              'SELECT COUNT(*) total FROM effective_workshop_payments WHERE tenant_id=? AND invoice_id=?',
            )
            .get(context.tenant.id, invoice.id)
        ).total,
      )
    )
      throw new AppError(
        'No se puede anular una factura con cobros vigentes. Si hubo un error de registro, un usuario autorizado debe corregirlo primero.',
        { status: 409 },
      );
    const order = await tenantRow(
      db,
      'work_orders',
      invoice.work_order_id,
      context.tenant.id,
      'Orden',
    );
    assertOrderState(
      order,
      Number(invoice.amount) === 0 ? ['INVOICED', 'PAID'] : ['INVOICED'],
      'anular la factura',
    );
    return await transaction(db, async () => {
      const timestamp = now(),
        reason = required(input.reason, 'El motivo de anulación', { max: 1000 });
      await db
        .prepare(
          "UPDATE workshop_invoices SET status='VOID',voided_at=?,voided_by=?,void_reason=? WHERE id=? AND tenant_id=?",
        )
        .run(timestamp, context.user.user_id, reason, invoice.id, context.tenant.id);
      await transition(db, context, order, 'READY', 'INVOICE_VOIDED', meta, {
        invoiceId: invoice.id,
      });
      await audit(db, {
        ...actorMeta(context, meta),
        branchId: invoice.branch_id,
        action: 'WORKSHOP_INVOICE_VOIDED',
        entityType: 'workshop_invoice',
        entityId: invoice.id,
        before: { status: invoice.status, balance: invoice.balance },
        after: { status: 'VOID', reason },
      });
      return invoice.id;
    });
  });
}

export async function cancelOrder(db, context, orderId, input = {}, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.cancel');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(
      order,
      ['RECEIVED', 'INSPECTION', 'DIAGNOSIS', 'ESTIMATE', 'AWAITING_APPROVAL'],
      'cancelar la orden',
    );
    return await transaction(db, async () => {
      const reason = required(input.reason, 'El motivo de cancelación', { max: 1000 });
      return (await transition(db, context, order, 'CANCELED', 'ORDER_CANCELED', meta, { reason }))
        .id;
    });
  });
}

export async function recordCustomerPayment(db, context, invoiceId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'billing.collect');
    assertTenantWritable(context);
    const invoice = await tenantRow(
      db,
      'workshop_invoices',
      invoiceId,
      context.tenant.id,
      'Factura',
    );
    if (invoice.voided_at)
      throw new AppError('No se puede cobrar una factura anulada.', { status: 409 });
    const currency = invoice.currency || (await tenantCurrency(db, context.tenant.id));
    const amount = moneyAmount(input.amount, currency, 'El importe'),
      key = required(input.idempotencyKey, 'La clave de operación', { max: 200 }),
      method = oneOf(input.method, ['CASH', 'TRANSFER', 'CARD', 'OTHER'], 'El método de pago'),
      reference = optional(input.reference, { max: 200 }),
      explicitPaidAt = input.paidAt
        ? paymentTimestamp(input.paidAt, {
            timezone: (
              await db
                .prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?')
                .get(context.tenant.id)
            )?.timezone,
          })
        : null;
    return await transaction(db, async () => {
      const duplicate = await db
        .prepare('SELECT * FROM workshop_payments WHERE tenant_id=? AND idempotency_key=?')
        .get(context.tenant.id, key);
      if (duplicate) {
        if (
          duplicate.invoice_id !== invoice.id ||
          Number(duplicate.amount) !== amount ||
          duplicate.method !== method ||
          (duplicate.reference || null) !== reference ||
          (explicitPaidAt && duplicate.paid_at !== explicitPaidAt)
        )
          throw new AppError('Esta clave de pago ya se utilizó con otros datos.', {
            status: 409,
          });
        return { paymentId: duplicate.id, duplicate: true };
      }
      const current = await db
        .prepare('SELECT * FROM workshop_invoices WHERE id=? AND tenant_id=?')
        .get(invoice.id, context.tenant.id);
      if (amount > current.balance)
        throw new AppError(`El cobro supera el saldo pendiente de ${current.balance}.`, {
          status: 409,
        });
      const paymentId = id(),
        newPaid = roundMoney(Number(current.paid_amount) + amount, currency),
        newBalance = roundMoney(Number(current.balance) - amount, currency),
        status = newBalance === 0 ? 'PAID' : 'PARTIAL',
        paidAt = explicitPaidAt || now();
      await db
        .prepare(
          'INSERT INTO workshop_payments (id,tenant_id,invoice_id,amount,method,reference,paid_at,received_by,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          paymentId,
          context.tenant.id,
          current.id,
          amount,
          method,
          reference,
          paidAt,
          context.user.user_id,
          key,
          now(),
        );
      await db
        .prepare(
          'UPDATE workshop_invoices SET paid_amount=?,balance=?,status=?,paid_at=? WHERE id=? AND tenant_id=?',
        )
        .run(
          newPaid,
          newBalance,
          status,
          newBalance === 0 ? paidAt : null,
          current.id,
          context.tenant.id,
        );
      await db
        .prepare(
          `INSERT INTO cash_movements (id,tenant_id,branch_id,type,category,amount,reference,notes,created_by,created_at,workshop_payment_id,idempotency_key)
      VALUES (?,?,?,'INCOME','CUSTOMER_PAYMENT',?,?,?,?,?,?,?)`,
        )
        .run(
          id(),
          context.tenant.id,
          current.branch_id,
          amount,
          reference,
          `Cobro factura #${current.number}`,
          context.user.user_id,
          paidAt,
          paymentId,
          `customer-payment:${paymentId}`,
        );
      const order = await tenantRow(
        db,
        'work_orders',
        current.work_order_id,
        context.tenant.id,
        'Orden',
      );
      if (!['DELIVERED', 'CLOSED'].includes(order.status))
        await transition(
          db,
          context,
          order,
          newBalance === 0 ? 'PAID' : 'PARTIALLY_PAID',
          'CUSTOMER_PAYMENT_RECORDED',
          meta,
          { balance: current.balance },
        );
      else
        await audit(db, {
          ...actorMeta(context, meta),
          branchId: current.branch_id,
          action: 'CUSTOMER_PAYMENT_RECORDED',
          entityType: 'workshop_payment',
          entityId: paymentId,
          before: { balance: current.balance, orderStatus: order.status },
          after: { balance: newBalance, amount, orderStatus: order.status },
        });
      await queueNotification(db, {
        tenantId: context.tenant.id,
        eventType: 'PAYMENT_RECEIVED',
        title: `Pago recibido · factura #${current.number}`,
        message: `Se registró un pago por ${amount}.`,
        payload: { invoiceId: current.id, paymentId },
        idempotencyKey: `customer-payment:${paymentId}`,
      });
      return { paymentId, balance: newBalance, duplicate: false };
    });
  });
}

export async function deliverVehicle(db, context, orderId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'orders.deliver');
    assertTenantWritable(context);
    const order = await tenantRow(db, 'work_orders', orderId, context.tenant.id, 'Orden');
    assertOrderState(order, ['PAID'], 'entregar el vehículo');
    if (
      !(await db
        .prepare(
          "SELECT 1 FROM quality_checks WHERE tenant_id=? AND work_order_id=? AND result='PASSED'",
        )
        .get(context.tenant.id, order.id))
    )
      throw new AppError('Falta un control de calidad aprobado.', { status: 409 });
    const invoice = await db
      .prepare(
        "SELECT * FROM workshop_invoices WHERE tenant_id=? AND work_order_id=? AND status='PAID' AND voided_at IS NULL",
      )
      .get(context.tenant.id, order.id);
    if (!invoice) throw new AppError('La factura todavía tiene saldo pendiente.', { status: 409 });
    const settings = await db
      .prepare('SELECT warranty_days,warranty_terms FROM tenant_settings WHERE tenant_id=?')
      .get(context.tenant.id);
    const vehicle = await tenantRow(
      db,
      'vehicles',
      order.vehicle_id,
      context.tenant.id,
      'Vehículo',
    );
    const odometer = input.odometer
      ? integer(input.odometer, 'El kilometraje', { min: Number(vehicle.odometer || 0) })
      : Number(vehicle.odometer || 0);
    const warrantyDays = integer(
      input.warrantyDays ?? settings.warranty_days,
      'Los días de garantía',
      { min: 0, max: 3650 },
    );
    return await transaction(db, async () => {
      const deliveryId = id(),
        deliveredAt = now();
      await db
        .prepare(
          'INSERT INTO deliveries (id,tenant_id,work_order_id,delivered_by,received_by_name,notes,odometer,delivered_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run(
          deliveryId,
          context.tenant.id,
          order.id,
          context.user.user_id,
          required(input.receivedBy, 'La persona que recibe', { max: 200 }),
          optional(input.notes, { max: 2000 }),
          odometer,
          deliveredAt,
        );
      await db
        .prepare('UPDATE vehicles SET odometer=? WHERE id=? AND tenant_id=?')
        .run(odometer, vehicle.id, context.tenant.id);
      if (warrantyDays > 0)
        await db
          .prepare(
            "INSERT INTO warranties (id,tenant_id,work_order_id,starts_at,ends_at,terms,status,created_by,created_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?)",
          )
          .run(
            id(),
            context.tenant.id,
            order.id,
            deliveredAt,
            addDays(deliveredAt, warrantyDays),
            required(
              input.warrantyTerms || settings.warranty_terms,
              'Las condiciones de garantía',
              {
                max: 3000,
              },
            ),
            context.user.user_id,
            deliveredAt,
          );
      await transition(db, context, order, 'DELIVERED', 'VEHICLE_DELIVERED', meta);
      await queueNotification(db, {
        tenantId: context.tenant.id,
        eventType: 'VEHICLE_DELIVERED',
        title: `Vehículo entregado · orden #${order.number}`,
        message: 'El flujo operativo fue completado.',
        payload: { orderId, deliveryId },
        idempotencyKey: `delivery:${deliveryId}`,
      });
      return deliveryId;
    });
  });
}

export { createPurchaseOrder, receivePurchaseOrder } from './purchases.js';

export async function paySupplier(db, context, payableId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    assertPermission(context, 'purchases.pay');
    assertTenantWritable(context);
    const payable = await tenantRow(
      db,
      'accounts_payable',
      payableId,
      context.tenant.id,
      'Cuenta por pagar',
    );
    const currency = await tenantCurrency(db, context.tenant.id),
      amount = moneyAmount(input.amount, currency, 'El importe'),
      key = required(input.idempotencyKey, 'La clave de operación', { max: 200 }),
      method = oneOf(input.method, ['CASH', 'TRANSFER', 'CARD', 'OTHER'], 'El método de pago'),
      reference = optional(input.reference, { max: 200 }),
      explicitPaidAt = input.paidAt
        ? paymentTimestamp(input.paidAt, {
            timezone: (
              await db
                .prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?')
                .get(context.tenant.id)
            )?.timezone,
          })
        : null;
    return await transaction(db, async () => {
      const duplicate = await db
        .prepare('SELECT * FROM purchase_payments WHERE tenant_id=? AND idempotency_key=?')
        .get(context.tenant.id, key);
      if (duplicate) {
        if (
          duplicate.payable_id !== payable.id ||
          Number(duplicate.amount) !== amount ||
          duplicate.method !== method ||
          (duplicate.reference || null) !== reference ||
          (explicitPaidAt && duplicate.paid_at !== explicitPaidAt)
        )
          throw new AppError('La referencia ya se utilizó con otro pago.', { status: 409 });
        return { paymentId: duplicate.id, duplicate: true };
      }
      const current = await tenantRow(
        db,
        'accounts_payable',
        payable.id,
        context.tenant.id,
        'Cuenta por pagar',
      );
      if (amount > current.balance)
        throw new AppError(`El pago supera el saldo pendiente de ${current.balance}.`, {
          status: 409,
        });
      const paymentId = id(),
        balance = roundMoney(Number(current.balance) - amount, currency),
        paid = roundMoney(Number(current.paid_amount) + amount, currency),
        status = balance === 0 ? 'PAID' : 'PARTIAL',
        paidAt = explicitPaidAt || now();
      await db
        .prepare(
          'INSERT INTO purchase_payments (id,tenant_id,payable_id,amount,method,reference,paid_at,actor_user_id,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          paymentId,
          context.tenant.id,
          current.id,
          amount,
          method,
          reference,
          paidAt,
          context.user.user_id,
          key,
          now(),
        );
      await db
        .prepare(
          'UPDATE accounts_payable SET paid_amount=?,balance=?,status=? WHERE id=? AND tenant_id=?',
        )
        .run(paid, balance, status, current.id, context.tenant.id);
      await db
        .prepare(
          `INSERT INTO cash_movements (id,tenant_id,branch_id,type,category,amount,reference,notes,created_by,created_at,purchase_payment_id,idempotency_key)
      VALUES (?,?,?,'EXPENSE','SUPPLIER_PAYMENT',?,?,?,?,?,?,?)`,
        )
        .run(
          id(),
          context.tenant.id,
          current.branch_id,
          amount,
          reference,
          'Pago a proveedor',
          context.user.user_id,
          paidAt,
          paymentId,
          `supplier-payment:${paymentId}`,
        );
      await audit(db, {
        ...actorMeta(context, meta),
        branchId: current.branch_id,
        action: 'SUPPLIER_PAYMENT_RECORDED',
        entityType: 'accounts_payable',
        entityId: current.id,
        before: { balance: current.balance },
        after: { balance, status },
      });
      return { paymentId, balance, duplicate: false };
    });
  });
}

export async function orderProfitability(db, tenantId, orderId) {
  const order = await tenantRow(db, 'work_orders', orderId, tenantId, 'Orden');
  const parts = await db
    .prepare(
      'SELECT COALESCE(SUM(quantity*unit_cost),0) cost,COALESCE(SUM(total),0) revenue FROM active_work_order_parts WHERE tenant_id=? AND work_order_id=?',
    )
    .get(tenantId, order.id);
  const labor = await db
    .prepare(
      'SELECT COALESCE(SUM(hours*hourly_cost),0) cost,COALESCE(SUM(total),0) revenue FROM work_order_labor WHERE tenant_id=? AND work_order_id=?',
    )
    .get(tenantId, order.id);
  const revenue = Number(parts.revenue) + Number(labor.revenue),
    cost = Number(parts.cost) + Number(labor.cost);
  return {
    revenue,
    cost,
    margin: revenue - cost,
    marginPercent: revenue ? ((revenue - cost) / revenue) * 100 : 0,
  };
}
