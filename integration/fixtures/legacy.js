import fs from 'node:fs';
import { openDatabase } from '../../scripts/legacy/sqlite-db.js';
const data = JSON.parse(
  fs.readFileSync(new URL('./legacy-workflow.json', import.meta.url), 'utf8'),
);

// Synthetic historical state captured from the previously verified application workflow.
// Loading a snapshot is not re-executing purchases/payments against the new backend.
export function legacyFixture(filename) {
  const db = openDatabase(filename);
  try {
    const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    for (const trigger of triggers) db.exec('DROP TRIGGER "' + trigger.name + '"');
    db.exec('DELETE FROM schema_migrations');
    for (const [table, rows] of Object.entries(data.tables)) {
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const insert = db.prepare(
        'INSERT INTO "' +
          table +
          '"(' +
          columns.map((c) => '"' + c + '"').join(',') +
          ') VALUES(' +
          columns.map(() => '?').join(',') +
          ')',
      );
      for (const row of rows) insert.run(...columns.map((c) => row[c]));
    }
    for (const trigger of triggers) db.exec(trigger.sql);
    db.exec('COMMIT; PRAGMA foreign_keys=ON;');
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Fixture histórico inválido.');
    return {
      tenantA: data.tenantA,
      tenantB: data.tenantB,
      receipt: data.receipt,
      originalPassword: db
        .prepare('SELECT password_hash FROM users WHERE id=?')
        .get(data.tenantA.userId).password_hash,
    };
  } finally {
    db.close();
  }
}
