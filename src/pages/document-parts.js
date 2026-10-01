// Piezas compartidas por los documentos imprimibles del taller: la identidad sale de la
// configuración del taller (nombre, dirección, contacto, logo), nunca de valores fijos en código.
import { esc, money } from '../ui.js';
import {
  VEHICLE_PARTS,
  DAMAGE_SEVERITIES,
  partsForBody,
  severityColor,
} from '../vehicle-diagnosis.js';

export function documentHeader(tenant, settings) {
  const logo =
    tenant.logo_url && /^https:\/\//.test(tenant.logo_url)
      ? `<img class="document-logo" src="${esc(tenant.logo_url)}" alt="Logo del taller" referrerpolicy="no-referrer">`
      : '';
  const contact = [
    tenant.address,
    tenant.city,
    tenant.phone ? `Tel: ${tenant.phone}` : '',
    tenant.email ? `Email: ${tenant.email}` : '',
  ].filter(Boolean);
  return `<header>${logo}<h2>${esc(tenant.legal_name || tenant.name)}</h2><p>${esc([tenant.tax_id, ...contact].filter(Boolean).join(' · '))}</p><p class="preserve-lines">${esc(settings?.document_header || '')}</p></header>`;
}

export function longDate(value, timezone = 'America/Asuncion') {
  return new Intl.DateTimeFormat('es-PY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(value || Date.now()));
}
export const placeDate = (tenant, value, timezone) =>
  `<p class="doc-date">${esc(tenant.city ? `${tenant.city}, ` : '')}${esc(longDate(value, timezone))}</p>`;

export const docMeta = (pairs) =>
  `<div class="doc-meta">${pairs.map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(value ?? '—') || '—'}</b></div>`).join('')}</div>`;

export const sectionTitle = (text) => `<h3 class="doc-section-title">${esc(text)}</h3>`;

export const totals = (rows) =>
  `<dl class="doc-totals">${rows.map(([label, value, grand]) => `<dt${grand ? ' class="doc-grand"' : ''}>${esc(label)}</dt><dd${grand ? ' class="doc-grand"' : ''}>${money(value)}</dd>`).join('')}</dl>`;

export const signatures = (blocks) =>
  `<section class="doc-signatures">${blocks
    .map(
      ({ title, lines }) =>
        `<div><b>${esc(title)}</b>${lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>`,
    )
    .join('')}</section>`;

// Filas en blanco numeradas para anotar a mano en la hoja impresa.
export const blankRows = (count, columns, start) =>
  Array.from(
    { length: count },
    (_, index) =>
      `<tr class="doc-blank"><td>${start + index}</td>${'<td></td>'.repeat(columns - 1)}</tr>`,
  ).join('');

export function simpleTable(headers, rows, blank = 0) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}${blank ? blankRows(blank, headers.length, rows.length + 1) : ''}</tbody></table></div>`;
}

const SHORT = {
  hood: 'Capó',
  roof: 'Techo',
  trunk: 'Tapa trasera',
  bumper_front: 'Paragolpes del.',
  bumper_rear: 'Paragolpes tras.',
  door_front_left: 'Puerta del. izq.',
  door_rear_left: 'Puerta tras. izq.',
  door_front_right: 'Puerta del. der.',
  door_rear_right: 'Puerta tras. der.',
  fender_front_left: 'Guardab. del. izq.',
  fender_rear_left: 'Guardab. tras. izq.',
  fender_front_right: 'Guardab. del. der.',
  fender_rear_right: 'Guardab. tras. der.',
};

// Esquema desplegado del vehículo (vista superior con laterales abatidos), como la hoja en papel.
// Solo atributos de presentación SVG: la CSP del sistema no admite estilos en línea.
export function damageMapSvg(report, bodyType) {
  const parts = report?.parts || {};
  const available = new Set(
    partsForBody(bodyType || report?.assessment?.body_type).map((p) => p.code),
  );
  const twoDoors = !available.has('door_rear_left');
  const layout = {
    bumper_front: [280, 12, 200, 36],
    hood: [280, 52, 200, 100],
    roof: [280, 160, 200, 112],
    trunk: [280, 280, 200, 82],
    bumper_rear: [280, 366, 200, 36],
    fender_front_left: [150, 52, 118, 100],
    door_front_left: twoDoors ? [150, 156, 118, 176] : [150, 156, 118, 88],
    door_rear_left: [150, 248, 118, 84],
    fender_rear_left: [150, 336, 118, 66],
    fender_front_right: [492, 52, 118, 100],
    door_front_right: twoDoors ? [492, 156, 118, 176] : [492, 156, 118, 88],
    door_rear_right: [492, 248, 118, 84],
    fender_rear_right: [492, 336, 118, 66],
  };
  const zones = VEHICLE_PARTS.filter((part) => available.has(part.code))
    .map((part) => {
      const [x, y, w, h] = layout[part.code];
      const data = parts[part.code] || {};
      const damaged = data.severity && data.severity !== 'NONE';
      const fill = damaged ? severityColor(data.severity) : '#eef2f5';
      // Como en la tabla, los totales y el presupuesto: una pieza sin daño no suma costo.
      const cost = damaged ? Number(data.repairCost || 0) + Number(data.laborCost || 0) : 0;
      return `<g><title>${esc(part.label)}</title><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" fill-opacity="${damaged ? 0.82 : 1}" stroke="#415160" stroke-width="1.4"/><text x="${x + w / 2}" y="${y + h / 2 - (cost ? 4 : -4)}" text-anchor="middle" font-size="12" font-weight="600" fill="#102c2b">${esc(SHORT[part.code])}</text>${cost ? `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" font-size="12" fill="#102c2b">${esc(money(cost))}</text>` : ''}</g>`;
    })
    .join('');
  const wheels = [
    [128, 70],
    [128, 340],
    [614, 70],
    [614, 340],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="18" height="52" rx="6" fill="#2b3440"/>`)
    .join('');
  const legend = DAMAGE_SEVERITIES.filter((s) => s.color)
    .map(
      (s, i) =>
        `<rect x="${210 + i * 90}" y="418" width="12" height="12" rx="3" fill="${s.color}"/><text x="${228 + i * 90}" y="428" font-size="12" fill="#102c2b">${esc(s.label)}</text>`,
    )
    .join('');
  return `<svg class="damage-map-svg" viewBox="100 0 560 440" role="img" aria-label="Mapeo de daños por pieza"><text x="380" y="8" text-anchor="middle" font-size="9" fill="#647573">FRENTE</text>${wheels}${zones}${legend}</svg>`;
}
