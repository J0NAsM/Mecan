// Arranque de «Mecan 1.1 Offline» en cualquier PC con Windows, sin internet.
// Todo vive dentro de la carpeta: aplicación (app/), Node y PostgreSQL (runtime/), base de datos y
// adjuntos (data/), biblioteca 3D (models/, catalog/, thumbnails/). No instala servicios ni toca
// otras bases: si un puerto está ocupado por otro programa lo informa y se detiene.
//   Iniciar Mecan 1.1 Offline.cmd              → arranca y abre el navegador
//   Respaldar Mecan 1.1 Offline.cmd            → respaldo verificado en data/backups
//   ... start.js --check                       → arranca, verifica /health y los modelos, y se detiene
//   ... start.js --no-browser                  → arranca sin abrir el navegador
//   ... start.js --restore "data\backups\<respaldo>"
//        restaura en una base NUEVA y vacía; la base anterior se conserva sin cambios
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const APP = path.join(ROOT, 'app');
const DATA = path.join(ROOT, 'data');
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const BACKUP = args.includes('--backup');
const RESTORE = args.includes('--restore') ? args[args.indexOf('--restore') + 1] : null;
const OPEN_BROWSER = !CHECK && !BACKUP && !RESTORE && !args.includes('--no-browser');
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
// Los binarios incluidos tienen prioridad: un PostgreSQL de otra versión instalado en la PC no
// puede abrir esta base.
const pgBin = [path.join(ROOT, 'runtime', 'pgsql', 'bin'), process.env.POSTGRES_BIN_PATH].find(
  (folder) => folder && fs.existsSync(path.join(folder, exe('pg_ctl'))),
);
const say = (text) => console.log(`  ${text}`);
let startedDatabase = false;
async function fail(text) {
  console.error(`\n  ${text}\n`);
  if (startedDatabase) await stopDatabase();
  process.exit(1);
}
if (!fs.existsSync(path.join(APP, 'src', 'server.js')))
  await fail(
    'Falta la aplicación en app/. Genera el paquete con «npm run offline:package» desde el repositorio.',
  );
if (RESTORE === undefined || (args.includes('--restore') && !RESTORE))
  await fail('Indica la carpeta del respaldo: start.js --restore "data\\backups\\<respaldo>".');
if (!pgBin) await fail('Falta PostgreSQL en runtime/pgsql/bin (o POSTGRES_BIN_PATH).');
// PostgreSQL para Windows usa el runtime de Visual C++ 2015-2022 (x64). El paquete lo incluye;
// si alguien lo quitó, se avisa en lugar de fallar con un código de Windows ilegible.
if (process.platform === 'win32') {
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const missing = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].filter(
    (dll) => !fs.existsSync(path.join(pgBin, dll)) && !fs.existsSync(path.join(system, dll)),
  );
  if (missing.length)
    await fail(
      `Faltan ${missing.join(', ')}. Vuelve a copiar la carpeta completa o instala «Microsoft Visual C++ 2015-2022 Redistributable (x64)».`,
    );
}

const run = (command, commandArgs, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { windowsHide: true, stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve(code)
        : reject(
            Object.assign(new Error(`${path.basename(command)} terminó con código ${code}`), {
              code,
            }),
          ),
    );
  });
const portFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

// Configuración local de esta copia: puertos, base y credencial aleatoria (nunca se versiona).
fs.mkdirSync(DATA, { recursive: true });
const settingsFile = path.join(DATA, 'offline.json');
let settings = null;
if (fs.existsSync(settingsFile))
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    await fail(
      'data/offline.json está dañado. Restáuralo desde una copia de la carpeta data/ (contiene la clave de la base local).',
    );
  }
