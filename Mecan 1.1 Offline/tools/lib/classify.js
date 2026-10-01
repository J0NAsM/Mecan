// Clasificación automática por nombre/etiquetas. Las fuentes pueden fijar la clase exacta cuando
// conocen su propio catálogo (p. ej. en Kenney «truck» es una pickup, no un camión).
const NOT_VEHICLE =
  /\b(wheel|wheels|tire|tyre|rim|cone|box|crate|debris|barrier|sign|road|track|tile|decoration|collision|bolt|nut|plate|axle|drivetrain|spoiler|bumper|door|engine|gearbox|paint|ball|dolly|trolley|cart|wheelbarrow|hand truck)\b/;
const RULES = [
  [/\b(motorcycle|motorbike|moto|scooter|chopper)\b/, 'motorcycles', 'motocicleta'],
  [/\b(bus|coach|minibus)\b/, 'buses', 'ómnibus'],
  [/\b(pickup|pick up)\b/, 'pickups', 'pickup'],
  [/\b(suv|jeep|4x4|offroad|off road)\b/, 'suv', 'SUV'],
  [/\b(ambulance)\b/, 'vans', 'ambulancia'],
  [/\b(van|minivan|campervan)\b/, 'vans', 'furgoneta'],
  [/\b(firetruck|fire truck)\b/, 'trucks', 'camión de bomberos'],
  [/\b(garbage|dump|monster)\b/, 'trucks', 'camión'],
  [/\b(truck|lorry|delivery)\b/, 'trucks', 'camión'],
  [/\b(tractor|loader|shovel|forklift|excavator)\b/, 'other', 'maquinaria'],
  [/\b(kart|go kart)\b/, 'other', 'kart'],
  [
    /\b(sedan|saloon|hatchback|coupe|convertible|taxi|police|race|racer|racing|speedster|sports|car|auto)\b/,
    'cars',
    'automóvil',
  ],
];

export const words = (value) =>
  ` ${String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

export function classify(name, tags = [], override = null) {
  if (override) return { vehicle: true, ...override };
  const text = words(`${name} ${tags.join(' ')}`);
  const vehicleRule = RULES.find(([pattern]) => pattern.test(text));
  // «wheel-truck», «debris-door», «ClearCoatCarPaint»: piezas o muestras, no vehículos completos.
  if (NOT_VEHICLE.test(words(name)))
    return {
      vehicle: false,
      reason: 'Pieza, accesorio o muestra de material; no es un vehículo completo.',
    };
  if (!vehicleRule) return { vehicle: false, reason: 'No se reconoce como vehículo.' };
  return { vehicle: true, category: vehicleRule[1], vehicleType: vehicleRule[2] };
}
