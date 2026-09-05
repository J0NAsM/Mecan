// Compila el APK de publicación y lo deja listo para que el servidor lo ofrezca como
// actualización. La versión vive en app/version.properties: este script es el único lugar que la
// cambia, para que el APK instalado y el manifiesto servido nunca puedan describir cosas distintas.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const versionFile = path.join(root, 'app', 'version.properties');
const releasesDir = path.join(root, 'releases');
const manifestFile = path.join(releasesDir, 'manifest.json');

function parseArguments(argv) {
  const options = { keep: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--'))
        throw new Error(`La opción ${flag} necesita un valor.`);
      index += 1;
      return next;
    };
    if (flag === '--version') options.versionName = value();
    else if (flag === '--version-code') options.versionCode = Number(value());
    else if (flag === '--bump') options.bump = true;
    else if (flag === '--notes') options.notes = value();
    else if (flag === '--server') options.server = value();
    else if (flag === '--mandatory') options.mandatory = true;
    else if (flag === '--keep') options.keep = Number(value());
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`Opción desconocida: ${flag}`);
  }
  return options;
}

const usage = `Uso: node movile/scripts/publish-release.js [opciones]

  --bump                Incrementa versionCode en uno antes de compilar.
  --version <nombre>    Fija versionName, por ejemplo 1.2.0.
  --version-code <n>    Fija versionCode explícitamente.
  --server <url>        Servidor sugerido dentro de la app (https://...).
  --notes <texto>       Texto que verá la persona en el aviso de actualización.
  --mandatory           La versión no se puede posponer desde la app.
  --keep <n>            APK anteriores que se conservan en releases/ (por omisión 3).

Publicar una versión nueva:  node movile/scripts/publish-release.js --bump --version 1.1.0`;

function readProperties(file) {
  const values = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return values;
}

function writeVersionProperties(values) {
  const body = [
    '# Fuente única de versión del APK. `node movile/scripts/publish-release.js` la incrementa.',
    `versionCode=${values.get('versionCode')}`,
    `versionName=${values.get('versionName')}`,
    `appName=${values.get('appName') ?? 'Mecan'}`,
    `defaultServerUrl=${values.get('defaultServerUrl') ?? ''}`,
    `debugServerUrl=${values.get('debugServerUrl') ?? ''}`,
    '',
  ].join('\n');
  fs.writeFileSync(versionFile, body);
}

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(usage);
  process.exit(0);
}
if (!fs.existsSync(path.join(root, 'keystore', 'signing.properties')))
  throw new Error(
    'Falta movile/keystore/signing.properties: sin la clave de firma no se puede publicar un APK actualizable.',
  );
if (options.server && !/^https:\/\/[^\s/]+/i.test(options.server))
  throw new Error(
    '--server debe ser una URL https:// pública; la app de publicación rechaza HTTP.',
  );
if (!Number.isInteger(options.keep) || options.keep < 1)
  throw new Error('--keep debe ser un entero mayor o igual a 1.');

const original = fs.readFileSync(versionFile, 'utf8');
const values = readProperties(versionFile);
if (options.bump) values.set('versionCode', String(Number(values.get('versionCode')) + 1));
if (Number.isInteger(options.versionCode)) values.set('versionCode', String(options.versionCode));
if (options.versionName) values.set('versionName', options.versionName);
if (options.server !== undefined) values.set('defaultServerUrl', options.server);

const versionCode = Number(values.get('versionCode'));
const versionName = values.get('versionName');
if (!Number.isInteger(versionCode) || versionCode < 1)
  throw new Error('versionCode debe ser un entero positivo.');
if (!/^\d+\.\d+(\.\d+)?$/.test(versionName ?? ''))
  throw new Error('versionName debe tener el formato 1.2 o 1.2.3.');

const published = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  : null;
if (published && versionCode <= published.versionCode)
  throw new Error(
    `La versión publicada es ${published.versionCode}. Usa --bump o --version-code mayor: un APK con versionCode ${versionCode} no puede instalarse sobre ella.`,
  );

writeVersionProperties(values);
// Windows no ejecuta un .bat directamente desde spawn: se invoca a través del intérprete de
// comandos, con la ruta entre comillas para tolerar espacios en el directorio del proyecto.
const windows = process.platform === 'win32';
const gradle = path.join(root, windows ? 'gradlew.bat' : 'gradlew');
// La ruta viene de la ubicación de este archivo, no de la entrada del usuario; las comillas están
// para tolerar espacios en el directorio del proyecto, no para desinfectar nada.
const build = spawnSync(`"${gradle}" assembleRelease`, {
  cwd: root,
  shell: true,
  stdio: 'inherit',
  windowsHide: true,
});
if (build.status !== 0) {
  // Una compilación fallida no debe dejar la versión adelantada respecto de lo publicado.
  fs.writeFileSync(versionFile, original);
  throw new Error(
    `La compilación del APK falló (${build.error?.message ?? `código ${build.status}`}); se restauró la versión anterior.`,
  );
}

const built = path.join(root, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(built)) {
  fs.writeFileSync(versionFile, original);
  throw new Error('Gradle terminó sin errores pero no se encontró el APK compilado.');
}

fs.mkdirSync(releasesDir, { recursive: true });
const fileName = `mecan-${versionName}-${versionCode}.apk`;
const target = path.join(releasesDir, fileName);
fs.copyFileSync(built, target);
const bytes = fs.readFileSync(target);
const manifest = {
  applicationId: 'py.softshop.mecan',
  versionCode,
  versionName,
  fileName,
  downloadUrl: `/movil/apk/${fileName}`,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  mandatory: Boolean(options.mandatory),
  notes: options.notes ?? '',
  releasedAt: new Date().toISOString(),
};
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

// Conserva las últimas versiones por si hay que volver atrás; borra las más viejas.
const previous = fs
  .readdirSync(releasesDir)
  .filter((name) => name.endsWith('.apk') && name !== fileName)
  .map((name) => ({ name, time: fs.statSync(path.join(releasesDir, name)).mtimeMs }))
  .sort((a, b) => b.time - a.time)
  .slice(options.keep - 1);
for (const stale of previous) fs.unlinkSync(path.join(releasesDir, stale.name));

console.log(`APK publicado: ${fileName}`);
console.log(`  versionCode ${versionCode} · versionName ${versionName}`);
console.log(`  ${(manifest.size / 1048576).toFixed(2)} MB · sha256 ${manifest.sha256}`);
console.log(`  manifiesto: ${path.relative(process.cwd(), manifestFile)}`);
console.log(
  manifest.mandatory
    ? '  Obligatoria: las apps instaladas no podrán posponerla.'
    : '  Opcional: la persona puede posponerla desde la app.',
);
console.log(
  'El servidor la ofrece en /movil; las apps instaladas la detectan al abrirse o al pulsar «Buscar actualizaciones».',
);
