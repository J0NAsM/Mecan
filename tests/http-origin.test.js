import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRequestOrigin } from '../src/security.js';

const settings = {
  appUrl: 'http://192.168.199.160:3100',
  port: 3100,
  production: false,
  secureTransport: false,
};
const request = (origin, address = '127.0.0.1', host = new URL(origin).host) => ({
  headers: { origin, host },
  socket: { localAddress: address, localPort: 3100 },
});

test('permite formularios locales después de cambiar de red, incluyendo localhost e IPv6', () => {
  for (const [origin, address] of [
    ['http://127.0.0.1:3100', '127.0.0.1'],
    ['http://localhost:3100', '127.0.0.1'],
    ['http://localhost:3100', '::ffff:127.0.0.1'],
    ['http://localhost:3100', '::1'],
    ['http://[::1]:3100', '::1'],
    ['http://172.20.10.9:3100', '172.20.10.9'],
    ['http://172.20.10.9:3100', '::ffff:172.20.10.9'],
  ])
    assert.equal(isAllowedRequestOrigin(request(origin, address), settings), true, origin);
});

test('rechaza otros sitios, puertos y direcciones que no recibió el servidor', () => {
  for (const req of [
    request('http://evil.example:3100'),
    request('http://172.20.10.8:3100', '172.20.10.9'),
    request('http://127.0.0.1:3000'),
    request('http://127.0.0.1:3100', '127.0.0.1', 'localhost:3100'),
    request('http://localhost:3100', '172.20.10.9'),
    request('https://127.0.0.1:3100'),
    request('http://user@127.0.0.1:3100'),
    request('http://127.0.0.1:3100/'),
    request('null', '127.0.0.1', '127.0.0.1:3100'),
    request('invalid', '127.0.0.1', '127.0.0.1:3100'),
    { ...request('http://localhost:3100'), socket: { localPort: 3100 } },
    { ...request('http://localhost:3100'), socket: { localAddress: '127.0.0.1', localPort: 3000 } },
  ]) {
    req.headers['x-forwarded-host'] = '127.0.0.1:3100';
    assert.equal(isAllowedRequestOrigin(req, settings), false, req.headers.origin);
  }
});

test('producción y túneles HTTPS mantienen el origen configurado como único permitido', () => {
  for (const config of [
    { ...settings, production: true },
    { ...settings, appUrl: 'https://mecan.example', secureTransport: true },
    { ...settings, appUrl: 'https://mecan.example' },
  ]) {
    assert.equal(isAllowedRequestOrigin(request('http://localhost:3100'), config), false);
    assert.equal(isAllowedRequestOrigin(request(new URL(config.appUrl).origin), config), true);
  }
  assert.equal(isAllowedRequestOrigin({ headers: {} }, settings), true);
});
