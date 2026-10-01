// Informe de cada ejecución: catalog/report.json (máquina) e INFORME.md (personas).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, CATEGORIES, writeJson } from './paths.js';
import { modelPresent, NOT_AVAILABLE } from './catalog.js';

const KINDS = [
  'downloaded',
  'alreadyLocal',
  'discardedLicense',
  'pendingCredentials',
  'duplicates',
  'invalid',
  'errors',
  'notVehicle',
];

export function createReport(label) {
  const report = {
    label,
    startedAt: new Date().toISOString(),
    counts: Object.fromEntries([['found', 0], ...KINDS.map((kind) => [kind, 0])]),
    lists: Object.fromEntries(KINDS.map((kind) => [kind, []])),
    sources: [],
    notes: [],
    security: [],
    problems: [],
    transferredBytes: 0,
    githubApiCalls: 0,
    add(kind, item) {
      report.lists[kind].push(item);
      report.counts[kind]++;
    },
  };
  return report;
}

function folderSize(folder) {
  if (!fs.existsSync(folder)) return 0;
  return fs.readdirSync(folder, { withFileTypes: true }).reduce((total, entry) => {
    const target = path.join(folder, entry.name);
    return total + (entry.isDirectory() ? folderSize(target) : fs.statSync(target).size);
  }, 0);
}
const OUTCOMES = {
  PENDING_CREDENTIALS: 'licencia admitida, descarga pendiente de token',
  DISCARDED_LICENSE: 'descartado por licencia',
  STORED: 'incorporado',
  LOCAL: 'ya local',
  ERROR: 'error',
  INVALID: 'inválido',
  DUPLICATE: 'duplicado',
};
const CATEGORY_LABELS = {
  cars: 'Automóviles',
  motorcycles: 'Motocicletas',
  trucks: 'Camiones',
  buses: 'Ómnibus',
  vans: 'Furgonetas',
  pickups: 'Pickups',
  suv: 'SUV',
  other: 'Otros',
};
const mb = (bytes) => `${(bytes / 1_048_576).toFixed(2)} MB`;
const cell = (value) =>
  String(value ?? '—')
    .replaceAll('|', '\\|')
    .replace(/\s+/g, ' ');
