// Mapa de daños por pieza sobre la geometría (vertex colors). Cada trazo es un sello esférico:
// posición normalizada a la caja de la pieza, radio en centímetros y gravedad. Guardar los sellos
// —no los colores— permite reconstruir el mapa en cualquier carrocería desde PostgreSQL.
import * as THREE from '../vendor/three/three.module.min.js';
import { SEVERITY_ORDER, SEVERITY_COLORS, HEAT_BASE, smoothstep } from './vehicle-configs.js';

const severityColors = SEVERITY_ORDER.map((code) =>
  SEVERITY_COLORS[code] ? new THREE.Color(SEVERITY_COLORS[code]) : null,
);
const heatBase = new THREE.Color(HEAT_BASE);

export function initDamageField(part) {
  part.userData.fields = part.userData.meshes.map((mesh) => {
    const position = mesh.geometry.attributes.position;
    const local = new Float32Array(position.count * 3),
      vertex = new THREE.Vector3();
    mesh.updateMatrix();
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrix);
      local.set([vertex.x, vertex.y, vertex.z], i * 3);
    }
    return {
      mesh,
      local,
      intensity: new Float32Array(position.count),
      severity: new Uint8Array(position.count),
    };
  });
  part.userData.strokes = [];
}

export const toStamp = (part, localPoint, radiusCm, severityRank) => {
  const size = part.userData.size;
  const norm = (value, extent) =>
    Math.round(Math.max(-1, Math.min(1, value / Math.max(extent, 1e-6))) * 1000) / 1000;
  return [
    norm(localPoint.x, size.x),
    norm(localPoint.y, size.y),
    norm(localPoint.z, size.z),
    Math.round(radiusCm),
    severityRank,
  ];
};

export function applyStamp(part, stamp) {
  const [nx, ny, nz, radiusCm, severity] = stamp;
  const size = part.userData.size;
  const cx = nx * size.x,
    cy = ny * size.y,
    cz = nz * size.z,
    radius = radiusCm / 100;
  let touched = false;
  for (const field of part.userData.fields) {
    const { local, intensity, severity: ranks } = field;
    for (let i = 0; i < intensity.length; i++) {
      const dx = local[i * 3] - cx,
        dy = local[i * 3 + 1] - cy,
        dz = local[i * 3 + 2] - cz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance >= radius) continue;
      const strength = 1 - smoothstep(distance / radius);
      touched = true;
      if (severity === 0) {
        intensity[i] = Math.max(0, intensity[i] - strength);
        if (!intensity[i]) ranks[i] = 0;
      } else if (severity >= ranks[i]) {
        ranks[i] = severity;
        intensity[i] = Math.max(intensity[i], strength);
      } else if (strength > intensity[i]) {
        ranks[i] = severity;
        intensity[i] = strength;
      }
    }
  }
  return touched;
}

export function replayStrokes(part, strokes = []) {
  clearField(part);
  for (const stamp of strokes) applyStamp(part, stamp);
  part.userData.strokes = strokes.map((stamp) => [...stamp]);
}

export function clearField(part) {
  for (const field of part.userData.fields) {
    field.intensity.fill(0);
    field.severity.fill(0);
  }
  part.userData.strokes = [];
}

export const fieldHasDamage = (part) =>
  part.userData.fields.some((field) => field.intensity.some((value) => value > 0.02));

// mode: 'vehicle' → pintura original; 'heat' / 'isolated' → base neutra, zonas y tinte de gravedad.
export function paintPart(part, mode, { paintColor, severity = 'NONE' } = {}) {
  const paint = new THREE.Color(paintColor);
  const rank = SEVERITY_ORDER.indexOf(severity);
  const tint = rank > 0 ? heatBase.clone().lerp(severityColors[rank], 0.5) : heatBase;
  const color = new THREE.Color();
  for (const field of part.userData.fields) {
    const attribute = field.mesh.geometry.attributes.color;
    const array = attribute.array;
    for (let i = 0; i < field.intensity.length; i++) {
      if (mode === 'vehicle') color.copy(paint);
      else {
        color.copy(mode === 'heat' ? tint : heatBase);
        const value = field.intensity[i];
        if (value > 0 && severityColors[field.severity[i]])
          color.lerp(severityColors[field.severity[i]], Math.min(1, value * 1.15));
      }
      array[i * 3] = color.r;
      array[i * 3 + 1] = color.g;
      array[i * 3 + 2] = color.b;
    }
    attribute.needsUpdate = true;
  }
  part.userData.paintColor = paintColor;
  part.userData.hasDamage = rank > 0 || fieldHasDamage(part);
  if (mode === 'vehicle')
    part.userData.originalVertexColorsData = Float32Array.from(
      part.userData.fields.flatMap((field) => [...field.mesh.geometry.attributes.color.array]),
    );
}

// Describe la zona dominante del mapa para completar «zona afectada» si queda vacía.
export function describeZone(part) {
  const strokes = (part.userData.strokes || []).filter((stamp) => stamp[4] > 0);
  if (!strokes.length) return '';
  const mean = [0, 1, 2].map(
    (axis) => strokes.reduce((sum, stamp) => sum + stamp[axis], 0) / strokes.length,
  );
  const size = part.userData.size;
  const longAxis = size.z >= size.x ? 2 : 0;
  const along = mean[longAxis],
    vertical = size.y > size.x && size.y > 0.2 ? mean[1] : null;
  // +z apunta al frente del vehículo y +x a su lado izquierdo.
  const [positive, negative] =
    longAxis === 2 ? ['sector delantero', 'sector trasero'] : ['lado izquierdo', 'lado derecho'];
  const horizontal = along > 0.17 ? positive : along < -0.17 ? negative : 'sector central';
  const height =
    vertical === null
      ? ''
      : vertical > 0.17
        ? ', parte superior'
        : vertical < -0.17
          ? ', parte inferior'
          : ', altura media';
  return `${horizontal}${height}`;
}
