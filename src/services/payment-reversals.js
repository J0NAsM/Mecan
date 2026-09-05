import { id, now } from '../utils.js';
import { AppError } from '../errors.js';
import { required } from '../validation.js';
import { withTenantWrite, assertPermission, assertTenantWritable } from '../tenancy.js';
import { audit } from '../domain.js';
import { roundMoney, tenantCurrency } from '../money.js';
import { assertTransition } from '../workflow.js';
import { queueNotification } from '../notifications.js';

// Reverses a mistaken internal registration, not a bank transfer or a fiscal credit note.
const kinds = {
  customer: {
    permission: 'billing.reverse',
    payments: 'workshop_payments',
    effective: 'effective_workshop_payments',
    parent: 'workshop_invoices',
    parentKey: 'invoice_id',
    reversalKey: 'customer_payment_id',
    cashKey: 'workshop_payment_id',
    category: 'CUSTOMER_PAYMENT',
    action: 'CUSTOMER_PAYMENT_REVERSED',
    type: 'EXPENSE',
  },
  supplier: {
    permission: 'purchases.reverse',
    payments: 'purchase_payments',
    effective: 'effective_purchase_payments',
    parent: 'accounts_payable',
    parentKey: 'payable_id',
    reversalKey: 'purchase_payment_id',
    cashKey: 'purchase_payment_id',
    category: 'SUPPLIER_PAYMENT',
    action: 'SUPPLIER_PAYMENT_REVERSED',
    type: 'INCOME',
  },
};

