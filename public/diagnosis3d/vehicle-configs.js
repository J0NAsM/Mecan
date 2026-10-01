// Configuraciones reutilizables de las 8 carrocerías del diagnóstico 3D.
// Cada perfil describe proporciones reales (metros, eje z hacia el frente, y hacia arriba) y
// `defineVehicle` deriva los campos que usa el constructor: capó, techo, tapa trasera, puertas,
// guardabarros y paragolpes. Agregar un modelo nuevo es agregar un perfil.

const BUMPER_DEPTH = 0.24;

function panelBetween(front, back) {
  // Panel rígido entre dos puntos del perfil lateral: centro, largo e inclinación positiva.
  const dz = front.z - back.z,
    dy = front.y - back.y;
  return {
    z: (front.z + back.z) / 2,
    y: (front.y + back.y) / 2,
    len: Math.hypot(dz, dy),
    tilt: Math.atan2(dy, dz),
  };
}

export function defineVehicle(profile) {
  const { length, width, wheelbase, wheelR, frontOverhang, hatch, numDoors } = profile;
  const front = length / 2,
    rear = -length / 2;
  const frontAxleZ = front - frontOverhang,
    rearAxleZ = frontAxleZ - wheelbase;
  const bumperY = profile.bumperY ?? profile.clearance + profile.bumperH / 2 + 0.07;
  const bumperTop = bumperY + profile.bumperH / 2;
  const hood = panelBetween(
    { z: front - BUMPER_DEPTH * 0.55, y: profile.noseY },
    { z: profile.cowlZ, y: profile.cowlY },
  );
  const trunk = hatch
    ? panelBetween(
        { z: profile.glassBaseZ, y: profile.tailTopY ?? profile.beltY + 0.03 },
        { z: rear + 0.13, y: bumperTop - 0.02 },
      )
    : panelBetween(
        { z: profile.glassBaseZ - 0.02, y: profile.beltY + 0.03 },
        { z: rear + 0.14, y: profile.tailY },
      );
  const doorStart = frontAxleZ - wheelR - 0.1,
    doorsEnd = rearAxleZ + wheelR + 0.1;
  let doorFrontLen, doorRearLen;
  if (numDoors === 4) {
    const span = doorStart - doorsEnd;
    doorFrontLen = profile.frontDoorLen ?? span * 0.54 - 0.01;
    doorRearLen = span - doorFrontLen - 0.02;
  } else {
    doorFrontLen = Math.min(profile.frontDoorLen ?? 1.28, doorStart - (rearAxleZ + wheelR + 0.3));
    doorRearLen = 0;
  }
  const doorFrontZ = doorStart - doorFrontLen / 2;
  const doorRearZ = numDoors === 4 ? doorsEnd + doorRearLen / 2 : null;
  const sideEnd = numDoors === 4 ? doorsEnd - 0.01 : doorStart - doorFrontLen - 0.01;
  const fenderFrontStart = front - BUMPER_DEPTH * 0.5;
  const fenderRearEnd = rear + BUMPER_DEPTH * 0.5;
  return {
    key: profile.key,
    code: profile.code,
    name: profile.name,
    color: profile.color,
    hatch: Boolean(hatch),
    cargo: Boolean(profile.cargo),
    length,
    width,
    wheelbase,
    wheelR,
    wheelW: profile.wheelW,
    frontAxleZ,
    rearAxleZ,
    clearance: profile.clearance,
    beltY: profile.beltY,
    sillY: profile.sillY,
    noseY: profile.noseY,
    cowlY: profile.cowlY,
    cowlZ: profile.cowlZ,
    glassBaseZ: profile.glassBaseZ,
    hoodY: hood.y,
    hoodZ: hood.z,
    hoodLen: hood.len,
    hoodTilt: hood.tilt,
    roofY: profile.roofY,
    roofZ: (profile.roofFrontZ + profile.roofRearZ) / 2,
    roofLen: profile.roofFrontZ - profile.roofRearZ,
    roofFrontZ: profile.roofFrontZ,
    roofRearZ: profile.roofRearZ,
    trunkY: trunk.y,
    trunkZ: trunk.z,
    trunkLen: trunk.len,
    trunkTilt: trunk.tilt,
    doorY: (profile.sillY + profile.beltY) / 2,
    doorH: profile.beltY - profile.sillY,
    doorFrontZ,
    doorFrontLen,
    doorRearZ,
    doorRearLen,
    fenderY: (profile.sillY + profile.beltY) / 2,
    fenderH: profile.beltY - profile.sillY,
    fenderLen: fenderFrontStart - doorStart - 0.01,
    fenderFrontZ: (fenderFrontStart + doorStart + 0.01) / 2,
    fenderRearLen: sideEnd - fenderRearEnd,
    fenderRearZ: (sideEnd + fenderRearEnd) / 2,
    bumperY,
    bumperH: profile.bumperH,
    bumperDepth: BUMPER_DEPTH,
    numDoors,
  };
}

