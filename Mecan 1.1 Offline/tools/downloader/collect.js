// Recopilación inicial (única fase con internet). Uso:
//   node tools/downloader/collect.js [--sources=open_assets,github,public_3d,custom] [--no-thumbnails]
// Repetirla es seguro: lo que ya está en el catálogo local no se vuelve a descargar.
import * as openAssets from '../sources/open_assets/index.js';
import * as github from '../sources/github/index.js';
import * as public3d from '../sources/public_3d/index.js';
import * as custom from '../sources/custom/index.js';
import { runPipeline } from '../lib/pipeline.js';
import { loadCatalog } from '../lib/catalog.js';

const all = [openAssets, github, public3d, custom];
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const selected = option('sources')?.split(',') || all.map((adapter) => adapter.id);
const adapters = all.filter((adapter) => selected.includes(adapter.id));
const report = await runPipeline({
  adapters,
  thumbnails: !process.argv.includes('--no-thumbnails'),
  label: loadCatalog().models.length
    ? 'recopilación incremental (lo existente no se vuelve a descargar)'
    : 'recopilación inicial',
});
const c = report.counts;
console.log(
  `\nEncontrados ${c.found} · incorporados ${c.downloaded} · ya locales ${c.alreadyLocal} · descartados por licencia ${c.discardedLicense} · pendientes de credencial ${c.pendingCredentials} · duplicados ${c.duplicates} · inválidos ${c.invalid} · errores ${c.errors}`,
);
console.log('Informe: INFORME.md y catalog/report.json');
