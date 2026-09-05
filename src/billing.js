import { id, now, addDays, addMonths } from './utils.js';
import { audit } from './domain.js';
import { queueNotification } from './notifications.js';
import { positive, oneOf, optional, required } from './validation.js';
import { paymentTimestamp } from './time.js';
import { roundMoney, moneyAmount } from './money.js';
const subscriptionCharge = (sub) =>
  roundMoney(Number(sub.price) * (1 - Number(sub.discount_percent || 0) / 100), sub.currency);

const cycleMonths = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

export class PaymentProvider {
  get code() {
    throw new Error('Provider code requerido');
  }
  normalize(_event) {
    throw new Error('normalize debe implementarse');
  }
}

export class ManualPaymentProvider extends PaymentProvider {
  get code() {
    return 'manual';
  }
  normalize(input) {
    return { ...input, status: 'APPROVED', externalId: input.reference || id() };
  }
}

export class PaymentRegistry {
  constructor(providers = [new ManualPaymentProvider()]) {
    this.providers = new Map(providers.map((p) => [p.code, p]));
  }
  get(code) {
    const provider = this.providers.get(code);
    if (!provider) throw new Error(`Proveedor ${code} no configurado`);
    return provider;
  }
}

export async function platformSetting(db, key, fallback = null) {
  return (
    (await db.prepare('SELECT value FROM platform_settings WHERE key=?').get(key))?.value ??
    fallback
  );
}

async function nextInvoiceNumber(db, date = new Date()) {
  const year = date.getUTCFullYear();
  await db
    .prepare(
      'INSERT INTO platform_sequences (kind,year,next_value) VALUES (?, ?, 1) ON CONFLICT(kind,year) DO NOTHING',
    )
    .run('SAAS_INVOICE', year);
  const value = Number(
    (
      await db
        .prepare(
          'UPDATE platform_sequences SET next_value=next_value+1 WHERE kind=? AND year=? RETURNING next_value-1 value',
        )
        .get('SAAS_INVOICE', year)
    ).value,
  );
  return `SAAS-${year}-${String(value).padStart(6, '0')}`;
}

