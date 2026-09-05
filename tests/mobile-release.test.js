import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase } from './helpers/postgres.js';

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const waitFor = async (url, getError) => {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor de prueba no inició: ${getError()}`);
};

/** Directorio de versiones con un APK simulado y su manifiesto, como lo deja publish-release.js. */
function publishFakeRelease(directory, { versionCode = 4, versionName = '1.2.0', bytes } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const fileName = `mecan-${versionName}-${versionCode}.apk`;
  const content = bytes ?? crypto.randomBytes(2048);
  fs.writeFileSync(path.join(directory, fileName), content);
  const manifest = {
    applicationId: 'py.softshop.mecan',
    versionCode,
    versionName,
    fileName,
    downloadUrl: `/movil/apk/${fileName}`,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    size: content.length,
    mandatory: false,
    notes: 'Notas de la versión.',
    releasedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { manifest, content };
}

async function startServer(t, { releasesPath }) {
  const setup = await openTestDatabase();
  await seedDatabase(setup, {
    superadminEmail: 'root@movil.local',
    superadminPassword: 'Strong123!',
  });
  const schema = setup.schema;
  await setup.close();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let serverError = '';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      APP_URL: base,
      DATABASE_SCHEMA: schema,
      SEED_DEMO: 'false',
      MOBILE_RELEASES_PATH: releasesPath,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => (serverError += chunk.toString()));
  t.after(
    () =>
      new Promise((resolve) => {
        if (child.exitCode != null) return resolve();
        child.once('exit', resolve);
        child.kill();
      }),
  );
  await waitFor(`${base}/health`, () => serverError);
  return base;
}

test('la web publica el APK vigente con su huella y lo entrega intacto', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-movil-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  const { manifest, content } = publishFakeRelease(directory);
  const base = await startServer(t, { releasesPath: directory });

  const update = await fetch(`${base}/movil/actualizacion.json`);
  assert.equal(update.status, 200);
  assert.equal(update.headers.get('cache-control'), 'no-store');
  const published = await update.json();
  assert.equal(published.versionCode, manifest.versionCode);
  assert.equal(published.applicationId, 'py.softshop.mecan');
  assert.equal(published.sha256, manifest.sha256);
  assert.equal(published.size, manifest.size);
  // La app resuelve esta ruta contra su propio servidor: debe ser relativa, no absoluta a otro host.
  assert.equal(published.downloadUrl, `/movil/apk/${manifest.fileName}`);

  const download = await fetch(`${base}${published.downloadUrl}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/vnd.android.package-archive');
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.length, content.length);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), manifest.sha256);

  const page = await fetch(`${base}/movil`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, new RegExp(manifest.fileName));
  assert.match(html, new RegExp(manifest.sha256));
});

test('sin versión publicada la app recibe 404 y la página no ofrece descargas', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-movil-vacio-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  const base = await startServer(t, { releasesPath: directory });

  const update = await fetch(`${base}/movil/actualizacion.json`);
  assert.equal(update.status, 404);
  assert.deepEqual(await update.json(), { published: false });

  const page = await fetch(`${base}/movil`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Todavía no hay una versión publicada/);
  assert.doesNotMatch(html, /\/movil\/apk\//);
});

test('un manifiesto que no corresponde al APK en disco no se anuncia como versión', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-movil-roto-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  const { manifest } = publishFakeRelease(directory);
  // Copia interrumpida: el archivo existe pero no tiene el tamaño declarado.
  fs.writeFileSync(path.join(directory, manifest.fileName), Buffer.alloc(10));
  const base = await startServer(t, { releasesPath: directory });

  assert.equal((await fetch(`${base}/movil/actualizacion.json`)).status, 404);
  assert.match(await (await fetch(`${base}/movil`)).text(), /Todavía no hay una versión publicada/);
});

test('la descarga rechaza rutas fuera del directorio de versiones y nombres arbitrarios', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-movil-rutas-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  publishFakeRelease(directory);
  // Un archivo vecino que jamás debe poder descargarse a través de esta ruta.
  fs.writeFileSync(path.join(directory, 'signing.properties'), 'storePassword=secreto');
  const base = await startServer(t, { releasesPath: directory });

  for (const target of [
    '/movil/apk/signing.properties',
    '/movil/apk/manifest.json',
    '/movil/apk/..%2Fmanifest.json',
    '/movil/apk/%2E%2E%2F%2E%2E%2Fpackage.json',
    '/movil/apk/mecan-1.2.0-4.apk.bak',
  ]) {
    const response = await fetch(`${base}${target}`);
    assert.equal(response.status, 404, `${target} devolvió ${response.status}`);
    assert.doesNotMatch(await response.text(), /storePassword|mecan-cloud/);
  }
});
