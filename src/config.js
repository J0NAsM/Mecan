import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile() {
  const file = path.resolve('.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

export const config = Object.freeze({
  port: Number(process.env.PORT || 3000),
  appName: process.env.APP_NAME || 'Mecan Cloud',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  databasePath: process.env.DATABASE_PATH || './data/mecan.db',
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  seedDemo: (process.env.SEED_DEMO || 'true').toLowerCase() === 'true',
  superadminEmail: (process.env.SUPERADMIN_EMAIL || 'admin@mecan.local').toLowerCase(),
  superadminPassword: process.env.SUPERADMIN_PASSWORD || 'Admin123!',
  trustProxy: (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  notificationWebhookUrl: process.env.NOTIFICATION_WEBHOOK_URL || '',
  notificationWebhookSecret: process.env.NOTIFICATION_WEBHOOK_SECRET || '',
  production: process.env.NODE_ENV === 'production'
});

export function validateProductionConfig(){
  if(!config.production)return;
  const problems=[];
  if(!config.appUrl.startsWith('https://'))problems.push('APP_URL debe usar HTTPS');
  if(config.seedDemo)problems.push('SEED_DEMO debe ser false');
  if(config.superadminPassword==='Admin123!'||config.superadminPassword.length<14)problems.push('SUPERADMIN_PASSWORD debe ser robusta y no usar el valor demo');
  if(!config.notificationWebhookUrl||!config.notificationWebhookSecret)problems.push('configure NOTIFICATION_WEBHOOK_URL y NOTIFICATION_WEBHOOK_SECRET para recuperación de cuentas y avisos');
  if(problems.length)throw new Error(`Configuración de producción insegura: ${problems.join('; ')}`);
}
