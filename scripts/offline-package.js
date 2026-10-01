// Arma la distribución portátil «Mecan 1.1 Offline»: una carpeta que se copia completa a otra PC
// con Windows y funciona sin internet. Incluye la aplicación, sus dependencias de producción,
// Node, PostgreSQL y la biblioteca local de modelos 3D. Nunca copia .env, datos ni respaldos.
//   npm run offline:package [-- --no-runtime]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const target = path.join(repo, 'Mecan 1.1 Offline');
const app = path.join(target, 'app');
const withRuntime = !process.argv.includes('--no-runtime');
if (!fs.existsSync(path.join(target, 'tools', 'launcher', 'start.js')))
  throw new Error('No se encontró la carpeta «Mecan 1.1 Offline» con su lanzador.');
if (!fs.existsSync('public/vendor/three/three.module.min.js'))
  throw new Error('Falta Three.js local: ejecuta npm run vendor:three.');

const copy = (from, to, filter = () => true) =>
  fs.cpSync(from, to, { recursive: true, filter: (source) => filter(source), dereference: true });
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
for (const entry of ['src', 'public', 'scripts'])
  copy(
    path.join(repo, entry),
    path.join(app, entry),
    (source) => !source.includes(`${path.sep}.runtime`),
  );
for (const file of ['package.json', 'package-lock.json', 'README.md', '.env.example'])
  fs.copyFileSync(path.join(repo, file), path.join(app, file));

// Solo dependencias de producción, tomadas del lockfile (sin descargar nada).
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
let modules = 0;
for (const [name, meta] of Object.entries(lock.packages || {})) {
  if (!name.startsWith('node_modules/') || meta.dev) continue;
  const source = path.join(repo, name);
  if (!fs.existsSync(source)) throw new Error(`Falta ${name}: ejecuta npm ci antes de empaquetar.`);
  copy(
    source,
    path.join(app, name),
    (file) => !file.slice(source.length).includes(`${path.sep}node_modules${path.sep}`),
  );
  modules++;
}

let runtime = 'no incluido (--no-runtime)';
const vcRuntime = [];
if (withRuntime) {
  const node = path.join(target, 'runtime', 'node');
  fs.mkdirSync(node, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(node, path.basename(process.execPath)));
  const pgRoot = [
    process.env.POSTGRES_BIN_PATH && path.dirname(process.env.POSTGRES_BIN_PATH),
    path.join(repo, '.runtime', 'postgresql', '18.6', 'pgsql'),
  ].find(
    (folder) =>
      folder &&
      fs.existsSync(
        path.join(folder, 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'),
      ),
  );
  if (!pgRoot)
    throw new Error(
      'No se encontraron binarios de PostgreSQL (POSTGRES_BIN_PATH o .runtime/postgresql).',
    );
  const pg = path.join(target, 'runtime', 'pgsql');
  fs.rmSync(pg, { recursive: true, force: true });
  for (const folder of ['bin', 'lib', 'share'])
    copy(path.join(pgRoot, folder), path.join(pg, folder));
  for (const file of fs
    .readdirSync(pgRoot)
    .filter((name) => /license/i.test(name) && name.endsWith('.txt')))
    fs.copyFileSync(path.join(pgRoot, file), path.join(pg, file));
  // PostgreSQL para Windows depende del runtime de Visual C++ 2015-2022 (x64). Se despliega junto
  // a los binarios (instalación «app-local» que admite Microsoft) para que la carpeta funcione en
  // una PC que no tenga instalado el Redistributable.
  if (process.platform === 'win32') {
    const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
      const bundled = path.join(pg, 'bin', dll);
      if (fs.existsSync(bundled)) continue;
      if (!fs.existsSync(path.join(system, dll)))
        throw new Error(
          `Falta ${dll}: instala «Microsoft Visual C++ 2015-2022 Redistributable (x64)» en esta PC y vuelve a empaquetar.`,
        );
      fs.copyFileSync(path.join(system, dll), bundled);
      vcRuntime.push(dll);
    }
  }
  const version = execFileSync(
    path.join(pg, 'bin', process.platform === 'win32' ? 'postgres.exe' : 'postgres'),
    ['--version'],
  )
    .toString()
    .trim();
  runtime = `Node ${process.version} · ${version}`;
}
const launcher = (title, extra) =>
  [
    '@echo off',
    `title ${title}`,
    'cd /d "%~dp0"',
    'if exist "runtime\\node\\node.exe" (',
    `  "runtime\\node\\node.exe" "tools\\launcher\\start.js" ${extra}`,
    ') else (',
    `  node "tools\\launcher\\start.js" ${extra}`,
    ')',
    'pause',
    '',
  ].join('\r\n');
fs.writeFileSync(
  path.join(target, 'Iniciar Mecan 1.1 Offline.cmd'),
  launcher('Mecan 1.1 Offline', '%*'),
);
fs.writeFileSync(
  path.join(target, 'Respaldar Mecan 1.1 Offline.cmd'),
  launcher('Respaldo de Mecan 1.1 Offline', '--backup'),
);

// Huella del contenido empaquetado: permite comprobar si app/ corresponde al código del repositorio.
const contentHash = crypto.createHash('sha256');
function walk(folder) {
  const entries = fs
    .readdirSync(folder, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      contentHash.update(path.relative(app, full).split(path.sep).join('/'));
      contentHash.update(fs.readFileSync(full));
    }
  }
}
for (const entry of ['src', 'public', 'scripts']) walk(path.join(app, entry));
let revision = 'NO DETERMINADO',
  modifiedFiles = [];
try {
  revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
  modifiedFiles = execFileSync('git', ['status', '--porcelain', '--', 'src', 'public', 'scripts'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .split(/\r?\n/)
    .filter(Boolean);
} catch {}
fs.writeFileSync(
  path.join(app, 'OFFLINE-BUILD.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      baseRevision: revision,
      contentSha256: contentHash.digest('hex'),
      uncommittedChanges: modifiedFiles,
      runtime,
      vcRuntimeBundled: vcRuntime,
      productionModules: modules,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Paquete listo en «Mecan 1.1 Offline»: app (${modules} módulos de producción) · runtime: ${runtime}`,
);
// data/ es la información de ESTA copia (base, adjuntos, claves). Para entregar una copia nueva a
// otro taller se copia la carpeta sin data/; para mudar una instalación se copia con data/.
if (fs.existsSync(path.join(target, 'data')))
  console.log(
    '  Atención: existe data/ (base y claves de esta copia). No la incluyas al entregar una copia nueva.',
  );
