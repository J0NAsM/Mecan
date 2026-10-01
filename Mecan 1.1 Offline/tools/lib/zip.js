// Lector ZIP mínimo (store/deflate) para paquetes descargados. No extrae a disco: entrega los
// bytes de las entradas pedidas. Rechaza rutas absolutas, «..», enlaces simbólicos y ZIP64.
import zlib from 'node:zlib';

const EOCD = 0x06054b50,
  CENTRAL = 0x02014b50,
  LOCAL = 0x04034b50;

export function readZip(buffer, { maxEntryBytes = 200_000_000 } = {}) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--)
    if (buffer.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('ZIP inválido: falta el directorio central.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (offset === 0xffffffff) throw new Error('ZIP64 no admitido.');
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL)
      throw new Error('ZIP inválido: entrada central corrupta.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    const name = rawName.replaceAll('\\', '/');
    const directory = name.endsWith('/');
    const symlink = ((externalAttributes >>> 16) & 0o170000) === 0o120000;
    const unsafe =
      name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..') || symlink;
    entries.push({
      name,
      directory,
      unsafe,
      size,
      method,
      read() {
        if (unsafe) throw new Error(`Entrada ZIP insegura: ${name}`);
        if (size > maxEntryBytes || compressedSize === 0xffffffff)
          throw new Error(`Entrada ZIP demasiado grande: ${name}`);
        if (buffer.readUInt32LE(localOffset) !== LOCAL)
          throw new Error(`Cabecera local corrupta: ${name}`);
        const start =
          localOffset +
          30 +
          buffer.readUInt16LE(localOffset + 26) +
          buffer.readUInt16LE(localOffset + 28);
        const data = buffer.subarray(start, start + compressedSize);
        const bytes =
          method === 0
            ? Buffer.from(data)
            : method === 8
              ? zlib.inflateRawSync(data, { maxOutputLength: Math.max(size, 1) })
              : null;
        if (!bytes) throw new Error(`Compresión ZIP no admitida (${method}): ${name}`);
        if (bytes.length !== size) throw new Error(`Tamaño inesperado al descomprimir: ${name}`);
        return bytes;
      },
    });
  }
  return entries;
}
