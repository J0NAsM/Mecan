// Vocabulario del diagnóstico visual. Las 13 piezas reproducen las zonas del esquema en papel
// «Presupuesto y diagnóstico visual del automóvil»; los códigos se guardan en PostgreSQL.
export const BODY_TYPES = [
  { code: 'HATCHBACK', label: 'Hatchback', doors: 4 },
  { code: 'COUPE', label: 'Coupé', doors: 2 },
  { code: 'CONVERTIBLE', label: 'Descapotable', doors: 2 },
  { code: 'CROSSOVER', label: 'Crossover', doors: 4 },
  { code: 'SUV', label: 'SUV', doors: 4 },
  { code: 'WAGON', label: 'Familiar', doors: 4 },
  { code: 'MINIVAN', label: 'Monovolumen', doors: 4 },
  { code: 'VAN', label: 'Furgoneta', doors: 4 },
];
export const BODY_TYPE_CODES = BODY_TYPES.map((body) => body.code);

export const VEHICLE_PARTS = [
  { code: 'hood', label: 'Capó' },
  { code: 'roof', label: 'Techo' },
  { code: 'trunk', label: 'Tapa trasera' },
  { code: 'door_front_left', label: 'Puerta delantera izquierda' },
  { code: 'door_front_right', label: 'Puerta delantera derecha' },
  { code: 'door_rear_left', label: 'Puerta trasera izquierda', rearDoor: true },
  { code: 'door_rear_right', label: 'Puerta trasera derecha', rearDoor: true },
  { code: 'fender_front_left', label: 'Guardabarros delantero izquierdo' },
  { code: 'fender_front_right', label: 'Guardabarros delantero derecho' },
  { code: 'fender_rear_left', label: 'Guardabarros trasero izquierdo' },
  { code: 'fender_rear_right', label: 'Guardabarros trasero derecho' },
  { code: 'bumper_front', label: 'Paragolpes delantero' },
  { code: 'bumper_rear', label: 'Paragolpes trasero' },
];
export const VEHICLE_PART_CODES = VEHICLE_PARTS.map((part) => part.code);

// La presión (0–100) es otro dato de la pieza: nunca se deriva de la gravedad ni al revés.
export const DAMAGE_SEVERITIES = [
  { code: 'NONE', label: 'Sin daño', color: null, rank: 0 },
  { code: 'LIGHT', label: 'Leve', color: '#22c55e', rank: 1 },
  { code: 'MODERATE', label: 'Moderado', color: '#facc15', rank: 2 },
  { code: 'SEVERE', label: 'Grave', color: '#f97316', rank: 3 },
  { code: 'CRITICAL', label: 'Crítico', color: '#ef4444', rank: 4 },
];
export const SEVERITY_CODES = DAMAGE_SEVERITIES.map((severity) => severity.code);

export const partLabel = (code) =>
  VEHICLE_PARTS.find((part) => part.code === code)?.label || code || '—';
export const severityLabel = (code) =>
  DAMAGE_SEVERITIES.find((severity) => severity.code === code)?.label || code || '—';
export const severityColor = (code) =>
  DAMAGE_SEVERITIES.find((severity) => severity.code === code)?.color || null;
export const bodyTypeLabel = (code) =>
  BODY_TYPES.find((body) => body.code === code)?.label || 'Sin definir';
export function partsForBody(bodyType) {
  const doors = BODY_TYPES.find((body) => body.code === bodyType)?.doors ?? 4;
  return VEHICLE_PARTS.filter((part) => doors === 4 || !part.rearDoor);
}