export async function refreshSubscriptionStates(db, at = new Date()) {
  const current = at.toISOString();
  const graceDays = Number(await platformSetting(db, 'grace_days', 5));
  const suspensionDays = Number(await platformSetting(db, 'suspension_days', 10));
  for (const candidate of await db
    .prepare("SELECT id,tenant_id FROM subscriptions WHERE status <> 'CANCELED'")
    .all()) {
    try {
      await db.transaction(
        async () => {
          const sub = await db
            .prepare(
              `SELECT s.*,t.status tenant_status,t.name tenant_name
            FROM subscriptions s JOIN tenants t ON t.id=s.tenant_id WHERE s.id=? AND s.tenant_id=?`,
            )
            .get(candidate.id, candidate.tenant_id);
          if (
            !sub ||
            ['SUSPENDED', 'BLOCKED', 'CANCELED'].includes(sub.tenant_status) ||
            sub.status === 'CANCELED'
          )
            return;
          const due = new Date(sub.next_charge_at),
            daysLate = Math.floor((at - due) / 86400000);
          const charge = subscriptionCharge(sub);
          if (daysLate < 0 && daysLate >= -7)
            await queueNotification(db, {
              tenantId: sub.tenant_id,
              eventType: 'SUBSCRIPTION_DUE_SOON',
              title: daysLate >= -1 ? 'Tu suscripción vence mañana' : 'Tu suscripción vence pronto',
              message:
                'Revisa Mi suscripción para conocer el importe, la fecha y las instrucciones de pago.',
              payload: { subscriptionId: sub.id },
              idempotencyKey: `subscription-reminder:${sub.id}:${sub.next_charge_at}:${daysLate >= -1 ? 'one' : 'seven'}`,
            });
          if (daysLate >= 0 && charge === 0) {
            await db
              .prepare(
                "UPDATE subscriptions SET next_charge_at=?,status='ACTIVE',updated_at=? WHERE id=?",
              )
              .run(addMonths(current, cycleMonths[sub.billing_cycle] || 1), current, sub.id);
            await db.prepare("UPDATE tenants SET status='ACTIVE' WHERE id=?").run(sub.tenant_id);
            await db.prepare('UPDATE trials SET active=0 WHERE tenant_id=?').run(sub.tenant_id);

            return;
          }
          if (daysLate >= 0) {
            const months = cycleMonths[sub.billing_cycle] || 1,
              periodEnd = addMonths(sub.next_charge_at, months);
            const existing = await db
              .prepare(
                'SELECT id FROM saas_invoices WHERE subscription_id=? AND period_start=? AND period_end=?',
              )
              .get(sub.id, sub.next_charge_at, periodEnd);
            if (!existing)
              await db
                .prepare(
                  `INSERT INTO saas_invoices (id,tenant_id,subscription_id,number,amount,currency,period_start,period_end,due_at,status,created_at,paid_amount,balance)
          VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?,0,?)`,
                )
                .run(
                  id(),
                  sub.tenant_id,
                  sub.id,
                  await nextInvoiceNumber(db, at),
                  charge,
                  sub.currency,
                  sub.next_charge_at,
                  periodEnd,
                  sub.next_charge_at,
                  current,
                  charge,
                );
          }
          let status = sub.status,
            tenantStatus = sub.tenant_status;
          if (sub.status === 'TRIAL' && daysLate < 0) {
            status = 'TRIAL';
            tenantStatus = 'TRIAL';
          } else if (daysLate < 0) {
            status = 'ACTIVE';
            tenantStatus = 'ACTIVE';
          } else if (daysLate < graceDays) {
            status = 'OVERDUE';
            tenantStatus = 'OVERDUE';
          } else if (daysLate < suspensionDays) {
            status = 'GRACE';
            tenantStatus = 'GRACE';
          } else {
            status = 'SUSPENDED';
            tenantStatus = 'SUSPENDED';
          }
          if (status !== sub.status || tenantStatus !== sub.tenant_status) {
            await db
              .prepare('UPDATE subscriptions SET status=?,grace_until=?,updated_at=? WHERE id=?')
              .run(status, addDays(due, graceDays), current, sub.id);
            await db
              .prepare('UPDATE tenants SET status=? WHERE id=?')
              .run(tenantStatus, sub.tenant_id);
            await audit(db, {
              scope: 'PLATFORM',
              tenantId: sub.tenant_id,
              action: 'SUBSCRIPTION_STATUS_CHANGED',
              entityType: 'subscription',
              entityId: sub.id,
              before: { status: sub.status, tenantStatus: sub.tenant_status },
              after: { status, tenantStatus },
            });
            await queueNotification(db, {
              tenantId: sub.tenant_id,
              eventType: `SUBSCRIPTION_${status}`,
              title:
                status === 'SUSPENDED'
                  ? 'Cuenta suspendida por vencimiento'
                  : 'Estado de suscripción actualizado',
              message:
                status === 'SUSPENDED'
                  ? 'La información permanece protegida en modo consulta. Registra el pago para reactivar la operación.'
                  : status === 'OVERDUE'
                    ? 'Tu suscripción venció. Revisa las instrucciones de pago.'
                    : status === 'GRACE'
                      ? 'Tu cuenta está en período de gracia. Regulariza el pago para evitar la suspensión.'
                      : 'Tu suscripción está activa.',
              payload: { subscriptionId: sub.id, status },
              idempotencyKey: `subscription-state:${sub.id}:${status}:${sub.next_charge_at}`,
            });
          }
        },
        { lockKey: 'tenant:' + candidate.tenant_id },
      );
    } catch (error) {
      throw error;
    }
  }
}

