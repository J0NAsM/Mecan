import fs from 'node:fs';
import { config } from './config.js';
import { opaqueHash } from './security.js';
import { esc, pageHead } from './ui.js';

export function legalDocument(kind) {
  const file = kind === 'terms' ? config.termsPath : config.privacyPath;
  if (!file || !fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return { text, version: opaqueHash(text) };
}
export function legalPage(kind) {
  const document = legalDocument(kind),
    title = kind === 'terms' ? 'Términos y condiciones' : 'Política de privacidad';
  return (
    pageHead(
      'INFORMACIÓN LEGAL',
      title,
      document
        ? 'Condiciones vigentes de la plataforma.'
        : 'Entorno de desarrollo: el titular aún debe publicar este documento.',
    ) +
    (config.companyName
      ? `<section class="legal-identity"><h2>Responsable de la plataforma</h2><p>${esc(config.companyName)}${config.companyTaxId ? ' · ' + esc(config.companyTaxId) : ''}</p><p>${esc(config.companyAddress)}${config.companyPhone ? ' · ' + esc(config.companyPhone) : ''}</p><p>${esc(config.supportEmail)}</p></section>`
      : '') +
    (document
      ? `<article class="legal-document">${esc(document.text)
          .split(/\r?\n\r?\n/)
          .map((paragraph) => `<p>${paragraph.replaceAll('\n', '<br>')}</p>`)
          .join('')}</article>`
      : '<p>El registro productivo permanece bloqueado hasta incorporar el texto aprobado por el titular. No se utilizan datos empresariales ni condiciones legales inventadas.</p>')
  );
}
