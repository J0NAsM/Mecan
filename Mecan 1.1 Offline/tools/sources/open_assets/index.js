// Paquetes de assets abiertos publicados como ZIP (Kenney). La licencia se verifica leyendo el
// License.txt incluido en el propio paquete descargado, no la página web.
import path from 'node:path';
import { readZip } from '../../lib/zip.js';
import { classify } from '../../lib/classify.js';

export const id = 'open_assets';
export const label = 'Paquetes de assets abiertos (Kenney)';
const UNEXPECTED = /\.(exe|dll|bat|cmd|ps1|sh|vbs|js|jar|msi|com|scr|lnk|url|html?|app|apk|py)$/i;

export function zipResolver(entries, basePath) {
  return (uri) => {
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(basePath), decodeURIComponent(uri)),
    );
    const entry = entries.find((candidate) => candidate.name === target && !candidate.unsafe);
    return entry ? entry.read() : null;
  };
}

export async function discover(ctx) {
  const candidates = [];
  for (const kit of ctx.config.open_assets?.kenney || []) {
    const html = await ctx.fetchText(kit.page);
    const zipUrl = html.match(/https:\/\/kenney\.nl\/media\/pages\/assets\/[^"'\s]+\.zip/)?.[0];
    if (!zipUrl) {
      ctx.problem(`${kit.name}: la página no publica un enlace de descarga reconocible.`);
      continue;
    }
    const zip = await ctx.cachedDownload(zipUrl, 'kenney');
    const entries = readZip(zip);
    const licenseText =
      entries
        .find((e) => /(^|\/)license\.txt$/i.test(e.name) && !e.unsafe)
        ?.read()
        .toString('latin1') || '';
    const packageName =
      licenseText.match(/^\s*([^\r\n]+\(\d+(?:\.\d+)*\))\s*$/m)?.[1]?.trim() || kit.name;
    const licenses = /Creative Commons Zero|\bCC0\b/i.test(licenseText)
      ? [
          {
            spdx: 'CC0-1.0',
            evidence: `License.txt del paquete «${packageName}»: «License: (Creative Commons Zero, CC0)»`,
          },
        ]
      : [];
    const unexpected = entries.filter((e) => UNEXPECTED.test(e.name) || e.unsafe);
    if (unexpected.length)
      ctx.security(
        `${kit.name}: ${unexpected.length} archivo(s) no esperados ignorados sin extraer ni ejecutar (${[...new Set(unexpected.map((e) => path.posix.extname(e.name) || e.name))].join(', ')}).`,
      );
    const alternates = entries.filter((e) => /\.(obj|fbx|mtl)$/i.test(e.name)).length;
    if (alternates)
      ctx.note(
        `${kit.name}: ${alternates} archivo(s) OBJ/FBX/MTL omitidos porque los mismos modelos están en GLB.`,
      );
    const glbs = entries.filter((e) => !e.directory && !e.unsafe && /\.glb$/i.test(e.name));
    const lods = new Map();
    const byName = new Map();
    for (const entry of glbs) {
      const name = path.posix.basename(entry.name, '.glb');
      const mapped = kit.names?.[name];
      if (mapped?.lodOf) {
        lods.set(mapped.lodOf, { level: mapped.level, entry });
        continue;
      }
      const classification = mapped
        ? { vehicle: true, ...mapped }
        : kit.onlyListed
          ? {
              vehicle: false,
              reason:
                'Elemento del paquete que no es un vehículo (escenario, pista, pieza o accesorio).',
            }
          : classify(name);
      const candidate = {
        key: `${kit.id}:${entry.name}`,
        sourceId: kit.id,
        sourceName: kit.name,
        adapter: id,
        url: kit.page,
        downloadUrl: zipUrl,
        originalPath: entry.name,
        title: name,
        author: 'Kenney (www.kenney.nl)',
        attribution: null,
        licenses,
        meta: {
          generic: true,
          brand: 'Genérico',
          model: classification.model || name,
          version: `Kenney ${packageName}`,
          year: null,
          category: classification.category,
          vehicleType: classification.vehicleType,
        },
        originalFormat: 'glb',
        status: classification.vehicle ? undefined : 'NOT_VEHICLE',
        reason: classification.reason,
        load: async () => ({
          bytes: entry.read(),
          resources: zipResolver(entries, entry.name),
          lods: {},
        }),
      };
      byName.set(name, candidate);
      candidates.push(candidate);
    }
    for (const [name, lod] of lods) {
      const candidate = byName.get(name);
      if (!candidate) continue;
      const load = candidate.load;
      candidate.load = async () => ({
        ...(await load()),
        lods: {
          [lod.level]: { bytes: lod.entry.read(), resources: zipResolver(entries, lod.entry.name) },
        },
      });
    }
  }
  return candidates;
}
