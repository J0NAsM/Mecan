import { id, now, addDays, addMonths } from './utils.js';
import { audit } from './domain.js';
import { queueNotification } from './notifications.js';

const cycleMonths = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

export class PaymentProvider {
  get code() { throw new Error('Provider code requerido'); }
  normalize(_event) { throw new Error('normalize debe implementarse'); }
}

export class ManualPaymentProvider extends PaymentProvider {
  get code() { return 'manual'; }
  normalize(input) { return { status: 'APPROVED', externalId: input.reference || id(), ...input }; }
}

export class PaymentRegistry {
  constructor(providers = [new ManualPaymentProvider()]) { this.providers = new Map(providers.map(p => [p.code,p])); }
  get(code) { const provider = this.providers.get(code); if (!provider) throw new Error(`Proveedor ${code} no configurado`); return provider; }
}

export function platformSetting(db, key, fallback = null) {
  return db.prepare('SELECT value FROM platform_settings WHERE key=?').get(key)?.value ?? fallback;
}

function nextInvoiceNumber(db, date = new Date()) {
  const year=date.getUTCFullYear();
  db.prepare('INSERT INTO platform_sequences (kind,year,next_value) VALUES (?, ?, 1) ON CONFLICT(kind,year) DO NOTHING').run('SAAS_INVOICE',year);
  const value=Number(db.prepare('UPDATE platform_sequences SET next_value=next_value+1 WHERE kind=? AND year=? RETURNING next_value-1 value').get('SAAS_INVOICE',year).value);
  return `SAAS-${year}-${String(value).padStart(6,'0')}`;
}

