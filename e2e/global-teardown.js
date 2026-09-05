import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createPostgresDatabase,
  postgresOptions,
  quoteIdentifier,
} from '../src/postgres/database.js';

export default async function teardown() {
  const stateFile = path.resolve('.runtime/playwright-postgres.json');
  if (!fs.existsSync(stateFile)) return;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (
    !/^test_browser_[a-f0-9]{24}$/.test(state.schema) ||
    !Number.isSafeInteger(state.pid) ||
    state.pid === process.pid
  )
    throw new Error('No se reconoce el servidor temporal de navegador.');
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(state.pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') break;
      throw error;
    }
    if (i === 49) throw new Error('El servidor temporal sigue activo; no se eliminará su esquema.');
    await delay(100);
  }
  const db = createPostgresDatabase(postgresOptions());
  try {
    await db.query('DROP SCHEMA IF EXISTS ' + quoteIdentifier(state.schema) + ' CASCADE');
  } finally {
    await db.close();
  }
  const directory = path.resolve(state.directory);
  if (
    path.dirname(directory) !== path.resolve(os.tmpdir()) ||
    !path.basename(directory).startsWith('mecan-browser-')
  )
    throw new Error('Ruta temporal no válida.');
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.unlinkSync(stateFile);
}
