// Rutas de la biblioteca «Mecan 1.1 Offline». Todo es relativo a la carpeta: se puede copiar
// completa a otra PC y seguir funcionando sin conexión.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const DIRS = {
  models: path.join(ROOT, 'models'),
  catalog: path.join(ROOT, 'catalog'),
  thumbnails: path.join(ROOT, 'thumbnails'),
  cache: path.join(ROOT, 'cache'),
  inbox: path.join(ROOT, 'tools', 'sources', 'custom', 'inbox'),
};
export const CATEGORIES = [
  'cars',
  'motorcycles',
  'trucks',
  'buses',
  'vans',
  'pickups',
  'suv',
  'other',
];

export const slug = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'sin-nombre';

// Solo un archivo inexistente usa el valor por defecto. Un JSON dañado detiene la herramienta:
// tratarlo como vacío terminaría sobrescribiendo el catálogo o relajando la política de licencias.
export function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    value = undefined;
  }
  if (!value || typeof value !== 'object')
    throw new Error(
      `JSON inválido en ${relative(file)}: corrígelo o restáuralo desde una copia; no se modificó nada.`,
    );
  return value;
}

// Escritura atómica: un corte a mitad de la escritura nunca deja un catálogo truncado.
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

export const relative = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');

export function inside(base, candidate) {
  const target = path.resolve(base, candidate);
  if (target !== base && !target.startsWith(base + path.sep))
    throw new Error(`Ruta fuera de la biblioteca: ${candidate}`);
  return target;
}
