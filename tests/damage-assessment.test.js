import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase } from './helpers/postgres.js';
import { provisionWorkshop } from '../src/domain.js';
import { createSession, readSession } from '../src/auth.js';
import { resolveContext } from '../src/tenancy.js';
import { now } from '../src/utils.js';
import {
  receiveVehicle,
  addEstimateItem,
  sendEstimate,
  approveEstimate,
} from '../src/services/workshop-operations.js';
import { reviseEstimate, removeEstimateItem } from '../src/services/operational-closure.js';
import {
  loadDamageAssessment,
  saveDamageAssessment,
  importDamageToEstimate,
  finishDamageDiagnosis,
  updateEstimateTerms,
  vehicleDamageHistory,
} from '../src/services/damage-assessments.js';
import {
  loadModelCatalog,
  resolveVehicleModel,
  modelEntry,
} from '../src/services/vehicle-models.js';
import { printableOrder } from '../src/pages/print-documents.js';

async function contextFor(db, userId) {
  const session = await createSession(db, userId);
  return resolveContext(db, await readSession(db, session.id));
}
async function fixture() {
  const db = await openTestDatabase();
  await seedDatabase(db, {
    superadminEmail: 'root@damage.local',
    superadminPassword: 'Strong123!',
  });
  const tenant = await provisionWorkshop(db, {
    ownerName: 'Encargado',
    workshopName: 'CM Performance Test',
    email: 'owner@damage.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  const context = await contextFor(db, tenant.userId);
  await db
    .prepare(
      'INSERT INTO customers (id,tenant_id,branch_id,name,document,tax_id,phone,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'customer',
      tenant.tenantId,
      tenant.branchId,
      'Cliente Uno',
      '1234567',
      '80012345-6',
      '0981000000',
      now(),
    );
  await db
    .prepare(
      'INSERT INTO vehicles (id,tenant_id,customer_id,plate,make,model,year,color,odometer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      'vehicle',
      tenant.tenantId,
      'customer',
      'AAA123',
      'Toyota',
      'Ractis',
      2012,
      'Rojo',
      90000,
      now(),
    );
  const { orderId } = await receiveVehicle(db, context, {
    branchId: context.membership.branch_id,
    customerId: 'customer',
    vehicleId: 'vehicle',
    complaint: 'Golpe lateral izquierdo',
    odometer: 90100,
  });
  return { db, tenant, context, orderId };
}
const damage = {
  revision: 0,
  bodyType: 'HATCHBACK',
  paintColor: '#C0392B',
  notes: 'Golpe lateral',
  parts: {
    door_front_left: {
      severity: 'SEVERE',
      pressure: 70,
      affectedZone: 'sector central',
      description: 'Abolladura profunda',
      repairCost: 300000,
      laborCost: 80000,
      strokes: [
        [0.1, 0.2, 0.5, 18, 3],
        [0.12, 0.2, 0.5, 18, 3],
      ],
    },
    hood: { severity: 'MODERATE', pressure: 35, repairCost: 150000 },
    roof: { pressure: 20 },
  },
};

test('el diagnóstico 3D persiste por pieza, alimenta el presupuesto y los documentos', async () => {
  const { db, tenant, context, orderId } = await fixture();
  const initial = await loadDamageAssessment(db, context, orderId);
  assert.equal(initial.assessment, null);
  assert.equal(initial.permissions.edit, true);

  const saved = await saveDamageAssessment(db, context, orderId, damage);
  assert.equal(saved.revision, 1);
  const loaded = await loadDamageAssessment(db, context, orderId);
  assert.equal(loaded.assessment.paintColor, '#c0392b');
  assert.deepEqual(loaded.parts.door_front_left.strokes, damage.parts.door_front_left.strokes);
  // La presión se guarda aparte de la gravedad.
  assert.equal(loaded.parts.roof.severity, 'NONE');
  assert.equal(loaded.parts.roof.pressure, 20);
  assert.equal(loaded.totals.damagedParts, 2);
  assert.equal(
    (await db.prepare("SELECT body_type FROM vehicles WHERE id='vehicle'").get()).body_type,
    'HATCHBACK',
  );

  await assert.rejects(
    saveDamageAssessment(db, context, orderId, { ...damage, revision: 0 }),
    (error) => error.code === 'STALE_REVISION',
  );
  await assert.rejects(
    saveDamageAssessment(db, context, orderId, {
      ...damage,
      revision: 1,
      bodyType: 'COUPE',
      parts: { door_rear_left: { severity: 'LIGHT' } },
    }),
    /no tiene puerta trasera izquierda/,
  );
  await assert.rejects(
    saveDamageAssessment(db, context, orderId, {
      ...damage,
      revision: 1,
      parts: { hood: { strokes: [[0, 0, 0, 100, 2]] } },
    }),
    /trazos no válidos/,
  );
  await assert.rejects(importDamageToEstimate(db, context, orderId), /preparar el presupuesto/);

  const finished = await finishDamageDiagnosis(db, context, orderId, {
    importEstimate: true,
    recommendations: 'Enderezar y pintar',
  });
  assert.equal(finished.imported, 3);
  const order = await db
    .prepare('SELECT status,diagnosis FROM work_orders WHERE id=?')
    .get(orderId);
  assert.equal(order.status, 'ESTIMATE');
  assert.match(order.diagnosis, /Puerta delantera izquierda: Grave/);
  const draft = await db
    .prepare("SELECT * FROM estimates WHERE work_order_id=? AND status='DRAFT'")
    .get(orderId);
  assert.deepEqual(
    [Number(draft.subtotal), Number(draft.tax), Number(draft.total)],
    [530000, 53000, 583000],
  );
  await assert.rejects(
    importDamageToEstimate(db, context, orderId),
    (error) => error.code === 'NOTHING_TO_IMPORT',
  );

  await addEstimateItem(db, context, orderId, {
    itemType: 'LABOR',
    description: 'Trabajo de chapista',
    vehiclePart: 'door_front_left',
    responsibleUserId: context.user.user_id,
    quantity: 1,
    unitPrice: 70000,
  });
  await assert.rejects(
    addEstimateItem(db, context, orderId, {
      itemType: 'LABOR',
      description: 'Pulido',
      responsibleUserId: 'desconocido',
      unitPrice: 1000,
    }),
    /responsable/,
  );
  await updateEstimateTerms(db, context, orderId, {
    paymentTerms: 'Contado',
    workTimeValue: 3,
    workTimeUnit: 'DAYS',
  });

  // Una revisión conserva el vínculo de cada concepto con su pieza y su diagnóstico.
  await sendEstimate(db, context, orderId);
  await reviseEstimate(db, context, orderId, { reason: 'Cliente pide revisar' });
  const revised = await db
    .prepare(
      "SELECT ei.* FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id WHERE e.work_order_id=? AND e.status='DRAFT'",
    )
    .all(orderId);
  assert.equal(revised.filter((item) => item.damage_part_id).length, 3);
  assert.equal(
    revised.find((item) => item.description === 'Trabajo de chapista').vehicle_part,
    'door_front_left',
  );
  const revisedTerms = await db
    .prepare("SELECT payment_terms FROM estimates WHERE work_order_id=? AND status='DRAFT'")
    .get(orderId);
  assert.equal(revisedTerms.payment_terms, 'Contado');
  await assert.rejects(
    importDamageToEstimate(db, context, orderId),
    (error) => error.code === 'NOTHING_TO_IMPORT',
  );

  await sendEstimate(db, context, orderId);
  await approveEstimate(db, context, orderId, { approvedBy: 'Cliente Uno' });
  const labor = await db
    .prepare(
      'SELECT technician_user_id FROM work_order_labor WHERE work_order_id=? AND description=?',
    )
    .get(orderId, 'Trabajo de chapista');
  assert.equal(labor.technician_user_id, context.user.user_id);
  await assert.rejects(
    saveDamageAssessment(db, context, orderId, { ...damage, revision: 1 }),
    /modificar el diagnóstico visual/,
  );
  assert.equal((await loadDamageAssessment(db, context, orderId)).permissions.edit, false);

  const req = { context, session: { user_id: context.user.user_id } };
  const damageDocument = await printableOrder(db, req, orderId, 'damage');
  assert.match(damageDocument, /damage-map-svg/);
  assert.match(damageDocument, /Puerta delantera izquierda/);
  assert.match(damageDocument, /Firma del encargado/);
  const serviceDocument = await printableOrder(db, req, orderId, 'service');
  assert.match(serviceDocument, /PRESUPUESTO DEL SERVICIO/);
  assert.match(serviceDocument, /80012345-6/);
  assert.match(serviceDocument, /Contado/);
  assert.match(serviceDocument, /3 día/);
  assert.match(serviceDocument, /Trabajo de chapista/);
  const materialsDocument = await printableOrder(db, req, orderId, 'materials');
  assert.match(materialsDocument, /CONTROL DE MATERIALES E INSUMOS/);
  assert.match(materialsDocument, /Mano de obra/);
  assert.match(materialsDocument, /Verificado por/);

  const history = await vehicleDamageHistory(db, tenant.tenantId, 'vehicle');
  assert.equal(history.length, 1);
  assert.equal(history[0].damagedParts, 2);
});

test('el diagnóstico de un taller no es visible ni editable desde otro', async () => {
  const { db, context, orderId } = await fixture();
  await saveDamageAssessment(db, context, orderId, damage);
  const other = await provisionWorkshop(db, {
    ownerName: 'Otro',
    workshopName: 'Otro taller',
    email: 'other@damage.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  const outsider = await contextFor(db, other.userId);
  await assert.rejects(loadDamageAssessment(db, outsider, orderId), /Orden no encontrada/);
  await assert.rejects(
    saveDamageAssessment(db, outsider, orderId, { ...damage, revision: 1 }),
    /Orden no encontrada/,
  );
  await assert.rejects(
    printableOrder(
      db,
      { context: outsider, session: { user_id: outsider.user.user_id } },
      orderId,
      'damage',
    ),
    /Orden no encontrada/,
  );
});

test('fotos, modificaciones y borrados conservan la integridad del diagnóstico', async () => {
  const { db, tenant, context, orderId } = await fixture();
  await saveDamageAssessment(db, context, orderId, damage);
  // Foto de la pieza: vínculo existente de archivos con la categoría DAMAGE:<pieza>.
  await db
    .prepare(
      'INSERT INTO files (id,tenant_id,name,mime_type,storage_key,size_bytes,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'photo',
      tenant.tenantId,
      'puerta.jpg',
      'image/jpeg',
      tenant.tenantId + '/puerta.jpg',
      10,
      context.user.user_id,
      now(),
    );
  await db
    .prepare(
      "INSERT INTO file_links (file_id,tenant_id,entity_type,entity_id,category) VALUES (?,?,'WORK_ORDER',?,?)",
    )
    .run('photo', tenant.tenantId, orderId, 'DAMAGE:door_front_left');
  assert.deepEqual(
    (await loadDamageAssessment(db, context, orderId)).photos.map(({ id, part }) => [id, part]),
    [['photo', 'door_front_left']],
  );
  await db.prepare("DELETE FROM files WHERE id='photo'").run();
  assert.deepEqual((await loadDamageAssessment(db, context, orderId)).photos, []);

  // Modificar una pieza a «sin daño» limpia su mapa y deja de sumarla.
  await saveDamageAssessment(db, context, orderId, {
    ...damage,
    revision: 1,
    parts: {
      ...damage.parts,
      hood: { severity: 'NONE', pressure: 0, repairCost: 0, laborCost: 0, strokes: [] },
    },
  });
  const modified = await loadDamageAssessment(db, context, orderId);
  assert.equal(modified.assessment.revision, 2);
  assert.equal(modified.parts.hood.severity, 'NONE');
  assert.equal(modified.totals.damagedParts, 1);

  // Borrar un concepto importado solo vuelve a dejar pendiente ese concepto: nunca duplica.
  assert.equal(
    (await finishDamageDiagnosis(db, context, orderId, { importEstimate: true })).imported,
    2,
  );
  const linked = () =>
    db
      .prepare(
        "SELECT ei.id,ei.item_type FROM estimate_items ei JOIN estimates e ON e.id=ei.estimate_id AND e.tenant_id=ei.tenant_id WHERE e.work_order_id=? AND e.status='DRAFT' AND ei.damage_part_id IS NOT NULL ORDER BY ei.item_type",
      )
      .all(orderId);
  const [labor] = await linked();
  await removeEstimateItem(db, context, labor.id);
  assert.equal((await importDamageToEstimate(db, context, orderId)).created, 1);
  assert.deepEqual(
    (await linked()).map((item) => item.item_type),
    ['LABOR', 'SERVICE'],
  );

  // La base impide dejar un diagnóstico o sus conceptos huérfanos.
  const rejectedFk = (error) => error.code === '23503';
  await assert.rejects(
    db.prepare('DELETE FROM damage_assessments WHERE work_order_id=?').run(orderId),
    rejectedFk,
  );
  await assert.rejects(db.prepare('DELETE FROM work_orders WHERE id=?').run(orderId), rejectedFk);
  await assert.rejects(db.prepare("DELETE FROM vehicles WHERE id='vehicle'").run(), rejectedFk);
  assert.equal((await loadDamageAssessment(db, context, orderId)).totals.damagedParts, 1);
});

test('la biblioteca local resuelve modelos sin red y marca 3D_NOT_AVAILABLE', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-models-'));
  try {
    fs.mkdirSync(path.join(root, 'catalog'));
    fs.mkdirSync(path.join(root, 'models', 'cars', 'toyota', 'ractis', '2012'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'models', 'cars', 'toyota', 'ractis', '2012', 'model.glb'),
      'glb',
    );
    const entry = (id, extra) => ({
      id,
      format: 'glb',
      sha256: 'a'.repeat(64),
      validation: { status: 'VALID' },
      license: 'CC0-1.0',
      author: 'Autor',
      ...extra,
    });
    fs.writeFileSync(
      path.join(root, 'catalog', 'models.json'),
      JSON.stringify({
        models: [
          entry('toyota-ractis-2012', {
            brand: 'Toyota',
            model: 'Ractis',
            year: 2012,
            category: 'cars',
            file: 'models/cars/toyota/ractis/2012/model.glb',
          }),
          entry('generic-hatch', {
            brand: 'Genérico',
            model: 'Hatchback',
            generic: true,
            category: 'cars',
            file: 'models/cars/toyota/ractis/2012/model.glb',
          }),
          entry('escape', { brand: 'X', model: 'Y', category: 'cars', file: '../../outside.glb' }),
          entry('missing', {
            brand: 'Kia',
            model: 'Picanto',
            category: 'cars',
            file: 'models/cars/kia/model.glb',
          }),
        ],
      }),
    );
    const catalog = loadModelCatalog(root);
    assert.equal(modelEntry('escape', catalog), null);
    assert.equal(modelEntry('missing', catalog), null);
    const exact = resolveVehicleModel({ make: 'TOYOTA', model: 'ractis', year: 2012 }, catalog);
    assert.equal(exact.status, 'EXACT');
    assert.match(exact.model.url, /^\/workshop\/models3d\/toyota-ractis-2012\/model\.glb\?v=/);
    assert.equal(
      resolveVehicleModel({ make: 'Toyota', model: 'Ractis', year: 2015 }, catalog).status,
      'VARIANT',
    );
    const none = resolveVehicleModel(
      { make: 'Kia', model: 'Picanto', bodyType: 'HATCHBACK' },
      catalog,
    );
    assert.equal(none.status, '3D_NOT_AVAILABLE');
    assert.equal(none.model, null);
    assert.deepEqual(
      none.generic.map((model) => model.id),
      ['generic-hatch'],
    );
    assert.equal(loadModelCatalog(path.join(root, 'no-existe')).available, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
