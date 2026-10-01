// GitHub como fuente de descubrimiento y descarga. Nunca se asume que un repositorio completo es
// redistribuible: cada modelo necesita evidencia de licencia (metadatos por modelo o declaración
// explícita del autor sobre los modelos 3D). Lo hallado por búsqueda solo se registra para revisión.
import path from 'node:path';
import { classify } from '../../lib/classify.js';
import { parseGlb } from '../../lib/gltf.js';

export const id = 'github';
export const label = 'GitHub';
const raw = (repo, branch, file) =>
  `https://raw.githubusercontent.com/${repo}/${branch}/${file.split('/').map(encodeURIComponent).join('/')}`;
const media = (repo, branch, file) =>
  `https://media.githubusercontent.com/media/${repo}/${branch}/${file.split('/').map(encodeURIComponent).join('/')}`;
const CONTRADICTIONS =
  /not for (re)?publish|do not (re)?distribute|don'?t (re)?distribute|personal use only|non-?commercial|downloaded from|ripped|all rights reserved/i;

// Archivos grandes versionados con Git LFS: raw devuelve un puntero, media entrega el contenido.
async function download(ctx, repo, branch, file) {
  const bytes = await ctx.fetchBuffer(raw(repo, branch, file));
  if (bytes.subarray(0, 40).toString('latin1').startsWith('version https://git-lfs'))
    return ctx.fetchBuffer(media(repo, branch, file));
  return bytes;
}
function gltfResolver(ctx, repo, branch, file) {
  const cache = new Map();
  return {
    prefetch: async (json) => {
      const uris = [...(json.buffers || []), ...(json.images || [])]
        .map((item) => item.uri)
        .filter((uri) => uri && !uri.startsWith('data:'));
      for (const uri of uris) {
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), decodeURIComponent(uri)),
        );
        if (target.startsWith('..')) throw new Error(`Recurso fuera del modelo: ${uri}`);
        cache.set(uri, await download(ctx, repo, branch, target));
      }
    },
    resolve: (uri) => cache.get(uri) || null,
  };
}

// GLB o glTF junto con los recursos relativos que referencie (texturas, .bin) del mismo repositorio.
async function downloadWithResources(ctx, repo, branch, file) {
  const bytes = await download(ctx, repo, branch, file);
  const json = /\.gltf$/i.test(file) ? JSON.parse(bytes.toString('utf8')) : parseGlb(bytes).json;
  const resolver = gltfResolver(ctx, repo, branch, file);
  await resolver.prefetch(json);
  return { bytes, resources: resolver.resolve };
}

function candidateBase(repository, extra) {
  return {
    sourceId: repository.id,
    sourceName: repository.name,
    adapter: id,
    author: repository.author || '',
    attribution: null,
    ...extra,
  };
}

