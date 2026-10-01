import fs from 'node:fs';
import { AppError, publicError } from '../errors.js';
import { assertPermission, can } from '../tenancy.js';
import { logger } from '../logger.js';
import {
  loadDamageAssessment,
  saveDamageAssessment,
  importDamageToEstimate,
  finishDamageDiagnosis,
  updateEstimateTerms,
} from '../services/damage-assessments.js';
import { resolveVehicleModel, modelEntry } from '../services/vehicle-models.js';
import { diagnosisStudioPage, modelLibraryPage } from '../pages/diagnosis.js';

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  res.end(JSON.stringify(value));
}
// The 3D studio talks JSON: failures return a JSON message instead of an HTML redirect.
async function respondJson(req, res, operation) {
  try {
    sendJson(res, 200, await operation());
  } catch (error) {
    const friendly = publicError(error);
    (friendly.status >= 500 ? logger.error : logger.warn)('request_failed', {
      requestId: req.requestId,
      method: req.method,
      path: req.url,
      status: friendly.status,
      code: friendly.code,
      userId: req.session?.user_id,
      tenantId: req.context?.tenant?.id,
      ...(friendly.status >= 500 ? { error: error?.stack || String(error) } : {}),
    });
    sendJson(res, friendly.status, { error: friendly.message, code: friendly.code });
  }
}
// Local model files are immutable per content hash (?v=sha); served in streaming, never proxied.
function streamFile(res, file, type) {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  // Un archivo bloqueado o una unidad desconectada corta esta respuesta, nunca el servidor.
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
const requireSession = (req) => {
  if (!req.session) throw new AppError('Inicia sesión para continuar.', { status: 401 });
};

export async function diagnosisGet(req, res, url, api) {
  const { db, render, requireWorkshop, match } = api,
    p = url.pathname;
  let params = match('/workshop/orders/:id/diagnosis-3d', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.view');
    render(
      res,
      'Diagnóstico 3D',
      await diagnosisStudioPage(db, req, params.id),
      req,
      url,
      'workshop',
    );
    return true;
  }
  params = match('/workshop/orders/:id/damage-assessment', p);
  if (params) {
    await respondJson(req, res, async () => {
      requireSession(req);
      requireWorkshop(req);
      const payload = await loadDamageAssessment(db, req.context, params.id);
      payload.referenceModel = resolveVehicleModel(payload.vehicle);
      return payload;
    });
    return true;
  }
  if (p === '/workshop/models3d') {
    requireWorkshop(req);
    assertPermission(req.context, 'vehicles.view');
    render(res, 'Modelos 3D', modelLibraryPage(req), req, url, 'workshop');
    return true;
  }
  params = match('/workshop/models3d/:id/:file', p);
  if (params) {
    requireWorkshop(req);
    if (!can(req.context, 'vehicles.view') && !can(req.context, 'orders.view'))
      assertPermission(req.context, 'vehicles.view');
    const entry = modelEntry(params.id);
    if (entry && params.file === 'model.glb') streamFile(res, entry.absolute, 'model/gltf-binary');
    else if (
      entry?.thumbnailAbsolute &&
      params.file === 'thumbnail.webp' &&
      fs.existsSync(entry.thumbnailAbsolute)
    )
      streamFile(res, entry.thumbnailAbsolute, 'image/webp');
    else throw new AppError('Modelo 3D no disponible en la biblioteca local.', { status: 404 });
    return true;
  }
  return false;
}

export async function diagnosisPost(req, res, url, data, api) {
  const {
      db,
      redirect,
      withMessage,
      requireAuth,
      requireWorkshop,
      checkCsrf,
      match,
      tenantAuditActor,
    } = api,
    p = url.pathname;
  let params = match('/workshop/orders/:id/damage-assessment', p);
  if (params) {
    await respondJson(req, res, async () => {
      requireSession(req);
      checkCsrf(req, data);
      requireWorkshop(req);
      return await saveDamageAssessment(db, req.context, params.id, data, tenantAuditActor(req));
    });
    return true;
  }
  params = match('/workshop/orders/:id/damage-assessment/estimate', p);
  if (params) {
    requireAuth(req);
    checkCsrf(req, data);
    requireWorkshop(req);
    const { created } = await importDamageToEstimate(
      db,
      req.context,
      params.id,
      tenantAuditActor(req),
    );
    redirect(
      res,
      withMessage(
        `/workshop/orders/${params.id}`,
        `${created} concepto(s) del diagnóstico agregados al presupuesto.`,
      ),
    );
    return true;
  }
  params = match('/workshop/orders/:id/damage-assessment/finish', p);
  if (params) {
    requireAuth(req);
    checkCsrf(req, data);
    requireWorkshop(req);
    const { imported } = await finishDamageDiagnosis(
      db,
      req.context,
      params.id,
      { ...data, importEstimate: data.importEstimate === '1' },
      tenantAuditActor(req),
    );
    redirect(
      res,
      withMessage(
        `/workshop/orders/${params.id}`,
        imported
          ? `Diagnóstico finalizado: ${imported} concepto(s) pasaron al presupuesto.`
          : 'Diagnóstico finalizado. Continúa con el presupuesto.',
      ),
    );
    return true;
  }
  params = match('/workshop/orders/:id/estimate/terms', p);
  if (params) {
    requireAuth(req);
    checkCsrf(req, data);
    requireWorkshop(req);
    await updateEstimateTerms(db, req.context, params.id, data, tenantAuditActor(req));
    redirect(
      res,
      withMessage(`/workshop/orders/${params.id}`, 'Condiciones del presupuesto actualizadas.'),
    );
    return true;
  }
  return false;
}
