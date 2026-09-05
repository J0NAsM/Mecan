import path from 'node:path';

export function within(root, relative) {
  const base = path.resolve(root),
    target = path.resolve(base, relative),
    suffix = path.relative(base, target);
  if (!suffix || suffix.startsWith('..') || path.isAbsolute(suffix))
    throw new Error('Ruta fuera del directorio permitido.');
  return target;
}
