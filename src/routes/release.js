import { config, productionIssues } from '../config.js';
import { legalPage, legalDocument } from '../legal.js';
import { AppError } from '../errors.js';
import { id, now } from '../utils.js';
import { required, password as validPassword } from '../validation.js';
import { hashPassword, verifyPassword, createSession, sessionCookie } from '../auth.js';
import { assertPermission, assertTenantWritable, can } from '../tenancy.js';
import { audit } from '../domain.js';
import { catalogEditPage, stockPage } from '../pages/catalog.js';
import { catalogs, updateCatalog, archiveCatalog, restoreCatalog } from '../services/catalog.js';
import {
  removeEstimateItem,
  reviseEstimate,
  requestRestock,
  returnUnusedPart,
  warrantyClaim,
  resolveWarrantyClaim,
} from '../services/operational-closure.js';
import {
  configureWorkshop,
  updateEmployee,
  toggleEmployee,
  updateRole,
} from '../services/organization.js';
import { PERMISSIONS } from '../permissions.js';
import { reverseCustomerPayment, reverseSupplierPayment } from '../services/payment-reversals.js';
import { tenantDateTime } from '../time.js';
import { printableOrder } from '../pages/print-documents.js';
import { adjustStock, transferStock, reserveStock, releaseStock } from '../services/inventory.js';
import {
  pageHead,
  card,
  formCard,
  field,
  textarea,
  select,
  esc,
  dataTable,
  shortDate,
  badge,
  csrfInput,
  money,
} from '../ui.js';

