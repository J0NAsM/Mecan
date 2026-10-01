import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { slugify } from '../utils.js';
import { logger } from '../logger.js';

// Read-only access to the local model library «Mecan 1.1 Offline». It never performs network
// requests: a model that is not on disk is reported as 3D_NOT_AVAILABLE and the workshop keeps
// working with the parametric 3D body used for the diagnosis.
export const NOT_AVAILABLE = '3D_NOT_AVAILABLE';
const validId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,119}$/.test(value);
let cached = { key: null, catalog: null };

export const libraryRoot = (root = config.modelLibraryPath) => path.resolve(root);

// A missing file is normal (no library yet); an unreadable one is logged and treated as absent,
// never as an empty catalog and never as a server error.
function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text.replace(/^﻿/, ''));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // reported below
  }
  logger.warn('model_catalog_unreadable', { file: path.basename(file) });
  return null;
}
const list = (value) => (Array.isArray(value) ? value : []);
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const target = path.resolve(root, relative);
  return target.startsWith(root + path.sep) ? target : null;
}

export function loadModelCatalog(root = libraryRoot()) {
  const file = path.join(root, 'catalog', 'models.json');
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { root, available: false, models: [], vehicles: [], licenses: [] };
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (cached.key === key) return cached.catalog;
  const data = readJson(file);
  if (!data) {
    const unreadable = {
      root,
      available: false,
      unreadable: true,
      models: [],
      vehicles: [],
      licenses: [],
    };
    cached = { key, catalog: unreadable };
    return unreadable;
  }
  const models = list(data.models)
    .filter(
      (entry) =>
        validId(entry?.id) &&
        entry.format === 'glb' &&
        entry.validation?.status === 'VALID' &&
        /^[a-f0-9]{64}$/.test(entry.sha256 || ''),
    )
    .map((entry) => ({
      ...entry,
      absolute: inside(root, entry.file),
      thumbnailAbsolute: inside(root, entry.thumbnail),
    }))
    .filter((entry) => entry.absolute);
  const catalog = {
    root,
    available: true,
    generatedAt: data.generatedAt || null,
    models,
    vehicles: list(readJson(path.join(root, 'catalog', 'vehicles.json'))?.vehicles),
    licenses: list(readJson(path.join(root, 'catalog', 'licenses.json'))?.licenses),
  };
  cached = { key, catalog };
  return catalog;
}

const present = (entry) => {
  try {
    return fs.statSync(entry.absolute).isFile();
  } catch {
    return false;
  }
};

export function modelEntry(id, catalog = loadModelCatalog()) {
  if (!validId(id)) return null;
  const entry = catalog.models.find((model) => model.id === id);
  return entry && present(entry) ? entry : null;
}

export function publicModel(entry) {
  const version = entry.sha256.slice(0, 12);
  return {
    id: entry.id,
    brand: entry.brand,
    model: entry.model,
    version: entry.version || '',
    year: entry.year || null,
    category: entry.category,
    vehicleType: entry.vehicleType || '',
    generic: Boolean(entry.generic),
    license: entry.license,
    author: entry.author,
    attribution: entry.attribution || '',
    sourceUrl: entry.sources?.[0]?.url || '',
    triangles: entry.triangles ?? null,
    sizeBytes: entry.sizeBytes ?? null,
    dimensions: entry.dimensions || null,
    url: `/workshop/models3d/${entry.id}/model.glb?v=${version}`,
    thumbnail:
      entry.thumbnailAbsolute && fs.existsSync(entry.thumbnailAbsolute)
        ? `/workshop/models3d/${entry.id}/thumbnail.webp?v=${version}`
        : null,
  };
}

const categoryForBody = (bodyType) =>
  ({
    SUV: 'suv',
    CROSSOVER: 'suv',
    VAN: 'vans',
    MINIVAN: 'vans',
    HATCHBACK: 'cars',
    COUPE: 'cars',
    CONVERTIBLE: 'cars',
    WAGON: 'cars',
  })[bodyType] || null;

// Exact make/model/year first, then the same make/model in another year. Generic models are only
// suggestions and are always labelled as such: they never stand in for a real make or model.
export function resolveVehicleModel(vehicle, catalog = loadModelCatalog()) {
  const available = catalog.models.filter(present);
  const assigned = vehicle.model3dId
    ? available.find((entry) => entry.id === vehicle.model3dId)
    : null;
  let status = NOT_AVAILABLE,
    match = null;
  if (assigned) {
    status = 'ASSIGNED';
    match = assigned;
  } else {
    const brand = slugify(vehicle.make),
      name = slugify(vehicle.model);
    const same = available.filter(
      (entry) =>
        !entry.generic &&
        brand &&
        name &&
        slugify(entry.brand) === brand &&
        slugify(entry.model) === name,
    );
    const exact = vehicle.year
      ? same.find((entry) => Number(entry.year) === Number(vehicle.year))
      : null;
    if (exact) {
      status = 'EXACT';
      match = exact;
    } else if (same.length) {
      status = 'VARIANT';
      const year = Number(vehicle.year || 0);
      match = [...same].sort(
        (a, b) => Math.abs(Number(a.year || 0) - year) - Math.abs(Number(b.year || 0) - year),
      )[0];
    }
  }
  const category = categoryForBody(vehicle.bodyType);
  return {
    status,
    libraryAvailable: catalog.available,
    model: match ? publicModel(match) : null,
    generic: available
      .filter((entry) => entry.generic && (!category || entry.category === category))
      .slice(0, 8)
      .map(publicModel),
  };
}

export function modelOptions(catalog = loadModelCatalog()) {
  return catalog.models
    .filter(present)
    .map((entry) => [
      entry.id,
      `${entry.generic ? 'Genérico' : entry.brand} · ${entry.model}${entry.year ? ` ${entry.year}` : ''}${entry.version ? ` (${entry.version})` : ''}`,
    ]);
}
