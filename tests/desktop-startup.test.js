import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { desktopUrls, probeServer, waitForServer } from '../scripts/desktop-startup.js';

const health = JSON.stringify({ status: 'ok', database: 'ok', migrations: 2 });
const running = () => ({ exitCode: null, signalCode: null });
const interfaces = {
  'vEthernet (WSL)': [{ address: '172.27.128.1', family: 'IPv4', internal: false }],
  'Wi-Fi': [{ address: '192.168.199.160', family: 'IPv4', internal: false }],
  Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};

async function listen(t, handler, host = '127.0.0.1', port = 0) {
  const server = http.createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  server.listen(port, host);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/health`;
}

test('el acceso de desarrollo sigue la IP de Wi-Fi al cambiar de red', () => {
  const urls = desktopUrls(
    { APP_URL: 'http://192.168.100.18:3000', PORT: '3100', HOST: '0.0.0.0' },
    interfaces,
  );
  assert.deepEqual(urls, {
    localUrl: 'http://127.0.0.1:3100',
    publicUrl: 'http://192.168.199.160:3100',
    previousUrl: 'http://192.168.100.18:3000',
  });
});

test('sin una única red física se puede abrir Mecan en esta PC', () => {
  const env = { APP_URL: 'http://192.168.100.18:3000', PORT: '3100' };
  assert.equal(desktopUrls(env, {}).publicUrl, 'http://127.0.0.1:3100');
  assert.equal(
    desktopUrls(env, {
      ...interfaces,
      Ethernet: [{ address: '10.0.0.2', family: 'IPv4', internal: false }],
    }).publicUrl,
    'http://127.0.0.1:3100',
  );
});

test('se respetan las direcciones vigentes, los dominios, HTTPS y producción', () => {
  for (const env of [
    { APP_URL: 'http://192.168.199.160:3100' },
    { APP_URL: 'http://localhost:3100' },
    { APP_URL: 'http://mecan.local:3100' },
    { APP_URL: 'https://mecan.example.com' },
    { APP_URL: 'http://192.168.100.18:3100', NODE_ENV: 'production' },
  ]) {
    const urls = desktopUrls(env, interfaces);
    assert.equal(urls.publicUrl, env.APP_URL);
    assert.equal(urls.previousUrl, undefined);
  }
});

test('la consulta de salud utiliza la interfaz donde escucha el servidor', () => {
  assert.equal(
    desktopUrls({ HOST: '192.168.199.160' }, interfaces).localUrl,
    'http://192.168.199.160:3000',
  );
  assert.equal(desktopUrls({ HOST: '::' }, interfaces).localUrl, 'http://[::1]:3000');
  assert.equal(
    desktopUrls({ HOST: '127.0.0.1', APP_URL: 'http://192.168.100.18:3000' }, interfaces).publicUrl,
    'http://127.0.0.1:3000',
  );
});

test('la salud distingue Mecan, errores de la base y aplicaciones ajenas', async (t) => {
  for (const [status, body, state] of [
    [200, health, 'listo'],
    [200, '<html>Otro programa</html>', 'ajeno'],
    [404, 'No encontrado', 'ajeno'],
    [302, '', 'ajeno'],
    [503, JSON.stringify({ database: 'error', migrations: 2 }), 'sin respuesta'],
  ]) {
    const url = await listen(t, (req, res) => {
      res.writeHead(status);
      res.end(body);
    });
    assert.equal((await probeServer(url)).state, state);
  }
});

test('un intento bloqueado leyendo el cuerpo vence y el arranque puede recuperarse', async (t) => {
  let requests = 0;
  const url = await listen(t, (req, res) => {
    requests += 1;
    if (requests === 1) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
    } else res.end(health);
  });
  const result = await waitForServer(url, running(), {
    timeoutMs: 1500,
    requestTimeoutMs: 100,
    intervalMs: 10,
  });
  assert.equal(result.state, 'listo');
  assert.equal(requests, 2);
});

test('la espera total tiene límite aunque el servidor no envíe encabezados', async (t) => {
  const url = await listen(t, () => {});
  const started = Date.now();
  const result = await waitForServer(url, running(), { timeoutMs: 150, requestTimeoutMs: 2000 });
  assert.equal(result.state, 'sin respuesta');
  assert.match(result.detail, /agotó su tiempo/);
  assert.ok(Date.now() - started < 1500);
});

test('un 404 transitorio se vuelve a comprobar con una conexión nueva', async (t) => {
  let requests = 0;
  const sockets = new Set();
  const url = await listen(t, (req, res) => {
    sockets.add(req.socket);
    requests += 1;
    res.writeHead(requests === 1 ? 404 : 200);
    res.end(requests === 1 ? 'Otro programa' : health);
  });
  const result = await waitForServer(url, running(), { timeoutMs: 1500, intervalMs: 10 });
  assert.equal(result.state, 'listo');
  assert.equal(sockets.size, 2);
});

test('se informa el programa ajeno y se detecta un proceso detenido por señal', async (t) => {
  const url = await listen(t, (req, res) => {
    res.writeHead(404);
    res.end('Otro programa');
  });
  assert.deepEqual(await waitForServer(url, running(), { timeoutMs: 100, intervalMs: 10 }), {
    state: 'ajeno',
    detail: 'HTTP 404: la respuesta no corresponde a Mecan',
  });
  assert.equal(
    (await waitForServer(url, { exitCode: null, signalCode: 'SIGTERM' })).state,
    'detenido',
  );
});

test(
  'Windows: una conexión previa al listener IPv6 no oculta el arranque de Mecan en IPv4',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const url = await listen(
      t,
      (req, res) => {
        res.writeHead(404);
        res.end('Otro proyecto');
      },
      '::',
    );
    // Reproduce la conexión que fetch mantendría abierta hacia el proyecto ajeno.
    const initial = await fetch(url);
    assert.equal(initial.status, 404);
    await initial.text();
    await listen(t, (req, res) => res.end(health), '0.0.0.0', Number(new URL(url).port));
    const result = await waitForServer(url, running(), { timeoutMs: 1000, intervalMs: 10 });
    assert.equal(result.state, 'listo');
  },
);
