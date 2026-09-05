import { AppError } from './errors.js';
import { isoDate } from './validation.js';

export function calendarDate(value = new Date(), timezone = 'America/Asuncion') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function startOfLocalDate(date, timezone = 'America/Asuncion') {
  const target = Date.parse(date);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, 10) !== date
  )
    throw new AppError('Selecciona una fecha válida.');
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const local = (timestamp) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  // Find the first instant of the calendar day, including DST changes at midnight.
  let low = target - 36 * 3600000,
    high = target + 36 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (local(middle) < date) low = middle + 1;
    else high = middle;
  }
  if (local(low) !== date)
    throw new AppError('Esa fecha no existe en la zona horaria seleccionada.');
  return new Date(low).toISOString();
}

export function paymentTimestamp(
  value,
  { timezone = 'America/Asuncion', current = new Date().toISOString() } = {},
) {
  const timestamp = value
    ? /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? startOfLocalDate(value, timezone)
      : isoDate(value, 'La fecha de pago')
    : current;
  if (timestamp > current) throw new AppError('No puedes registrar un pago con fecha futura.');
  return timestamp;
}
export function localDateTime(value, timezone = 'America/Asuncion') {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(value)))
    throw new AppError('Selecciona una fecha y hora válidas.');
  const parts = String(value).split(/[-T:]/).map(Number),
    target = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let result = target;
  const wall = (timestamp) => {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map((x) => [x.type, x.value]),
    );
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
  };
  for (let attempt = 0; attempt < 3; attempt++) result += target - wall(result);
  if (
    !Number.isFinite(result) ||
    wall(result) !== target ||
    new Date(target).toISOString().slice(0, 16) !== String(value).slice(0, 16)
  )
    throw new AppError('Esa fecha y hora no existe en la zona horaria del taller.');
  return new Date(result).toISOString();
}
export async function tenantDateTime(db, tenantId, value) {
  return localDateTime(
    value,
    (await db.prepare('SELECT timezone FROM tenant_settings WHERE tenant_id=?').get(tenantId))
      ?.timezone,
  );
}
