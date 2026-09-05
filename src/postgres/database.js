import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { logger } from '../logger.js';
import { bindParameters } from './parameters.js';
import crypto from 'node:crypto';

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
export function quoteIdentifier(value) {
  if (!identifier.test(value)) throw new Error('Identificador de base de datos no válido.');
  return '"' + value + '"';
}

export function postgresOptions(env = process.env) {
  const connectionString = env.DATABASE_URL || '';
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL: se requiere una conexión PostgreSQL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new Error('DATABASE_URL: formato PostgreSQL no válido.');
  // Driver URL SSL parameters can override the verified TLS object. Keep one source of truth.
  for (const key of [
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'ssl',
    'options',
    'application_name',
  ])
    if (url.searchParams.has(key))
      throw new Error(
        `DATABASE_URL: configura ${key} mediante las variables DATABASE_* documentadas.`,
      );
  if ([...url.searchParams].length)
    throw new Error('DATABASE_URL: no se admiten parámetros adicionales.');
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const mode =
    env.DATABASE_SSL_MODE || (local && env.NODE_ENV !== 'production' ? 'disable' : 'verify-full');
  if (!['disable', 'verify-full'].includes(mode))
    throw new Error('DATABASE_SSL_MODE: disable o verify-full.');
  if (mode === 'disable' && !local && env.DATABASE_TRUSTED_NETWORK !== 'true')
    throw new Error(
      'PostgreSQL remoto requiere TLS verificado o DATABASE_TRUSTED_NETWORK=true dentro de una red privada controlada.',
    );
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key}: valor fuera del rango permitido.`);
    return value;
  };
  const schema = env.DATABASE_SCHEMA || 'mecan';
  quoteIdentifier(schema);
  if (schema === 'public' || schema === 'information_schema' || schema.startsWith('pg_'))
    throw new Error('DATABASE_SCHEMA: utiliza un esquema exclusivo de Mecan.');
  return {
    connectionString,
    schema,
    max: integer('DATABASE_POOL_MAX', 10, 1, 100),
    connectionTimeoutMillis: integer('DATABASE_CONNECT_TIMEOUT_MS', 10000, 100, 120000),
    idleTimeoutMillis: integer('DATABASE_IDLE_TIMEOUT_MS', 30000, 1000, 300000),
    statement_timeout: integer('DATABASE_STATEMENT_TIMEOUT_MS', 30000, 100, 300000),
    idle_in_transaction_session_timeout: integer(
      'DATABASE_TRANSACTION_IDLE_TIMEOUT_MS',
      30000,
      100,
      300000,
    ),
    ssl:
      mode === 'verify-full'
        ? {
            rejectUnauthorized: true,
            ...(env.DATABASE_SSL_CA_FILE
              ? { ca: fs.readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8') }
              : {}),
          }
        : false,
    application_name: 'mecan',
  };
}

// Native asynchronous pool. A transaction always owns ONE connection, including nested service calls.
// No blocking workers, SQLite emulation, global connection state or automatic replay of side effects.
export function createPostgresDatabase(
  options,
  { onPoolError = ({ code }) => logger.error('database_pool_connection_failed', { code }) } = {},
) {
  const { schema, ...poolOptions } = options;
  quoteIdentifier(schema);
  const safeInteger = (value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      throw new Error('Un contador excede el rango seguro de la aplicación.');
    return number;
  };
  // Money/quantity calculations currently use the centrally rounded Number domain API.
  // PostgreSQL stores NUMERIC exactly; reject non-finite/unsafe values instead of silently overflowing.
  const safeNumeric = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER)
      throw new Error('Un importe excede el rango seguro de la aplicación.');
    return number;
  };
  const typeOverrides = {
    getTypeParser(oid, format) {
      if (!format || format === 'text') {
        if (oid === 20) return safeInteger;
        if (oid === 1700) return safeNumeric;
      }
      return pg.types.getTypeParser(oid, format);
    },
  };
  const pool = new pg.Pool({
    ...poolOptions,
    types: typeOverrides,
    options: `-c search_path=${schema},pg_catalog -c timezone=UTC`,
  });
  pool.on('error', (error) => onPoolError({ code: error.code || 'DATABASE_CONNECTION_ERROR' }));
  const transactions = new AsyncLocalStorage();
  let closed = false;
  const active = () => {
    if (closed) throw new Error('La conexión de base de datos está cerrada.');
    const state = transactions.getStore();
    if (state?.finished) throw new Error('No se puede usar una transacción finalizada.');
    return state;
  };
  const db = {
    dialect: 'postgres',
    schema,
    prepare(sql) {
      const statement = bindParameters(sql);
      const parameters = (values) => {
        if (values.length !== statement.count)
          throw new Error('Cantidad de parámetros SQL incompatible.');
        return values;
      };
      return {
        get: (...values) => db.get(statement.sql, parameters(values)),
        all: (...values) => db.all(statement.sql, parameters(values)),
        run: (...values) => db.run(statement.sql, parameters(values)),
        iterate: (...values) => db.iterate(statement.sql, parameters(values)),
      };
    },
    async exec(sql) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i.test(sql))
        throw new Error('Usa db.transaction para conservar la conexión y la atomicidad.');
      return db.query(sql);
    },
    async *iterate(sql, values = [], { batchSize = 200 } = {}) {
      const state = active(),
        client = state?.client || (await pool.connect());
      const name = 'cursor_' + crypto.randomBytes(12).toString('hex');
      if (state) state.pending = (state.pending || 0) + 1;
      let began = false,
        cursor = false,
        failed;
      try {
        if (!state) {
          await client.query('BEGIN READ ONLY');
          began = true;
        }
        await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${sql}`, values);
        cursor = true;
        while (true) {
          if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000)
            throw new Error('Tamaño de lote no válido.');
          const batch = await client.query(`FETCH FORWARD ${batchSize} FROM ${name}`);
          if (!batch.rows.length) break;
          for (const row of batch.rows) yield row;
        }
      } catch (error) {
        failed = error;
        if (state) state.failure = error;
        throw error;
      } finally {
        try {
          if (failed && began) await client.query('ROLLBACK');
          else if (!failed) {
            if (cursor) await client.query(`CLOSE ${name}`);
            if (began) await client.query('COMMIT');
          }
        } catch (error) {
          failed = error;
          if (state) state.failure = error;
          throw error;
        } finally {
          if (state) state.pending--;
          else client.release(failed);
        }
      }
    },
    async query(sql, parameters = []) {
      const state = active();
      if (state) state.pending = (state.pending || 0) + 1;
      try {
        return await (state?.client || pool).query(sql, parameters);
      } catch (error) {
        if (state) state.failure = error;
        throw error;
      } finally {
        if (state) state.pending--;
      }
    },
    async all(sql, parameters = []) {
      return (await db.query(sql, parameters)).rows;
    },
    async get(sql, parameters = []) {
      return (await db.query(sql, parameters)).rows[0];
    },
    async run(sql, parameters = []) {
      const result = await db.query(sql, parameters);
      return { changes: result.rowCount, rows: result.rows };
    },
    async transaction(callback, { isolation = 'READ COMMITTED', readOnly = false, lockKey } = {}) {
      const parent = active();
      if (!['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'].includes(isolation))
        throw new Error('Nivel de aislamiento no válido.');
      if (parent) {
        // Nested service operations share the outer atomic boundary. Do not conceal failed SQL in a savepoint.
        if (parent.readOnly && !readOnly) throw new Error('La transacción es de solo lectura.');
        if (lockKey && parent.lockKey !== lockKey)
          throw new Error('La transacción ya pertenece a otro ámbito de escritura.');
        try {
          return await callback(db);
        } catch (error) {
          parent.failure ||= error;
          throw error;
        }
      }
      const client = await pool.connect();
      const state = { client, finished: false, readOnly, lockKey };
      let began = false;
      let releaseError;
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}${readOnly ? ' READ ONLY' : ''}`);
        began = true;
        // Explicit tenant/resource lock coordinates writers across processes without blocking other tenants.
        if (lockKey)
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lockKey]);
        const result = await transactions.run(state, () => callback(db));
        if (state.failure) throw state.failure;
        if (state.pending)
          throw new Error(
            'La transacción contiene consultas sin esperar. No se confirmarán cambios parciales.',
          );
        // Reject detached work before COMMIT, not only after releasing the connection.
        state.finished = true;
        await client.query('COMMIT');
        return result;
      } catch (error) {
        if (began) {
          try {
            await client.query('ROLLBACK');
          } catch (rollbackError) {
            releaseError = rollbackError;
          }
        } else releaseError = error;
        throw error;
      } finally {
        state.finished = true;
        client.release(releaseError);
      }
    },
    async close() {
      if (transactions.getStore())
        throw new Error('No se puede cerrar la base dentro de una transacción.');
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
  return db;
}
