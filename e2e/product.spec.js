import { test, expect } from '@playwright/test';

async function login(page, email, password) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: false }).fill(email);
  await page.getByLabel('Contraseña', { exact: false }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/(workshop|saas)$/);
}
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}
async function checkPage(page, url) {
  const response = await page.goto(url);
  expect(response.status(), url).toBe(200);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
    url + ' desborda la pantalla',
  ).toBe(false);
}

test('sitio público, legales, login y precios sin errores de navegador', async ({ page }) => {
  const errors = collectErrors(page);
  for (const url of [
    '/',
    '/features',
    '/pricing',
    '/faq',
    '/contact',
    '/terms',
    '/privacy',
    '/login',
    '/signup',
    '/forgot-password',
    '/movil',
  ])
    await checkPage(page, url);
  expect(errors).toEqual([]);
});
test('alta real desde el navegador crea organización y acceso', async ({ page }, testInfo) => {
  await page.goto('/signup');
  await page.getByLabel('Tu nombre').fill('Titular de prueba');
  await page.getByLabel('Nombre del taller').fill('Taller navegador ' + testInfo.project.name);
  await page.getByLabel('Email', { exact: false }).fill('alta-' + Date.now() + '@example.test');
  await page.getByLabel('Contraseña', { exact: false }).fill('BrowserTest123!');
  await page.locator('[name=acceptLegal]').check();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL('/workshop/onboarding');
  await expect(page.getByRole('heading', { name: 'Configura tu taller' })).toBeVisible();
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  await expect(page).toHaveURL(/\/workshop\?ok=/);
  await expect(page.locator('h1')).toContainText('Resumen');
});
test('todas las pantallas operativas y SaaS funcionan en escritorio y móvil', async ({ page }) => {
  const errors = collectErrors(page);
  await login(page, 'dueno@demo.local', 'Demo123!');
  for (const url of [
    '/workshop',
    '/workshop/orders',
    '/workshop/my-work',
    '/workshop/warranties',
    '/workshop/search?q=demo',
    '/workshop/onboarding',
    '/workshop/customers',
    '/workshop/vehicles',
    '/workshop/services',
    '/workshop/schedule',
    '/workshop/inventory',
    '/workshop/purchases',
    '/workshop/billing',
    '/workshop/reports',
    '/workshop/documents',
    '/workshop/notifications',
    '/workshop/employees',
    '/workshop/branches',
    '/workshop/subscription',
    '/workshop/support',
    '/workshop/settings',
    '/workshop/audit',
    '/account/password',
  ])
    await checkPage(page, url);
  for (const section of [
    'customers',
    'vehicles',
    'services',
    'inventory',
    'branches',
    'employees',
  ]) {
    await page.goto('/workshop/' + section);
    const edit = page.locator('a[href$="/edit"]').first();
    if (await edit.count()) await checkPage(page, await edit.getAttribute('href'));
  }
  await login(page, 'admin@mecan.local', 'Admin123!');
  for (const url of [
    '/saas',
    '/saas/tenants',
    '/saas/collections',
    '/saas/plans',
    '/saas/features',
    '/saas/support',
    '/saas/audit',
    '/saas/settings',
    '/saas/readiness',
  ])
    await checkPage(page, url);
  expect(errors).toEqual([]);
});

