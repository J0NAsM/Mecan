// Conversión manual y local a GLB: node tools/converter/convert.js <entrada.gltf|.obj|.glb> <salida.glb>
// Solo convierte y valida; para incorporarlo al catálogo usa la bandeja custom (con su licencia).
import fs from 'node:fs';
import path from 'node:path';
import { toGlb } from '../lib/pipeline.js';
import { analyzeGlb } from '../lib/gltf.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node tools/converter/convert.js <entrada> <salida.glb>');
  process.exit(2);
}
const folder = path.dirname(path.resolve(input));
const resources = (uri) => {
  const target = path.resolve(folder, decodeURIComponent(uri));
  return target.startsWith(folder + path.sep) && fs.existsSync(target)
    ? fs.readFileSync(target)
    : null;
};
const format = path.extname(input).slice(1).toLowerCase();
const { bytes, conversion } = toGlb(format, { bytes: fs.readFileSync(input), resources });
const analysis = analyzeGlb(bytes);
if (analysis.issues.length) {
  console.error('El resultado no es válido:\n- ' + analysis.issues.join('\n- '));
  process.exit(1);
}
fs.writeFileSync(output, bytes);
console.log(
  `${conversion || 'Sin cambios (ya era GLB autocontenido).'} ${analysis.stats.triangles} triángulos → ${output}`,
);
