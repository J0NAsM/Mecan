// Validación estructural de glTF 2.0 / GLB y empaquetado sin pérdida a GLB (formato interno).
// Un archivo descargado se considera no confiable hasta superar estas comprobaciones.
const MAGIC = 0x46546c67,
  JSON_CHUNK = 0x4e4f534a,
  BIN_CHUNK = 0x004e4942;
// Extensiones que GLTFLoader (three.js r160) resuelve sin decodificadores adicionales.
const SUPPORTED_REQUIRED = new Set([
  'KHR_materials_clearcoat',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_materials_anisotropy',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_lights_punctual',
  'EXT_texture_webp',
]);
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function sniffImage(bytes) {
  if (bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length > 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export function parseGlb(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== MAGIC)
    throw new Error('No es un archivo GLB (firma glTF ausente).');
  if (buffer.readUInt32LE(4) !== 2) throw new Error('Versión GLB no admitida (se requiere 2).');
  if (buffer.readUInt32LE(8) !== buffer.length)
    throw new Error('El tamaño declarado del GLB no coincide: archivo truncado o corrupto.');
  let offset = 12,
    json = null,
    bin = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset),
      type = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + length > buffer.length) throw new Error('Bloque GLB fuera de rango.');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK && !json) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK && !bin) bin = data;
    offset += 8 + length;
  }
  if (!json) throw new Error('El GLB no contiene el bloque JSON.');
  return { json, bin };
}

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.map(Number);
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}
const transform = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

export function inspectGltf(json, { bin = null, glb = false } = {}) {
  const issues = [];
  if (!String(json.asset?.version || '').startsWith('2'))
    issues.push('asset.version no es glTF 2.x');
  for (const extension of json.extensionsRequired || [])
    if (!SUPPORTED_REQUIRED.has(extension))
      issues.push(`Extensión requerida no admitida sin decodificador adicional: ${extension}`);
  const buffers = json.buffers || [];
  buffers.forEach((buffer, index) => {
    if (buffer.uri) {
      if (!buffer.uri.startsWith('data:'))
        issues.push(`Buffer externo no empaquetado: ${buffer.uri}`);
    } else if (!(glb && index === 0)) issues.push(`Buffer ${index} sin datos`);
    else if (!bin || bin.length < buffer.byteLength)
      issues.push('El bloque binario es menor que el buffer declarado');
  });
  const views = json.bufferViews || [];
  views.forEach((view, index) => {
    const buffer = buffers[view.buffer];
    if (!buffer || (view.byteOffset || 0) + view.byteLength > buffer.byteLength)
      issues.push(`bufferView ${index} fuera de los límites de su buffer`);
  });
  (json.accessors || []).forEach((accessor, index) => {
    const size = COMPONENT_BYTES[accessor.componentType],
      components = TYPE_COMPONENTS[accessor.type];
    if (!size || !components || !(accessor.count >= 1))
      return issues.push(`Accesor ${index} inválido`);
    if (accessor.bufferView === undefined) return;
    const view = views[accessor.bufferView];
    if (!view) return issues.push(`Accesor ${index} apunta a un bufferView inexistente`);
    const element = size * components,
      stride = view.byteStride || element;
    if ((accessor.byteOffset || 0) + stride * (accessor.count - 1) + element > view.byteLength)
      issues.push(`Accesor ${index} excede su bufferView`);
  });
  for (const [index, image] of (json.images || []).entries()) {
    if (image.uri && !image.uri.startsWith('data:'))
      issues.push(`Imagen externa no empaquetada: ${image.uri}`);
    else if (image.uri && !/^data:image\/(png|jpeg|webp);base64,/.test(image.uri))
      issues.push(`Imagen ${index} con tipo no admitido`);
    else if (
      image.bufferView !== undefined &&
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)
    )
      issues.push(`Imagen ${index} con tipo MIME no admitido: ${image.mimeType || 'sin tipo'}`);
  }
  // Estadísticas y dimensiones reales recorriendo la escena (instancias incluidas).
  let triangles = 0,
    vertices = 0,
    primitives = 0;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  const nodes = json.nodes || [];
  const scene = json.scenes?.[json.scene ?? 0];
  const visit = (index, parent, depth) => {
    const node = nodes[index];
    if (!node || depth > 64) return;
    const world = multiply(parent, localMatrix(node));
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : null;
    for (const primitive of mesh?.primitives || []) {
      primitives++;
      const position = json.accessors?.[primitive.attributes?.POSITION];
      if (!position) {
        issues.push('Primitiva sin atributo POSITION');
        continue;
      }
      const count =
        primitive.indices !== undefined
          ? json.accessors?.[primitive.indices]?.count || 0
          : position.count;
      const mode = primitive.mode ?? 4;
      triangles +=
        mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
      vertices += position.count;
      if (Array.isArray(position.min) && Array.isArray(position.max) && !position.normalized)
        for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const point = transform(world, [
            corner & 1 ? position.max[0] : position.min[0],
            corner & 2 ? position.max[1] : position.min[1],
            corner & 4 ? position.max[2] : position.min[2],
          ]);
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
          }
        }
    }
    for (const child of node.children || []) visit(child, world, depth + 1);
  };
  for (const root of scene?.nodes || nodes.map((_, i) => i)) visit(root, identity(), 0);
  if (!primitives) issues.push('El archivo no contiene geometría');
  const round = (value) => Math.round(value * 1000) / 1000;
  const dimensions = Number.isFinite(min[0])
    ? {
        x: round(max[0] - min[0]),
        y: round(max[1] - min[1]),
        z: round(max[2] - min[2]),
        unit: 'm (unidades glTF)',
      }
    : null;
  return {
    issues,
    stats: {
      triangles,
      vertices,
      primitives,
      meshes: (json.meshes || []).length,
      materials: (json.materials || []).length,
      textures: (json.textures || []).length,
      images: (json.images || []).length,
      animations: (json.animations || []).length,
      extensionsUsed: json.extensionsUsed || [],
    },
    dimensions,
  };
}