async function khronosIndex(ctx, repository) {
  const index = JSON.parse(
    (
      await ctx.fetchBuffer(raw(repository.repo, repository.branch, 'Models/model-index.json'))
    ).toString('utf8'),
  );
  const candidates = [];
  for (const entry of index) {
    const mapped = repository.names?.[entry.name];
    const classification = mapped
      ? { vehicle: true, ...mapped }
      : classify(`${entry.name} ${entry.label || ''}`);
    if (!classification.vehicle) continue;
    const folder = `Models/${entry.name}`;
    const metadata = JSON.parse(
      (
        await ctx.fetchBuffer(raw(repository.repo, repository.branch, `${folder}/metadata.json`))
      ).toString('utf8'),
    );
    const legal = metadata.legal || [];
    const licenses = legal.map((item) => ({
      spdx: item.spdx || item.license,
      evidence: `${folder}/metadata.json: ${item.text || item.license} — ${item.what || ''} (${item.artist || item.owner}, ${item.year})`,
    }));
    const copyright = legal.filter((item) => item.spdx);
    const variant = entry.variants?.['glTF-Binary']
      ? ['glTF-Binary', entry.variants['glTF-Binary']]
      : entry.variants?.glTF
        ? ['glTF', entry.variants.glTF]
        : null;
    const file = variant ? `${folder}/${variant[0]}/${variant[1]}` : null;
    candidates.push(
      candidateBase(repository, {
        key: `${repository.id}:${file || folder}`,
        url: `https://github.com/${repository.repo}/tree/${repository.branch}/${folder}`,
        originalPath: file || folder,
        title: entry.name,
        author: [...new Set(copyright.map((item) => item.artist))].join(', ') || 'Khronos Group',
        attribution: copyright.some((item) => /^CC-BY/.test(item.spdx))
          ? copyright
              .map(
                (item) =>
                  `«${metadata.name}» ${item.what ? `(${item.what}) ` : ''}© ${item.year} ${item.owner}, ${item.artist} — ${item.spdx}`,
              )
              .join('; ') + ` — ${repository.repo}`
          : null,
        licenses,
        meta: {
          generic: true,
          brand: 'Genérico',
          model: classification.model || metadata.name || entry.name,
          version: 'Khronos glTF Sample Assets',
          year: null,
          category: classification.category,
          vehicleType: classification.vehicleType,
          trademarkNotice: legal.some((item) => /LegalMark/.test(item.license))
            ? 'Contiene logos con marca registrada de terceros.'
            : null,
        },
        originalFormat: variant?.[0] === 'glTF' ? 'gltf' : 'glb',
        status: file ? undefined : 'INVALID',
        reason: file ? undefined : 'Sin variante glTF/GLB publicada.',
        load: async () => {
          return downloadWithResources(ctx, repository.repo, repository.branch, file);
        },
      }),
    );
  }
  return candidates;
}

