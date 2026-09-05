import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { seedDatabase } from '../src/db.js';
import { openTestDatabase, connectTestDatabase } from './helpers/postgres.js';
import { provisionWorkshop } from '../src/domain.js';
import { id, now } from '../src/utils.js';

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
const waitFor = async (url, getError) => {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Servidor de prueba no inició: ${getError()}`);
};
async function login(base, email, password) {
  const page = await fetch(`${base}/login`),
    guestCookie = page.headers.get('set-cookie').split(';')[0],
    html = await page.text(),
    guestCsrf = html.match(/name="guestCsrf" value="([^"]+)"/)?.[1];
  const response = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: guestCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password, guestCsrf }),
  });
  return response.headers.get('set-cookie').split(';')[0];
}
async function csrf(base, cookie, page = '/workshop') {
  const response = await fetch(`${base}${page}`, { headers: { cookie } });
  const html = await response.text();
  return html.match(/name="csrf" value="([^"]+)"/)?.[1];
}

test('HTTP bloquea URL, ID de orden y archivo pertenecientes a otro tenant', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-test-'));
  const db = await openTestDatabase();
  await seedDatabase(db, { superadminEmail: 'root@test.local', superadminPassword: 'Strong123!' });
  const a = await provisionWorkshop(db, {
    ownerName: 'Ana',
    workshopName: 'HTTP A',
    email: 'a@http.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  const b = await provisionWorkshop(db, {
    ownerName: 'Bruno',
    workshopName: 'HTTP B',
    email: 'b@http.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  await db
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('customer-b', b.tenantId, b.branchId, 'Cliente secreto B', now());
  await db
    .prepare('INSERT INTO vehicles (id,tenant_id,customer_id,plate,created_at) VALUES (?,?,?,?,?)')
    .run('vehicle-b', b.tenantId, 'customer-b', 'SECRET-B', now());
  await db
    .prepare(
      "INSERT INTO work_orders (id,tenant_id,branch_id,customer_id,vehicle_id,number,status,created_by,created_at) VALUES (?,?,?,?,?,1,'RECEIVED',?,?)",
    )
    .run('order-b', b.tenantId, b.branchId, 'customer-b', 'vehicle-b', b.userId, now());
  await db
    .prepare(
      'INSERT INTO files (id,tenant_id,name,mime_type,storage_key,size_bytes,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(
      'file-b',
      b.tenantId,
      'secreto.pdf',
      'application/pdf',
      'b/secreto.pdf',
      100,
      b.userId,
      now(),
    );
  await db
    .prepare(
      'INSERT INTO inventory_items (id,tenant_id,branch_id,name,quantity,cost,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run('item-b', b.tenantId, b.branchId, 'Repuesto secreto B', 2, 1000, now());
  await db.close();
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  let serverError = '';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      APP_URL: base,
      DATABASE_SCHEMA: db.schema,
      SEED_DEMO: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => (serverError += chunk.toString()));
  t.after(async () => {
    await new Promise((resolve) => {
      if (child.exitCode != null) return resolve();
      child.once('exit', resolve);
      child.kill();
    });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await waitFor(`${base}/health`, () => serverError);
  const csrfLessLogin = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'a@http.local', password: 'Strong123!' }),
  });
  assert.equal(csrfLessLogin.status, 303);
  assert.equal(csrfLessLogin.headers.get('set-cookie'), null);
  const cookie = await login(base, 'a@http.local', 'Strong123!');
  const token = await csrf(base, cookie);
  const tenantSaasAttempt = await fetch(`${base}/saas`, {
    headers: { cookie },
    redirect: 'manual',
  });
  assert.equal(tenantSaasAttempt.status, 403);
  assert.equal(
    (await fetch(`${base}/workshop/orders/order-b`, { headers: { cookie } })).status,
    404,
  );
  const orderAttempt = await fetch(`${base}/workshop/orders/order-b/inspection`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: token, findings: 'Intento cruzado' }),
  });
  assert.equal(orderAttempt.status, 303);
  const fileAttempt = await fetch(`${base}/api/files/file-b`, { headers: { cookie } });
  assert.equal(fileAttempt.status, 404);
  for (const endpoint of [
    '/workshop/customers/customer-b',
    '/workshop/customers/customer-b/edit',
    '/workshop/vehicles/vehicle-b',
    '/workshop/vehicles/vehicle-b/edit',
    '/workshop/inventory/item-b/edit',
    '/workshop/inventory/item-b/movements',
    ...['estimate', 'invoice', 'delivery'].map(
      (type) => '/workshop/orders/order-b/print?type=' + type,
    ),
  ]) {
    const response = await fetch(base + endpoint, { headers: { cookie } });
    assert.equal(response.status, 404, endpoint);
    assert.doesNotMatch(await response.text(), /Cliente secreto B|Repuesto secreto B|SECRET-B/);
  }
  for (const [endpoint, fields] of [
    ['/workshop/customers/customer-b/edit', { name: 'Intrusión' }],
    ['/workshop/vehicles/vehicle-b/archive', {}],
    [
      '/workshop/inventory/item-b/adjust',
      { quantity: '0', reason: 'Intrusión', idempotencyKey: 'cross-adjust' },
    ],
    ['/workshop/documents/file-b/delete', {}],
  ]) {
    const response = await fetch(base + endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: token, ...fields }),
    });
    assert.equal(response.status, 303, endpoint);
    assert.match(response.headers.get('location'), /error=/, endpoint);
  }
  for (const endpoint of ['/workshop/search?q=secreto', '/workshop/reports/export']) {
    const response = await fetch(base + endpoint, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /Cliente secreto B|Repuesto secreto B|SECRET-B/);
  }
  const adminCookie = await login(base, 'root@test.local', 'Strong123!');
  assert.equal(
    (await fetch(`${base}/workshop`, { headers: { cookie: adminCookie }, redirect: 'manual' }))
      .status,
    403,
  );
  const adminToken = await csrf(base, adminCookie, '/saas');
  assert.equal(
    (
      await fetch(`${base}/saas/tenants/${b.tenantId}/impersonate`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: adminCookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf: adminToken }),
      })
    ).status,
    303,
  );
  const impersonated = await fetch(`${base}/workshop`, { headers: { cookie: adminCookie } });
  assert.equal(impersonated.status, 200, serverError);
  assert.match(await impersonated.text(), /Modo soporte/);
  const verify = connectTestDatabase(db.schema);
  assert.equal(
    (await verify.prepare("SELECT name FROM customers WHERE id='customer-b'").get()).name,
    'Cliente secreto B',
  );
  assert.equal(
    (await verify.prepare("SELECT quantity FROM inventory_items WHERE id='item-b'").get()).quantity,
    2,
  );
  assert.equal(
    (await verify.prepare("SELECT active FROM vehicles WHERE id='vehicle-b'").get()).active,
    1,
  );
  assert.equal((await verify.prepare("SELECT COUNT(*) n FROM files WHERE id='file-b'").get()).n, 1);
  assert.equal(
    (await verify.prepare("SELECT status FROM work_orders WHERE id='order-b'").get()).status,
    'RECEIVED',
  );
  assert.equal(
    (
      await verify
        .prepare(
          "SELECT COUNT(*) n FROM audit_logs WHERE tenant_id=? AND action='IMPERSONATION_STARTED'",
        )
        .get(b.tenantId)
    ).n,
    1,
  );
  verify.close();
});