export async function recordManualPayment(db, input, actorUserId, ip = null) {
  return await db.transaction(
    async () => {
      const tenant = await db.prepare('SELECT * FROM tenants WHERE id=?').get(input.tenantId);
      const sub = await db
        .prepare('SELECT * FROM subscriptions WHERE tenant_id=?')
        .get(input.tenantId);
      if (!tenant || !sub)
        throw Object.assign(new Error('Taller o suscripción no encontrados.'), { status: 404 });
      const amount = moneyAmount(input.amount, sub.currency, 'El monto'),
        reference = required(input.reference, 'La referencia del pago', { max: 200 }),
        method = oneOf(
          input.method || 'TRANSFER',
          ['TRANSFER', 'CASH', 'CARD', 'OTHER'],
          'El método de pago',
        );
      const registry = new PaymentRegistry();
      const normalized = registry.get('manual').normalize({ ...input, reference });
      const paidAt = paymentTimestamp(input.paidAt),
        months = cycleMonths[sub.billing_cycle] || 1;
      let periodStart = sub.next_charge_at;
      let periodEnd = addMonths(periodStart, months);
      const paymentId = id();

      try {
        return await db.transaction(async () => {
          const existing = await db
            .prepare('SELECT * FROM saas_payments WHERE provider=? AND provider_payment_id=?')
            .get('manual', normalized.externalId);
          if (existing) {
            if (
              existing.tenant_id !== tenant.id ||
              Number(existing.amount) !== amount ||
              existing.currency !== sub.currency ||
              existing.method !== method ||
              (input.paidAt && existing.paid_at !== paidAt)
            )
              throw Object.assign(new Error('La referencia ya fue utilizada con otros datos.'), {
                status: 409,
              });

            return { paymentId: existing.id, duplicate: true };
          }
          let invoice = await db
            .prepare(
              "SELECT * FROM saas_invoices WHERE tenant_id=? AND status IN ('PENDING','PARTIAL') ORDER BY due_at,created_at LIMIT 1",
            )
            .get(tenant.id);
          if (!invoice) {
            const invoiceId = id(),
              invoiceNumber = await nextInvoiceNumber(db, new Date(paidAt)),
              invoiceAmount = positive(subscriptionCharge(sub), 'El precio de la suscripción');
            await db
              .prepare(
                `INSERT INTO saas_invoices (id,tenant_id,subscription_id,number,amount,currency,period_start,period_end,due_at,status,created_at,paid_amount,balance)
        VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?,0,?)`,
              )
              .run(
                invoiceId,
                tenant.id,
                sub.id,
                invoiceNumber,
                invoiceAmount,
                sub.currency,
                periodStart,
                periodEnd,
                sub.next_charge_at,
                now(),
                invoiceAmount,
              );
            invoice = await db.prepare('SELECT * FROM saas_invoices WHERE id=?').get(invoiceId);
          }
          periodStart = invoice.period_start;
          periodEnd = invoice.period_end;
          const currentBalance = Number(invoice.balance);
          if (amount > currentBalance)
            throw Object.assign(
              new Error(`El pago supera el saldo pendiente de ${currentBalance}.`),
              {
                status: 409,
              },
            );
          const newPaid = roundMoney(Number(invoice.paid_amount || 0) + amount, sub.currency),
            newBalance = roundMoney(currentBalance - amount, sub.currency),
            invoiceStatus = newBalance === 0 ? 'PAID' : 'PARTIAL';
          await db
            .prepare(
              `INSERT INTO saas_payments (id,tenant_id,subscription_id,invoice_id,amount,currency,paid_at,method,reference,notes,period_start,period_end,provider,provider_payment_id,status,recorded_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              paymentId,
              tenant.id,
              sub.id,
              invoice.id,
              amount,
              sub.currency,
              paidAt,
              method,
              reference,
              optional(input.notes, { max: 2000 }),
              periodStart,
              periodEnd,
              'manual',
              normalized.externalId,
              'APPROVED',
              actorUserId,
              now(),
            );
          await db
            .prepare(
              'UPDATE saas_invoices SET status=?,paid_at=?,paid_amount=?,balance=? WHERE id=?',
            )
            .run(invoiceStatus, newBalance === 0 ? paidAt : null, newPaid, newBalance, invoice.id);
          const outstanding = Number(
              (
                await db
                  .prepare(
                    "SELECT COALESCE(SUM(balance),0) total FROM saas_invoices WHERE tenant_id=? AND status IN ('PENDING','PARTIAL')",
                  )
                  .get(tenant.id)
              ).total,
            ),
            reactivated =
              newBalance === 0 &&
              outstanding === 0 &&
              !['BLOCKED', 'CANCELED'].includes(tenant.status);
          if (reactivated) {
            // A suspended service does not accrue additional unpaid periods. An expired
            // purchased period restarts on full settlement; its original invoice is preserved.
            const serviceEnd = periodEnd < now() ? addMonths(now(), months) : periodEnd;
            await db
              .prepare(
                "UPDATE subscriptions SET status='ACTIVE',next_charge_at=?,grace_until=NULL,updated_at=? WHERE id=?",
              )
              .run(serviceEnd, now(), sub.id);
            await db
              .prepare("UPDATE tenants SET status='ACTIVE',canceled_at=NULL WHERE id=?")
              .run(tenant.id);
            await db.prepare('UPDATE trials SET active=0 WHERE tenant_id=?').run(tenant.id);
            await queueNotification(db, {
              tenantId: tenant.id,
              eventType: 'SUBSCRIPTION_REACTIVATED',
              title: 'Suscripción reactivada',
              message: 'El pago fue verificado y tu taller puede volver a operar.',
              payload: { subscriptionId: sub.id, nextChargeAt: serviceEnd },
              idempotencyKey: 'reactivated:' + paymentId,
            });
          }
          await db
            .prepare(
              'INSERT INTO subscription_history (id,tenant_id,subscription_id,event,metadata,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?)',
            )
            .run(
              id(),
              tenant.id,
              sub.id,
              newBalance === 0 ? 'PAYMENT_RECORDED' : 'PARTIAL_PAYMENT_RECORDED',
              JSON.stringify({ paymentId, amount, balance: newBalance, periodEnd }),
              actorUserId,
              now(),
            );
          await audit(db, {
            scope: 'PLATFORM',
            tenantId: tenant.id,
            actorUserId,
            action: 'SAAS_PAYMENT_RECORDED',
            entityType: 'saas_payment',
            entityId: paymentId,
            ip,
            metadata: { amount, balance: newBalance, reference: input.reference },
          });

          return {
            paymentId,
            invoiceId: invoice.id,
            balance: newBalance,
            reactivated,
            duplicate: false,
          };
        }, {});
      } catch (error) {
        throw error;
      }
    },
    { lockKey: 'tenant:' + input.tenantId },
  );
}

export async function changeSubscription(db, tenantId, input, actorUserId) {
  return await db.transaction(
    async () => {
      const sub = await db.prepare('SELECT * FROM subscriptions WHERE tenant_id=?').get(tenantId);
      const plan = await db
        .prepare('SELECT * FROM plans WHERE id=? AND active=1')
        .get(input.planId);
      if (!sub || !plan)
        throw Object.assign(new Error('Suscripción o plan inválidos.'), { status: 404 });
      const billingCycle = oneOf(
          input.billingCycle || sub.billing_cycle,
          Object.keys(cycleMonths),
          'El ciclo de facturación',
        ),
        price = moneyAmount(input.price ?? plan.price_monthly, plan.currency, 'El precio', {
          allowZero: true,
        }),
        discount = positive(input.discount || 0, 'El descuento', { allowZero: true, max: 100 });
      if (input.autoRenew === '1')
        throw Object.assign(new Error('No hay una pasarela configurada para cargos automáticos.'), {
          status: 422,
        });
      if (
        sub.currency !== plan.currency &&
        (await db
          .prepare('SELECT 1 FROM saas_invoices WHERE tenant_id=? AND balance>0')
          .get(tenantId))
      )
        throw Object.assign(
          new Error('Cancela la deuda antes de cambiar la moneda de la suscripción.'),
          { status: 409 },
        );

      try {
        await db.transaction(
          async () => {
            await db
              .prepare(
                'UPDATE subscriptions SET plan_id=?,billing_cycle=?,price=?,currency=?,auto_renew=?,discount_percent=?,promotion=?,updated_at=? WHERE id=?',
              )
              .run(
                plan.id,
                billingCycle,
                price,
                plan.currency,
                Number(input.autoRenew === '1'),
                discount,
                optional(input.promotion, { max: 200 }),
                now(),
                sub.id,
              );
            await db
              .prepare(
                'INSERT INTO subscription_history (id,tenant_id,subscription_id,event,from_plan_id,to_plan_id,metadata,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
              )
              .run(
                id(),
                tenantId,
                sub.id,
                'PLAN_CHANGED',
                sub.plan_id,
                plan.id,
                '{}',
                actorUserId,
                now(),
              );
            await audit(db, {
              scope: 'PLATFORM',
              tenantId,
              actorUserId,
              action: 'PLAN_CHANGED',
              entityType: 'subscription',
              entityId: sub.id,
              metadata: { from: sub.plan_id, to: plan.id },
            });
          },
          { lockKey: 'tenant:' + tenantId },
        );
      } catch (error) {
        throw error;
      }
    },
    { lockKey: 'tenant:' + tenantId },
  );
}

export async function setTenantStatus(db, tenantId, status, actorUserId, reason = '') {
  return await db.transaction(
    async () => {
      const allowed = new Set([
        'ACTIVE',
        'PAYMENT_PENDING',
        'OVERDUE',
        'GRACE',
        'SUSPENDED',
        'CANCELED',
        'BLOCKED',
      ]);
      if (!allowed.has(status)) throw Object.assign(new Error('Estado inválido.'), { status: 422 });
      const tenant = await db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
      if (!tenant) throw Object.assign(new Error('Taller no encontrado.'), { status: 404 });
      const timestamp = now();
      const retentionDays = Number(await platformSetting(db, 'retention_days', 365));
      reason = required(reason, 'El motivo del cambio', { max: 1500 });

      try {
        await db.transaction(
          async () => {
            await db
              .prepare(
                'UPDATE tenants SET status=?,canceled_at=?,deletion_eligible_at=? WHERE id=?',
              )
              .run(
                status,
                status === 'CANCELED' ? timestamp : null,
                status === 'CANCELED' ? addDays(timestamp, retentionDays) : null,
                tenantId,
              );
            await db
              .prepare(
                'UPDATE subscriptions SET status=?,canceled_at=?,updated_at=? WHERE tenant_id=?',
              )
              .run(status, status === 'CANCELED' ? timestamp : null, timestamp, tenantId);
            await audit(db, {
              scope: 'PLATFORM',
              tenantId,
              actorUserId,
              action: `TENANT_${status}`,
              entityType: 'tenant',
              entityId: tenantId,
              metadata: { reason, previous: tenant.status },
            });
          },
          { lockKey: 'tenant:' + tenantId },
        );
      } catch (error) {
        throw error;
      }
    },
    { lockKey: 'tenant:' + tenantId },
  );
}

export async function platformMetrics(db) {
  const tenantCounts = Object.fromEntries(
    (await db.prepare('SELECT status,COUNT(*) value FROM tenants GROUP BY status').all()).map(
      (x) => [x.status, Number(x.value)],
    ),
  );
  const active = Number(
    (
      await db
        .prepare(
          "SELECT COUNT(*) total FROM tenants WHERE status IN ('ACTIVE','TRIAL','PAYMENT_PENDING','OVERDUE','GRACE')",
        )
        .get()
    ).total,
  );
  // Never add amounts expressed in different currencies, and do not count trials in ARPU.
  const periods = [now().slice(0, 7), addMonths(now(), -1).slice(0, 7)];
  const byCurrency = new Map();
  const financial = (currency) => {
    if (!byCurrency.has(currency))
      byCurrency.set(currency, {
        currency,
        payingCustomers: 0,
        mrr: 0,
        revenue: 0,
        previousRevenue: 0,
      });
    return byCurrency.get(currency);
  };
  for (const row of await db
    .prepare(
      `SELECT currency, COUNT(*) customers,
    SUM(price*(1-discount_percent/100.0)/(CASE billing_cycle WHEN 'ANNUAL' THEN 12 WHEN 'SEMIANNUAL' THEN 6 WHEN 'QUARTERLY' THEN 3 ELSE 1 END)) amount
    FROM subscriptions WHERE status IN ('ACTIVE','PAYMENT_PENDING','OVERDUE','GRACE') AND price>0 AND discount_percent<100 GROUP BY currency`,
    )
    .all()) {
    Object.assign(financial(row.currency), {
      mrr: Number(row.amount),
      payingCustomers: Number(row.customers),
    });
  }
  for (const row of await db
    .prepare(
      `SELECT currency,substr(paid_at,1,7) period,SUM(amount) amount FROM saas_payments
    WHERE status='APPROVED' AND substr(paid_at,1,7) IN (?,?) GROUP BY currency,period`,
    )
    .all(...periods)) {
    financial(row.currency)[row.period === periods[0] ? 'revenue' : 'previousRevenue'] = Number(
      row.amount,
    );
  }
  const financials = [...byCurrency.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((row) => ({
      ...row,
      arr: row.mrr * 12,
      arpu: row.payingCustomers ? row.mrr / row.payingCustomers : 0,
      growth: row.previousRevenue
        ? ((row.revenue - row.previousRevenue) / row.previousRevenue) * 100
        : row.revenue
          ? 100
          : 0,
    }));
  // Compatibility for a single currency; mixed-currency totals are deliberately unavailable.
  const single =
    financials.length <= 1
      ? financials[0] || { mrr: 0, arr: 0, arpu: 0, revenue: 0, previousRevenue: 0, growth: 0 }
      : {};
  const canceled30 = Number(
    (
      await db
        .prepare("SELECT COUNT(*) total FROM tenants WHERE status='CANCELED' AND canceled_at>=?")
        .get(addDays(now(), -30))
    ).total,
  );
  const start30 = Number(
    (
      await db
        .prepare('SELECT COUNT(*) total FROM tenants WHERE created_at<?')
        .get(addDays(now(), -30))
    ).total,
  );
  const totalTrials = Number(
    (await db.prepare('SELECT COUNT(DISTINCT tenant_id) total FROM trials').get()).total,
  );
  const converted = Number(
    (
      await db
        .prepare(
          "SELECT COUNT(DISTINCT tr.tenant_id) total FROM trials tr JOIN saas_payments p ON p.tenant_id=tr.tenant_id AND p.status='APPROVED'",
        )
        .get()
    ).total,
  );
  return {
    tenantCounts,
    active,
    financials,
    mrr: single.mrr ?? null,
    arr: single.arr ?? null,
    arpu: single.arpu ?? null,
    revenue: single.revenue ?? null,
    previousRevenue: single.previousRevenue ?? null,
    growth: single.growth ?? null,
    churn: start30 ? (canceled30 / start30) * 100 : 0,
    newThisMonth: Number(
      (
        await db
          .prepare('SELECT COUNT(*) total FROM tenants WHERE substr(created_at,1,7)=substr(?,1,7)')
          .get(now())
      ).total,
    ),
    overdue: Number(
      (
        await db
          .prepare(
            "SELECT COUNT(*) total FROM tenants WHERE status IN ('OVERDUE','GRACE','SUSPENDED')",
          )
          .get()
      ).total,
    ),
    trials: Number(
      (await db.prepare("SELECT COUNT(*) total FROM tenants WHERE status='TRIAL'").get()).total,
    ),
    trialConversion: totalTrials ? (converted / totalTrials) * 100 : 0,
    cancellations: Number(
      (await db.prepare("SELECT COUNT(*) total FROM tenants WHERE status='CANCELED'").get()).total,
    ),
    renewals: Number(
      (
        await db
          .prepare(
            "SELECT COUNT(*) total FROM subscriptions WHERE next_charge_at BETWEEN ? AND ? AND status!='CANCELED'",
          )
          .get(now(), addDays(now(), 7))
      ).total,
    ),
    activeUsers: Number(
      (
        await db
          .prepare('SELECT COUNT(*) total FROM users WHERE active=1 AND last_activity_at>=?')
          .get(addDays(now(), -30))
      ).total,
    ),
    branches: Number(
      (await db.prepare('SELECT COUNT(*) total FROM branches WHERE active=1').get()).total,
    ),
    storageBytes: Number(
      (await db.prepare('SELECT COALESCE(SUM(storage_used_bytes),0) total FROM tenants').get())
        .total,
    ),
  };
}

export async function billingRows(db) {
  const rows = await db
    .prepare(
      `SELECT t.id,t.name,t.owner_name,p.name plan,s.price,s.currency,s.billing_cycle,s.next_charge_at,s.status,
    (SELECT MAX(paid_at) FROM saas_payments sp WHERE sp.tenant_id=t.id AND sp.status='APPROVED') last_payment,
    GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-s.next_charge_at::timestamptz))/86400)::integer) days_late,
    GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (s.next_charge_at::timestamptz-CURRENT_TIMESTAMP))/86400)::integer) days_until,
    COALESCE((SELECT SUM(si.balance) FROM saas_invoices si WHERE si.tenant_id=t.id AND si.status IN ('PENDING','PARTIAL')),0) debt
    FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN plans p ON p.id=s.plan_id ORDER BY s.next_charge_at`,
    )
    .all();
  return rows.map((row) => ({
    ...row,
    debt: Number(row.debt),
    collectionState:
      row.status === 'SUSPENDED'
        ? 'SUSPENDED'
        : row.status === 'GRACE'
          ? 'GRACE'
          : row.status === 'OVERDUE'
            ? 'OVERDUE'
            : row.days_until <= 7
              ? 'DUE_SOON'
              : 'CURRENT',
  }));
}
