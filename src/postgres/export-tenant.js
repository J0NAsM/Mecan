import fs from 'node:fs/promises';
import path from 'node:path';
import { quoteIdentifier } from './database.js';

// Operator CLI export, not a public API. Bounded memory, one consistent snapshot,
// exact tenant predicates and no credentials/session or password-reset material.
export async function exportPostgresTenant(db, tenantId, destination) {
  let file, target;
  try {
    return await db.transaction(
      async () => {
        const tenant = await db.get('SELECT * FROM tenants WHERE id=$1', [tenantId]);
        if (!tenant) throw new Error('Taller no encontrado.');
        target = path.resolve(destination || `export-${tenant.slug}-${Date.now()}.json`);
        file = await fs.open(target, 'wx', 0o600);
        const header = {
          version: 3,
          engine: 'postgres',
          exportedAt: new Date().toISOString(),
          tenant,
        };
        await file.writeFile(JSON.stringify(header).slice(0, -1));
        async function writeRows(name, sql, values) {
          await file.writeFile(',' + JSON.stringify(name) + ':[');
          let separator = '';
          for await (const row of db.iterate(sql, values)) {
            await file.writeFile(separator + JSON.stringify(row));
            separator = ',';
          }
          await file.writeFile(']');
        }
        const tables = await db.all(
          `SELECT c.table_name name FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
        WHERE c.table_schema=$1 AND c.column_name='tenant_id' AND t.table_type='BASE TABLE' ORDER BY c.table_name`,
          [db.schema],
        );
        for (const { name } of tables) {
          const sql =
            name === 'notifications'
              ? "SELECT id,tenant_id,user_id,channel,event_type,title,message,status,created_at,sent_at,read_at FROM notifications WHERE tenant_id=$1 AND event_type<>'PASSWORD_RESET'"
              : `SELECT * FROM ${quoteIdentifier(name)} WHERE tenant_id=$1`;
          await writeRows(name, sql, [tenantId]);
        }
        await writeRows(
          'users',
          `SELECT u.id,u.name,u.email,u.kind,u.active,u.created_at,u.last_activity_at
        FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1`,
          [tenantId],
        );
        await file.writeFile('}\n');
        await file.sync();
        return target;
      },
      { isolation: 'REPEATABLE READ', readOnly: true },
    );
  } catch (error) {
    if (file) {
      await file.close();
      file = null;
      await fs.unlink(target); // Only the exclusive file created by this failed invocation.
    }
    throw error;
  } finally {
    await file?.close();
  }
}
