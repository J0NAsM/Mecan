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
import { now } from '../src/utils.js';

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
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor de prueba no inició: ${getError()}`);
};

async function authenticate(base, email, password) {
  const page = await fetch(`${base}/login`),
    guestCookie = page.headers.get('set-cookie').split(';')[0],
    html = await page.text(),
    guestCsrf = html.match(/name="guestCsrf" value="([^"]+)"/)?.[1];
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: guestCookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password, guestCsrf }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0],
    workshop = await fetch(`${base}/workshop`, { headers: { cookie } }),
    workshopHtml = await workshop.text();
  assert.equal(workshop.status, 200, workshopHtml);
  return { cookie, csrf: workshopHtml.match(/name="csrf" value="([^"]+)"/)?.[1] };
}

test('HTTP completa recepción, diagnóstico, autorización, reparación, factura, cobro y entrega', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-e2e-'));
  const setup = await openTestDatabase();
  await seedDatabase(setup, {
    superadminEmail: 'root@e2e.local',
    superadminPassword: 'Strong123!',
  });
  const tenant = await provisionWorkshop(setup, {
    ownerName: 'Owner',
    workshopName: 'E2E Shop',
    email: 'owner@e2e.local',
    password: 'Strong123!',
    planId: 'plan-pro',
  });
  await setup
    .prepare('INSERT INTO customers (id,tenant_id,branch_id,name,created_at) VALUES (?,?,?,?,?)')
    .run('customer-e2e', tenant.tenantId, tenant.branchId, 'Cliente E2E', now());
  await setup
    .prepare(
      'INSERT INTO vehicles (id,tenant_id,customer_id,plate,make,model,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run('vehicle-e2e', tenant.tenantId, 'customer-e2e', 'E2E-001', 'Toyota', 'Corolla', now());
  await setup
    .prepare(
      'INSERT INTO inventory_items (id,tenant_id,branch_id,name,quantity,cost,sale_price,created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run('part-e2e', tenant.tenantId, tenant.branchId, 'Pastilla', 1, 1000, 10000, now());
  await setup.close();
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
      DATABASE_SCHEMA: setup.schema,
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
  const auth = await authenticate(base, 'owner@e2e.local', 'Strong123!');
  const post = async (url, data = {}) => {
    const response = await fetch(`${base}${url}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: auth.csrf, ...data }),
    });
    assert.equal(response.status, 303);
    assert.doesNotMatch(response.headers.get('location') || '', /error=/);
  };
  const read = async (sql, ...params) => {
    const connection = connectTestDatabase(setup.schema);
    try {
      return await connection.prepare(sql).get(...params);
    } finally {
      await connection.close();
    }
  };

  await post('/workshop/orders', {
    branchId: tenant.branchId,
    customerId: 'customer-e2e',
    vehicleId: 'vehicle-e2e',
    odometer: '42000',
    fuelLevel: '60',
    complaint: 'Ruido al frenar',
  });
  const order = await read(
    'SELECT * FROM work_orders WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1',
    tenant.tenantId,
  );
  assert.equal(order.status, 'RECEIVED');
  await post(`/workshop/orders/${order.id}/inspection`, {
    checklist: 'luces,frenos,neumáticos',
    findings: 'Pastillas delanteras desgastadas',
  });
  await post(`/workshop/orders/${order.id}/diagnosis`, {
    summary: 'Reemplazar pastillas delanteras',
    recommendations: 'Rectificar discos si corresponde',
  });
  await post(`/workshop/orders/${order.id}/estimate/items`, {
    itemType: 'LABOR',
    description: 'Servicio de frenos',
    quantity: '2',
    unitCost: '50000',
    unitPrice: '100000',
  });
  await post(`/workshop/orders/${order.id}/estimate/items`, {
    itemType: 'PART',
    inventoryItemId: 'part-e2e',
    description: 'Pastilla',
    quantity: '1',
    unitPrice: '10000',
  });
  await post(`/workshop/orders/${order.id}/estimate/send`);
  await post(`/workshop/orders/${order.id}/estimate/approve`, {
    approvedBy: 'Cliente E2E',
    notes: 'Aprobado por teléfono',
  });
  await post(`/workshop/orders/${order.id}/assignments`, {
    technicianId: tenant.userId,
    description: 'Realizar servicio de frenos',
    priority: 'HIGH',
  });
  const assignment = await read(
    'SELECT * FROM work_assignments WHERE tenant_id=? AND work_order_id=?',
    tenant.tenantId,
    order.id,
  );
  await post(`/workshop/assignments/${assignment.id}/start`, { notes: 'Inicio del trabajo' });
  await Promise.all(
    Array.from(
      { length: 8 },
      async () =>
        await post(`/workshop/orders/${order.id}/parts`, {
          inventoryItemId: 'part-e2e',
          quantity: '1',
          idempotencyKey: 'concurrent-stock',
        }),
    ),
  );
  assert.equal(
    (await read("SELECT quantity FROM inventory_items WHERE id='part-e2e'")).quantity,
    0,
  );
  assert.equal(
    (await read("SELECT COUNT(*) n FROM work_order_parts WHERE inventory_item_id='part-e2e'")).n,
    1,
  );
  await post(`/workshop/assignments/${assignment.id}/complete`, { notes: 'Trabajo completado' });
  await post(`/workshop/orders/${order.id}/quality/start`);
  await post(`/workshop/orders/${order.id}/quality`, {
    result: 'PASSED',
    checklist: 'prueba de frenado,torque',
    notes: 'Control conforme',
  });
  await Promise.all(
    Array.from(
      { length: 8 },
      async () =>
        await post(`/workshop/orders/${order.id}/invoice`, { idempotencyKey: 'e2e-invoice' }),
    ),
  );
  assert.equal(
    (await read('SELECT COUNT(*) n FROM workshop_invoices WHERE work_order_id=?', order.id)).n,
    1,
  );
  const invoice = await read(
    'SELECT * FROM workshop_invoices WHERE tenant_id=? AND work_order_id=?',
    tenant.tenantId,
    order.id,
  );
  assert.ok(invoice.balance > 0);
  await Promise.all(
    Array.from(
      { length: 8 },
      async () =>
        await post(`/workshop/invoices/${invoice.id}/payments`, {
          amount: String(invoice.balance),
          method: 'CASH',
          reference: 'REC-E2E',
          idempotencyKey: 'e2e-payment',
        }),
    ),
  );
  const overpayments = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      fetch(`${base}/workshop/invoices/${invoice.id}/payments`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          csrf: auth.csrf,
          amount: '1',
          method: 'CASH',
          idempotencyKey: 'excess-' + i,
        }),
      }),
    ),
  );
  for (const response of overpayments) assert.match(response.headers.get('location'), /error=/);
  await post(`/workshop/orders/${order.id}/delivery`, {
    receivedBy: 'Cliente E2E',
    odometer: '42020',
    warrantyDays: '90',
    warrantyTerms: 'Garantía sobre mano de obra',
  });
  const finalOrder = await read('SELECT * FROM work_orders WHERE id=?', order.id),
    finalInvoice = await read('SELECT * FROM workshop_invoices WHERE id=?', invoice.id);
  assert.equal(finalOrder.status, 'DELIVERED');
  assert.equal(finalInvoice.status, 'PAID');
  assert.equal(finalInvoice.balance, 0);
  assert.equal(
    (
      await read(
        "SELECT COUNT(*) n FROM cash_movements WHERE tenant_id=? AND category='CUSTOMER_PAYMENT'",
        tenant.tenantId,
      )
    ).n,
    1,
  );
  assert.equal(
    (
      await read(
        'SELECT COUNT(*) n FROM warranties WHERE tenant_id=? AND work_order_id=?',
        tenant.tenantId,
        order.id,
      )
    ).n,
    1,
  );
  const payment = await read('SELECT id FROM workshop_payments WHERE invoice_id=?', invoice.id);
  const reversePath = `/workshop/payments/${payment.id}/reverse`;
  const forbiddenCsrf = await fetch(`${base}${reversePath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: auth.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrf: 'invalid',
      reason: 'No autorizado',
      idempotencyKey: 'invalid-csrf',
    }),
  });
  assert.equal((await read('SELECT COUNT(*) n FROM payment_reversals')).n, 0);
  assert.ok(
    forbiddenCsrf.status === 403 ||
      (forbiddenCsrf.headers.get('location') || '').includes('error='),
  );
  await Promise.all(
    Array.from(
      { length: 8 },
      async () =>
        await post(reversePath, {
          reason: 'Registro de efectivo incorrecto',
          idempotencyKey: 'concurrent-reversal',
        }),
    ),
  );
  assert.equal(
    (await read('SELECT COUNT(*) n FROM payment_reversals WHERE customer_payment_id=?', payment.id))
      .n,
    1,
  );
  assert.equal(
    (await read('SELECT COUNT(*) n FROM cash_movements WHERE reversal_id IS NOT NULL')).n,
    1,
  );
  assert.equal(
    (await read('SELECT balance FROM workshop_invoices WHERE id=?', invoice.id)).balance,
    invoice.amount,
  );
  assert.equal(
    (await read('SELECT status FROM work_orders WHERE id=?', order.id)).status,
    'DELIVERED',
  );
  await post(`/workshop/invoices/${invoice.id}/payments`, {
    amount: String(invoice.amount),
    method: 'TRANSFER',
    idempotencyKey: 'confirmed-after-correction',
  });
  assert.equal(
    (await read('SELECT balance FROM workshop_invoices WHERE id=?', invoice.id)).balance,
    0,
  );
  assert.equal(
    (await read('SELECT COUNT(*) n FROM deliveries WHERE work_order_id=?', order.id)).n,
    1,
  );
});