const profiles = [
  {
    key: 'hatchback',
    code: 'HATCHBACK',
    name: 'Hatchback',
    numDoors: 4,
    length: 4.05,
    width: 1.76,
    color: '#c0392b',
    wheelbase: 2.55,
    frontOverhang: 0.82,
    wheelR: 0.31,
    wheelW: 0.21,
    clearance: 0.16,
    sillY: 0.34,
    beltY: 0.93,
    noseY: 0.72,
    cowlY: 0.92,
    cowlZ: 0.78,
    roofY: 1.46,
    roofFrontZ: 0.12,
    roofRearZ: -1.28,
    glassBaseZ: -1.78,
    hatch: true,
    bumperH: 0.3,
  },
  {
    key: 'coupe',
    code: 'COUPE',
    name: 'Coupé',
    numDoors: 2,
    length: 4.42,
    width: 1.86,
    color: '#2450c8',
    wheelbase: 2.65,
    frontOverhang: 0.95,
    wheelR: 0.33,
    wheelW: 0.24,
    clearance: 0.13,
    sillY: 0.32,
    beltY: 0.86,
    noseY: 0.64,
    cowlY: 0.86,
    cowlZ: 0.55,
    roofY: 1.32,
    roofFrontZ: -0.12,
    roofRearZ: -0.85,
    glassBaseZ: -1.48,
    tailY: 0.9,
    bumperH: 0.28,
    frontDoorLen: 1.3,
  },
  {
    key: 'convertible',
    code: 'CONVERTIBLE',
    name: 'Descapotable',
    numDoors: 2,
    length: 4.35,
    width: 1.84,
    color: '#e3b007',
    wheelbase: 2.6,
    frontOverhang: 0.92,
    wheelR: 0.33,
    wheelW: 0.23,
    clearance: 0.13,
    sillY: 0.32,
    beltY: 0.84,
    noseY: 0.65,
    cowlY: 0.84,
    cowlZ: 0.5,
    roofY: 1.22,
    roofFrontZ: -0.02,
    roofRearZ: -0.72,
    glassBaseZ: -1.08,
    tailY: 0.88,
    bumperH: 0.28,
    frontDoorLen: 1.24,
  },
  {
    key: 'crossover',
    code: 'CROSSOVER',
    name: 'Crossover',
    numDoors: 4,
    length: 4.45,
    width: 1.86,
    color: '#1e7a6c',
    wheelbase: 2.66,
    frontOverhang: 0.92,
    wheelR: 0.36,
    wheelW: 0.23,
    clearance: 0.2,
    sillY: 0.42,
    beltY: 1.05,
    noseY: 0.84,
    cowlY: 1.04,
    cowlZ: 0.8,
    roofY: 1.62,
    roofFrontZ: 0.2,
    roofRearZ: -1.55,
    glassBaseZ: -1.95,
    hatch: true,
    bumperH: 0.34,
  },
  {
    key: 'suv',
    code: 'SUV',
    name: 'SUV',
    numDoors: 4,
    length: 4.82,
    width: 1.96,
    color: '#2e5c3a',
    wheelbase: 2.85,
    frontOverhang: 0.95,
    wheelR: 0.39,
    wheelW: 0.26,
    clearance: 0.23,
    sillY: 0.48,
    beltY: 1.16,
    noseY: 0.98,
    cowlY: 1.15,
    cowlZ: 0.95,
    roofY: 1.84,
    roofFrontZ: 0.35,
    roofRearZ: -1.98,
    glassBaseZ: -2.26,
    hatch: true,
    bumperH: 0.38,
  },
  {
    key: 'wagon',
    code: 'WAGON',
    name: 'Familiar',
    numDoors: 4,
    length: 4.8,
    width: 1.84,
    color: '#b8c3d0',
    wheelbase: 2.8,
    frontOverhang: 0.95,
    wheelR: 0.32,
    wheelW: 0.22,
    clearance: 0.15,
    sillY: 0.34,
    beltY: 0.92,
    noseY: 0.72,
    cowlY: 0.92,
    cowlZ: 0.85,
    roofY: 1.48,
    roofFrontZ: 0.22,
    roofRearZ: -1.98,
    glassBaseZ: -2.24,
    hatch: true,
    bumperH: 0.3,
  },
  {
    key: 'minivan',
    code: 'MINIVAN',
    name: 'Monovolumen',
    numDoors: 4,
    length: 4.72,
    width: 1.88,
    color: '#e6ebf2',
    wheelbase: 2.85,
    frontOverhang: 0.92,
    wheelR: 0.34,
    wheelW: 0.23,
    clearance: 0.17,
    sillY: 0.4,
    beltY: 1.02,
    noseY: 0.86,
    cowlY: 1.05,
    cowlZ: 1.35,
    roofY: 1.76,
    roofFrontZ: 0.62,
    roofRearZ: -2.06,
    glassBaseZ: -2.24,
    hatch: true,
    bumperH: 0.34,
  },
  {
    key: 'van',
    code: 'VAN',
    name: 'Furgoneta',
    numDoors: 4,
    length: 5.2,
    width: 1.98,
    color: '#d97706',
    wheelbase: 3.25,
    frontOverhang: 0.95,
    wheelR: 0.36,
    wheelW: 0.24,
    clearance: 0.19,
    sillY: 0.46,
    beltY: 1.1,
    noseY: 0.95,
    cowlY: 1.12,
    cowlZ: 1.7,
    roofY: 2.3,
    roofFrontZ: 1.05,
    roofRearZ: -2.47,
    glassBaseZ: -2.5,
    tailTopY: 2.18,
    hatch: true,
    cargo: true,
    bumperH: 0.36,
    frontDoorLen: 1.02,
  },
];

