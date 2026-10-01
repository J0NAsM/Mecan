// Política de licencias. Un modelo solo se incorpora si TODAS sus licencias declaradas permiten
// redistribución, uso comercial y obras derivadas (convertir/optimizar es una obra derivada).
// La política editable vive en catalog/license-policy.json; estos valores son el mínimo seguro.
import path from 'node:path';
import { DIRS, readJson } from './paths.js';

export const DEFAULT_POLICY = {
  allowed: {
    'CC0-1.0': {
      name: 'Creative Commons Zero v1.0 Universal',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: false,
      shareAlike: false,
    },
    'CC-BY-4.0': {
      name: 'Creative Commons Attribution 4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: true,
      shareAlike: false,
    },
    'CC-BY-3.0': {
      name: 'Creative Commons Attribution 3.0',
      url: 'https://creativecommons.org/licenses/by/3.0/',
      attribution: true,
      shareAlike: false,
    },
    'CC-BY-SA-4.0': {
      name: 'Creative Commons Attribution-ShareAlike 4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: true,
      shareAlike: true,
    },
  },
  // Marcas registradas incrustadas (logos): la licencia del modelo no otorga derechos sobre la marca.
  reviewPatterns: ['^LicenseRef-LegalMark-'],
  deniedReasons: {
    NC: 'La licencia prohíbe el uso comercial (NC).',
    ND: 'La licencia prohíbe obras derivadas (ND): no se puede convertir ni optimizar.',
    UNKNOWN: 'La licencia no está declarada o no es verificable.',
    RESTRICTED: 'Licencia propietaria o limitada a pruebas: no permite redistribución.',
  },
};

export function loadPolicy() {
  const custom = readJson(path.join(DIRS.catalog, 'license-policy.json'), null);
  return custom?.allowed ? custom : DEFAULT_POLICY;
}

// entries: [{ spdx, evidence }] → { decision: ALLOW | DENY | REVIEW, reason, licenses }
export function evaluateLicenses(entries, policy = loadPolicy()) {
  if (!entries?.length || entries.some((entry) => !entry?.spdx))
    return { decision: 'DENY', reason: policy.deniedReasons.UNKNOWN, licenses: [] };
  const licenses = [];
  for (const { spdx, evidence } of entries) {
    const id = String(spdx).trim();
    if (policy.reviewPatterns.some((pattern) => new RegExp(pattern).test(id)))
      return {
        decision: 'REVIEW',
        reason: `Incluye marcas registradas de terceros (${id}); requiere aprobación manual.`,
        licenses,
      };
    if (/(^|-)NC(-|$)/i.test(id))
      return { decision: 'DENY', reason: policy.deniedReasons.NC, licenses };
    if (/(^|-)ND(-|$)/i.test(id))
      return { decision: 'DENY', reason: policy.deniedReasons.ND, licenses };
    const known = policy.allowed[id];
    if (!known)
      return {
        decision: 'DENY',
        reason: /^LicenseRef-/i.test(id)
          ? `${policy.deniedReasons.RESTRICTED} (${id})`
          : `Licencia no admitida por la política: ${id}.`,
        licenses,
      };
    licenses.push({ spdx: id, ...known, evidence: evidence || '' });
  }
  return { decision: 'ALLOW', reason: 'Licencia verificada y admitida.', licenses };
}

// La búsqueda de Sketchfab informa solo la etiqueta de la licencia; la descarga usa slugs propios.
export const SKETCHFAB_LABELS = {
  'CC0 Public Domain': 'cc0',
  'CC Attribution': 'by',
  'CC Attribution-ShareAlike': 'by-sa',
  'CC Attribution-NoDerivs': 'by-nd',
  'CC Attribution-NonCommercial': 'by-nc',
  'CC Attribution-NonCommercial-ShareAlike': 'by-nc-sa',
  'CC Attribution-NonCommercial-NoDerivs': 'by-nc-nd',
  'Free Standard': 'st',
  Standard: 'st',
  Editorial: 'ed',
};
// Licencias propias de Sketchfab: permiten usar el modelo, no redistribuir el archivo.
export const SKETCHFAB_PROPRIETARY = {
  st: 'LicenseRef-Sketchfab-Standard',
  ed: 'LicenseRef-Sketchfab-Editorial',
};
export const SKETCHFAB_SPDX = {
  cc0: 'CC0-1.0',
  by: 'CC-BY-4.0',
  'by-sa': 'CC-BY-SA-4.0',
  'by-nd': 'CC-BY-ND-4.0',
  'by-nc': 'CC-BY-NC-4.0',
  'by-nc-sa': 'CC-BY-NC-SA-4.0',
  'by-nc-nd': 'CC-BY-NC-ND-4.0',
};
