import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { within } from './storage-paths.js';
export { within } from './storage-paths.js';

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function checkDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (
      db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('La base no supera las verificaciones de integridad.');
    return db.prepare('SELECT storage_key,size_bytes FROM files').all();
  } finally {
    db.close();
  }
}
export function createBackup(settings) {
  const source = path.resolve(settings.databasePath);
  if (!fs.existsSync(source)) throw new Error('No existe la base que se desea respaldar.');
  const directory = path.resolve(settings.backupPath),
    name =
      'mecan-' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      crypto.randomBytes(3).toString('hex'),
    target = within(directory, name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const databaseFile = within(target, 'database.db'),
    db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA busy_timeout=10000');
    db.exec(`VACUUM INTO '${databaseFile.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
  const files = checkDb(databaseFile),
    entries = [];
  for (const file of files) {
    const original = within(settings.storagePath, file.storage_key),
      destination = within(path.join(target, 'storage'), file.storage_key);
    if (
      fs.lstatSync(original).isSymbolicLink() ||
      !fs.statSync(original).isFile() ||
      fs.statSync(original).size !== file.size_bytes
    )
      throw new Error(
        'Un archivo del respaldo no coincide con su registro. El respaldo incompleto no es restaurable.',
      );
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL);
    entries.push({ key: file.storage_key, size: file.size_bytes, sha256: hash(destination) });
  }
  fs.mkdirSync(path.join(target, 'storage'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(target, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        databaseSha256: hash(databaseFile),
        files: entries,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  return { directory: target, files: entries.length };
}
export function verifyBackup(directory) {
  const manifest = JSON.parse(fs.readFileSync(within(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || hash(within(directory, 'database.db')) !== manifest.databaseSha256)
    throw new Error('El respaldo está incompleto o ha sido modificado.');
  const rows = checkDb(within(directory, 'database.db'));
  if (rows.length !== manifest.files.length)
    throw new Error('El inventario de archivos no coincide.');
  for (const row of rows) {
    const entry = manifest.files.find((f) => f.key === row.storage_key),
      file = within(path.join(directory, 'storage'), row.storage_key);
    if (
      !entry ||
      entry.size !== row.size_bytes ||
      fs.lstatSync(file).isSymbolicLink() ||
      !fs
        .realpathSync(file)
        .startsWith(fs.realpathSync(path.join(directory, 'storage')) + path.sep) ||
      fs.statSync(file).size !== row.size_bytes ||
      hash(file) !== entry.sha256
    )
      throw new Error('Un archivo del respaldo está ausente o fue modificado.');
  }
  return manifest;
}
export function assertServerStopped(databasePath) {
  const lock = path.resolve(databasePath) + '.server-lock';
  if (!fs.existsSync(lock)) return;
  let pid;
  try {
    pid = JSON.parse(fs.readFileSync(lock, 'utf8')).pid;
  } catch {
    throw new Error(
      'No se pudo verificar el bloqueo del servidor. Revisa el proceso antes de continuar.',
    );
  }
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    throw error;
  }
  throw new Error('Detén el servidor antes de restaurar o iniciar otra instancia.');
}
export function acquireServerLock(databasePath) {
  if (databasePath === ':memory:') return () => {};
  const lock = path.resolve(databasePath) + '.server-lock';
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  assertServerStopped(databasePath);
  if (fs.existsSync(lock)) fs.unlinkSync(lock);
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    { flag: 'wx', mode: 0o600 },
  );
  return () => {
    try {
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock);
    } catch {}
  };
}