export function analyzeGlb(buffer) {
  try {
    const { json, bin } = parseGlb(buffer);
    return { ...inspectGltf(json, { bin, glb: true }), json };
  } catch (error) {
    return { issues: [error.message], stats: null, dimensions: null };
  }
}

const pad = (bytes, filler) => {
  const extra = (4 - (bytes.length % 4)) % 4;
  return extra ? Buffer.concat([bytes, Buffer.alloc(extra, filler)]) : bytes;
};
export function buildGlb(json, bin) {
  const jsonChunk = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binChunk = bin?.length ? pad(bin, 0) : null;
  const total = 12 + 8 + jsonChunk.length + (binChunk ? 8 + binChunk.length : 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return [head, data];
  };
  return Buffer.concat([
    header,
    ...chunk(JSON_CHUNK, jsonChunk),
    ...(binChunk ? chunk(BIN_CHUNK, binChunk) : []),
  ]);
}

const decodeDataUri = (uri) => Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');

// .gltf + .bin + texturas → un único .glb. No recomprime ni altera geometría, UV ni materiales.
export function packGltf(json, readResource) {
  const out = structuredClone(json);
  const parts = [];
  let length = 0;
  const append = (bytes) => {
    const aligned = Math.ceil(length / 4) * 4;
    if (aligned > length) parts.push(Buffer.alloc(aligned - length));
    parts.push(bytes);
    length = aligned + bytes.length;
    return aligned;
  };
  const offsets = (out.buffers || []).map((buffer) => {
    const bytes = buffer.uri?.startsWith('data:')
      ? decodeDataUri(buffer.uri)
      : readResource(buffer.uri);
    if (bytes.length < buffer.byteLength) throw new Error(`Buffer incompleto: ${buffer.uri}`);
    return append(bytes.subarray(0, buffer.byteLength));
  });
  out.bufferViews ||= [];
  for (const view of out.bufferViews) {
    view.byteOffset = (view.byteOffset || 0) + offsets[view.buffer];
    view.buffer = 0;
  }
  for (const image of out.images || []) {
    if (!image.uri) continue;
    const bytes = image.uri.startsWith('data:')
      ? decodeDataUri(image.uri)
      : readResource(image.uri);
    const mimeType = sniffImage(bytes);
    if (!mimeType) throw new Error(`Textura con formato no admitido: ${image.uri.slice(0, 80)}`);
    out.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.length });
    image.bufferView = out.bufferViews.length - 1;
    image.mimeType = mimeType;
    delete image.uri;
  }
  out.buffers = length ? [{ byteLength: length }] : [];
  return buildGlb(out, Buffer.concat(parts));
}
