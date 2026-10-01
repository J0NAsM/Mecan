// Conversión OBJ (+MTL y texturas) → GLB. Conserva escala, UV, normales y el color/textura base de
// cada material. Las normales faltantes se calculan; la geometría no se simplifica.
import { buildGlb, sniffImage } from './gltf.js';

function parseMtl(text) {
  const materials = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === 'newmtl') {
      current = { name: rest.join(' '), color: [0.8, 0.8, 0.8], opacity: 1, map: null };
      materials.set(current.name, current);
    } else if (!current) continue;
    else if (keyword === 'Kd') current.color = rest.slice(0, 3).map(Number);
    else if (keyword === 'd') current.opacity = Number(rest[0]);
    else if (keyword === 'Tr') current.opacity = 1 - Number(rest[0]);
    else if (keyword === 'map_Kd') current.map = rest.at(-1);
  }
  return materials;
}

export function objToGlb(objText, readResource = () => null) {
  const positions = [],
    uvs = [],
    normals = [];
  const groups = new Map();
  let material = 'default';
  let mtlFile = null;
  const group = () => {
    if (!groups.has(material))
      groups.set(material, { keys: new Map(), position: [], uv: [], normal: [], indices: [] });
    return groups.get(material);
  };
  const resolve = (value, list) => {
    const index = Number(value);
    return index < 0 ? list.length + index : index - 1;
  };
  for (const raw of objText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === 'v') positions.push(rest.slice(0, 3).map(Number));
    else if (keyword === 'vt') uvs.push([Number(rest[0]), Number(rest[1] || 0)]);
    else if (keyword === 'vn') normals.push(rest.slice(0, 3).map(Number));
    else if (keyword === 'usemtl') material = rest.join(' ') || 'default';
    else if (keyword === 'mtllib') mtlFile = rest.join(' ');
    else if (keyword === 'f') {
      const target = group();
      const corners = rest.map((token) => {
        const [v, t, n] = token.split('/');
        const key = token;
        if (!target.keys.has(key)) {
          const p = positions[resolve(v, positions)];
          if (!p) throw new Error('Cara OBJ con vértice inexistente.');
          target.keys.set(key, target.position.length / 3);
          target.position.push(...p);
          const uv = t ? uvs[resolve(t, uvs)] : null;
          target.uv.push(...(uv ? [uv[0], 1 - uv[1]] : [0, 0]));
          const normal = n ? normals[resolve(n, normals)] : null;
          target.normal.push(...(normal || [0, 0, 0]));
          target.hasUv ||= Boolean(uv);
          target.hasNormal ||= Boolean(normal);
        }
        return target.keys.get(key);
      });
      for (let i = 1; i + 1 < corners.length; i++)
        target.indices.push(corners[0], corners[i], corners[i + 1]);
    }
  }
  if (!groups.size) throw new Error('El OBJ no contiene caras.');
  const materials = mtlFile ? parseMtl(readResource(mtlFile)?.toString('utf8') || '') : new Map();
  const chunks = [];
  let length = 0;
  const json = {
    asset: { version: '2.0', generator: 'Mecan 1.1 Offline obj-to-glb' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'modelo' }],
    meshes: [{ primitives: [] }],
    materials: [],
    bufferViews: [],
    accessors: [],
    buffers: [],
  };
  const view = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const offset = Math.ceil(length / 4) * 4;
    if (offset > length) chunks.push(Buffer.alloc(offset - length));
    chunks.push(bytes);
    length = offset + bytes.length;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.length,
      ...(target ? { target } : {}),
    });
    return json.bufferViews.length - 1;
  };
  const accessor = (typed, type, componentType, target, bounds) => {
    json.accessors.push({
      bufferView: view(typed, target),
      componentType,
      count: typed.length / { SCALAR: 1, VEC2: 2, VEC3: 3 }[type],
      type,
      ...bounds,
    });
    return json.accessors.length - 1;
  };
  for (const [name, data] of groups) {
    if (!data.hasNormal) {
      data.normal.fill(0);
      for (let i = 0; i < data.indices.length; i += 3) {
        const [a, b, c] = data.indices
          .slice(i, i + 3)
          .map((k) => data.position.slice(k * 3, k * 3 + 3));
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
          w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        for (const k of data.indices.slice(i, i + 3))
          for (let axis = 0; axis < 3; axis++) data.normal[k * 3 + axis] += n[axis];
      }
      for (let k = 0; k < data.normal.length; k += 3) {
        const size = Math.hypot(data.normal[k], data.normal[k + 1], data.normal[k + 2]) || 1;
        for (let axis = 0; axis < 3; axis++) data.normal[k + axis] /= size;
      }
    }
    const position = Float32Array.from(data.position);
    const min = [0, 1, 2].map((axis) => Math.min(...position.filter((_, i) => i % 3 === axis)));
    const max = [0, 1, 2].map((axis) => Math.max(...position.filter((_, i) => i % 3 === axis)));
    const attributes = {
      POSITION: accessor(position, 'VEC3', 5126, 34962, { min, max }),
      NORMAL: accessor(Float32Array.from(data.normal), 'VEC3', 5126, 34962),
    };
    if (data.hasUv)
      attributes.TEXCOORD_0 = accessor(Float32Array.from(data.uv), 'VEC2', 5126, 34962);
    const source = materials.get(name) || { name, color: [0.8, 0.8, 0.8], opacity: 1 };
    const pbr = {
      baseColorFactor: [...source.color.map((c) => Math.min(1, Math.max(0, c))), source.opacity],
      metallicFactor: 0,
      roughnessFactor: 0.8,
    };
    const texture = source.map && data.hasUv ? readResource(source.map) : null;
    if (texture && sniffImage(texture)) {
      json.images ||= [];
      json.textures ||= [];
      json.images.push({ bufferView: view(texture), mimeType: sniffImage(texture) });
      json.textures.push({ source: json.images.length - 1 });
      pbr.baseColorTexture = { index: json.textures.length - 1 };
    }
    json.materials.push({
      name,
      pbrMetallicRoughness: pbr,
      ...(source.opacity < 1 ? { alphaMode: 'BLEND' } : {}),
    });
    json.meshes[0].primitives.push({
      attributes,
      indices: accessor(Uint32Array.from(data.indices), 'SCALAR', 5125, 34963),
      material: json.materials.length - 1,
    });
  }
  json.buffers.push({ byteLength: length });
  return buildGlb(json, Buffer.concat(chunks));
}