async function readmeLicense(ctx, repository) {
  const candidates = [];
  for (const model of repository.models || []) {
    // Un README que no se pudo leer no es un README sin licencia: se informa como tal.
    let readme = '',
      readError = null;
    try {
      readme = await ctx.fetchText(
        raw(repository.repo, repository.branch, `${model.path}/README.md`),
      );
    } catch (error) {
      readError = error.message;
    }
    const section = readme.split(/##\s*License Information/i)[1]?.split(/\n##\s/)[0] || '';
    const spdx = /CC0|public domain/i.test(section)
      ? 'CC0-1.0'
      : /CC[- ]BY[- ]4\.0|Attribution 4\.0/i.test(section)
        ? 'CC-BY-4.0'
        : null;
    candidates.push(
      candidateBase(repository, {
        key: `${repository.id}:${model.path}/${model.file}`,
        url: `https://github.com/${repository.repo}/tree/${repository.branch}/${model.path}`,
        originalPath: `${model.path}/${model.file}`,
        title: model.model,
        licenses: spdx ? [{ spdx, evidence: `${model.path}/README.md (License Information)` }] : [],
        meta: {
          generic: true,
          brand: 'Genérico',
          model: model.model,
          version: repository.name,
          category: model.category,
          vehicleType: model.vehicleType,
        },
        originalFormat: 'glb',
        reason: spdx
          ? undefined
          : readError
            ? `No se pudo leer el README para verificar la licencia (${readError}); se reintentará en la próxima recopilación.`
            : `El README no declara una licencia para el modelo: «${section.trim().replace(/\s+/g, ' ').slice(0, 160)}».`,
        load: async () => ({
          bytes: await download(
            ctx,
            repository.repo,
            repository.branch,
            `${model.path}/${model.file}`,
          ),
        }),
      }),
    );
  }
  return candidates;
}

async function tree(ctx, repository) {
  const evidenceFile = await ctx.fetchText(
    raw(repository.repo, repository.branch, repository.licenseEvidence.file),
  );
  const statement = evidenceFile.match(new RegExp(repository.licenseEvidence.pattern, 'i'))?.[0];
  const licenses = statement
    ? [
        {
          spdx: repository.licenseEvidence.spdx,
          evidence: `${repository.licenseEvidence.file}: «${statement.trim()}»`,
        },
      ]
    : [];
  const listing = await ctx.githubApi(
    `/repos/${repository.repo}/git/trees/${repository.branch}?recursive=1`,
  );
  return (listing.tree || [])
    .filter(
      (item) =>
        item.type === 'blob' &&
        repository.paths.some((prefix) => item.path.startsWith(prefix)) &&
        /\.glb$/i.test(item.path),
    )
    .map((item) => {
      const name = path.posix.basename(item.path, '.glb');
      const mapped = repository.names?.[name];
      const classification = mapped ? { vehicle: true, ...mapped } : classify(name);
      return candidateBase(repository, {
        key: `${repository.id}:${item.path}`,
        url: `https://github.com/${repository.repo}/blob/${repository.branch}/${item.path}`,
        originalPath: item.path,
        title: name,
        licenses,
        meta: {
          generic: true,
          brand: 'Genérico',
          model: classification.model || name,
          version: repository.name,
          category: classification.category,
          vehicleType: classification.vehicleType,
        },
        originalFormat: 'glb',
        status: classification.vehicle ? undefined : 'NOT_VEHICLE',
        reason: classification.reason,
        load: () => downloadWithResources(ctx, repository.repo, repository.branch, item.path),
      });
    });
}

function explicit(ctx, repository) {
  return repository.files.map((file) =>
    candidateBase(repository, {
      key: `${repository.id}:${file.path}`,
      url: `https://github.com/${repository.repo}/blob/${repository.branch}/${file.path}`,
      originalPath: file.path,
      title: file.model,
      licenses: file.license ? [{ spdx: file.license, evidence: file.evidence }] : [],
      meta: {
        generic: !file.brand,
        brand: file.brand || 'Genérico',
        model: file.model,
        version: repository.name,
        category: file.category,
        vehicleType: file.vehicleType,
      },
      originalFormat: 'glb',
      reason: file.license ? undefined : file.note,
      load: async () => ({
        bytes: await download(ctx, repository.repo, repository.branch, file.path),
      }),
    }),
  );
}

async function search(ctx, settings, configured) {
  const seen = new Set(configured);
  const candidates = [];
  for (const query of settings.queries || []) {
    const result = await ctx.githubApi(
      `/search/repositories?q=${encodeURIComponent(query)}&per_page=${settings.maxResultsPerQuery || 15}`,
    );
    for (const repo of result.items || []) {
      if (seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);
      const contradiction = CONTRADICTIONS.test(repo.description || '');
      candidates.push({
        key: `github-search:${repo.full_name}`,
        sourceId: 'github-search',
        sourceName: 'GitHub · búsqueda',
        adapter: id,
        url: repo.html_url,
        title: repo.full_name,
        author: repo.owner?.login || '',
        licenses:
          repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
            ? [{ spdx: repo.license.spdx_id, evidence: 'Licencia declarada del repositorio' }]
            : [],
        meta: {},
        status: contradiction ? 'DENY' : 'REVIEW',
        reason: contradiction
          ? `La descripción contradice la licencia declarada (${repo.license?.spdx_id || 'sin licencia'}): «${(repo.description || '').slice(0, 120)}».`
          : `Repositorio descubierto por búsqueda (${repo.license?.spdx_id || 'sin licencia'}): la licencia del repositorio no acredita la autoría ni la procedencia de cada modelo. Requiere revisión manual antes de agregarlo a sources.config.json.`,
      });
    }
  }
  return candidates;
}

export async function discover(ctx) {
  const settings = ctx.config.github || {};
  const candidates = [];
  for (const repository of settings.repositories || []) {
    try {
      if (repository.mode === 'khronos-index')
        candidates.push(...(await khronosIndex(ctx, repository)));
      else if (repository.mode === 'readme-license')
        candidates.push(...(await readmeLicense(ctx, repository)));
      else if (repository.mode === 'tree') candidates.push(...(await tree(ctx, repository)));
      else if (repository.mode === 'explicit') candidates.push(...explicit(ctx, repository));
    } catch (error) {
      ctx.problem(`${repository.name}: ${error.message}`);
    }
  }
  if (settings.search?.enabled)
    try {
      candidates.push(
        ...(await search(
          ctx,
          settings.search,
          (settings.repositories || []).map((r) => r.repo),
        )),
      );
    } catch (error) {
      ctx.problem(`GitHub · búsqueda: ${error.message}`);
    }
  return candidates;
}