test('operación completa por formularios: cliente a entrega con stock, factura y cobro', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const errors = collectErrors(page);
  page.on('dialog', (dialog) => dialog.accept());
  const suffix = Date.now() + '-' + testInfo.project.name;
  await page.goto('/signup');
  await page.locator('[name=ownerName]').fill('Titular operativo');
  await page.locator('[name=workshopName]').fill('Operación ' + suffix);
  await page.locator('[name=email]').fill('operacion-' + suffix + '@example.test');
  await page.locator('[name=password]').fill('BrowserTest123!');
  await page.locator('[name=planId]').selectOption('plan-pro');
  await page.locator('[name=acceptLegal]').check();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL('/workshop/onboarding');
  await page.getByRole('button', { name: 'Guardar y continuar' }).click();
  const submit = async (action, values = {}, selects = {}) => {
    const form = page.locator(`form[method="post"][action="${action}"]`);
    await expect(form).toBeVisible();
    for (const [name, value] of Object.entries(values))
      await form.locator(`[name="${name}"]`).fill(String(value));
    for (const [name, value] of Object.entries(selects))
      await form.locator(`[name="${name}"]`).selectOption(value);
    await form.locator('button[type=submit],button:not([type])').last().click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.flash-error')).toHaveCount(0);
  };
  await page.goto('/workshop/customers');
  await submit('/workshop/customers', { name: 'Cliente operación', phone: '0981111222' });
  await expect(page.getByRole('link', { name: 'Cliente operación', exact: true })).toBeVisible();
  await page.goto('/workshop/vehicles');
  await submit(
    '/workshop/vehicles',
    { plate: 'QA1234', make: 'Toyota', model: 'Hilux', odometer: 1000 },
    { customerId: { label: 'Cliente operación' } },
  );
  await page.goto('/workshop/inventory');
  await submit(
    '/workshop/inventory',
    { name: 'Filtro de prueba', sku: 'QA-F1', quantity: 5, cost: 50000, price: 90000 },
    { branchId: { label: 'Casa central' } },
  );
  await page.goto('/workshop/orders');
  await submit(
    '/workshop/orders',
    { complaint: 'Cambio de filtro', odometer: 1000, fuelLevel: 50 },
    { customerId: { label: 'Cliente operación' }, vehicleId: { label: 'QA1234 · Toyota Hilux' } },
  );
  await expect(page).toHaveURL(/\/workshop\/orders\/[^/?]+/);
  const orderPath = new URL(page.url()).pathname;
  await submit(orderPath + '/inspection', { findings: 'Filtro deteriorado' });
  await submit(orderPath + '/diagnosis', { summary: 'Reemplazar filtro' });
  await submit(
    orderPath + '/estimate/items',
    { description: 'Cambio de filtro', quantity: 1, unitCost: 30000, unitPrice: 100000 },
    { itemType: 'LABOR' },
  );
  const itemValue = await page
    .locator(`form[action="${orderPath}/estimate/items"] [name=inventoryItemId] option`)
    .filter({ hasText: 'Filtro de prueba' })
    .getAttribute('value');
  await submit(
    orderPath + '/estimate/items',
    { description: 'Filtro', quantity: 1, unitCost: 50000, unitPrice: 90000 },
    { itemType: 'PART', inventoryItemId: itemValue },
  );
  await submit(orderPath + '/estimate/send');
  await submit(orderPath + '/estimate/approve');
  await submit(
    orderPath + '/assignments',
    { description: 'Cambiar filtro' },
    { technicianId: { label: 'Titular operativo' } },
  );
  await page.locator('form[action$="/start"]').getByRole('button').click();
  await page.waitForLoadState('domcontentloaded');
  await submit(orderPath + '/parts', { quantity: 1 }, { inventoryItemId: itemValue });
  await page.locator('form[action$="/complete"]').getByRole('button').click();
  await page.waitForLoadState('domcontentloaded');
  await submit(orderPath + '/quality/start');
  await submit(orderPath + '/quality', { notes: 'Prueba satisfactoria' }, { result: 'PASSED' });
  await submit(orderPath + '/invoice');
  const payAction = await page.locator('form[action$="/payments"]').getAttribute('action');
  await submit(payAction, { amount: 100000 }, { method: 'CASH' });
  await submit(payAction, { amount: 100000 }, { method: 'CASH' });
  await submit(payAction, { amount: 9000 }, { method: 'CASH' });
  await submit(orderPath + '/delivery', { receivedBy: 'Cliente operación', odometer: 1001 });
  await expect(page.locator('main')).toContainText('Entregado a');
  const correction = page
    .locator('details')
    .filter({ has: page.locator('form[action^="/workshop/payments/"]') })
    .first();
  const reverseAction = await correction.locator('form').getAttribute('action');
  await correction.locator('summary').click();
  await submit(reverseAction, { reason: 'Cobro registrado con un método equivocado' });
  await expect(page.locator('main')).toContainText('Revertido');
  await expect(page.locator('main')).toContainText('Entregado a');
  await submit(payAction, { amount: 100000 }, { method: 'TRANSFER' });
  await expect(page.locator('form[action$="/payments"]')).toHaveCount(0);
  if (testInfo.project.name === 'mobile')
    expect(
      await page
        .locator('.table-stacked')
        .first()
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  await page
    .locator('section.card')
    .filter({ has: page.getByRole('heading', { name: /^Factura #/ }) })
    .screenshot({ path: testInfo.outputPath('historial-cobros.png') });
  for (const type of ['estimate', 'invoice', 'delivery'])
    await checkPage(page, orderPath + '/print?type=' + type);
  await page.screenshot({ path: testInfo.outputPath('documento-entrega.png'), fullPage: true });
  await checkPage(page, '/workshop/warranties');
  await expect(page.locator('main')).toContainText('QA1234');
  const claimAction = await page.locator('form[action$="/claims"]').getAttribute('action');
  await submit(claimAction, { description: 'Revisión cubierta por garantía' });
  const resolveAction = await page.locator('form[action$="/resolve"]').getAttribute('action');
  await page.goto('/workshop/orders');
  await submit(
    '/workshop/orders',
    { complaint: 'Reparación en garantía', odometer: 1001, fuelLevel: 50 },
    { customerId: { label: 'Cliente operación' }, vehicleId: { label: 'QA1234 · Toyota Hilux' } },
  );
  const freeOrderPath = new URL(page.url()).pathname;
  await page.goto('/workshop/warranties');
  await submit(
    resolveAction,
    { resolution: 'Reparación aceptada en garantía' },
    { status: 'ACCEPTED', workOrderId: freeOrderPath.split('/').pop() },
  );
  await page.goto(freeOrderPath);
  await submit(freeOrderPath + '/inspection', { findings: 'Revisar reparación anterior' });
  await submit(freeOrderPath + '/diagnosis', { summary: 'Ajuste cubierto por garantía' });
  await submit(
    freeOrderPath + '/estimate/items',
    { description: 'Ajuste en garantía', quantity: 1, unitCost: 30000, unitPrice: 0 },
    { itemType: 'LABOR' },
  );
  await submit(freeOrderPath + '/estimate/send');
  await submit(freeOrderPath + '/estimate/approve', {
    notes: 'Sin cargo por cobertura de garantía',
  });
  await submit(
    freeOrderPath + '/assignments',
    { description: 'Realizar ajuste' },
    { technicianId: { label: 'Titular operativo' } },
  );
  await page.locator('form[action$="/start"]').getByRole('button').click();
  await page.locator('form[action$="/complete"]').getByRole('button').click();
  await submit(freeOrderPath + '/quality/start');
  await submit(freeOrderPath + '/quality', { notes: 'Ajuste verificado' }, { result: 'PASSED' });
  await submit(freeOrderPath + '/invoice');
  await expect(page.locator('main')).toContainText('Sin cargo');
  await expect(page.locator('form[action$="/payments"]')).toHaveCount(0);
  await checkPage(page, freeOrderPath + '/print?type=invoice');
  await expect(page.locator('.print-document')).toContainText('No se registró un cobro al cliente');
  await page.goto(freeOrderPath);
  await submit(freeOrderPath + '/delivery', {
    receivedBy: 'Cliente operación',
    odometer: 1002,
    warrantyDays: 0,
  });
  await page.goto('/workshop/warranties');
  await submit(resolveAction, { resolution: 'Ajuste entregado sin cargo' }, { status: 'RESOLVED' });
  await expect(page.locator('main')).toContainText('Ajuste entregado sin cargo');
  await page.goto('/workshop/inventory');
  const row = page.locator('tr').filter({ hasText: 'Filtro de prueba' });
  await expect(row.locator('td').nth(3)).toContainText('4');
  await submit('/workshop/suppliers', { name: 'Proveedor operativo' });
  await page.goto('/workshop/purchases');
  await submit(
    '/workshop/restock',
    { quantity: 2, description: 'Reposición tras reparación' },
    { inventoryItemId: { label: 'Filtro de prueba' } },
  );
  const purchaseAction = await page.locator('form[action$="/order"]').getAttribute('action');
  await submit(
    purchaseAction,
    { unitCost: 50000 },
    { supplierId: { label: 'Proveedor operativo' } },
  );
  const receiveAction = await page.locator('form[action$="/receive"]').getAttribute('action');
  await submit(receiveAction);
  const supplierPayAction = await page
    .locator('form[action^="/workshop/payables/"]')
    .getAttribute('action');
  await submit(supplierPayAction, { amount: 110000, reference: 'REC-QA' }, { method: 'TRANSFER' });
  const supplierCorrection = page
    .locator('details')
    .filter({ has: page.locator('form[action^="/workshop/purchase-payments/"]') })
    .first();
  const supplierReverseAction = await supplierCorrection.locator('form').getAttribute('action');
  await supplierCorrection.locator('summary').click();
  await submit(supplierReverseAction, {
    reason: 'Se seleccionó una referencia de pago incorrecta',
  });
  await expect(page.locator('main')).toContainText('Revertido');
  await submit(
    supplierPayAction,
    { amount: 110000, reference: 'REC-QA-CORRECTO' },
    { method: 'TRANSFER' },
  );
  if (testInfo.project.name === 'mobile')
    expect(
      await page
        .locator('.table-stacked')
        .first()
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  await page
    .locator('section.card')
    .filter({ has: page.getByRole('heading', { name: 'Historial de pagos a proveedores' }) })
    .screenshot({ path: testInfo.outputPath('historial-proveedores.png') });
  await checkPage(page, '/workshop/inventory');
  await expect(
    page.locator('tr').filter({ hasText: 'Filtro de prueba' }).locator('td').nth(3),
  ).toContainText('6');
  await checkPage(page, '/workshop/reports');
  await expect(page.locator('main')).toContainText('Margen bruto');
  await checkPage(page, '/workshop/notifications');
  const paymentNoticeAction = await page
    .locator('tr')
    .filter({ hasText: 'Pago recibido' })
    .first()
    .locator('form')
    .getAttribute('action');
  const roles = [
    { name: 'Gerencia', allowed: ['/workshop/employees', '/workshop/settings'], denied: ['/saas'] },
    {
      name: 'Recepción',
      allowed: ['/workshop/schedule', '/workshop/orders'],
      denied: ['/workshop/employees'],
    },
    {
      name: 'Mecánico',
      allowed: ['/workshop/my-work', '/workshop/inventory'],
      denied: ['/workshop/billing', '/workshop/employees'],
    },
    {
      name: 'Caja',
      allowed: ['/workshop/billing', '/workshop/purchases'],
      denied: ['/workshop/employees'],
    },
    {
      name: 'Inventario',
      allowed: ['/workshop/inventory', '/workshop/purchases'],
      denied: ['/workshop/billing', '/workshop/employees'],
    },
  ];
  await page.goto('/workshop/employees');
  for (const [index, role] of roles.entries()) {
    role.email = `empleado-${index}-${suffix}@example.test`;
    await submit(
      '/workshop/employees',
      { name: role.name + ' prueba', email: role.email, password: 'TemporalBrowser123!' },
      { roleId: { label: role.name }, branchId: { label: 'Casa central' } },
    );
  }
  for (const role of roles) {
    await page.goto('/login');
    await page.locator('[name=email]').fill(role.email);
    await page.locator('[name=password]').fill('TemporalBrowser123!');
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page).toHaveURL('/account/password');
    await submit('/account/password', {
      currentPassword: 'TemporalBrowser123!',
      password: 'PersonalBrowser123!',
      confirmation: 'PersonalBrowser123!',
    });
    for (const url of role.allowed) await checkPage(page, url);
    const forbiddenReverse = await page.request.post(reverseAction, {
      form: {
        csrf: await page.locator('[name=csrf]').first().inputValue(),
        reason: 'Intento sin permiso',
        idempotencyKey: 'role-' + role.name,
      },
      maxRedirects: 0,
    });
    expect(forbiddenReverse.headers().location).toContain('error=');
    await checkPage(page, '/workshop/notifications');
    if (['Mecánico', 'Inventario'].includes(role.name)) {
      await expect(page.locator('main')).not.toContainText('Pago recibido');
      const denied = await page.request.post(paymentNoticeAction, {
        form: { csrf: await page.locator('[name=csrf]').first().inputValue() },
        maxRedirects: 0,
      });
      expect(denied.headers().location).toContain('error=');
    } else await expect(page.locator('main')).toContainText('Pago recibido');
    const sharedNotice = page.locator('tr').filter({ hasText: 'Vehículo entregado · orden #1' });
    await expect(sharedNotice.getByRole('button', { name: 'Marcar leída' })).toBeVisible();
    await sharedNotice.getByRole('button', { name: 'Marcar leída' }).click();
    await expect(sharedNotice.getByRole('button')).toHaveCount(0);
    await expect(sharedNotice).toContainText('Leída');
    for (const url of role.denied)
      expect((await page.request.get(url)).status(), role.name + ' no debe acceder a ' + url).toBe(
        403,
      );
    if (role.name === 'Caja')
      await expect(page.locator('.sidebar a[href="/workshop/purchases"]')).toHaveCount(1);
    if (await page.locator('.app-menu-toggle').isVisible()) {
      await expect(page.locator('.sidebar')).not.toBeVisible();
      await page.locator('.app-menu-toggle').click();
      await expect(page.locator('.sidebar')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.sidebar')).not.toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