export function refreshSubscriptionStates(db, at = new Date()) {
  const current = at.toISOString();
  const graceDays = Number(platformSetting(db,'grace_days',5));
  const suspensionDays = Number(platformSetting(db,'suspension_days',10));
  for (const sub of db.prepare("SELECT s.*,t.status tenant_status,t.name tenant_name FROM subscriptions s JOIN tenants t ON t.id=s.tenant_id WHERE s.status NOT IN ('CANCELED')").all()) {
    if (['SUSPENDED','BLOCKED','CANCELED'].includes(sub.tenant_status)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      const due = new Date(sub.next_charge_at),daysLate = Math.floor((at - due) / 86400000);
      if (daysLate >= 0) {
        const months = cycleMonths[sub.billing_cycle] || 1,periodEnd = addMonths(sub.next_charge_at, months);
        const existing = db.prepare('SELECT id FROM saas_invoices WHERE subscription_id=? AND period_start=? AND period_end=?').get(sub.id,sub.next_charge_at,periodEnd);
        if (!existing) db.prepare(`INSERT INTO saas_invoices (id,tenant_id,subscription_id,number,amount,currency,period_start,period_end,due_at,status,created_at,paid_amount,balance)
          VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?,0,?)`).run(id(),sub.tenant_id,sub.id,nextInvoiceNumber(db,at),sub.price,sub.currency,sub.next_charge_at,periodEnd,sub.next_charge_at,current,sub.price);
      }
      let status = sub.status, tenantStatus = sub.tenant_status;
      if (sub.status === 'TRIAL' && daysLate < 0) { status='TRIAL'; tenantStatus='TRIAL'; }
      else if (daysLate <= 0) { status='ACTIVE'; tenantStatus='ACTIVE'; }
      else if (daysLate <= graceDays) { status='OVERDUE'; tenantStatus='OVERDUE'; }
      else if (daysLate <= suspensionDays) { status='GRACE'; tenantStatus='GRACE'; }
      else { status='SUSPENDED'; tenantStatus='SUSPENDED'; }
      if (status !== sub.status || tenantStatus !== sub.tenant_status) {
        db.prepare('UPDATE subscriptions SET status=?,grace_until=?,updated_at=? WHERE id=?').run(status,addDays(due,graceDays),current,sub.id);
        db.prepare('UPDATE tenants SET status=? WHERE id=?').run(tenantStatus,sub.tenant_id);
        audit(db,{scope:'PLATFORM',tenantId:sub.tenant_id,action:'SUBSCRIPTION_STATUS_CHANGED',entityType:'subscription',entityId:sub.id,before:{status:sub.status,tenantStatus:sub.tenant_status},after:{status,tenantStatus}});
        queueNotification(db,{tenantId:sub.tenant_id,eventType:`SUBSCRIPTION_${status}`,title:status==='SUSPENDED'?'Cuenta suspendida por vencimiento':'Estado de suscripción actualizado',message:status==='SUSPENDED'?'La información permanece protegida en modo consulta. Registra el pago para reactivar la operación.':`El estado de la suscripción cambió a ${status}.`,payload:{subscriptionId:sub.id,status},idempotencyKey:`subscription-state:${sub.id}:${status}:${sub.next_charge_at}`});
      }
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  }
}

export function recordManualPayment(db, input, actorUserId, ip = null) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(input.tenantId);
  const sub = db.prepare('SELECT * FROM subscriptions WHERE tenant_id=?').get(input.tenantId);
  if (!tenant || !sub) throw Object.assign(new Error('Taller o suscripción no encontrados.'),{status:404});
  if (!(Number(input.amount) > 0)) throw Object.assign(new Error('El monto debe ser mayor que cero.'),{status:422});
  const registry = new PaymentRegistry();
  const normalized = registry.get('manual').normalize(input);
  const paidAt = input.paidAt || now(), months = cycleMonths[sub.billing_cycle] || 1;
  const periodStart = input.periodStart || sub.next_charge_at;
  const periodEnd = input.periodEnd || addMonths(periodStart,months);
  const paymentId = id();
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT id FROM saas_payments WHERE provider=? AND provider_payment_id=?').get('manual',normalized.externalId);
    if (existing) { db.exec('COMMIT'); return { paymentId: existing.id, duplicate: true }; }
    let invoice = db.prepare("SELECT * FROM saas_invoices WHERE tenant_id=? AND status='PENDING' ORDER BY due_at LIMIT 1").get(tenant.id);
    if(!invoice)invoice=db.prepare("SELECT * FROM saas_invoices WHERE tenant_id=? AND status='PARTIAL' ORDER BY due_at LIMIT 1").get(tenant.id);
    if (!invoice) {
      const invoiceId=id(), invoiceNumber=nextInvoiceNumber(db,new Date(paidAt));
      db.prepare(`INSERT INTO saas_invoices (id,tenant_id,subscription_id,number,amount,currency,period_start,period_end,due_at,status,created_at,paid_amount,balance)
        VALUES (?,?,?,?,?,?,?,?,?,'PENDING',?,0,?)`).run(invoiceId,tenant.id,sub.id,invoiceNumber,Number(input.amount),sub.currency,periodStart,periodEnd,sub.next_charge_at,now(),Number(input.amount));
      invoice = db.prepare('SELECT * FROM saas_invoices WHERE id=?').get(invoiceId);
    }
    const currentBalance=Number(invoice.balance||invoice.amount);if(Number(input.amount)>currentBalance)throw Object.assign(new Error(`El pago supera el saldo pendiente de ${currentBalance}.`),{status:409});
    const newPaid=Number(invoice.paid_amount||0)+Number(input.amount),newBalance=currentBalance-Number(input.amount),invoiceStatus=newBalance===0?'PAID':'PARTIAL';
    db.prepare(`INSERT INTO saas_payments (id,tenant_id,subscription_id,invoice_id,amount,currency,paid_at,method,reference,notes,period_start,period_end,provider,provider_payment_id,status,recorded_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(paymentId,tenant.id,sub.id,invoice.id,Number(input.amount),sub.currency,paidAt,input.method || 'TRANSFER',input.reference || null,input.notes || null,periodStart,periodEnd,'manual',normalized.externalId,'APPROVED',actorUserId,now());
    db.prepare('UPDATE saas_invoices SET status=?,paid_at=?,paid_amount=?,balance=? WHERE id=?').run(invoiceStatus,newBalance===0?paidAt:null,newPaid,newBalance,invoice.id);
    if(newBalance===0){db.prepare("UPDATE subscriptions SET status='ACTIVE',next_charge_at=?,grace_until=NULL,updated_at=? WHERE id=?").run(periodEnd,now(),sub.id);db.prepare("UPDATE tenants SET status='ACTIVE',canceled_at=NULL WHERE id=?").run(tenant.id);}
    db.prepare('INSERT INTO subscription_history (id,tenant_id,subscription_id,event,metadata,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id(),tenant.id,sub.id,'PAYMENT_RECORDED',JSON.stringify({paymentId,amount:Number(input.amount),periodEnd}),actorUserId,now());
    audit(db,{scope:'PLATFORM',tenantId:tenant.id,actorUserId,action:'SAAS_PAYMENT_RECORDED',entityType:'saas_payment',entityId:paymentId,ip,metadata:{amount:Number(input.amount),reference:input.reference}});
    db.exec('COMMIT');
    return { paymentId, invoiceId: invoice.id, balance:newBalance, reactivated:newBalance===0, duplicate: false };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function changeSubscription(db, tenantId, input, actorUserId) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE tenant_id=?').get(tenantId);
  const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(input.planId);
  if (!sub || !plan) throw Object.assign(new Error('Suscripción o plan inválidos.'),{status:404});
  db.prepare('UPDATE subscriptions SET plan_id=?,billing_cycle=?,price=?,currency=?,auto_renew=?,discount_percent=?,promotion=?,updated_at=? WHERE id=?')
    .run(plan.id,input.billingCycle || sub.billing_cycle,Number(input.price ?? plan.price_monthly),plan.currency,Number(input.autoRenew||0),Number(input.discount||0),input.promotion||null,now(),sub.id);
  db.prepare('INSERT INTO subscription_history (id,tenant_id,subscription_id,event,from_plan_id,to_plan_id,metadata,actor_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id(),tenantId,sub.id,'PLAN_CHANGED',sub.plan_id,plan.id,'{}',actorUserId,now());
  audit(db,{scope:'PLATFORM',tenantId,actorUserId,action:'PLAN_CHANGED',entityType:'subscription',entityId:sub.id,metadata:{from:sub.plan_id,to:plan.id}});
}

export function setTenantStatus(db, tenantId, status, actorUserId, reason = '') {
  const allowed = new Set(['ACTIVE','PAYMENT_PENDING','OVERDUE','GRACE','SUSPENDED','CANCELED','BLOCKED']);
  if (!allowed.has(status)) throw Object.assign(new Error('Estado inválido.'),{status:422});
  const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
  if (!tenant) throw Object.assign(new Error('Taller no encontrado.'),{status:404});
  const timestamp = now();
  const retentionDays = Number(platformSetting(db,'retention_days',365));
  db.prepare('UPDATE tenants SET status=?,canceled_at=?,deletion_eligible_at=? WHERE id=?')
    .run(status,status==='CANCELED'?timestamp:null,status==='CANCELED'?addDays(timestamp,retentionDays):null,tenantId);
  db.prepare('UPDATE subscriptions SET status=?,canceled_at=?,updated_at=? WHERE tenant_id=?')
    .run(status,status==='CANCELED'?timestamp:null,timestamp,tenantId);
  audit(db,{scope:'PLATFORM',tenantId,actorUserId,action:`TENANT_${status}`,entityType:'tenant',entityId:tenantId,metadata:{reason,previous:tenant.status}});
}

export function platformMetrics(db) {
  const tenantCounts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) value FROM tenants GROUP BY status').all().map(x=>[x.status,Number(x.value)]));
  const active = Number(db.prepare("SELECT COUNT(*) total FROM tenants WHERE status IN ('ACTIVE','TRIAL','PAYMENT_PENDING','OVERDUE','GRACE')").get().total);
  const mrr = Number(db.prepare(`SELECT COALESCE(SUM(CASE billing_cycle WHEN 'ANNUAL' THEN price/12 WHEN 'SEMIANNUAL' THEN price/6 WHEN 'QUARTERLY' THEN price/3 ELSE price END),0) total
    FROM subscriptions WHERE status IN ('ACTIVE','TRIAL','PAYMENT_PENDING','OVERDUE','GRACE')`).get().total);
  const revenue = Number(db.prepare("SELECT COALESCE(SUM(amount),0) total FROM saas_payments WHERE status='APPROVED' AND substr(paid_at,1,7)=substr(?,1,7)").get(now()).total);
  const previousMonth = new Date(); previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1);
  const previousRevenue = Number(db.prepare("SELECT COALESCE(SUM(amount),0) total FROM saas_payments WHERE status='APPROVED' AND substr(paid_at,1,7)=substr(?,1,7)").get(previousMonth.toISOString()).total);
  const canceled30 = Number(db.prepare("SELECT COUNT(*) total FROM tenants WHERE status='CANCELED' AND canceled_at>=?").get(addDays(now(),-30)).total);
  const start30 = Number(db.prepare('SELECT COUNT(*) total FROM tenants WHERE created_at<?').get(addDays(now(),-30)).total);
  const totalTrials=Number(db.prepare('SELECT COUNT(DISTINCT tenant_id) total FROM trials').get().total);
  const converted=Number(db.prepare("SELECT COUNT(DISTINCT tr.tenant_id) total FROM trials tr JOIN saas_payments p ON p.tenant_id=tr.tenant_id AND p.status='APPROVED'").get().total);
  return { tenantCounts, active, mrr, arr:mrr*12, arpu:active?mrr/active:0, revenue, previousRevenue, growth:previousRevenue?(revenue-previousRevenue)/previousRevenue*100:(revenue?100:0), churn:start30?canceled30/start30*100:0,
    newThisMonth:Number(db.prepare('SELECT COUNT(*) total FROM tenants WHERE substr(created_at,1,7)=substr(?,1,7)').get(now()).total),
    overdue:Number(db.prepare("SELECT COUNT(*) total FROM tenants WHERE status IN ('OVERDUE','GRACE','SUSPENDED')").get().total),
    trials:Number(db.prepare("SELECT COUNT(*) total FROM tenants WHERE status='TRIAL'").get().total), trialConversion:totalTrials?converted/totalTrials*100:0,
    cancellations:Number(db.prepare("SELECT COUNT(*) total FROM tenants WHERE status='CANCELED'").get().total),
    renewals:Number(db.prepare("SELECT COUNT(*) total FROM subscriptions WHERE next_charge_at BETWEEN ? AND ? AND status!='CANCELED'").get(now(),addDays(now(),7)).total),
    activeUsers:Number(db.prepare('SELECT COUNT(*) total FROM users WHERE active=1 AND last_activity_at>=?').get(addDays(now(),-30)).total),
    branches:Number(db.prepare('SELECT COUNT(*) total FROM branches WHERE active=1').get().total),
    storageBytes:Number(db.prepare('SELECT COALESCE(SUM(storage_used_bytes),0) total FROM tenants').get().total) };
}

export function billingRows(db) {
  const rows = db.prepare(`SELECT t.id,t.name,t.owner_name,p.name plan,s.price,s.currency,s.billing_cycle,s.next_charge_at,s.status,
    (SELECT MAX(paid_at) FROM saas_payments sp WHERE sp.tenant_id=t.id AND sp.status='APPROVED') last_payment,
    MAX(0,CAST(julianday('now')-julianday(s.next_charge_at) AS INTEGER)) days_late,
    MAX(0,CAST(julianday(s.next_charge_at)-julianday('now') AS INTEGER)) days_until,
    COALESCE((SELECT SUM(si.balance) FROM saas_invoices si WHERE si.tenant_id=t.id AND si.status IN ('PENDING','PARTIAL')),0) debt
    FROM tenants t JOIN subscriptions s ON s.tenant_id=t.id JOIN plans p ON p.id=s.plan_id ORDER BY s.next_charge_at`).all();
  return rows.map(row => ({...row,debt:Number(row.debt),collectionState:row.status==='SUSPENDED'?'SUSPENDED':row.status==='GRACE'?'GRACE':row.status==='OVERDUE'?'OVERDUE':row.days_until<=7?'DUE_SOON':'CURRENT'}));
}