if (!settings) {
  settings = {
    appPort: Number(process.env.MECAN_OFFLINE_PORT || 3111),
    pgPort: Number(process.env.MECAN_OFFLINE_PG_PORT || 55451),
    dbPassword: crypto.randomBytes(24).toString('base64url'),
    adminEmail: 'admin@mecan-offline.lan',
    adminPassword: `${crypto.randomBytes(9).toString('base64url')}-A1`,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.writeFileSync(
    path.join(DATA, 'PRIMER-ACCESO.txt'),
    [
      'Mecan 1.1 Offline — acceso inicial a la consola de plataforma',
      `Usuario: ${settings.adminEmail}`,
      `Clave temporal: ${settings.adminPassword}`,
      '',
      'Cámbiala al ingresar y guarda este archivo en un lugar privado o bórralo.',
      `Para el taller: abre http://127.0.0.1:${settings.appPort}/signup y crea la cuenta del taller.`,
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
}
// Una restauración deja la base y los adjuntos restaurados como vigentes (ver --restore).
const database = settings.database || 'mecan';
if (
  !/^[a-z][a-z0-9_]{0,62}$/.test(database) ||
  !/^[\w-]{1,80}$/.test(settings.storage || 'storage')
)
  await fail('data/offline.json tiene un nombre de base o de carpeta de adjuntos no válido.');
const storage = path.join(DATA, settings.storage || 'storage');
const cluster = path.join(DATA, 'postgres');
const urlFor = (name) =>
  `postgresql://mecan:${encodeURIComponent(settings.dbPassword)}@127.0.0.1:${settings.pgPort}/${name}`;
const pgCtl = path.join(pgBin, exe('pg_ctl'));
const stopDatabase = () => run(pgCtl, ['-D', cluster, '-m', 'fast', '-w', 'stop']).catch(() => {});

console.log('\n  Mecan 1.1 Offline\n');
// Restos de un primer arranque interrumpido: la clave temporal y la base a medio crear.
for (const name of fs.readdirSync(DATA))
  if (/^init-.*\.tmp$/.test(name) || /^postgres-init-/.test(name))
    fs.rmSync(path.join(DATA, name), { recursive: true, force: true });
if (!fs.existsSync(path.join(cluster, 'PG_VERSION'))) {
  if (fs.existsSync(cluster) && fs.readdirSync(cluster).length)
    await fail(
      'data/postgres existe pero no es una base completa. Muévela a otra carpeta y vuelve a iniciar.',
    );
  say('Creando la base de datos local (primer arranque)…');
  const share = initdbShare();
  if (!share)
    await fail(
      'La carpeta está en una ruta con tildes o «ñ» y este disco no admite nombres cortos. Muévela, por ejemplo, a C:\\Mecan 1.1 Offline y vuelve a iniciar.',
    );
  // Se crea en una carpeta temporal y se renombra al terminar: un corte nunca deja una base rota.
  const building = path.join(DATA, `postgres-init-${crypto.randomUUID()}`);
  const passwordFile = path.join(DATA, `init-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(passwordFile, settings.dbPassword + '\n', { mode: 0o600 });
  let initError = null;
  try {
    await run(path.join(pgBin, exe('initdb')), [
      '-D',
      building,
      '-L',
      share.dir,
      '--username=mecan',
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
      `--pwfile=${passwordFile}`,
    ]);
    fs.rmSync(cluster, { recursive: true, force: true });
    fs.renameSync(building, cluster);
  } catch (error) {
    initError = error;
    fs.rmSync(building, { recursive: true, force: true });
  } finally {
    // La clave temporal nunca queda en disco, tampoco si initdb falla.
    fs.rmSync(passwordFile, { force: true });
    if (share.temporary) fs.rmSync(share.dir, { recursive: true, force: true });
  }
  if (initError) await fail(`No se pudo crear la base local (${initError.message}).`);
}
// initdb escribe la ruta de share/ dentro de sentencias SQL (COPY … FROM '<ruta>'): con tildes o
// «ñ» en la ruta, PostgreSQL la rechaza como UTF-8 inválido. Se usa una ruta equivalente en ASCII:
// el nombre corto de Windows o, si el disco no los tiene, una copia temporal en ProgramData.
function initdbShare() {
  const ascii = (value) => /^[\x20-\x7e]+$/.test(value || '');
  const source = path.join(path.dirname(pgBin), 'share');
  if (ascii(source)) return { dir: source };
  if (process.platform !== 'win32') return null;
  const result = spawnSync(
    process.env.COMSPEC || 'cmd.exe',
    ['/d', '/s', '/c', `for %I in ("${source}") do @echo %~sI`],
    { windowsVerbatimArguments: true, encoding: 'utf8', windowsHide: true },
  );
  const short = result.stdout?.trim();
  if (result.status === 0 && ascii(short) && fs.existsSync(path.join(short, 'postgres.bki')))
    return { dir: short };
  const base = process.env.ProgramData;
  if (!ascii(base) || !fs.existsSync(base)) return null;
  const temporary = path.join(base, `mecan-offline-initdb-${crypto.randomUUID()}`);
  fs.cpSync(source, temporary, { recursive: true });
  return { dir: temporary, temporary: true };
}
const status = await run(pgCtl, ['-D', cluster, 'status']).catch((error) => error.code);
if (status === 3) {
  if (!(await portFree(settings.pgPort)))
    await fail(
      `El puerto ${settings.pgPort} ya lo usa otro programa. Cambia pgPort en data/offline.json.`,
    );
  say('Iniciando PostgreSQL local…');
  // pg_ctl lanza el servidor desacoplado; su salida va al registro de la propia base.
  await run(pgCtl, [
    '-D',
    cluster,
    '-l',
    path.join(DATA, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${settings.pgPort}`,
    '-w',
    'start',
  ]).catch((error) => fail(`PostgreSQL no arrancó (${error.message}). Revisa data/postgres.log.`));
  startedDatabase = true;
} else if (status !== 0) await fail('No se pudo consultar el estado de PostgreSQL local.');

const pg = createRequire(path.join(APP, 'package.json'))('pg');
async function withAdmin(callback) {
  const admin = new pg.Client({ connectionString: urlFor('postgres') });
  await admin.connect();
  try {
    return await callback(admin);
  } finally {
    await admin.end();
  }
}
const databaseExists = (admin, name) =>
  admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]).then((r) => r.rowCount > 0);
