import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const dateOnly = (value = new Date()) => new Date(value).toISOString().slice(0, 10);
export const addDays = (value, days) => {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + Number(days));
  return result.toISOString();
};
export const addMonths = (value, months) => {
  const result = new Date(value);
  result.setUTCMonth(result.getUTCMonth() + Number(months));
  return result.toISOString();
};
export const slugify = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
export const json = (value, fallback = {}) => {
  try { return JSON.parse(value ?? ''); } catch { return fallback; }
};
export const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const safeNext = value => String(value || '').startsWith('/') && !String(value).startsWith('//') ? String(value) : '/app';
