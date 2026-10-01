// Bibliotecas públicas de modelos 3D.
// · Poly Haven: todos los assets son CC0; su API exige User-Agent propio y crédito a Poly Haven.
// · Sketchfab: la búsqueda es pública; la descarga exige un token personal (SKETCHFAB_API_TOKEN).
//   Sin token, los modelos con licencia admitida quedan registrados como «pendientes de credencial».
import crypto from 'node:crypto';
import path from 'node:path';
import { classify, words } from '../../lib/classify.js';
import { SKETCHFAB_SPDX, SKETCHFAB_LABELS, SKETCHFAB_PROPRIETARY } from '../../lib/license.js';
import { readZip } from '../../lib/zip.js';
import { zipResolver } from '../open_assets/index.js';

export const id = 'public_3d';
export const label = 'Bibliotecas públicas (Poly Haven, Sketchfab)';

async function polyHaven(ctx, settings) {
  const assets = await ctx.fetchJson('https://api.polyhaven.com/assets?t=models');
  const candidates = [];
  for (const [assetId, asset] of Object.entries(assets)) {
    // Solo nombre y categorías: las etiquetas mencionan «car» en productos de limpieza o repuestos.
    const classification = classify(`${asset.name} ${(asset.categories || []).join(' ')}`);
    if (!classification.vehicle) continue;
    candidates.push({
      key: `polyhaven:${assetId}`,
      sourceId: 'polyhaven',
      sourceName: 'Poly Haven',
      adapter: id,
      url: `https://polyhaven.com/a/${assetId}`,
      originalPath: `api.polyhaven.com/files/${assetId}`,
      title: asset.name,
      author: `${Object.keys(asset.authors || {}).join(', ') || 'Poly Haven'} (Poly Haven)`,
      attribution: 'Modelo de Poly Haven (polyhaven.com), obtenido mediante su API pública.',
      licenses: [
        {
          spdx: 'CC0-1.0',
          evidence: 'polyhaven.com/license: todos los assets se publican bajo CC0.',
        },
      ],
      meta: {
        generic: true,
        brand: 'Genérico',
        model: asset.name,
        version: 'Poly Haven',
        year: null,
        category: classification.category,
        vehicleType: classification.vehicleType,
      },
      originalFormat: 'gltf',
      load: async () => {
        const files = await ctx.fetchJson(`https://api.polyhaven.com/files/${assetId}`);
        const level = async (resolution) => {
          const entry = files.gltf?.[resolution]?.gltf;
          if (!entry) return null;
          const verify = async (url, md5) => {
            const bytes = await ctx.fetchBuffer(url);
            if (md5 && crypto.createHash('md5').update(bytes).digest('hex') !== md5)
              throw new Error(`Suma MD5 distinta a la publicada: ${url}`);
            return bytes;
          };
          const bytes = await verify(entry.url, entry.md5);
          const resources = new Map();
          for (const [relative, include] of Object.entries(entry.include || {}))
            resources.set(path.posix.normalize(relative), await verify(include.url, include.md5));
          return {
            bytes,
            resources: (uri) =>
              resources.get(path.posix.normalize(decodeURIComponent(uri))) || null,
          };
        };
        const high = await level(settings.levels.HIGH);
        if (!high) throw new Error('Poly Haven no publica la resolución configurada.');
        const low = settings.levels.LOW ? await level(settings.levels.LOW) : null;
        return { ...high, lods: low ? { LOW: low } : {} };
      },
    });
  }
  return candidates;
}

async function sketchfab(ctx, settings) {
  const token = process.env[settings.tokenEnv];
  const candidates = [];
  for (const request of ctx.requested) {
    await ctx.wait(settings.delayMs);
    const query = `${request.brand} ${request.model}`;
    const result = await ctx.fetchJson(
      `https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24&q=${encodeURIComponent(query)}`,
    );
    const brand = words(request.brand).trim(),
      model = words(request.model).trim();
    const matches = (result.results || [])
      .filter((item) => {
        const name = words(item.name);
        return (
          name.includes(` ${brand} `) &&
          model.split(' ').every((token) => name.includes(` ${token} `))
        );
      })
      .slice(0, settings.maxResultsPerVehicle);
    for (const item of matches) {
      const slugLicense = item.license?.slug || SKETCHFAB_LABELS[item.license?.label] || '';
      const spdx = SKETCHFAB_SPDX[slugLicense] || SKETCHFAB_PROPRIETARY[slugLicense] || null;
      const allowed = settings.licenses.includes(slugLicense);
      const year = Number(item.name.match(/\b(19[5-9]\d|20[0-4]\d)\b/)?.[1]) || null;
      candidates.push({
        key: `sketchfab:${item.uid}`,
        sourceId: 'sketchfab',
        sourceName: 'Sketchfab',
        adapter: id,
        requestKey: request.key,
        url: `https://sketchfab.com/models/${item.uid}`,
        originalPath: `sketchfab:${item.uid}`,
        title: item.name,
        author: item.user?.displayName || item.user?.username || 'Autor de Sketchfab',
        attribution: `«${item.name}» (https://sketchfab.com/models/${item.uid}) por ${item.user?.displayName || item.user?.username} — ${item.license?.label || slugLicense}`,
        licenses: spdx
          ? [
              {
                spdx,
                evidence: `Licencia publicada en Sketchfab: ${item.license?.label || slugLicense}`,
              },
            ]
          : [],
        licenseLabel: item.license?.label || slugLicense || 'sin licencia',
        meta: {
          generic: false,
          brand: request.brand,
          model: request.model,
          version: `Sketchfab · ${item.name}`,
          year,
          category: request.category,
          vehicleType: request.vehicleType || request.category,
          trademarkNotice:
            'Representa un vehículo de una marca registrada: la licencia CC cubre el modelo 3D, no la marca.',
        },
        originalFormat: 'gltf',
        status: allowed && !token ? 'PENDING_CREDENTIALS' : undefined,
        reason: allowed
          ? token
            ? undefined
            : `Licencia admitida (${item.license?.label}); la descarga requiere la variable ${settings.tokenEnv}.`
          : undefined,
        load: async () => {
          const links = await ctx.fetchJson(
            `https://api.sketchfab.com/v3/models/${item.uid}/download`,
            {
              headers: { Authorization: `Token ${token}` },
            },
          );
          if (!links.gltf?.url)
            throw new Error('Sketchfab no ofrece la variante glTF de este modelo.');
          const entries = readZip(await ctx.fetchBuffer(links.gltf.url));
          const main = entries.find(
            (entry) => /(^|\/)scene\.gltf$/i.test(entry.name) && !entry.unsafe,
          );
          if (!main) throw new Error('El paquete de Sketchfab no contiene scene.gltf.');
          return { bytes: main.read(), resources: zipResolver(entries, main.name) };
        },
      });
    }
  }
  return candidates;
}

export async function discover(ctx) {
  const settings = ctx.config.public_3d || {};
  const candidates = [];
  if (settings.polyhaven?.enabled)
    try {
      candidates.push(...(await polyHaven(ctx, settings.polyhaven)));
    } catch (error) {
      ctx.problem(`Poly Haven: ${error.message}`);
    }
  if (settings.sketchfab?.enabled)
    try {
      candidates.push(...(await sketchfab(ctx, settings.sketchfab)));
    } catch (error) {
      ctx.problem(`Sketchfab: ${error.message}`);
    }
  return candidates;
}