const table = (headers, rows) =>
  rows.length
    ? [
        `| ${headers.join(' | ')} |`,
        `|${headers.map(() => '---').join('|')}|`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n')
    : '_Ninguno._';

export function writeReport(report, catalog, requested, summaries) {
  report.finishedAt = new Date().toISOString();
  const models = catalog.models.filter(modelPresent);
  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => [category, models.filter((m) => m.category === category).length]),
  );
  const brands = [...new Set(models.filter((m) => !m.generic).map((m) => m.brand))];
  const formats = {};
  for (const model of models)
    formats[model.originalFormat || 'glb'] = (formats[model.originalFormat || 'glb'] || 0) + 1;
  const sourcesUsed = {};
  for (const model of models)
    for (const source of model.sources)
      sourcesUsed[source.name] = (sourcesUsed[source.name] || 0) + 1;
  const licenses = {};
  for (const model of models) licenses[model.license] = (licenses[model.license] || 0) + 1;
  const sizes = {
    models: folderSize(DIRS.models),
    thumbnails: folderSize(DIRS.thumbnails),
    catalog: folderSize(DIRS.catalog),
  };
  const available = new Set(
    models
      .filter((m) => !m.generic)
      .map((m) => `${m.brand.toLowerCase()}|${m.model.toLowerCase()}`),
  );
  const notObtained = requested
    .filter(
      (vehicle) => !available.has(`${vehicle.brand.toLowerCase()}|${vehicle.model.toLowerCase()}`),
    )
    .map((vehicle) => ({
      vehicle: `${vehicle.brand} ${vehicle.model}`,
      status: NOT_AVAILABLE,
      candidates: summaries
        .filter((s) => s.requestKey === vehicle.key)
        .map(
          (s) =>
            `${s.sourceName}: «${s.title}» (${s.licenseLabel}) → ${OUTCOMES[s.outcome] || s.outcome}`,
        ),
    }));
  const lodModels = models.filter((m) => Object.keys(m.lod || {}).length > 1);
  const json = {
    label: report.label,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    run: report.counts,
    catalog: {
      models: models.length,
      genericModels: models.filter((m) => m.generic).length,
      brandedModels: models.length - models.filter((m) => m.generic).length,
      brands: brands.length,
      byCategory,
      formats: {
        stored: {
          glb: models.length,
          lodFiles: lodModels.reduce((n, m) => n + Object.keys(m.lod).length - 1, 0),
        },
        original: formats,
      },
      licenses,
      sourcesUsed,
      sizeBytes: sizes,
      totalBytes: sizes.models + sizes.thumbnails + sizes.catalog,
      withThumbnail: models.filter((m) => m.thumbnail).length,
    },
    lists: report.lists,
    notObtained,
    sources: report.sources,
    security: report.security,
    notes: report.notes,
    problems: report.problems,
    transferredBytes: report.transferredBytes,
    githubApiCalls: report.githubApiCalls,
    thumbnails: report.thumbnails || null,
  };
  // El informe anterior se archiva: una ejecución parcial no borra el de la recopilación completa.
  const current = path.join(DIRS.catalog, 'report.json');
  if (fs.existsSync(current)) {
    const history = path.join(DIRS.catalog, 'history');
    fs.mkdirSync(history, { recursive: true });
    const previous = JSON.parse(fs.readFileSync(current, 'utf8'));
    const stamp = String(previous.startedAt || Date.now()).replace(/[:.]/g, '-');
    fs.renameSync(current, path.join(history, `report-${stamp}.json`));
  }
  writeJson(current, json);
  const c = report.counts;
  const markdown = `# Informe de la biblioteca 3D — Mecan 1.1 Offline

Ejecución: **${report.label}** · inicio ${report.startedAt} · fin ${report.finishedAt}.
Este informe se regenera en cada ejecución (\`catalog/report.json\` contiene el detalle completo).

## Resultado de esta ejecución

| Indicador | Cantidad |
|---|---|
| Modelos de vehículos encontrados | ${c.found} |
| Descargados e incorporados | ${c.downloaded} |
| Ya disponibles localmente (no se volvieron a descargar) | ${c.alreadyLocal} |
| Descartados por licencia (incluye revisión manual) | ${c.discardedLicense} |
| Con licencia admitida pero pendientes de credencial | ${c.pendingCredentials} |
| Duplicados detectados por SHA-256 | ${c.duplicates} |
| Inválidos | ${c.invalid} |
| Errores de descarga o conversión | ${c.errors} |
| Elementos no vehiculares ignorados (pistas, piezas, accesorios) | ${c.notVehicle} |
| Datos transferidos | ${mb(report.transferredBytes)} |

## Catálogo local

| Indicador | Valor |
|---|---|
| Modelos descargados en total (todas las ejecuciones) | ${models.length} |
| Modelos en el catálogo | ${models.length} (${json.catalog.genericModels} genéricos, ${json.catalog.brandedModels} de marca) |
| Marcas | ${brands.length}${brands.length ? ` (${brands.join(', ')})` : ''} |
| Tamaño total ocupado | ${mb(json.catalog.totalBytes)} (modelos ${mb(sizes.models)}, miniaturas ${mb(sizes.thumbnails)}, catálogo ${mb(sizes.catalog)}) |
| Formato interno | GLB (${models.length} principales + ${json.catalog.formats.stored.lodFiles} niveles de detalle adicionales) |
| Formatos de origen | ${
    Object.entries(formats)
      .map(([f, n]) => `${f.toUpperCase()}: ${n}`)
      .join(', ') || '—'
  } |
| Con miniatura | ${json.catalog.withThumbnail} |

### Modelos por categoría

${table(
  ['Carpeta', 'Categoría', 'Modelos'],
  Object.entries(byCategory).map(([key, count]) => [key, CATEGORY_LABELS[key], count]),
)}

### Fuentes utilizadas

${table(['Fuente', 'Modelos'], Object.entries(sourcesUsed))}

### Licencias

${table(['Licencia', 'Modelos'], Object.entries(licenses))}

## Modelos incorporados en esta ejecución

${table(
  ['Modelo', 'Fuente', 'Categoría', 'Licencia', 'Triángulos', 'LOD'],
  report.lists.downloaded.map((d) => [
    d.title,
    d.source,
    d.category,
    d.license,
    d.triangles,
    d.lod.join('/'),
  ]),
)}

## Descartados por licencia

${table(
  ['Modelo', 'Fuente', 'Licencia', 'Motivo'],
  report.lists.discardedLicense.map((d) => [d.title, d.source, d.license, d.reason]),
)}

## Pendientes de credencial

${table(
  ['Modelo', 'Fuente', 'Licencia', 'Motivo'],
  report.lists.pendingCredentials.map((d) => [d.title, d.source, d.license, d.reason]),
)}

## Duplicados

${table(
  ['Modelo', 'Fuente', 'Misma copia que'],
  report.lists.duplicates.map((d) => [d.title, d.source, d.sameAs]),
)}

## Inválidos y errores

${table(['Modelo', 'Fuente', 'Detalle'], [...report.lists.invalid.map((d) => [d.title, d.source, d.issues.join('; ')]), ...report.lists.errors.map((d) => [d.title, d.source, d.error])])}

## Vehículos que no pudieron conseguirse (${NOT_AVAILABLE})

${table(
  ['Vehículo', 'Estado', 'Candidatos encontrados'],
  notObtained.map((n) => [
    n.vehicle,
    n.status,
    n.candidates.length
      ? n.candidates.slice(0, 3).join(' · ') +
        (n.candidates.length > 3
          ? ` · y ${n.candidates.length - 3} más (ver catalog/report.json)`
          : '')
      : 'Ningún modelo encontrado en las fuentes',
  ]),
)}

## Seguridad

${[...report.security, 'Ningún archivo descargado se ejecuta: solo se leen bytes, se validan firma, estructura glTF, límites de tamaño y recursos embebidos.'].map((s) => `- ${s}`).join('\n')}

## Observaciones y problemas

${[...report.problems, ...report.notes].map((s) => `- ${s}`).join('\n') || '- Sin observaciones.'}
`;
  fs.writeFileSync(path.join(ROOT, 'INFORME.md'), markdown);
  return json;
}
