import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? javascriptFiles(target)
      : entry.isFile() && entry.name.endsWith('.js')
        ? [target]
        : [];
  });
}

const files = [
  ...javascriptFiles('src'),
  ...javascriptFiles('scripts'),
  ...javascriptFiles('public'),
  ...(fs.existsSync('movile/scripts') ? javascriptFiles('movile/scripts') : []),
  // Herramientas de la biblioteca 3D local; app/ y runtime/ son copias generadas por el paquete.
  ...(fs.existsSync('Mecan 1.1 Offline/tools') ? javascriptFiles('Mecan 1.1 Offline/tools') : []),
];
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (checked.status !== 0) process.exit(checked.status || 1);
}
for (const required of [
  'public/app.css',
  'public/app.js',
  'public/mecan.ico',
  'public/vendor/three/three.module.min.js',
  'public/diagnosis3d/studio.js',
  'README.md',
  '.env.example',
]) {
  if (!fs.existsSync(required) || !fs.statSync(required).size)
    throw new Error(`Falta un artefacto requerido: ${required}`);
}
console.log(`Build validado: ${files.length} archivos JavaScript y activos públicos.`);
