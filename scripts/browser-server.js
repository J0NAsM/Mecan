import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mecan-browser-'));
const schema = 'test_browser_' + crypto.randomBytes(12).toString('hex');
Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: '3107',
  APP_URL: 'http://127.0.0.1:3107',
  DATABASE_SCHEMA: schema,
  STORAGE_PATH: path.join(directory, 'storage'),
  BACKUP_PATH: path.join(directory, 'backups'),
  SEED_DEMO: 'true',
  EMAIL_TRANSPORT: 'disabled',
});
const state = path.resolve('.runtime/playwright-postgres.json');
fs.mkdirSync(path.dirname(state), { recursive: true });
fs.writeFileSync(state, JSON.stringify({ schema, directory, pid: process.pid }), {
  flag: 'wx',
  mode: 0o600,
});
process.once('exit', () =>
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
);
await import('../src/server.js');
