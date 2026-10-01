// Proceso común de recopilación/importación. Cada candidato se procesa aislado: un fallo individual
// queda en el informe y la ejecución continúa.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, ROOT, readJson, slug } from './paths.js';
import { fetchBuffer, fetchJson, fetchText, throttle } from './http.js';
import { evaluateLicenses } from './license.js';
import { parseGlb, analyzeGlb, packGltf } from './gltf.js';
import { objToGlb } from './obj.js';
import { loadCatalog, findBySource, storeModel, saveCatalog, modelPresent } from './catalog.js';
import { renderThumbnails } from './thumbnails.js';
import { createReport, writeReport } from './report.js';

const MAX_MODEL_BYTES = 80_000_000;
const HIGH_POLY = 750_000;

function required(bytes, uri) {
  if (!bytes) throw new Error(`Falta el recurso referenciado por el modelo: ${uri}`);
  return bytes;
}

export function toGlb(format, loaded) {
  if (format === 'glb') {
    const { json, bin } = parseGlb(loaded.bytes);
    const external = [...(json.buffers || []), ...(json.images || [])].some((item) => item.uri);
    if (!external) return { bytes: loaded.bytes, conversion: null };
    const clone = structuredClone(json);
    clone.buffers = (clone.buffers || []).map((buffer, index) =>
      index === 0 && !buffer.uri ? { ...buffer, uri: '__glb_bin__' } : buffer,
    );
    return {
      bytes: packGltf(clone, (uri) =>
        uri === '__glb_bin__' ? bin : required(loaded.resources?.(uri), uri),
      ),
      conversion: 'GLB con recursos externos empaquetado en un único GLB (sin pérdida).',
    };
  }
  if (format === 'gltf')
    return {
      bytes: packGltf(JSON.parse(loaded.bytes.toString('utf8')), (uri) =>
        required(loaded.resources?.(uri), uri),
      ),
      conversion:
        'glTF + buffers + texturas → GLB sin pérdida (geometría, UV, materiales y texturas intactos).',
    };
  if (format === 'obj')
    return {
      bytes: objToGlb(loaded.bytes.toString('utf8'), (uri) => loaded.resources?.(uri) || null),
      conversion: 'OBJ/MTL → GLB (geometría, UV, normales y material base; escala original).',
    };
  throw new Error(
    `Formato ${format.toUpperCase()} sin conversión automática segura; requiere una herramienta externa.`,
  );
}

