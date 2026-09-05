import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet programs may strip whitespace/control characters before evaluating formulas.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const now = () => new Date().toISOString();
export const dateOnly = (value = new Date()) => new Date(value).toISOString().slice(0, 10);
export const addDays = (value, days) => {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result.toISOString();
};
export const addMonths = (value, months) => {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + Number(months));
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result.toISOString();
};
export const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
export const json = (value, fallback = {}) => {
  try {
    return JSON.parse(value ?? '');
  } catch {
    return fallback;
  }
};
export const asNumber = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
export const safeNext = (value) => {
  const target = String(value || '');
  if (!target.startsWith('/') || target.startsWith('//') || /[\\\u0000-\u0020]/.test(target))
    return '/app';
  try {
    return new URL(target, 'https://local.invalid').origin === 'https://local.invalid'
      ? target
      : '/app';
  } catch {
    return '/app';
  }
};
