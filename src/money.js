import { AppError } from './errors.js';

export function currencyCode(value) {
  const code = String(value || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf('currency').includes(code))
    throw new AppError('Selecciona una moneda válida de tres letras.', { status: 422 });
  return code;
}
export function roundMoney(value, currency = 'PYG') {
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currencyCode(currency),
  }).resolvedOptions().maximumFractionDigits;
  const factor = 10 ** digits,
    number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1e12)
    throw new AppError('El importe no es válido.', { status: 422 });
  return Math.round((number + Math.sign(number) * Number.EPSILON) * factor) / factor;
}
export function moneyAmount(value, currency, label = 'El importe', { allowZero = false } = {}) {
  const amount = roundMoney(value, currency);
  if (amount < 0 || (!allowZero && amount === 0) || Math.abs(amount - Number(value)) > 1e-7)
    throw new AppError(`${label} debe ser positivo y respetar los decimales de ${currency}.`, {
      status: 422,
    });
  return amount;
}
export async function tenantCurrency(db, tenantId) {
  return (
    (await db.prepare('SELECT currency FROM tenant_settings WHERE tenant_id=?').get(tenantId))
      ?.currency || 'PYG'
  );
}
