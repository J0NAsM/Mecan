import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';

const tenantId=process.argv[2];
if(!tenantId)throw new Error('Uso: npm run export-tenant -- <tenant-id> [destino.json]');
const db=openDatabase(config.databasePath);
const tenant=db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
if(!tenant)throw new Error('Tenant no encontrado.');
const tables=['branches','roles','memberships','customers','vehicles','services','work_orders','work_order_items','inventory_items','suppliers','purchases','bays','appointments','workshop_invoices','cash_movements','subscriptions','subscription_history','trials','tenant_features','tenant_settings','support_tickets','files','audit_logs'];
const output={version:1,exportedAt:new Date().toISOString(),tenant};
for(const table of tables)output[table]=db.prepare(`SELECT * FROM ${table} WHERE tenant_id=?`).all(tenantId);
db.close();
const target=path.resolve(process.argv[3]||`export-${tenant.slug}-${Date.now()}.json`);
fs.writeFileSync(target,JSON.stringify(output,null,2),{flag:'wx'});
console.log(`Exportación creada: ${target}`);
