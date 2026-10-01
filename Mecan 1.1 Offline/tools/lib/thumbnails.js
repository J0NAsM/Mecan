// Miniaturas WebP renderizadas localmente: Chromium sin interfaz (Playwright) + Three.js de la
// aplicación, servidos por un servidor HTTP efímero en 127.0.0.1. No usa internet. Si Playwright no
// está instalado la recopilación continúa y el modelo queda sin miniatura.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, relative } from './paths.js';
import { writeModelFiles } from './catalog.js';

function threeVendor() {
  return [
    process.env.THREE_VENDOR_PATH,
    path.join(ROOT, '..', 'public', 'vendor', 'three'),
    path.join(ROOT, 'app', 'public', 'vendor', 'three'),
  ].find((candidate) => candidate && fs.existsSync(path.join(candidate, 'three.module.min.js')));
}

const PAGE = `<!doctype html><html><body style="margin:0;background:#0f141c"><canvas id="c" width="512" height="384"></canvas>
<script type="module">
import * as THREE from '/three/three.module.min.js';
import { GLTFLoader } from '/three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from '/three/addons/environments/RoomEnvironment.js';
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(512, 384, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#131a25');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.add(new THREE.HemisphereLight(0x9dc4ff, 0x080c14, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(4, 8, 6); scene.add(sun);
const camera = new THREE.PerspectiveCamera(32, 512 / 384, 0.01, 1000);
const loader = new GLTFLoader();
let current = null;
window.renderModel = async (url) => {
  if (current) scene.remove(current);
  const gltf = await loader.loadAsync(url);
  current = gltf.scene;
  scene.add(current);
  const box = new THREE.Box3().setFromObject(current);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1e-3);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02;
  camera.position.copy(center).add(new THREE.Vector3(1, 0.62, 1.35).normalize().multiplyScalar(distance));
  camera.near = distance / 100; camera.far = distance * 100; camera.updateProjectionMatrix();
  camera.lookAt(center);
  renderer.render(scene, camera);
  const large = canvas.toDataURL('image/webp', 0.9);
  const small = document.createElement('canvas'); small.width = 192; small.height = 144;
  small.getContext('2d').drawImage(canvas, 0, 0, 192, 144);
  return { large, small: small.toDataURL('image/webp', 0.85) };
};
window.ready = true;
</script></body></html>`;

export async function renderThumbnails(models, { log = console.log } = {}) {
  const pending = models.filter((model) => model.file);
  if (!pending.length) return { rendered: 0 };
  let playwright;
  try {
    playwright = await import('@playwright/test');
  } catch {
    return { rendered: 0, skipped: 'Playwright no está instalado: modelos sin miniatura.' };
  }
  const vendor = threeVendor();
  if (!vendor)
    return { rendered: 0, skipped: 'No se encontró Three.js local para renderizar miniaturas.' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    let target = null,
      type = 'text/html; charset=utf-8';
    if (url.pathname === '/') return response.end(PAGE);
    if (url.pathname.startsWith('/three/')) {
      target = path.resolve(vendor, '.' + url.pathname.slice('/three'.length));
      type = 'text/javascript; charset=utf-8';
      if (!target.startsWith(vendor + path.sep)) target = null;
    } else if (url.pathname.startsWith('/model/')) {
      const model = pending[Number(url.pathname.split('/')[2])];
      target = model ? path.join(ROOT, model.file) : null;
      type = 'model/gltf-binary';
    }
    if (!target || !fs.existsSync(target)) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(target).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  let rendered = 0;
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 384 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 30_000 });
    for (const [index, model] of pending.entries()) {
      try {
        const images = await page.evaluate((url) => window.renderModel(url), `/model/${index}`);
        const folder = path.join(ROOT, path.dirname(model.file));
        const decode = (dataUrl) => {
          if (!dataUrl.startsWith('data:image/webp;base64,'))
            throw new Error('El navegador no generó WebP.');
          return Buffer.from(dataUrl.split(',')[1], 'base64');
        };
        fs.writeFileSync(path.join(folder, 'thumbnail.webp'), decode(images.large));
        const small = path.join(ROOT, 'thumbnails', `${model.id}.webp`);
        fs.mkdirSync(path.dirname(small), { recursive: true });
        fs.writeFileSync(small, decode(images.small));
        model.thumbnail = relative(path.join(folder, 'thumbnail.webp'));
        model.thumbnailSmall = relative(small);
        writeModelFiles(model);
        rendered++;
      } catch (error) {
        failures.push(`${model.id}: ${error.message}`);
        log(`  ! miniatura no generada para ${model.id}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { rendered, failures };
}