export async function releaseGet(req, res, url, api) {
  const { db, render, requireAuth, requireWorkshop, requirePlatform, match } = api,
    p = url.pathname;
  if (p === '/workshop/theme.css') {
    requireWorkshop(req);
    const color = /^#[\da-f]{6}$/i.test(req.context.tenant.primary_color)
      ? req.context.tenant.primary_color
      : '#0f766e';
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    res.end(`.area-workshop{--green:${color}}`);
    return true;
  }
  if (['/terms', '/privacy'].includes(p)) {
    render(res, p === '/terms' ? 'Términos' : 'Privacidad', legalPage(p.slice(1)), req, url);
    return true;
  }
  if (p === '/account/password') {
    requireAuth(req);
    render(
      res,
      'Seguridad de acceso',
      pageHead(
        'CUENTA',
        'Cambiar contraseña',
        req.session.must_change_password
          ? 'Actualiza tu clave temporal antes de continuar.'
          : 'Protege tu acceso con una contraseña personal.',
      ) +
        formCard(
          'Contraseña',
          '/account/password',
          req.session.csrf_token,
          field('currentPassword', 'Contraseña actual', 'password', '', {
            required: true,
            autocomplete: 'current-password',
          }) +
            field('password', 'Nueva contraseña', 'password', '', {
              required: true,
              minlength: 10,
              autocomplete: 'new-password',
            }) +
            field('confirmation', 'Confirmar contraseña', 'password', '', {
              required: true,
              minlength: 10,
              autocomplete: 'new-password',
            }),
          'Actualizar contraseña',
        ),
      req,
      url,
      req.session.kind === 'PLATFORM' ? 'saas' : 'workshop',
    );
    return true;
  }
  let params = match('/workshop/:kind/:id/edit', p);
  if (params?.kind === 'roles') {
    requireWorkshop(req);
    assertPermission(req.context, 'employees.manage');
    const role = await db
      .prepare("SELECT * FROM roles WHERE id=? AND tenant_id=? AND code<>'OWNER'")
      .get(params.id, req.context.tenant.id);
    if (!role) throw new AppError('Rol no encontrado.', { status: 404 });
    const selected = JSON.parse(role.permissions);
    render(
      res,
      'Editar permisos',
      pageHead(
        'EQUIPO',
        'Editar rol',
        'Los cambios se aplican cerrando las sesiones de sus miembros.',
      ) +
        formCard(
          'Permisos',
          p,
          req.session.csrf_token,
          field('name', 'Nombre', 'text', role.name, { required: true }) +
            `<div class="field-wide check-grid">${PERMISSIONS.filter(([permission]) =>
              can(req.context, permission),
            )
              .map(
                ([permission, label]) =>
                  `<label class="check"><input type="checkbox" name="perm_${esc(permission)}" value="1" ${selected.includes(permission) ? 'checked' : ''}>${esc(label)}</label>`,
              )
              .join('')}</div>`,
          'Guardar permisos',
        ),
      req,
      url,
      'workshop',
    );
    return true;
  }
  const print = match('/workshop/orders/:id/print', p);
  if (print) {
    requireWorkshop(req);
    render(
      res,
      'Documento del taller',
      await printableOrder(db, req, print.id, url.searchParams.get('type') || 'estimate'),
      req,
      url,
      'workshop',
    );
    return true;
  }
  const appointment = match('/workshop/appointments/:id/receive', p);
  if (appointment) {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.create');
    const row = await db
      .prepare(
        "SELECT a.*,c.name customer,v.plate,v.odometer FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN vehicles v ON v.id=a.vehicle_id WHERE a.id=? AND a.tenant_id=? AND a.status='SCHEDULED'",
      )
      .get(appointment.id, req.context.tenant.id);
    if (!row) throw new AppError('Turno disponible no encontrado.', { status: 404 });
    const vehicles = await db
      .prepare('SELECT id,plate FROM vehicles WHERE customer_id=? AND tenant_id=? AND active=1')
      .all(row.customer_id, req.context.tenant.id);
    render(
      res,
      'Recepción desde agenda',
      pageHead(
        'RECEPCIÓN',
        row.customer,
        'Completa la inspección de ingreso para abrir la orden vinculada al turno.',
      ) +
        formCard(
          'Recibir vehículo',
          '/workshop/orders',
          req.session.csrf_token,
          `<input type="hidden" name="appointmentId" value="${row.id}"><input type="hidden" name="customerId" value="${row.customer_id}"><input type="hidden" name="branchId" value="${row.branch_id}">` +
            select(
              'vehicleId',
              'Vehículo',
              vehicles.map((v) => [v.id, v.plate]),
              row.vehicle_id,
              { required: true },
            ) +
            field('odometer', 'Kilometraje', 'number', row.odometer || 0, {
              min: 0,
              required: true,
            }) +
            field('fuelLevel', 'Combustible %', 'number', '', { min: 0, max: 100 }) +
            textarea('complaint', 'Motivo', row.reason, { required: true }) +
            textarea('visibleDamage', 'Daños visibles'),
          'Crear recepción',
        ),
      req,
      url,
      'workshop',
    );
    return true;
  }
  if (params?.kind === 'employees') {
    requireWorkshop(req);
    assertPermission(req.context, 'employees.manage');
    const member = await db
      .prepare(
        'SELECT m.*,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=? AND m.tenant_id=?',
      )
      .get(params.id, req.context.tenant.id);
    if (!member) throw new AppError('Empleado no encontrado.', { status: 404 });
    const roles = (
        await db
          .prepare("SELECT * FROM roles WHERE tenant_id=? AND code<>'OWNER'")
          .all(req.context.tenant.id)
      ).filter((r) => JSON.parse(r.permissions).every((p) => can(req.context, p))),
      branches = await db
        .prepare('SELECT id,name FROM branches WHERE tenant_id=? AND active=1')
        .all(req.context.tenant.id);
    render(
      res,
      'Editar empleado',
      pageHead(
        'EQUIPO',
        'Editar empleado',
        'Al guardar se cerrarán sus sesiones para aplicar los permisos.',
      ) +
        formCard(
          'Datos',
          p,
          req.session.csrf_token,
          field('name', 'Nombre', 'text', member.name, { required: true }) +
            field('jobTitle', 'Cargo', 'text', member.job_title) +
            select(
              'roleId',
              'Rol',
              roles.map((r) => [r.id, r.name]),
              member.role_id,
            ) +
            select(
              'branchId',
              'Sucursal',
              branches.map((r) => [r.id, r.name]),
              member.branch_id,
            ),
          'Guardar',
        ),
      req,
      url,
      'workshop',
    );
    return true;
  }
  if (params && catalogs[params.kind]) {
    requireWorkshop(req);
    assertPermission(req.context, catalogs[params.kind].permission);
    render(
      res,
      'Editar registro',
      await catalogEditPage(db, req, params.kind, params.id),
      req,
      url,
      'workshop',
    );
    return true;
  }
  params = match('/workshop/inventory/:id/movements', p);
  if (params) {
    requireWorkshop(req);
    assertPermission(req.context, 'inventory.view');
    render(
      res,
      'Movimientos de inventario',
      await stockPage(db, req, params.id),
      req,
      url,
      'workshop',
    );
    return true;
  }
  if (p === '/workshop/audit') {
    requireWorkshop(req);
    assertPermission(req.context, 'employees.manage');
    const rows = await db
      .prepare(
        'SELECT a.*,u.name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 250',
      )
      .all(req.context.tenant.id);
    render(
      res,
      'Auditoría',
      pageHead(
        'CONTROL',
        'Auditoría del taller',
        'Acciones, responsables y fechas de las operaciones.',
      ) +
        card(
          'Actividad reciente',
          dataTable(
            [
              { label: 'Fecha', render: (r) => shortDate(r.created_at) },
              { label: 'Acción', render: (r) => badge(r.action) },
              { label: 'Responsable', key: 'actor' },
              { label: 'Registro', key: 'entity_type' },
            ],
            rows,
          ),
        ),
      req,
      url,
      'workshop',
    );
    return true;
  }
  if (p === '/workshop/warranties') {
    requireWorkshop(req);
    assertPermission(req.context, 'orders.view');
    const t = req.context.tenant.id,
      csrf = req.session.csrf_token;
    const warranties = await db
      .prepare(
        'SELECT w.*,o.number,v.plate FROM warranties w JOIN work_orders o ON o.id=w.work_order_id JOIN vehicles v ON v.id=o.vehicle_id WHERE w.tenant_id=? ORDER BY w.ends_at DESC LIMIT 200',
      )
      .all(t);
    const claims = await db
      .prepare(
        'SELECT c.*,o.number,v.plate FROM warranty_claims c JOIN warranties w ON w.id=c.warranty_id JOIN work_orders o ON o.id=w.work_order_id JOIN vehicles v ON v.id=o.vehicle_id WHERE c.tenant_id=? ORDER BY c.created_at DESC LIMIT 200',
      )
      .all(t);
    const repairOrders = await db
      .prepare(
        "SELECT c.id claim_id,o.id,o.number FROM warranty_claims c JOIN warranties w ON w.id=c.warranty_id AND w.tenant_id=c.tenant_id JOIN work_orders original ON original.id=w.work_order_id AND original.tenant_id=w.tenant_id JOIN work_orders o ON o.tenant_id=c.tenant_id AND o.vehicle_id=original.vehicle_id AND o.created_at>=original.created_at AND o.id<>original.id AND o.status<>'CANCELED' WHERE c.tenant_id=? AND c.status IN ('OPEN','ACCEPTED') ORDER BY o.created_at DESC",
      )
      .all(t);
    render(
      res,
      'Garantías',
      pageHead(
        'POSVENTA',
        'Garantías y reclamos',
        'Vigencia, seguimiento y resolución de trabajos cubiertos.',
      ) +
        card(
          'Garantías',
          dataTable(
            [
              {
                label: 'Orden',
                render: (r) => `<a href="/workshop/orders/${r.work_order_id}">#${r.number}</a>`,
              },
              { label: 'Vehículo', key: 'plate' },
              { label: 'Vencimiento', render: (r) => shortDate(r.ends_at) },
              { label: 'Condiciones', key: 'terms' },
              {
                label: 'Reclamo',
                render: (r) =>
                  r.status === 'ACTIVE' && r.ends_at >= now() && can(req.context, 'orders.create')
                    ? `<form method="post" action="/workshop/warranties/${r.id}/claims">${csrfInput(csrf)}${textarea('description', 'Descripción', '', { required: true })}<button class="button button-small">Registrar</button></form>`
                    : r.ends_at < now()
                      ? 'Vencida'
                      : badge(r.status),
              },
            ],
            warranties,
          ),
        ) +
        card(
          'Reclamos',
          dataTable(
            [
              { label: 'Orden original', key: 'number' },
              { label: 'Vehículo', key: 'plate' },
              { label: 'Descripción', key: 'description' },
              { label: 'Estado', render: (r) => badge(r.status) },
              { label: 'Resolución', key: 'resolution' },
              {
                label: 'Acción',
                render: (r) =>
                  ['OPEN', 'ACCEPTED'].includes(r.status) && can(req.context, 'orders.quality')
                    ? `<form method="post" action="/workshop/warranty-claims/${r.id}/resolve">${csrfInput(csrf)}${select(
                        'status',
                        'Decisión',
                        [
                          ['ACCEPTED', 'Aceptar'],
                          ['RESOLVED', 'Resuelto'],
                          ['REJECTED', 'Rechazar'],
                        ],
                      )}${select('workOrderId', 'Orden de reparación vinculada (opcional)', [['', 'Sin reparación vinculada'], ...repairOrders.filter((order) => order.claim_id === r.id).map((order) => [order.id, 'Orden #' + order.number])], r.work_order_id || '')}${textarea('resolution', 'Resolución', r.resolution || '', { required: true })}<button class="button button-small">Guardar</button></form>`
                    : '—',
              },
            ],
            claims,
          ),
        ),
      req,
      url,
      'workshop',
    );
    return true;
  }
  if (p === '/saas/readiness') {
    requirePlatform(req);
    const issues = productionIssues(),
      failed = await db
        .prepare(
          "SELECT id,channel,title,status,attempts,created_at FROM notifications WHERE channel<>'IN_APP' AND status IN ('FAILED','PENDING','SENDING') ORDER BY created_at DESC LIMIT 100",
        )
        .all();
    const contacts = await db
      .prepare('SELECT * FROM contact_inquiries ORDER BY created_at DESC LIMIT 100')
      .all();
    render(
      res,
      'Operación de plataforma',
      pageHead(
        'OPERACIÓN',
        'Preparación y comunicaciones',
        'Estado de configuración, entregas y consultas comerciales.',
      ) +
        card(
          'Configuración de producción',
          issues.length
            ? `<ul>${issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>`
            : '<p>La configuración requerida está completa.</p>',
        ) +
        card(
          'Correos y avisos',
          dataTable(
            [
              { label: 'Fecha', render: (r) => shortDate(r.created_at) },
              { label: 'Asunto', key: 'title' },
              { label: 'Canal', key: 'channel' },
              { label: 'Estado', render: (r) => badge(r.status) },
              { label: 'Intentos', key: 'attempts' },
              {
                label: 'Acción',
                render: (r) =>
                  r.status === 'FAILED'
                    ? `<form method="post" action="/saas/notifications/${r.id}/retry">${csrfInput(req.session.csrf_token)}<button class="link-button">Reintentar</button></form>`
                    : 'En cola',
              },
            ],
            failed,
          ),
        ) +
        card(
          'Consultas comerciales',
          dataTable(
            [
              { label: 'Fecha', render: (r) => shortDate(r.created_at) },
              { label: 'Nombre', key: 'name' },
              { label: 'Email', key: 'email' },
              { label: 'Consulta', key: 'message' },
              { label: 'Estado', render: (r) => badge(r.status) },
              {
                label: 'Acción',
                render: (r) =>
                  r.status === 'NEW'
                    ? `<form method="post" action="/saas/contacts/${r.id}/close">${csrfInput(req.session.csrf_token)}<button class="link-button">Marcar atendida</button></form>`
                    : 'Atendida',
              },
            ],
            contacts,
          ),
        ),
      req,
      url,
      'saas',
    );
    return true;
  }
  return false;
}

