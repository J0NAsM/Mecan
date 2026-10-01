// Copies the exact Three.js release used by the 3D diagnosis into public/vendor/three.
// The browser loads it from /assets like app.js: no CDN, no import map (CSP forbids inline
// scripts) and nothing to download while the workshop is running offline.
import fs from 'node:fs';
import path from 'node:path';

const expected = '0.160.0';
const source = path.resolve('node_modules/three');
const packageFile = path.join(source, 'package.json');
const version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version;
if (version !== expected)
  throw new Error(`Se esperaba three@${expected} y está instalado ${version}.`);
const target = path.resolve('public/vendor/three');
const addons = [
  'controls/OrbitControls.js',
  'environments/RoomEnvironment.js',
  'loaders/GLTFLoader.js',
  'utils/BufferGeometryUtils.js',
];
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'addons'), { recursive: true });
fs.copyFileSync(
  path.join(source, 'build/three.module.min.js'),
  path.join(target, 'three.module.min.js'),
);
for (const addon of addons) {
  const destination = path.join(target, 'addons', addon);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const relative = path
    .relative(path.dirname(destination), path.join(target, 'three.module.min.js'))
    .replaceAll('\\', '/');
  const code = fs.readFileSync(path.join(source, 'examples/jsm', addon), 'utf8');
  if (!code.includes("from 'three'"))
    throw new Error('Formato de importación inesperado: ' + addon);
  fs.writeFileSync(destination, code.replaceAll("from 'three'", `from '${relative}'`));
}
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
fs.writeFileSync(
  path.join(target, 'VERSION.json'),
  JSON.stringify({ package: 'three', version, addons }, null, 2) + '\n',
);
console.log(`Three.js ${version} copiado en public/vendor/three (${addons.length} complementos).`);
