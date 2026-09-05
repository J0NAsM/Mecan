// Genera public/mecan.ico, el icono del acceso directo de escritorio.
//
// Se dibuja por código y no se versiona un binario opaco: cualquiera puede revisar qué contiene el
// archivo que Windows va a mostrar. El formato ICO admite una imagen PNG embebida desde Windows
// Vista, así que basta una sola entrada de 256x256.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 256;
const BACKGROUND = [0x0f, 0x76, 0x6e];
const STROKE = [0xff, 0xff, 0xff];
const RADIUS = 56;
const STROKE_WIDTH = 26;
// Trazo de la «M» de la marca, en coordenadas del lienzo de 256 px.
const LETTER = [
  [78, 182],
  [78, 74],
  [128, 138],
  [178, 74],
  [178, 182],
];

/** Distancia con signo de un punto al borde de un rectángulo redondeado centrado en el lienzo. */
function roundedRectDistance(x, y) {
  const half = SIZE / 2;
  const dx = Math.abs(x - half) - (half - RADIUS);
  const dy = Math.abs(y - half) - (half - RADIUS);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - RADIUS;
}

/** Distancia de un punto al segmento AB; con ella el trazo queda con extremos redondeados. */
function segmentDistance(x, y, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const length = vx * vx + vy * vy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / length));
  return Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
}

function coverage(distance) {
  return Math.min(1, Math.max(0, 0.5 - distance));
}

function pixels() {
  // Formato PNG «filtro 0» por fila: un byte de filtro seguido de RGBA por píxel.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const shape = coverage(roundedRectDistance(cx, cy));
      let letter = Infinity;
      for (let index = 0; index < LETTER.length - 1; index += 1)
        letter = Math.min(letter, segmentDistance(cx, cy, LETTER[index], LETTER[index + 1]));
      const ink = coverage(letter - STROKE_WIDTH / 2);
      for (let channel = 0; channel < 3; channel += 1)
        raw[offset + channel] = Math.round(BACKGROUND[channel] * (1 - ink) + STROKE[channel] * ink);
      raw[offset + 3] = Math.round(255 * shape);
      offset += 4;
    }
  }
  return raw;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function png() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // profundidad de bits
  header[9] = 6; // color verdadero con alfa
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels(), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(image) {
  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(0, 0); // reservado
  directory.writeUInt16LE(1, 2); // tipo icono
  directory.writeUInt16LE(1, 4); // una sola imagen
  directory[6] = 0; // 0 significa 256 px
  directory[7] = 0;
  directory[8] = 0; // paleta
  directory[9] = 0; // reservado
  directory.writeUInt16LE(1, 10); // planos
  directory.writeUInt16LE(32, 12); // bits por píxel
  directory.writeUInt32LE(image.length, 14);
  directory.writeUInt32LE(22, 18); // desplazamiento de los datos
  return Buffer.concat([directory, image]);
}

const target = path.resolve('public', 'mecan.ico');
fs.writeFileSync(target, ico(png()));
console.log(`Icono generado: ${path.relative(process.cwd(), target)}`);