export async function releasePost(req, res, url, data, api) {
  const {
      db,
      redirect,
      withMessage,
      requireAuth,
      requireWorkshop,
      requirePlatform,
      checkCsrf,
      match,
      tenantAuditActor,
    } = api,
    p = url.pathname;
  const reverseCustomer = match('/workshop/payments/:id/reverse', p),
    reverseSupplier = match('/workshop/purchase-payments/:id/reverse', p);
  if (reverseCustomer || reverseSupplier) {
    requireWorkshop(req);
    checkCsrf(req, data);
    const result = reverseCustomer
      ? await reverseCustomerPayment(
          db,
          req.context,
          reverseCustomer.id,
          data,
          tenantAuditActor(req),
        )
      : await reverseSupplierPayment(
          db,
          req.context,
          reverseSupplier.id,
          data,
          tenantAuditActor(req),
        );
    redirect(
      res,
      withMessage(
        reverseCustomer ? `/workshop/orders/${result.orderId}` : '/workshop/purchases',
        'Registro de pago revertido. Saldo y caja actualizados; no se realizó ninguna operación bancaria.',
      ),
    );
    return true;
  }
  if (['/workshop/onboarding', '/workshop/settings'].includes(p)) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await configureWorkshop(db, req.context, data);
    redirect(res, withMessage('/workshop', 'Configuración guardada.'));
    return true;
  }
  const employeeEdit = match('/workshop/employees/:id/edit', p),
    employeeToggle = match('/workshop/employees/:id/toggle', p);
  const roleEdit = match('/workshop/roles/:id/edit', p);
  if (roleEdit) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await updateRole(db, req.context, roleEdit.id, data);
    redirect(res, withMessage('/workshop/employees', 'Permisos actualizados.'));
    return true;
  }
  const restore = match('/workshop/:kind/:id/restore', p);
  if (restore && catalogs[restore.kind]) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await restoreCatalog(db, req.context, restore.kind, restore.id);
    redirect(
      res,
      withMessage(
        '/workshop/' + (restore.kind === 'suppliers' ? 'inventory' : restore.kind),
        'Registro reactivado.',
      ),
    );
    return true;
  }
  const appointmentChange = match('/workshop/appointments/:id/change', p);
  if (appointmentChange) {
    requireWorkshop(req);
    checkCsrf(req, data);
    assertPermission(req.context, 'orders.create');
    assertTenantWritable(req.context);
    const row = await db
      .prepare("SELECT * FROM appointments WHERE id=? AND tenant_id=? AND status='SCHEDULED'")
      .get(appointmentChange.id, req.context.tenant.id);
    if (!row) throw new AppError('Turno disponible no encontrado.', { status: 404 });
    const status = data.action === 'cancel' ? 'CANCELED' : 'SCHEDULED',
      scheduled =
        status === 'CANCELED'
          ? row.scheduled_at
          : await tenantDateTime(db, req.context.tenant.id, data.scheduledAt);

    try {
      await db.transaction(
        async () => {
          await db
            .prepare('UPDATE appointments SET status=?,scheduled_at=? WHERE id=? AND tenant_id=?')
            .run(status, scheduled, row.id, req.context.tenant.id);
          await audit(db, {
            tenantId: req.context.tenant.id,
            actorUserId: req.session.user_id,
            action: status === 'CANCELED' ? 'APPOINTMENT_CANCELED' : 'APPOINTMENT_RESCHEDULED',
            entityType: 'appointment',
            entityId: row.id,
            before: { status: row.status, scheduledAt: row.scheduled_at },
            after: { status, scheduledAt: scheduled },
          });
        },
        {
          lockKey: req.context?.tenant?.id
            ? 'tenant:' + req.context.tenant.id
            : 'platform:configuration',
        },
      );
    } catch (error) {
      throw error;
    }
    redirect(res, withMessage('/workshop/schedule', 'Turno actualizado.'));
    return true;
  }
  if (employeeEdit || employeeToggle) {
    requireWorkshop(req);
    checkCsrf(req, data);
    if (employeeEdit) await updateEmployee(db, req.context, employeeEdit.id, data);
    else await toggleEmployee(db, req.context, employeeToggle.id);
    redirect(res, withMessage('/workshop/employees', 'Empleado actualizado.'));
    return true;
  }
  for (const [pattern, action, next] of [
    [
      '/workshop/estimate-items/:id/remove',
      async (id) => await removeEstimateItem(db, req.context, id),
      () => '/workshop/orders',
    ],
    [
      '/workshop/orders/:id/revise-estimate',
      async (id) => await reviseEstimate(db, req.context, id, data),
      (id) => '/workshop/orders/' + id,
    ],
    [
      '/workshop/parts/:id/return',
      async (id) => await returnUnusedPart(db, req.context, id, data),
      (_id, result) => '/workshop/orders/' + result,
    ],
    [
      '/workshop/warranties/:id/claims',
      async (id) => await warrantyClaim(db, req.context, id, data),
      () => '/workshop/warranties',
    ],
    [
      '/workshop/warranty-claims/:id/resolve',
      async (id) => await resolveWarrantyClaim(db, req.context, id, data),
      () => '/workshop/warranties',
    ],
  ]) {
    const values = match(pattern, p);
    if (values) {
      requireWorkshop(req);
      checkCsrf(req, data);
      const result = await action(values.id);
      redirect(res, withMessage(next(values.id, result), 'Operación registrada.'));
      return true;
    }
  }
  if (p === '/workshop/restock') {
    requireWorkshop(req);
    checkCsrf(req, data);
    await requestRestock(db, req.context, data);
    redirect(res, withMessage('/workshop/purchases', 'Solicitud de reposición creada.'));
    return true;
  }
  if (p === '/account/password') {
    requireAuth(req);
    checkCsrf(req, data);
    const password = validPassword(data.password);
    if (password !== data.confirmation)
      throw new AppError('Las contraseñas no coinciden.', { status: 422 });

    let session;
    try {
      await db.transaction(
        async () => {
          const user = await db
            .prepare(
              `SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
            WHERE u.id=? AND s.id=? AND u.active=1 AND s.expires_at>?`,
            )
            .get(req.session.user_id, req.session.id, now());
          if (!user)
            throw new AppError('Tu sesión cambió. Inicia sesión nuevamente.', { status: 401 });
          if (!verifyPassword(data.currentPassword, user.password_hash))
            throw new AppError('La contraseña actual no es correcta.', { status: 422 });
          await db
            .prepare(
              'UPDATE users SET password_hash=?,password_changed_at=?,must_change_password=0 WHERE id=?',
            )
            .run(hashPassword(password), now(), user.id);
          await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          await db
            .prepare(
              'UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL',
            )
            .run(now(), user.id);
          session = await createSession(db, user.id, config.sessionDays);
          await audit(db, {
            scope: user.kind === 'PLATFORM' ? 'PLATFORM' : 'TENANT',
            tenantId: req.context.tenant?.id || null,
            actorUserId: user.id,
            action: 'PASSWORD_CHANGED',
          });
        },
        {
          lockKey: 'account:' + req.session.user_id,
        },
      );
    } catch (error) {
      throw error;
    }
    redirect(
      res,
      withMessage('/app', 'Contraseña actualizada.'),
      sessionCookie(session.id, config.secureTransport, config.sessionDays),
    );
    return true;
  }
  let params = match('/workshop/:kind/:id/edit', p);
  if (params && catalogs[params.kind]) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await updateCatalog(db, req.context, params.kind, params.id, data, tenantAuditActor(req));
    redirect(
      res,
      withMessage(
        '/workshop/' + (params.kind === 'suppliers' ? 'inventory' : params.kind),
        'Cambios guardados.',
      ),
    );
    return true;
  }
  params = match('/workshop/:kind/:id/archive', p);
  if (params && catalogs[params.kind]) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await archiveCatalog(db, req.context, params.kind, params.id, tenantAuditActor(req));
    redirect(
      res,
      withMessage(
        '/workshop/' + (params.kind === 'suppliers' ? 'inventory' : params.kind),
        'Registro archivado. Su historial se conserva.',
      ),
    );
    return true;
  }
  params = match('/workshop/inventory/:id/:action', p);
  if (params && ['adjust', 'transfer'].includes(params.action)) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await (params.action === 'adjust' ? adjustStock : transferStock)(
      db,
      req.context,
      params.id,
      data,
    );
    redirect(
      res,
      withMessage(`/workshop/inventory/${params.id}/movements`, 'Movimiento registrado.'),
    );
    return true;
  }
  params = match('/workshop/orders/:id/reservations', p);
  if (params) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await reserveStock(db, req.context, params.id, data);
    redirect(res, withMessage(`/workshop/orders/${params.id}`, 'Stock reservado.'));
    return true;
  }
  params = match('/workshop/reservations/:id/release', p);
  if (params) {
    requireWorkshop(req);
    checkCsrf(req, data);
    await releaseStock(db, req.context, params.id);
    redirect(res, withMessage('/workshop/inventory', 'Reserva liberada.'));
    return true;
  }
  params = match('/saas/notifications/:id/retry', p);
  if (params) {
    requirePlatform(req);
    checkCsrf(req, data);
    const result = await db
      .prepare(
        "UPDATE notifications SET status='PENDING',attempts=0,next_attempt_at=NULL,locked_until=NULL WHERE id=? AND status='FAILED'",
      )
      .run(params.id);
    if (!result.changes)
      throw new AppError('Aviso no encontrado o ya en proceso.', { status: 404 });
    await audit(db, {
      scope: 'PLATFORM',
      actorUserId: req.session.user_id,
      action: 'NOTIFICATION_RETRIED',
      entityType: 'notification',
      entityId: params.id,
    });
    redirect(res, withMessage('/saas/readiness', 'Aviso añadido a la cola.'));
    return true;
  }
  params = match('/saas/contacts/:id/close', p);
  if (params) {
    requirePlatform(req);
    checkCsrf(req, data);
    await db.prepare("UPDATE contact_inquiries SET status='CLOSED' WHERE id=?").run(params.id);
    redirect(res, withMessage('/saas/readiness', 'Consulta marcada como atendida.'));
    return true;
  }
  return false;
}
