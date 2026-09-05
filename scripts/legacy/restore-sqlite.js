import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../../src/config.js';
import { verifyBackup, assertServerStopped, within } from '../../src/backups.js';
const source = process.argv[2] && path.resolve(process.argv[2]);
if (!source || !process.argv.includes('--confirm'))
  throw new Error(
    'Uso: node scripts/legacy/restore-sqlite.js <directorio-del-respaldo> --confirm. Solo respaldos SQLite anteriores.',
  );
const manifest = verifyBackup(source);
assertServerStopped(config.databasePath);
const target = path.resolve(config.databasePath),
  storage = path.resolve(config.storagePath);
for (const candidate of [storage, path.dirname(target)]) {
  if ([path.parse(candidate).root, path.resolve('.'), os.homedir()].includes(candidate))
    throw new Error(
      'La restauración requiere directorios específicos de datos y archivos, no una raíz general.',
    );
}
if (
  !path.relative(storage, source).startsWith('..') ||
  !path.relative(path.dirname(target), source).startsWith('..')
)
  throw new Error('Usa un respaldo fuera de los directorios que serán restaurados.');
const stamp = Date.now(),
  oldDb = target + '.before-restore-' + stamp,
  oldStorage = storage + '.before-restore-' + stamp;
const stagingDb = target + '.restore-' + stamp,
  stagingStorage = storage + '.restore-' + stamp;
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.mkdirSync(stagingStorage, { recursive: true });
fs.copyFileSync(within(source, 'database.db'), stagingDb, fs.constants.COPYFILE_EXCL);
for (const entry of manifest.files) {
  const destination = within(stagingStorage, entry.key);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(
    within(path.join(source, 'storage'), entry.key),
    destination,
    fs.constants.COPYFILE_EXCL,
  );
}
let dbMoved = false,
  filesMoved = false,
  installedFiles = false;
try {
  if (fs.existsSync(storage)) {
    fs.renameSync(storage, oldStorage);
    filesMoved = true;
  }
  if (fs.existsSync(target)) {
    fs.renameSync(target, oldDb);
    dbMoved = true;
  }
  for (const suffix of ['-wal', '-shm'])
    if (fs.existsSync(target + suffix)) fs.renameSync(target + suffix, oldDb + suffix);
  fs.renameSync(stagingStorage, storage);
  installedFiles = true;
  fs.renameSync(stagingDb, target);
} catch (error) {
  if (installedFiles) fs.renameSync(storage, stagingStorage);
  if (filesMoved && !fs.existsSync(storage)) fs.renameSync(oldStorage, storage);
  if (dbMoved && !fs.existsSync(target)) fs.renameSync(oldDb, target);
  for (const suffix of ['-wal', '-shm'])
    if (fs.existsSync(oldDb + suffix) && !fs.existsSync(target + suffix))
      fs.renameSync(oldDb + suffix, target + suffix);
  throw error;
}
console.log(
  'Restauración completa. Base y archivos verificados. Se conservaron las copias anteriores:',
);
if (dbMoved) console.log(oldDb);
if (filesMoved) console.log(oldStorage);
