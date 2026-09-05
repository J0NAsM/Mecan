import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { within } from '../storage-paths.js';
import { createPostgresDatabase, postgresOptions } from './database.js';

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const connectionIdentity = (options) => {
  const url = new URL(options.connectionString);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([url.hostname, url.port || '5432', decodeURIComponent(url.pathname)]))
    .digest('hex');
};
function cliEnvironment(env, options) {
  const url = new URL(options.connectionString);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('PG')),
  );
  return {
    ...clean,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: options.ssl ? 'verify-full' : 'disable',
    ...(env.DATABASE_SSL_CA_FILE ? { PGSSLROOTCERT: path.resolve(env.DATABASE_SSL_CA_FILE) } : {}),
    PGCONNECT_TIMEOUT: String(Math.ceil(options.connectionTimeoutMillis / 1000)),
    PGAPPNAME: 'mecan-backup',
  };
}
async function pgCommand(name, args, env, options) {
  const executable = env.POSTGRES_BIN_PATH
    ? path.join(
        path.resolve(env.POSTGRES_BIN_PATH),
        name + (process.platform === 'win32' ? '.exe' : ''),
      )
    : name;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: cliEnvironment(env, options),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 600000,
    });
    // Drain diagnostics without logging SQL, row data, file names or credentials.
    child.stderr.resume();
    child.on('error', () =>
      reject(
        new Error(
          `No se pudo ejecutar ${name}. Verifica POSTGRES_BIN_PATH y la instalación de clientes PostgreSQL.`,
        ),
      ),
    );
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${name} no pudo completar la operación; código ${code ?? 'interrumpido'}. No se considera un respaldo/restauración verificado.`,
            ),
          ),
    );
  });
}
function regularPrivateFile(root, key, expectedSize) {
  const file = within(root, key);
  const stat = fs.lstatSync(file);
  const canonical = fs.realpathSync(file),
    canonicalRoot = fs.realpathSync(root);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size !== expectedSize ||
    !canonical.startsWith(canonicalRoot + path.sep)
  )
    throw new Error(
      'Un archivo no coincide con su registro o está fuera del almacenamiento permitido.',
    );
  return file;
}

export async function createPostgresBackup(env = process.env) {
  const options = postgresOptions(env),
    db = createPostgresDatabase(options);
  const name =
    'mecan-pg-' +
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    crypto.randomBytes(4).toString('hex');
  const target = within(env.BACKUP_PATH || './backups', name);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const databaseFile = within(target, 'database.dump');
  try {
    return await db.transaction(
      async () => {
        // Exported snapshot stays open while pg_dump uses its own authenticated connection.
        await db.query("SET LOCAL idle_in_transaction_session_timeout='11min'");
        const { snapshot, version } = await db.get(
          'SELECT pg_export_snapshot() snapshot, current_setting($1) version',
          ['server_version_num'],
        );
        const files = await db.all('SELECT storage_key,size_bytes FROM files ORDER BY storage_key');
        await pgCommand(
          'pg_dump',
          [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--schema=' + options.schema,
            '--snapshot=' + snapshot,
            '--file=' + databaseFile,
          ],
          env,
          options,
        );
        const entries = [];
        fs.mkdirSync(path.join(target, 'storage'), { mode: 0o700 });
        for (const file of files) {
          const original = regularPrivateFile(
            env.STORAGE_PATH || './storage',
            file.storage_key,
            file.size_bytes,
          );
          const destination = within(path.join(target, 'storage'), file.storage_key);
          fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
          fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL);
          entries.push({
            key: file.storage_key,
            size: file.size_bytes,
            sha256: await sha256(destination),
          });
        }
        const manifest = {
          version: 2,
          engine: 'postgres',
          schema: options.schema,
          serverVersion: Number(version),
          sourceIdentity: connectionIdentity(options),
          createdAt: new Date().toISOString(),
          databaseSha256: await sha256(databaseFile),
          files: entries,
        };
        // Manifest is the completion marker. Failed/incomplete directories are never valid backups.
        fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), {
          flag: 'wx',
          mode: 0o600,
        });
        return { directory: target, files: entries.length, engine: 'postgres' };
      },
      { isolation: 'REPEATABLE READ', readOnly: true },
    );
  } finally {
    await db.close();
  }
}

export async function verifyPostgresBackup(directory) {
  const manifest = JSON.parse(fs.readFileSync(within(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== 2 ||
    manifest.engine !== 'postgres' ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(manifest.schema) ||
    !Array.isArray(manifest.files) ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceIdentity)
  )
    throw new Error('El manifiesto PostgreSQL no es válido.');
  if ((await sha256(within(directory, 'database.dump'))) !== manifest.databaseSha256)
    throw new Error('El respaldo PostgreSQL fue modificado o está incompleto.');
  const keys = new Set();
  for (const entry of manifest.files) {
    if (keys.has(entry.key) || !Number.isSafeInteger(entry.size) || entry.size < 0)
      throw new Error('El inventario del respaldo no es válido.');
    keys.add(entry.key);
    const file = regularPrivateFile(path.join(directory, 'storage'), entry.key, entry.size);
    if ((await sha256(file)) !== entry.sha256)
      throw new Error('Un archivo del respaldo fue modificado.');
  }
  return manifest;
}

export async function restorePostgresBackup(directory, env = process.env) {
  const manifest = await verifyPostgresBackup(directory);
  const options = postgresOptions(env);
  if (options.schema !== manifest.schema)
    throw new Error('DATABASE_SCHEMA debe coincidir con el respaldo.');
  if (connectionIdentity(options) === manifest.sourceIdentity)
    throw new Error('Restaura en otra base vacía, nunca sobre la base de origen.');
  const storage = path.resolve(env.STORAGE_PATH || './storage');
  if (fs.existsSync(storage) && fs.readdirSync(storage).length)
    throw new Error(
      'El almacenamiento de restauración debe estar vacío. No se reemplazarán archivos.',
    );
  const db = createPostgresDatabase(options);
  try {
    const occupied = await db.get(
      "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%') occupied",
    );
    if (occupied.occupied)
      throw new Error('La base de restauración debe estar vacía. No se reemplazarán datos.');
    // This is an offline recovery destination, not a running application database.
    // Copy files first; failed pg_restore leaves them available for diagnosis, not a valid completed restore.
    fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
    for (const entry of manifest.files) {
      const original = regularPrivateFile(path.join(directory, 'storage'), entry.key, entry.size);
      const target = within(storage, entry.key);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    }
    await pgCommand(
      'pg_restore',
      [
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--dbname=' + decodeURIComponent(new URL(options.connectionString).pathname.slice(1)),
        path.resolve(directory, 'database.dump'),
      ],
      env,
      options,
    );
    const files = await db.all('SELECT storage_key,size_bytes FROM files');
    if (files.length !== manifest.files.length)
      throw new Error('La base restaurada y el inventario de adjuntos no coinciden.');
    for (const file of files) {
      const entry = manifest.files.find(
        (item) => item.key === file.storage_key && item.size === file.size_bytes,
      );
      if (
        !entry ||
        (await sha256(regularPrivateFile(storage, file.storage_key, file.size_bytes))) !==
          entry.sha256
      )
        throw new Error('Un adjunto restaurado no coincide con su registro.');
    }
    return { engine: 'postgres', files: files.length, restored: true };
  } finally {
    await db.close();
  }
}
