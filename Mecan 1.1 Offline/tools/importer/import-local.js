// Importa modelos dejados en tools/sources/custom/inbox/ sin conexión a internet.
import * as custom from '../sources/custom/index.js';
import { runPipeline } from '../lib/pipeline.js';

const report = await runPipeline({
  adapters: [custom],
  thumbnails: !process.argv.includes('--no-thumbnails'),
  label: 'importación local',
});
console.log(
  `Importados ${report.counts.downloaded} · en revisión o descartados ${report.counts.discardedLicense} · inválidos ${report.counts.invalid} · errores ${report.counts.errors}`,
);
