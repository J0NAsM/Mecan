// Arranque del sistema desde el acceso directo del escritorio.
//
// Deja la base lista, levanta el servidor HTTP y abre el navegador cuando responde. Cerrar esta
// ventana detiene el servidor. No inventa configuración: si el entorno ya define DATABASE_URL usa
// esa base tal cual; si no, recurre al PostgreSQL local aislado del proyecto, que es de desarrollo.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
process.chdir(root);

const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const configured = Boolean(process.env.DATABASE_URL);
const port = process.env.PORT || '3000';
// La salud se consulta siempre en local: prueba que arrancó este proceso, no que haya internet.
const localUrl = `http://127.0.0.1:${port}`;
// Con un túnel configurado, APP_URL es la dirección pública y pasa a ser la única utilizable: el
// servidor rechaza todo POST cuyo origen no coincida con ella, así que entrar por localhost
// cargaría las pantallas pero fallaría al guardar cualquier formulario.
const publicUrl = process.env.APP_URL || localUrl;
const tunnelled = publicUrl.startsWith('https://');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(command)} terminó con código ${code}`)),
    );
  });
}

/**
 * Espera a que responda este sistema y no cualquier cosa escuchando en el mismo puerto.
 *
 * Windows permite que dos procesos ocupen el mismo puerto en interfaces distintas, así que un 200
 * no alcanza: se confirma que la respuesta es el estado de salud de esta aplicación.
 */
async function waitForServer(healthUrl, child) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) return 'detenido';
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        const health = await response.json();
        return typeof health?.migrations === 'number' && 'database' in health ? 'listo' : 'ajeno';
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return 'sin respuesta';
}

function openBrowser(target) {
  // `start` es un comando interno de cmd; la cadena vacía ocupa el lugar del título de ventana.
  if (process.platform === 'win32')
    spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', 'start', '""', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  else if (process.platform === 'darwin')
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
}

console.log(`\n  ${process.env.APP_NAME || 'Mecan Cloud'}\n`);

if (!configured) {
  console.log('  Base de datos: PostgreSQL local de desarrollo (.runtime, fuera de Git).');
  console.log('  Preparando la base…');
  try {
    await run(process.execPath, ['scripts/dev-postgres.js', 'start'], { stdio: 'inherit' });
  } catch (error) {
    console.error(`\n  No se pudo preparar la base local: ${error.message}`);
    console.error(
      '  Revisa docs/POSTGRESQL.md o define DATABASE_URL en .env para usar otra base.\n',
    );
    process.exit(1);
  }
} else {
  console.log('  Base de datos: la configurada en .env (DATABASE_URL).');
}

const serverArguments = configured
  ? ['src/server.js']
  : ['scripts/dev-postgres.js', 'exec', process.execPath, 'src/server.js'];
const server = spawn(process.execPath, serverArguments, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

let stopping = false;
let stopTunnel = () => {};
const stop = () => {
  if (stopping) return;
  stopping = true;
  stopTunnel();
  if (server.exitCode === null) server.kill();
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
process.once('exit', stop);
server.once('exit', (code) => process.exit(code ?? 0));

console.log('  Iniciando el servidor…');
const state = await waitForServer(`${localUrl}/health`, server);
if (state === 'listo') {
  if (tunnelled) {
    console.log('  Abriendo el túnel…');
    const tunnel = spawn(process.execPath, ['scripts/tunnel.js'], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    stopTunnel = () => {
      if (tunnel.exitCode === null) tunnel.kill();
    };
    // Que el túnel caiga no debe tirar el sistema: el servidor local sigue sirviendo y el
    // agente vuelve a levantarse con npm run tunnel sin reiniciar ni perder las sesiones.
    tunnel.once('error', (error) => console.error(`  No se pudo abrir el túnel: ${error.message}`));
  }
  console.log(`\n  Listo: ${publicUrl}`);
  console.log('  Cierra esta ventana para detener el sistema.\n');
  openBrowser(publicUrl);
} else if (state === 'ajeno') {
  console.error(
    `\n  El puerto ${port} ya lo ocupa otro programa: ${localUrl} no muestra este sistema.`,
  );
  console.error(
    '  Define otro puerto en .env (PORT y APP_URL) y vuelve a abrir el acceso directo.\n',
  );
} else if (state === 'sin respuesta') {
  console.error(
    '\n  El servidor no respondió a tiempo. Se deja corriendo para ver el detalle arriba.\n',
  );
}
