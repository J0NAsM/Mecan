import { roundMoney } from '../money.js';

// Read-only reconciliation. Call inside a read transaction for a consistent database snapshot.
// Return counts, never customer identities, payment references or amounts in deployment logs.
export async function financialIntegrityIssues(db) {
  const issues = [];
  for (const spec of [
    {
      parent: 'workshop_invoices',
      payments: 'effective_workshop_payments',
      key: 'invoice_id',
      label: 'Comprobantes de taller',
      currency: 'COALESCE(d.currency,s.currency)',
      voided: 'd.voided_at IS NOT NULL',
    },
    {
      parent: 'accounts_payable',
      payments: 'effective_purchase_payments',
      key: 'payable_id',
      label: 'Cuentas por pagar',
      currency: 's.currency',
      voided: "d.status='VOID'",
    },
  ]) {
    let invalid = 0;
    for await (const row of db
      .prepare(
        `SELECT d.amount,d.paid_amount,d.balance,d.status,${spec.currency} currency,${spec.voided} voided,
      COALESCE(p.paid,0) effective_paid FROM ${spec.parent} d JOIN tenant_settings s ON s.tenant_id=d.tenant_id
      LEFT JOIN (SELECT tenant_id,${spec.key},SUM(amount) paid FROM ${spec.payments} GROUP BY tenant_id,${spec.key}) p ON p.tenant_id=d.tenant_id AND p.${spec.key}=d.id`,
      )
      .iterate()) {
      const paid = roundMoney(row.effective_paid, row.currency),
        balance = roundMoney(Number(row.amount) - paid, row.currency);
      const expected = row.voided
        ? 'VOID'
        : balance === 0
          ? 'PAID'
          : paid > 0
            ? 'PARTIAL'
            : 'PENDING';
      if (
        paid !== Number(row.paid_amount) ||
        balance !== Number(row.balance) ||
        balance < 0 ||
        row.status !== expected ||
        (row.voided && paid !== 0)
      )
        invalid++;
    }
    if (invalid)
      issues.push(
        `${spec.label}: ${invalid} saldo(s) o estado(s) no coinciden con sus pagos vigentes`,
      );
  }
  for (const [table, field, type, category, label] of [
    ['workshop_payments', 'workshop_payment_id', 'INCOME', 'CUSTOMER_PAYMENT', 'Cobros'],
    [
      'purchase_payments',
      'purchase_payment_id',
      'EXPENSE',
      'SUPPLIER_PAYMENT',
      'Pagos a proveedores',
    ],
    ['payment_reversals', 'reversal_id', null, null, 'Reversiones'],
  ]) {
    const invalid = (
      await db
        .prepare(
          `SELECT COUNT(*) n FROM ${table} p LEFT JOIN cash_movements c ON c.${field}=p.id AND c.tenant_id=p.tenant_id
      WHERE c.id IS NULL OR c.amount<>p.amount OR c.voided_at IS NOT NULL OR ${
        table === 'payment_reversals'
          ? "c.branch_id<>p.branch_id OR (p.customer_payment_id IS NOT NULL AND (c.type<>'EXPENSE' OR c.category<>'CUSTOMER_PAYMENT_REVERSAL')) OR (p.purchase_payment_id IS NOT NULL AND (c.type<>'INCOME' OR c.category<>'SUPPLIER_PAYMENT_REVERSAL'))"
          : `c.type<>? OR c.category<>? OR c.branch_id IS DISTINCT FROM (SELECT branch_id FROM ${table === 'workshop_payments' ? 'workshop_invoices' : 'accounts_payable'} WHERE id=p.${table === 'workshop_payments' ? 'invoice_id' : 'payable_id'} AND tenant_id=p.tenant_id)`
      }
      `,
        )
        .get(...(type ? [type, category] : []))
    ).n;
    if (invalid)
      issues.push(`${label}: ${invalid} movimiento(s) de caja faltantes o incompatibles`);
    const orphan = (
      await db
        .prepare(
          `SELECT COUNT(*) n FROM cash_movements c LEFT JOIN ${table} p ON p.id=c.${field} AND p.tenant_id=c.tenant_id WHERE (c.${field} IS NOT NULL OR ${category ? 'c.category=?' : "c.category IN ('CUSTOMER_PAYMENT_REVERSAL','SUPPLIER_PAYMENT_REVERSAL')"}) AND p.id IS NULL`,
        )
        .get(...(category ? [category] : []))
    ).n;
    if (orphan) issues.push(`${label}: ${orphan} referencia(s) de caja sin pago del mismo taller`);
  }
  return issues;
}
