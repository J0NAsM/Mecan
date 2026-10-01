// Importación manual sin internet: cada modelo se deja en tools/sources/custom/inbox/<carpeta>/
// junto a un source.json que declare licencia (SPDX), autor y procedencia. Sin esa declaración el
// modelo queda en revisión y no se incorpora.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, readJson } from '../../lib/paths.js';

export const id = 'custom';
export const label = 'Importación local (bandeja custom)';
const MODEL = /\.(glb|gltf|obj)$/i;

export async function discover() {
  if (!fs.existsSync(DIRS.inbox)) return [];
  const candidates = [];
  for (const folder of fs.readdirSync(DIRS.inbox, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const base = path.join(DIRS.inbox, folder.name);
    const files = fs.readdirSync(base).filter((name) => MODEL.test(name));
    const source = readJson(path.join(base, 'source.json'), null);
    for (const name of files) {
      const format = path.extname(name).slice(1).toLowerCase();
      const resolve = (uri) => {
        const target = path.resolve(base, decodeURIComponent(uri));
        return target.startsWith(base + path.sep) && fs.existsSync(target)
          ? fs.readFileSync(target)
          : null;
      };
      candidates.push({
        key: `custom:${folder.name}/${name}`,
        sourceId: 'custom',
        sourceName: 'Importación local',
        adapter: id,
        url: source?.url || `inbox/${folder.name}`,
        originalPath: `${folder.name}/${name}`,
        title: source?.model || name,
        author: source?.author || '',
        attribution: source?.attribution || null,
        licenses: source?.license
          ? [
              {
                spdx: source.license,
                evidence: source.evidence || 'source.json declarado por quien importó el modelo',
              },
            ]
          : [],
        meta: {
          generic: Boolean(source?.generic),
          brand: source?.brand || 'Genérico',
          model: source?.model || path.basename(name, path.extname(name)),
          version: source?.version || null,
          year: source?.year || null,
          category: source?.category,
          vehicleType: source?.vehicleType || source?.category,
        },
        originalFormat: format,
        status: source ? undefined : 'REVIEW',
        reason: source ? undefined : 'Falta source.json con licencia, autor y procedencia.',
        load: async () => ({ bytes: fs.readFileSync(path.join(base, name)), resources: resolve }),
      });
    }
  }
  return candidates;
}
