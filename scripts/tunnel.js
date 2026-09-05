// Publica el servidor local en internet a través de un túnel de ngrok.
//
// El sistema sigue corriendo en esta PC, en `localhost`: el túnel solo le da una dirección HTTPS
// pública y estable. No hay que abrir puertos en el router ni en el firewall, porque la conexión la
// abre el agente desde adentro hacia afuera.
//
// La dirección no se configura acá: se deduce de `APP_URL`. El servidor rechaza cualquier POST cuyo
// origen no coincida exactamente con `APP_URL` (src/server.js), y la app Android comprueba que la
// actualización venga del mismo origen que el servidor configurado. Si el dominio del túnel y
// `APP_URL` pudieran discrepar, el resultado sería un sistema que carga pero donde ningún formulario
// funciona, que es mucho peor que uno que no arranca. Por eso hay una sola fuente.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const port = process.env.PORT || '3000';
const appUrl = process.env.APP_URL || '';

function fail(message, hint) {
  console.error(`\n  ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error('');
  process.exit(1);
}

let target;
try {
  target = new URL(appUrl);
} catch {
  fail(
    'APP_URL no es una dirección válida.',
    'Debe ser la dirección pública del túnel, por ejemplo https://mecan.ngrok-free.app',
  );
}
if (target.protocol !== 'https:')
  fail(
    `APP_URL es «${appUrl}» y el túnel solo tiene sentido sobre HTTPS.`,
    'Un APK de publicación rechaza http:// y la actualización automática viajaría manipulable.',
  );
if (target.pathname !== '/' || target.search || target.hash)
  fail(
    `APP_URL debe ser solo el origen, sin ruta: «${target.origin}».`,
    'El origen es lo que compara el servidor al validar un POST.',
  );

/**
 * Ubica el agente de ngrok.
 *
 * Se busca en varios sitios porque winget lo instala para el usuario y no siempre deja el PATH
 * actualizado en la sesión en curso. `NGROK_PATH` permite fijarlo a mano.
 */
function findNgrok() {
  const candidates = [];
  if (process.env.NGROK_PATH) candidates.push(process.env.NGROK_PATH);
  const local = process.env.LOCALAPPDATA;
  if (local) {
    // Carpeta dedicada: es la que se excluye del antivirus, porque Defender bloquea la ejecución
    // del agente. Acotar la exclusión a una carpeta creada para esto evita que quede cubriendo
    // software instalado después, como pasaría excluyendo la carpeta de paquetes de winget.
    candidates.push(path.join(local, 'Programs', 'ngrok', 'ngrok.exe'));
    candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'ngrok.exe'));
    const packages = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const entry of fs.readdirSync(packages))
        if (entry.toLowerCase().startsWith('ngrok'))
          candidates.push(path.join(packages, entry, 'ngrok.exe'));
    } catch {}
  }
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  // Última opción: que lo resuelva el PATH. Si tampoco está, el spawn falla con ENOENT y se
  // informa igual que el resto, en lugar de dejar un error críptico del sistema operativo.
  return process.platform === 'win32' ? 'ngrok.exe' : 'ngrok';
}

/** Confirma que lo que responde es este sistema y no otra cosa escuchando en el mismo puerto. */
async function isThisSystem(healthUrl) {
  try {
    const response = await fetch(healthUrl, { redirect: 'manual' });
    if (!response.ok) return false;
    const health = await response.json();
    return typeof health?.migrations === 'number' && 'database' in health;
  } catch {
    return false;
  }
}

if (!(await isThisSystem(`http://127.0.0.1:${port}/health`)))
  fail(
    `No hay nada de este sistema respondiendo en http://127.0.0.1:${port}.`,
    'Levanta primero el servidor (npm start) o usa npm run desktop:start, que hace las dos cosas.',
  );

const ngrok = findNgrok();
const domain = target.hostname;
console.log(`\n  Abriendo el túnel hacia ${target.origin}`);
console.log(`  Agente: ${ngrok}\n`);

const agent = spawn(ngrok, ['http', port, `--domain=${domain}`, '--log=stdout'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  windowsHide: true,
});

agent.once('error', (error) => {
  if (error.code === 'ENOENT')
    fail(
      'No se encontró el agente de ngrok.',
      'Instalación y exclusión de Defender que necesita: docs/TUNEL.md',
    );
  fail(`No se pudo iniciar ngrok: ${error.message}`);
});

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (agent.exitCode === null) agent.kill();
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
process.once('exit', stop);
agent.once('exit', (code) => {
  if (!stopping)
    console.error(`\n  El túnel se cerró (código ${code}). El servidor local sigue corriendo.\n`);
  process.exit(code ?? 0);
});

// Se comprueba de punta a punta —saliendo a internet y volviendo— en lugar de creerle al agente:
// que ngrok diga «tunnel established» no prueba que la dirección pública llegue a este sistema.
for (let attempt = 0; attempt < 60; attempt += 1) {
  if (agent.exitCode !== null) break;
  if (await isThisSystem(`${target.origin}/health`)) {
    console.log(`\n  Túnel abierto: ${target.origin}`);
    console.log('  Esta ventana debe quedar abierta. Ciérrala para cerrar el túnel.\n');
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (attempt === 59)
    console.error(
      `\n  El túnel no confirmó respuesta desde ${target.origin}. Revisa el detalle de arriba.\n`,
    );
}