const appModule = (...parts) => pathToFileURL(path.join(APP, 'src', ...parts)).href;
const toolEnv = (name, storagePath) => ({
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: urlFor(name),
  DATABASE_SSL_MODE: 'disable',
  DATABASE_SCHEMA: 'mecan',
  STORAGE_PATH: storagePath,
  BACKUP_PATH: path.join(DATA, 'backups'),
  POSTGRES_BIN_PATH: pgBin,
});
try {
  await withAdmin(async (admin) => {
    if (!(await databaseExists(admin, database)))
      await admin.query(`CREATE DATABASE "${database}"`);
  });
} catch (error) {
  await fail(`No se pudo abrir la base local (${error.message}).`);
}

// ---------- respaldo y restauración (sin npm ni variables de entorno manuales) ----------
if (BACKUP) {
  try {
    const { createPostgresBackup } = await import(appModule('postgres', 'backups.js'));
    const result = await createPostgresBackup(toolEnv(database, storage));
    say(
      `Respaldo verificado: ${path.relative(ROOT, result.directory)} (${result.files} adjuntos).`,
    );
    say('Cópialo a un disco externo: es la copia de seguridad de toda la información del taller.');
  } catch (error) {
    await fail(`El respaldo no se completó: ${error.message}`);
  }
  if (startedDatabase) await stopDatabase();
  process.exit(0);
}
if (RESTORE) {
  if (!(await portFree(settings.appPort)))
    await fail('Cierra Mecan 1.1 Offline antes de restaurar un respaldo.');
  const directory = path.resolve(ROOT, RESTORE);
  if (!fs.existsSync(path.join(directory, 'manifest.json')))
    await fail(`No es un respaldo de Mecan (falta manifest.json): ${directory}`);
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const target = `mecan_r${stamp}`,
    targetStorage = `storage-r${stamp}`;
  try {
    await withAdmin((admin) => admin.query(`CREATE DATABASE "${target}"`));
    const { restorePostgresBackup } = await import(appModule('postgres', 'backups.js'));
    const result = await restorePostgresBackup(
      directory,
      toolEnv(target, path.join(DATA, targetStorage)),
    );
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ ...settings, database: target, storage: targetStorage }, null, 2),
      { mode: 0o600 },
    );
    say(
      `Restauración verificada (${result.files} adjuntos). Al iniciar se usará la base ${target}.`,
    );
    say(`La base anterior («${database}») y sus adjuntos se conservan sin cambios.`);
  } catch (error) {
    await withAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS "${target}"`)).catch(() => {});
    fs.rmSync(path.join(DATA, targetStorage), { recursive: true, force: true });
    await fail(`La restauración no se completó y no se cambió nada: ${error.message}`);
  }
  if (startedDatabase) await stopDatabase();
  process.exit(0);
}

// ---------- aplicación ----------
if (!(await portFree(settings.appPort)))
  await fail(
    `El puerto ${settings.appPort} ya lo usa otro programa. Cambia appPort en data/offline.json.`,
  );
const url = `http://127.0.0.1:${settings.appPort}`;
const server = spawn(process.execPath, [path.join(APP, 'src', 'server.js')], {
  cwd: APP,
  windowsHide: true,
  stdio: CHECK ? 'ignore' : 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    APP_NAME: 'Mecan 1.1 Offline',
    DATABASE_URL: urlFor(database),
    DATABASE_SSL_MODE: 'disable',
    DATABASE_SCHEMA: 'mecan',
    HOST: '127.0.0.1',
    PORT: String(settings.appPort),
    APP_URL: url,
    SEED_DEMO: 'false',
    SUPERADMIN_EMAIL: settings.adminEmail,
    SUPERADMIN_PASSWORD: settings.adminPassword,
    STORAGE_PATH: storage,
    BACKUP_PATH: path.join(DATA, 'backups'),
    MOBILE_RELEASES_PATH: path.join(DATA, 'movil'),
    MODEL_LIBRARY_PATH: ROOT,
    POSTGRES_BIN_PATH: pgBin,
    // Sin salidas de red aunque la PC tenga estas variables definidas para otra instalación.
    EMAIL_TRANSPORT: 'disabled',
    NOTIFICATION_WEBHOOK_URL: '',
    NOTIFICATION_WEBHOOK_SECRET: '',
  },
});
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null) server.kill();
  await stopDatabase();
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => shutdown(0));
server.once('exit', (code) => shutdown(code ?? 0));

let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  ready = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) })
    .then((response) => response.json())
    .then((body) => body.status === 'ok')
    .catch(() => false);
}
if (!ready) {
  console.error('  El servidor no respondió a tiempo. Revisa los mensajes anteriores.');
  await shutdown(1);
}
if (CHECK) {
  const health = await fetch(`${url}/health`).then((r) => r.json());
  // La misma lectura de catálogo que usa el servidor: solo disco, sin red.
  process.env.MODEL_LIBRARY_PATH = ROOT;
  const { loadModelCatalog, modelEntry } = await import(appModule('services', 'vehicle-models.js'));
  const catalog = loadModelCatalog(ROOT);
  const usable = catalog.models.filter((model) => modelEntry(model.id, catalog)).length;
  say(
    `Verificación correcta: ${url} · migraciones ${health.migrations} · modelos 3D locales utilizables ${usable}/${catalog.models.length}`,
  );
  await shutdown(usable === catalog.models.length ? 0 : 1);
} else {
  say(`Listo: ${url}`);
  say('Cierra esta ventana para detener el sistema y la base de datos.');
  // `start` necesita el título vacío entre comillas literales: se pasa la línea sin reescapar.
  if (OPEN_BROWSER && process.platform === 'win32')
    spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    }).unref();
}
