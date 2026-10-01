// Catálogo local: una sola copia física por contenido (SHA-256) y todas sus fuentes registradas.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS, ROOT, readJson, writeJson, slug, CATEGORIES } from './paths.js';

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export const NOT_AVAILABLE = '3D_NOT_AVAILABLE';
const file = (name) => path.join(DIRS.catalog, name);

export function loadCatalog() {
  const models = readJson(file('models.json'), {}).models || [];
  return {
    models,
    bySha: new Map(models.map((model) => [model.sha256, model])),
    byId: new Map(models.map((model) => [model.id, model])),
  };
}

export const modelPresent = (model) => {
  try {
    return fs.statSync(path.join(ROOT, model.file)).isFile();
  } catch {
    return false;
  }
};

// Un modelo ya descargado desde esta fuente nunca se vuelve a pedir a internet, salvo que su
// archivo falte o el validador lo haya marcado INVALID: entonces se recupera de la fuente.
export const findBySource = (catalog, key) =>
  catalog.models.find(
    (model) =>
      model.sources?.some((source) => source.key === key) &&
      model.validation?.status === 'VALID' &&
      modelPresent(model),
  );

function attributionText(model) {
  const licenses = model.licenses.map((l) => `${l.spdx} — ${l.name} (${l.url})`).join('\n');
  return [
    `${model.generic ? 'Modelo genérico' : `${model.brand} ${model.model}`}${model.year ? ` ${model.year}` : ''}`,
    `Versión/origen: ${model.version || '—'}`,
    `Autor: ${model.author}`,
    `Licencia(s):\n${licenses}`,
    model.attribution
      ? `Atribución requerida: ${model.attribution}`
      : 'Atribución no obligatoria (se recomienda citar al autor).',
    `Fuentes:\n${model.sources.map((s) => `- ${s.name}: ${s.url}${s.originalPath ? ` (${s.originalPath})` : ''}`).join('\n')}`,
    model.conversion ? `Conversión: ${model.conversion}` : '',
    `SHA-256: ${model.sha256}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function writeModelFiles(model) {
  const folder = path.join(ROOT, path.dirname(model.file));
  fs.mkdirSync(folder, { recursive: true });
  writeJson(path.join(folder, 'metadata.json'), model);
  fs.writeFileSync(path.join(folder, 'ATTRIBUTION.txt'), attributionText(model) + '\n');
}

export function storeModel(catalog, { glb, lods = {}, meta, analysis }) {
  const hash = sha256(glb);
  const existing = catalog.bySha.get(hash);
  if (existing) {
    if (!existing.sources.some((source) => source.key === meta.source.key))
      existing.sources.push(meta.source);
    // Mismo contenido que un modelo cuyo archivo se borró o dañó: se restaura en su lugar.
    const target = path.join(ROOT, existing.file);
    const intact = modelPresent(existing) && sha256(fs.readFileSync(target)) === hash;
    if (!intact) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, glb);
      existing.validation = { status: 'VALID', checkedAt: new Date().toISOString(), issues: [] };
    }
    writeModelFiles(existing);
    return { duplicate: intact, restored: !intact, model: existing };
  }
  if (!CATEGORIES.includes(meta.category)) throw new Error(`Categoría no válida: ${meta.category}`);
  const brandSlug = meta.generic ? 'generico' : slug(meta.brand);
  const variant = meta.year ? String(meta.year) : slug(meta.version || 'sin-anio');
  let base = `models/${meta.category}/${brandSlug}/${slug(meta.model)}/${variant}`;
  let id = `${brandSlug}-${slug(meta.model)}-${variant}`.slice(0, 110);
  for (let n = 2; catalog.byId.has(id) || fs.existsSync(path.join(ROOT, base, 'model.glb')); n++) {
    base = `models/${meta.category}/${brandSlug}/${slug(meta.model)}/${variant}-${n}`;
    id = `${brandSlug}-${slug(meta.model)}-${variant}-${n}`.slice(0, 110);
  }
  const folder = path.join(ROOT, base);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'model.glb'), glb);
  const lod = { HIGH: `${base}/model.glb` };
  for (const [level, bytes] of Object.entries(lods)) {
    if (!bytes || level === 'HIGH') continue;
    fs.writeFileSync(path.join(folder, `model-${level.toLowerCase()}.glb`), bytes);
    lod[level] = `${base}/model-${level.toLowerCase()}.glb`;
  }
  const model = {
    id,
    brand: meta.generic ? 'Genérico' : meta.brand,
    generic: Boolean(meta.generic),
    model: meta.model,
    version: meta.version || null,
    year: meta.year || null,
    category: meta.category,
    vehicleType: meta.vehicleType,
    file: `${base}/model.glb`,
    format: 'glb',
    originalFormat: meta.originalFormat,
    conversion: meta.conversion || null,
    sizeBytes: glb.length,
    triangles: analysis.stats.triangles,
    vertices: analysis.stats.vertices,
    stats: analysis.stats,
    dimensions: analysis.dimensions,
    lod,
    thumbnail: null,
    thumbnailSmall: null,
    author: meta.author,
    license: [...new Set(meta.licenses.map((l) => l.spdx))].join(' AND '),
    licenses: meta.licenses,
    attribution: meta.attribution || null,
    trademarkNotice: meta.trademarkNotice || null,
    source: meta.source.name,
    url: meta.source.url,
    sources: [meta.source],
    downloadedAt: meta.source.downloadedAt,
    sha256: hash,
    validation: { status: 'VALID', checkedAt: new Date().toISOString(), issues: [] },
  };
  catalog.models.push(model);
  catalog.bySha.set(hash, model);
  catalog.byId.set(id, model);
  writeModelFiles(model);
  return { duplicate: false, model };
}

export function saveCatalog(catalog, { requested = [], sources = [], candidates = [] } = {}) {
  for (const model of catalog.models)
    model.license = [...new Set(model.licenses.map((l) => l.spdx))].join(' AND ');
  const models = [...catalog.models].sort((a, b) =>
    `${a.category}/${a.brand}/${a.model}/${a.year || ''}`.localeCompare(
      `${b.category}/${b.brand}/${b.model}/${b.year || ''}`,
    ),
  );
  const generatedAt = new Date().toISOString();
  writeJson(file('models.json'), { schemaVersion: 1, generatedAt, models });

  const brands = new Map();
  for (const model of models) {
    const key = model.generic ? 'generico' : slug(model.brand);
    const entry = brands.get(key) || {
      slug: key,
      brand: model.brand,
      generic: model.generic,
      models: 0,
      categories: [],
    };
    entry.models++;
    if (!entry.categories.includes(model.category)) entry.categories.push(model.category);
    brands.set(key, entry);
  }
  for (const vehicle of requested)
    if (!brands.has(slug(vehicle.brand)))
      brands.set(slug(vehicle.brand), {
        slug: slug(vehicle.brand),
        brand: vehicle.brand,
        generic: false,
        models: 0,
        categories: [],
        status: NOT_AVAILABLE,
      });
  writeJson(file('brands.json'), {
    generatedAt,
    brands: [...brands.values()].sort((a, b) => a.brand.localeCompare(b.brand)),
  });

  // Vehículos: los disponibles en el catálogo y los solicitados que no tienen modelo legal.
  const vehicles = new Map();
  for (const model of models) {
    const key = `${model.generic ? 'generico' : slug(model.brand)}:${slug(model.model)}`;
    const entry = vehicles.get(key) || {
      id: key.replace(':', '-'),
      brand: model.brand,
      model: model.model,
      generic: model.generic,
      category: model.category,
      vehicleType: model.vehicleType,
      years: [],
      status: 'AVAILABLE',
      models: [],
    };
    entry.models.push(model.id);
    if (model.year && !entry.years.includes(model.year)) entry.years.push(model.year);
    vehicles.set(key, entry);
  }
  for (const request of requested) {
    const key = `${slug(request.brand)}:${slug(request.model)}`;
    if (vehicles.has(key)) {
      vehicles.get(key).requested = true;
      continue;
    }
    vehicles.set(key, {
      id: key.replace(':', '-'),
      brand: request.brand,
      model: request.model,
      generic: false,
      category: request.category,
      years: request.years || [],
      status: NOT_AVAILABLE,
      requested: true,
      models: [],
      candidates: candidates
        .filter((c) => c.requestKey === key)
        .map((c) => ({
          source: c.sourceName,
          url: c.url,
          license: c.licenseLabel,
          author: c.author,
          status: c.outcome,
          reason: c.reason,
        })),
    });
  }
  writeJson(file('vehicles.json'), {
    generatedAt,
    vehicles: [...vehicles.values()].sort((a, b) =>
      `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`),
    ),
  });

  const licenses = new Map();
  // Cada modelo cuenta una vez por licencia aunque la misma figure en más de una evidencia.
  for (const model of models)
    for (const license of new Map(model.licenses.map((l) => [l.spdx, l])).values()) {
      const entry = licenses.get(license.spdx) || {
        spdx: license.spdx,
        name: license.name,
        url: license.url,
        attributionRequired: Boolean(license.attribution),
        shareAlike: Boolean(license.shareAlike),
        commercialUse: true,
        derivatives: true,
        redistributable: true,
        models: 0,
      };
      entry.models++;
      licenses.set(license.spdx, entry);
    }
  writeJson(file('licenses.json'), { generatedAt, licenses: [...licenses.values()] });
  writeJson(file('sources.json'), { generatedAt, sources, candidates });
}
