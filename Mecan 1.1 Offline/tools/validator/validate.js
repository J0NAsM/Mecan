// Revalida sin internet cada archivo del catálogo: existencia, SHA-256 y estructura GLB.
// Un archivo alterado o corrupto queda marcado INVALID y la aplicación deja de ofrecerlo.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DIRS, readJson, writeJson } from '../lib/paths.js';
import { sha256, writeModelFiles } from '../lib/catalog.js';
import { analyzeGlb } from '../lib/gltf.js';

const file = path.join(DIRS.catalog, 'models.json');
const catalog = readJson(file, { models: [] });
let valid = 0;
const problems = [];
for (const model of catalog.models) {
  const issues = [];
  const target = path.join(ROOT, model.file || '');
  if (!model.file || !target.startsWith(ROOT + path.sep) || !fs.existsSync(target))
    issues.push('Archivo ausente');
  else {
    const bytes = fs.readFileSync(target);
    if (sha256(bytes) !== model.sha256)
      issues.push('SHA-256 distinto al registrado: el archivo fue modificado');
    issues.push(...analyzeGlb(bytes).issues);
  }
  for (const [level, lodFile] of Object.entries(model.lod || {}))
    if (level !== 'HIGH' && !fs.existsSync(path.join(ROOT, lodFile)))
      issues.push(`Falta el nivel ${level}`);
  model.validation = {
    status: issues.length ? 'INVALID' : 'VALID',
    checkedAt: new Date().toISOString(),
    issues,
  };
  if (issues.length) problems.push(`${model.id}: ${issues.join('; ')}`);
  else valid++;
  if (fs.existsSync(path.dirname(target))) writeModelFiles(model);
}
catalog.validatedAt = new Date().toISOString();
writeJson(file, catalog);
console.log(`Modelos válidos: ${valid}/${catalog.models.length}`);
for (const problem of problems) console.log(`  ! ${problem}`);
process.exitCode = problems.length ? 1 : 0;