export const VEHICLE_MODELS = Object.fromEntries(
  profiles.map((profile) => [profile.key, defineVehicle(profile)]),
);
export const MODEL_KEYS = profiles.map((profile) => profile.key);
export const keyForBodyType = (code) =>
  profiles.find((profile) => profile.code === code)?.key || 'hatchback';

export const PAINT_PRESETS = [
  '#c0392b',
  '#2450c8',
  '#2e5c3a',
  '#e3b007',
  '#d97706',
  '#1e7a6c',
  '#6a4dc8',
  '#e6ebf2',
  '#1a1d24',
  '#b8c3d0',
];

export const SEVERITY_ORDER = ['NONE', 'LIGHT', 'MODERATE', 'SEVERE', 'CRITICAL'];
export const SEVERITY_COLORS = {
  LIGHT: '#22c55e',
  MODERATE: '#facc15',
  SEVERE: '#f97316',
  CRITICAL: '#ef4444',
};
export const HEAT_BASE = '#151a22';
export const BRUSH = { min: 6, max: 60, initial: 18 };

// Presión 0–100: azul → verde → rojo. Es independiente de la gravedad del daño.
export function pressureColor(value) {
  const t = Math.min(1, Math.max(0, Number(value) / 100));
  const stops = [
    [0x2f, 0x6d, 0xf6],
    [0x22, 0xc5, 0x5e],
    [0xff, 0x3b, 0x30],
  ];
  const [a, b, local] = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], (t - 0.5) * 2];
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * local);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}
export const pressureLabel = (value) =>
  Number(value) < 34 ? 'Baja' : Number(value) < 67 ? 'Media' : 'Alta';

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const segmentsFor = (dimension) => Math.max(3, Math.min(28, Math.round(dimension * 16)));