export async function runPipeline({
  adapters,
  thumbnails = true,
  log = console.log,
  label = 'recopilación',
}) {
  const config = readJson(path.join(ROOT, 'tools', 'sources', 'sources.config.json'), {});
  const requested = (
    readJson(path.join(DIRS.catalog, 'requested-vehicles.json'), {}).vehicles || []
  ).map((vehicle) => ({
    ...vehicle,
    key: `${slug(vehicle.brand)}:${slug(vehicle.model)}`,
  }));
  const catalog = loadCatalog();
  const report = createReport(label);
  const githubThrottle = throttle(1200);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ctx = {
    config,
    requested,
    log,
    wait: sleep,
    note: (text) => report.notes.push(text),
    security: (text) => report.security.push(text),
    problem: (text) => report.problems.push(text),
    fetchText: (url, options) => fetchText(url, options),
    fetchJson: (url, options) => fetchJson(url, options),
    fetchBuffer: async (url, options) => {
      const { buffer } = await fetchBuffer(url, options);
      report.transferredBytes += buffer.length;
      return buffer;
    },
    // Los paquetes se descargan una sola vez: las ejecuciones siguientes usan cache/.
    cachedDownload: async (url, folder) => {
      const target = path.join(DIRS.cache, folder, path.basename(new URL(url).pathname));
      if (fs.existsSync(target)) {
        report.notes.push(
          `Paquete reutilizado desde cache/ sin descargar: ${path.basename(target)}`,
        );
        return fs.readFileSync(target);
      }
      const { buffer } = await fetchBuffer(url, { maxBytes: 300_000_000 });
      report.transferredBytes += buffer.length;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      return buffer;
    },
    githubApi: async (endpoint) => {
      await githubThrottle();
      const token = process.env.GITHUB_TOKEN;
      report.githubApiCalls++;
      return fetchJson(`https://api.github.com${endpoint}`, {
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    },
  };
  const summaries = [];
  const newModels = [];
  for (const adapter of adapters) {
    const source = { adapter: adapter.id, name: adapter.label, status: 'OK', found: 0, stored: 0 };
    report.sources.push(source);
    let candidates = [];
    try {
      log(`→ ${adapter.label}`);
      candidates = await adapter.discover(ctx);
    } catch (error) {
      source.status = 'ERROR';
      source.error = error.message;
      report.problems.push(`${adapter.label}: ${error.message}`);
      continue;
    }
    for (const candidate of candidates) {
      const entry = {
        title: candidate.title,
        source: candidate.sourceName,
        url: candidate.url,
        originalPath: candidate.originalPath,
        license:
          candidate.licenses?.map((l) => l.spdx).join(' AND ') ||
          candidate.licenseLabel ||
          'sin licencia declarada',
      };
      const summary = { ...candidate, licenseLabel: entry.license };
      summaries.push(summary);
      if (candidate.status === 'NOT_VEHICLE') {
        report.add('notVehicle', { ...entry, reason: candidate.reason });
        summary.outcome = 'NOT_VEHICLE';
        continue;
      }
      source.found++;
      report.counts.found++;
      try {
        if (candidate.status === 'INVALID') {
          report.add('invalid', {
            ...entry,
            issues: [candidate.reason || 'Sin archivo publicado.'],
          });
          summary.outcome = 'INVALID';
          summary.reason = candidate.reason;
          continue;
        }
        if (candidate.status === 'PENDING_CREDENTIALS') {
          report.add('pendingCredentials', { ...entry, reason: candidate.reason });
          summary.outcome = 'PENDING_CREDENTIALS';
          summary.reason = candidate.reason;
          continue;
        }
        const verdict =
          candidate.status === 'REVIEW' || candidate.status === 'DENY'
            ? { decision: candidate.status, reason: candidate.reason }
            : evaluateLicenses(candidate.licenses);
        if (verdict.decision !== 'ALLOW') {
          const reason =
            candidate.reason && candidate.status !== verdict.decision
              ? `${verdict.reason} ${candidate.reason}`
              : verdict.reason;
          report.add('discardedLicense', { ...entry, decision: verdict.decision, reason });
          summary.outcome = 'DISCARDED_LICENSE';
          summary.reason = reason;
          continue;
        }
        const existing = findBySource(catalog, candidate.key);
        if (existing) {
          report.add('alreadyLocal', { ...entry, id: existing.id });
          summary.outcome = 'LOCAL';
          continue;
        }
        log(`  · ${candidate.sourceName}: ${candidate.title}`);
        const loaded = await candidate.load();
        const { bytes, conversion } = toGlb(candidate.originalFormat, loaded);
        if (bytes.length > MAX_MODEL_BYTES)
          throw new Error(`El modelo supera ${MAX_MODEL_BYTES / 1e6} MB.`);
        const analysis = analyzeGlb(bytes);
        if (analysis.issues.length) {
          report.add('invalid', { ...entry, issues: analysis.issues });
          summary.outcome = 'INVALID';
          continue;
        }
        const lods = {};
        for (const [level, lod] of Object.entries(loaded.lods || {})) {
          const converted = toGlb(candidate.originalFormat, lod).bytes;
          const check = analyzeGlb(converted);
          if (check.issues.length)
            report.problems.push(
              `${candidate.title}: nivel ${level} descartado (${check.issues[0]}).`,
            );
          else lods[level] = converted;
        }
        if (analysis.stats.triangles > HIGH_POLY)
          report.notes.push(
            `${candidate.title}: ${analysis.stats.triangles} triángulos; se conserva en alta calidad sin simplificar automáticamente.`,
          );
        const stored = storeModel(catalog, {
          glb: bytes,
          lods,
          analysis,
          meta: {
            ...candidate.meta,
            licenses: evaluateLicenses(candidate.licenses).licenses,
            author: candidate.author,
            attribution: candidate.attribution,
            originalFormat: candidate.originalFormat,
            conversion,
            source: {
              key: candidate.key,
              name: candidate.sourceName,
              adapter: candidate.adapter,
              url: candidate.url,
              downloadUrl: candidate.downloadUrl || null,
              originalPath: candidate.originalPath || null,
              downloadedAt: new Date().toISOString(),
              licenseEvidence: candidate.licenses.map((l) => l.evidence),
            },
          },
        });
        if (stored.duplicate) {
          report.add('duplicates', { ...entry, sameAs: stored.model.id });
          summary.outcome = 'DUPLICATE';
        } else {
          // Un archivo restaurado (borrado o dañado) cuenta como descargado, no como modelo nuevo.
          report.add('downloaded', {
            ...entry,
            id: stored.model.id,
            category: stored.model.category,
            sizeBytes: stored.model.sizeBytes,
            triangles: stored.model.triangles,
            lod: Object.keys(stored.model.lod),
            ...(stored.restored ? { restored: true } : {}),
          });
          if (!stored.restored) newModels.push(stored.model);
          source.stored++;
          summary.outcome = 'STORED';
        }
      } catch (error) {
        report.add('errors', { ...entry, error: error.message });
        summary.outcome = 'ERROR';
        summary.reason = error.message;
        log(`  ! ${candidate.title}: ${error.message}`);
      }
    }
  }
  if (thumbnails) {
    const missing = catalog.models.filter(
      (model) =>
        modelPresent(model) &&
        (!model.thumbnail || !fs.existsSync(path.join(ROOT, model.thumbnail))),
    );
    if (missing.length) {
      log(`→ Miniaturas (${missing.length})`);
      const result = await renderThumbnails(missing, { log });
      report.thumbnails = result;
      if (result.skipped) report.problems.push(result.skipped);
    }
  }
  // Una ejecución parcial (una fuente o la bandeja local) conserva lo conocido de las demás:
  // estado de cada fuente y candidatos de los vehículos solicitados.
  const ran = new Set(adapters.map((adapter) => adapter.id));
  const previous = readJson(path.join(DIRS.catalog, 'sources.json'), {});
  const keep = (list) => (Array.isArray(list) ? list : []).filter((item) => !ran.has(item.adapter));
  const sources = [
    ...keep(previous.sources),
    ...report.sources.map((source) => ({ ...source, lastRun: report.startedAt })),
  ];
  const candidates = [
    ...keep(previous.candidates),
    ...summaries
      .filter((summary) => summary.requestKey)
      .map((s) => ({
        adapter: s.adapter,
        requestKey: s.requestKey,
        sourceName: s.sourceName,
        title: s.title,
        url: s.url,
        author: s.author || '',
        licenseLabel: s.licenseLabel,
        outcome: s.outcome,
        reason: s.reason || null,
      })),
  ];
  saveCatalog(catalog, { requested, sources, candidates });
  writeReport(report, loadCatalog(), requested, candidates);
  return report;
}