export async function reverseCustomerPayment(db, context, paymentId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    return await reversePayment(db, context, paymentId, input, meta, 'customer');
  });
}
export async function reverseSupplierPayment(db, context, paymentId, input, meta = {}) {
  return await withTenantWrite(db, context, async (context) => {
    return await reversePayment(db, context, paymentId, input, meta, 'supplier');
  });
}
async function reversePayment(db, context, paymentId, input, meta, kind) {
  const spec = kinds[kind],
    tenantId = context.tenant.id;
  assertPermission(context, spec.permission);
  assertTenantWritable(context);
  const reason = required(input.reason, 'El motivo de la corrección', { max: 1000 });
  const key = required(input.idempotencyKey, 'La referencia de operación', { max: 200 });

  try {
    return await db.transaction(
      async () => {
        const payment = await db
          .prepare(`SELECT * FROM ${spec.payments} WHERE id=? AND tenant_id=?`)
          .get(paymentId, tenantId);
        if (!payment) throw new AppError('Pago no encontrado.', { status: 404 });
        const parent = await db
          .prepare(`SELECT * FROM ${spec.parent} WHERE id=? AND tenant_id=?`)
          .get(payment[spec.parentKey], tenantId);
        if (!parent) throw new AppError('Documento de pago no encontrado.', { status: 404 });
        const duplicate = await db
          .prepare('SELECT * FROM payment_reversals WHERE tenant_id=? AND idempotency_key=?')
          .get(tenantId, key);
        let result;
        if (duplicate) {
          if (duplicate[spec.reversalKey] !== paymentId || duplicate.reason !== reason)
            throw new AppError('Esta referencia de corrección ya se utilizó con otros datos.', {
              status: 409,
            });
          result = { reversalId: duplicate.id, orderId: parent.work_order_id, duplicate: true };
        } else {
          if (
            await db
              .prepare(
                `SELECT 1 FROM payment_reversals WHERE tenant_id=? AND ${spec.reversalKey}=?`,
              )
              .get(tenantId, paymentId)
          )
            throw new AppError('Este pago ya fue revertido. No se modificó nuevamente el saldo.', {
              status: 409,
            });
          if (parent.voided_at) throw new AppError('El comprobante está anulado.', { status: 409 });
          const currency = parent.currency || (await tenantCurrency(db, tenantId));
          const effectivePaid = roundMoney(
            (
              await db
                .prepare(
                  `SELECT COALESCE(SUM(amount),0) amount FROM ${spec.effective} WHERE tenant_id=? AND ${spec.parentKey}=?`,
                )
                .get(tenantId, parent.id)
            ).amount,
            currency,
          );
          const ledger = await db
            .prepare(
              `SELECT * FROM cash_movements WHERE tenant_id=? AND ${spec.cashKey}=? AND category=? AND voided_at IS NULL`,
            )
            .get(tenantId, paymentId, spec.category);
          if (
            !ledger ||
            Number(ledger.amount) !== Number(payment.amount) ||
            ledger.branch_id !== parent.branch_id ||
            ledger.type === spec.type ||
            effectivePaid !== Number(parent.paid_amount) ||
            roundMoney(Number(parent.amount) - effectivePaid, currency) !== Number(parent.balance)
          )
            throw new AppError(
              'El pago y su saldo no coinciden con caja. Revisa la conciliación antes de corregirlo.',
              { status: 409 },
            );
          const reversalId = id(),
            timestamp = now();
          const paid = roundMoney(effectivePaid - Number(payment.amount), currency),
            balance = roundMoney(Number(parent.amount) - paid, currency);
          if (paid < 0 || balance > Number(parent.amount))
            throw new AppError('El saldo no permite esta corrección.', { status: 409 });
          await db
            .prepare(
              `INSERT INTO payment_reversals(id,tenant_id,branch_id,${spec.reversalKey},amount,reason,created_by,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              reversalId,
              tenantId,
              parent.branch_id,
              paymentId,
              payment.amount,
              reason,
              context.user.user_id,
              timestamp,
              key,
            );
          await db
            .prepare(
              `INSERT INTO cash_movements(id,tenant_id,branch_id,type,category,amount,reference,notes,created_by,created_at,idempotency_key,reversal_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              id(),
              tenantId,
              parent.branch_id,
              spec.type,
              spec.category + '_REVERSAL',
              payment.amount,
              payment.reference,
              reason,
              context.user.user_id,
              timestamp,
              `payment-reversal:${reversalId}`,
              reversalId,
            );
          const status = paid === 0 ? 'PENDING' : 'PARTIAL';
          await db
            .prepare(
              `UPDATE ${spec.parent} SET paid_amount=?,balance=?,status=?${kind === 'customer' ? ',paid_at=NULL' : ''} WHERE id=? AND tenant_id=?`,
            )
            .run(paid, balance, status, parent.id, tenantId);
          let order;
          if (kind === 'customer') {
            order = await db
              .prepare('SELECT * FROM work_orders WHERE id=? AND tenant_id=?')
              .get(parent.work_order_id, tenantId);
            if (!order) throw new AppError('Orden no encontrada.', { status: 404 });
            const next = paid === 0 ? 'INVOICED' : 'PARTIALLY_PAID';
            // A correction never undoes a physical delivery or its warranty.
            if (!['DELIVERED', 'CLOSED'].includes(order.status)) {
              if (order.status !== next)
                assertTransition(order.status, next, { action: spec.action });
              await db
                .prepare('UPDATE work_orders SET status=? WHERE id=? AND tenant_id=?')
                .run(next, order.id, tenantId);
            }
            await queueNotification(db, {
              tenantId,
              eventType: 'PAYMENT_REVERSED',
              title: `Cobro corregido · factura #${parent.number}`,
              message: 'Se revirtió un registro de cobro. El saldo pendiente fue actualizado.',
              payload: { invoiceId: parent.id, paymentId, reversalId },
              idempotencyKey: `payment-reversal:${reversalId}`,
            });
          }
          await audit(db, {
            tenantId,
            branchId: parent.branch_id,
            actorUserId: context.user.user_id,
            impersonatorUserId: context.isImpersonating ? context.user.user_id : null,
            ip: meta.ip,
            requestId: meta.requestId,
            action: spec.action,
            entityType: kind === 'customer' ? 'workshop_payment' : 'purchase_payment',
            entityId: paymentId,
            before: {
              paid: parent.paid_amount,
              balance: parent.balance,
              status: parent.status,
              orderStatus: order?.status,
            },
            after: { reversalId, paid, balance, status, reason, amount: payment.amount },
          });
          result = { reversalId, orderId: parent.work_order_id, balance, duplicate: false };
        }

        return result;
      },
      { lockKey: 'tenant:' + context.tenant.id },
    );
  } catch (error) {
    throw error;
  }
}
