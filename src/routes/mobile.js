// Distribución y actualización de la aplicación Android.
//
// El APK se compila en movile/ y se publica dejando el archivo y su manifiesto en el directorio de
// versiones. Aquí solo se lee ese directorio: el servidor no compila ni firma nada, de modo que un
// fallo de publicación no puede dejar servida una versión que no exista.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { esc, card } from '../ui.js';

const APK_NAME = /^mecan-\d+\.\d+(\.\d+)?-\d+\.apk$/;
const REQUIRED = ['applicationId', 'versionCode', 'versionName', 'fileName', 'sha256', 'size'];

function releasesDirectory() {
  return path.resolve(config.mobileReleasesPath);
}

/**
 * Versión vigente, o null si todavía no se publicó ninguna.
 *
 * Solo se anuncia una versión cuyo APK exista realmente y cuyo tamaño coincida con el declarado:
 * un manifiesto suelto o un archivo a medio copiar no debe llegar a los dispositivos.
 */
export function currentRelease() {
  const directory = releasesDirectory();
  const manifestFile = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    return null;
  }
  if (REQUIRED.some((key) => manifest[key] === undefined || manifest[key] === '')) return null;
  if (!APK_NAME.test(String(manifest.fileName))) return null;
  if (!/^[\da-f]{64}$/.test(String(manifest.sha256))) return null;
  const apk = path.join(directory, manifest.fileName);
  if (!fs.existsSync(apk) || !fs.statSync(apk).isFile()) return null;
  if (fs.statSync(apk).size !== Number(manifest.size)) return null;
  return manifest;
}

function apkPath(fileName) {
  // basename descarta cualquier intento de recorrer directorios antes de tocar el disco.
  const safe = path.basename(String(fileName));
  if (!APK_NAME.test(safe)) return null;
  const file = path.join(releasesDirectory(), safe);
  if (!file.startsWith(releasesDirectory() + path.sep)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function downloadPage(release) {
  const appUrl = config.appUrl.replace(/\/$/, '');
  // Encabezado del sitio público, con el mismo tratamiento que /pricing o /features.
  const intro = `<section class="public-heading"><span class="eyebrow">APLICACIÓN MÓVIL</span><h1>${esc(config.appName)} para Android</h1><p>La misma operación del taller desde el teléfono: órdenes, clientes, vehículos, inventario, compras, caja y reportes.</p></section>`;
  const install = card(
    'Cómo instalarla',
    `<ol class="public-workflow install-steps">
      <li><span>01</span><div><b>Descarga el archivo</b><p>Desde este mismo teléfono, con el botón de arriba.</p></div></li>
      <li><span>02</span><div><b>Autoriza la instalación</b><p>Android pedirá permiso para instalar desde esta fuente. Es un permiso por aplicación y puedes retirarlo después.</p></div></li>
      <li><span>03</span><div><b>Indica tu servidor</b><p>Al abrirla, escribe <b>${esc(appUrl)}</b> y entra con tu usuario del taller.</p></div></li>
    </ol>`,
  );
  const updates = card(
    'Actualizaciones',
    `<p>La aplicación consulta sola si hay una versión nueva publicada aquí, la descarga, verifica su firma y su huella SHA-256, y te pide confirmación antes de instalarla. No hay que volver a esta página para actualizar.</p>
     <p><button class="button button-outline" type="button" data-app-action="check-updates" hidden>Buscar actualizaciones ahora</button><span class="app-version-note" data-app-version hidden></span></p>`,
  );
  if (!release)
    return `${intro}${card('Todavía no hay una versión publicada', '<p>Cuando se publique la aplicación aparecerá aquí para descargar. Mientras tanto, el sistema funciona completo desde el navegador del teléfono.</p>')}${install}`;

  const megabytes = (Number(release.size) / 1048576).toFixed(1);
  const download = `<p class="download-row"><a class="button button-large" href="/movil/apk/${esc(release.fileName)}" download>Descargar versión ${esc(release.versionName)}</a></p>
    <div class="stat-list">
      <div><span>Versión</span><b>${esc(release.versionName)} (${esc(String(release.versionCode))})</b></div>
      <div><span>Tamaño</span><b>${esc(megabytes)} MB</b></div>
      <div><span>Publicada</span><b>${esc(String(release.releasedAt || '').slice(0, 10))}</b></div>
      <div><span>Requiere</span><b>Android 8.0 o superior</b></div>
    </div>
    <p class="hash-note">Huella SHA-256 del archivo:<br><code>${esc(release.sha256)}</code></p>
    ${release.notes ? `<p>${esc(release.notes)}</p>` : ''}`;
  return `${intro}${card('Descargar', download)}${install}${updates}`;
}

export async function mobileGet(req, res, url, api) {
  const { render } = api,
    p = url.pathname;

  if (p === '/movil') {
    render(res, 'Aplicación móvil', downloadPage(currentRelease()), req, url);
    return true;
  }

  if (p === '/movil/actualizacion.json') {
    const release = currentRelease();
    if (!release) {
      // 404 le dice a la app «no hay nada publicado», que no es lo mismo que un fallo de red.
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ published: false }));
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        applicationId: release.applicationId,
        versionCode: Number(release.versionCode),
        versionName: release.versionName,
        downloadUrl: `/movil/apk/${release.fileName}`,
        sha256: release.sha256,
        size: Number(release.size),
        mandatory: Boolean(release.mandatory),
        notes: release.notes || '',
        releasedAt: release.releasedAt || '',
      }),
    );
    return true;
  }

  const parameters = api.match('/movil/apk/:file', p);
  if (parameters) {
    const file = apkPath(parameters.file);
    if (!file)
      throw new AppError('Esa versión de la aplicación no está disponible.', { status: 404 });
    const size = fs.statSync(file).size;
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': size,
      // El nombre incluye la versión, así que el contenido de una URL nunca cambia.
      'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    // Se transmite en flujo: un APK no debe cargarse entero en memoria por cada descarga.
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  }

  return false;
}
