// Isolated local PostgreSQL runner. No system service, public listener or production secrets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';

if (process.env.NODE_ENV === 'production')
  throw new Error('Este comando es exclusivamente de desarrollo.');
const root = path.resolve(fileURLToPath(new URL('../.runtime/postgresql/', import.meta.url)));
const executable = (name) =>
  path.join(root, '18.6', 'pgsql', 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const data = path.join(root, 'dev-data');
const settingsFile = path.join(root, 'dev-connection.json');
const action = process.argv[2];
const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('El proceso local terminó con código ' + code)),
    );
  });
if (!['start', 'stop', 'exec'].includes(action))
  throw new Error('Uso: node scripts/dev-postgres.js start | stop | exec comando argumentos');
if (action === 'stop') {
  await run(executable('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
} else {
  if (!fs.existsSync(settingsFile)) {
    if (action !== 'start') throw new Error('Inicia primero el servidor PostgreSQL local.');
    if (fs.existsSync(data))
      throw new Error('Ya existe un directorio de datos sin configuración. No se sobrescribirá.');
    fs.mkdirSync(root, { recursive: true });
    const password = crypto.randomBytes(36).toString('base64url');
    const url = new URL('postgresql://mecan_dev@127.0.0.1:55432/mecan_dev');
    url.password = password;
    fs.writeFileSync(settingsFile, JSON.stringify({ databaseUrl: url.href }), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const env = {
    ...process.env,
    DATABASE_URL: settings.databaseUrl,
    DATABASE_SSL_MODE: 'disable',
    DATABASE_SCHEMA: 'mecan',
    POSTGRES_BIN_PATH: path.dirname(executable('pg_dump')),
  };
  if (action === 'start') {
    if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
      const passwordFile = path.join(root, 'init-password-' + crypto.randomUUID());
      fs.writeFileSync(
        passwordFile,
        decodeURIComponent(new URL(settings.databaseUrl).password) + '\n',
        { flag: 'wx', mode: 0o600 },
      );
      try {
        await run(executable('initdb'), [
          '-D',
          data,
          '--username=mecan_dev',
          '--auth=scram-sha-256',
          '--encoding=UTF8',
          '--locale=C',
          '--pwfile=' + passwordFile,
        ]);
      } finally {
        fs.unlinkSync(passwordFile);
      }
    }
    // A crash can leave postmaster.pid behind. Ask PostgreSQL whether its server is alive.
    const serverStatus = await new Promise((resolve, reject) => {
      const child = spawn(executable('pg_ctl'), ['-D', data, 'status'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    if (![0, 3].includes(serverStatus))
      throw new Error('No se pudo verificar el estado del servidor PostgreSQL local.');
    if (serverStatus === 3)
      await run(executable('pg_ctl'), [
        '-D',
        data,
        '-l',
        path.join(root, 'server.log'),
        '-o',
        '-h 127.0.0.1 -p 55432',
        '-w',
        'start',
      ]);
    const url = new URL(settings.databaseUrl);
    url.pathname = '/postgres';
    const client = new pg.Client({ connectionString: url.href });
    await client.connect();
    try {
      if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='mecan_dev'")).rowCount)
        await client.query('CREATE DATABASE mecan_dev');
    } finally {
      await client.end();
    }
    console.log(
      'PostgreSQL local preparado en 127.0.0.1:55432; credencial de desarrollo privada en .runtime (fuera de Git).',
    );
  } else {
    const [command, ...args] = process.argv.slice(3);
    if (!command) throw new Error('Indica el comando de desarrollo que se ejecutará.');
    await run(command, args, env);
  }
}
