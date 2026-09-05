import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync(path.resolve('.env'))) process.loadEnvFile(path.resolve('.env'));
const production = process.env.NODE_ENV === 'production';
const env = (key, fallback = '') => process.env[key] ?? fallback;
const bool = (key, fallback = false) => env(key, String(fallback)).toLowerCase() === 'true';
const appUrl = env('APP_URL', 'http://localhost:' + env('PORT', '3000'));
// `Secure` en las cookies y HSTS protegen el transporte, no la política comercial: dependen de si
// el tráfico llega por HTTPS y no de NODE_ENV. Detrás de un túnel HTTPS la app corre sin
// NODE_ENV=production —que exige datos comerciales completos— y aun así la sesión debe viajar
// marcada como Secure, o el navegador la mandaría también por una petición en claro.
const secureTransport = production || appUrl.startsWith('https://');
export const config = Object.freeze({
  production,
  secureTransport,
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'),
  appName: env('APP_NAME', 'Mecan Cloud'),
  appUrl,
  databasePath: env('DATABASE_PATH', './data/mecan.db'),
  storagePath: env('STORAGE_PATH', './storage'),
  backupPath: env('BACKUP_PATH', './backups'),
  mobileReleasesPath: env('MOBILE_RELEASES_PATH', './movile/releases'),
  sessionDays: Number(env('SESSION_DAYS', '14')),
  seedDemo: bool('SEED_DEMO', !production),
  superadminEmail: env('SUPERADMIN_EMAIL', production ? '' : 'admin@mecan.local').toLowerCase(),
  superadminPassword: env('SUPERADMIN_PASSWORD', production ? '' : 'Admin123!'),
  trustProxy: bool('TRUST_PROXY'),
  logLevel: env('LOG_LEVEL', 'info'),
  notificationWebhookUrl: env('NOTIFICATION_WEBHOOK_URL'),
  notificationWebhookSecret: env('NOTIFICATION_WEBHOOK_SECRET'),
  emailTransport: env('EMAIL_TRANSPORT', production ? 'smtp' : 'disabled'),
  smtpHost: env('SMTP_HOST'),
  smtpPort: Number(env('SMTP_PORT', '587')),
  smtpUser: env('SMTP_USER'),
  smtpPassword: env('SMTP_PASSWORD'),
  smtpSecure: bool('SMTP_SECURE'),
  smtpRequireTls: bool('SMTP_REQUIRE_TLS', true),
  emailFrom: env('EMAIL_FROM'),
  emailReplyTo: env('EMAIL_REPLY_TO'),
  companyName: env('COMPANY_LEGAL_NAME'),
  companyTaxId: env('COMPANY_TAX_ID'),
  companyAddress: env('COMPANY_ADDRESS'),
  companyPhone: env('COMPANY_PHONE'),
  supportEmail: env('SUPPORT_EMAIL'),
  termsPath: env('TERMS_FILE'),
  privacyPath: env('PRIVACY_FILE'),
  commercialConfigApproved: bool('COMMERCIAL_CONFIG_APPROVED'),
  paymentInstructions: env('SAAS_PAYMENT_INSTRUCTIONS'),
  backupIntervalHours: Number(env('BACKUP_INTERVAL_HOURS', '24')),
});

export function productionIssues(settings = config) {
  const issues = [];
  const urlValid = (value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !['localhost', '127.0.0.1', 'example.com', 'example.org', 'example.net'].includes(
          url.hostname,
        ) &&
        !/(\.local|\.test|\.invalid|\.example)$/.test(url.hostname)
      );
    } catch {
      return false;
    }
  };
  if (!urlValid(settings.appUrl)) issues.push('APP_URL: dominio público con HTTPS');
  if (settings.seedDemo) issues.push('SEED_DEMO: debe ser false');
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.superadminEmail) ||
    settings.superadminEmail.endsWith('.local')
  )
    issues.push('SUPERADMIN_EMAIL: correo real del administrador');
  if (
    settings.superadminPassword.length < 14 ||
    ['Admin123!', 'Demo123!'].includes(settings.superadminPassword)
  )
    issues.push('SUPERADMIN_PASSWORD: clave inicial de al menos 14 caracteres');
  if (settings.emailTransport === 'smtp') {
    for (const [key, value] of [
      ['SMTP_HOST', settings.smtpHost],
      ['SMTP_USER', settings.smtpUser],
      ['SMTP_PASSWORD', settings.smtpPassword],
      ['EMAIL_FROM', settings.emailFrom],
    ])
      if (!value) issues.push(key + ': requerido para correo');
    if (!settings.smtpSecure && !settings.smtpRequireTls)
      issues.push('SMTP_REQUIRE_TLS: debe ser true para STARTTLS');
    if (![465, 587, 2525, 25].includes(settings.smtpPort))
      issues.push('SMTP_PORT: puerto SMTP válido');
  } else if (settings.emailTransport === 'webhook') {
    if (!urlValid(settings.notificationWebhookUrl))
      issues.push('NOTIFICATION_WEBHOOK_URL: endpoint HTTPS');
    if (settings.notificationWebhookSecret.length < 32)
      issues.push('NOTIFICATION_WEBHOOK_SECRET: secreto de al menos 32 caracteres');
  } else issues.push('EMAIL_TRANSPORT: smtp o webhook en producción');
  for (const [key, value] of [
    ['COMPANY_LEGAL_NAME', settings.companyName],
    ['COMPANY_TAX_ID', settings.companyTaxId],
    ['COMPANY_ADDRESS', settings.companyAddress],
    ['SUPPORT_EMAIL', settings.supportEmail],
    ['SAAS_PAYMENT_INSTRUCTIONS', settings.paymentInstructions],
  ])
    if (!value) issues.push(key + ': información comercial requerida');
  for (const [key, file] of [
    ['TERMS_FILE', settings.termsPath],
    ['PRIVACY_FILE', settings.privacyPath],
  ])
    if (!file || !fs.existsSync(file) || fs.statSync(file).size < 100)
      issues.push(key + ': archivo de texto legal aprobado');
  if (!settings.commercialConfigApproved)
    issues.push('COMMERCIAL_CONFIG_APPROVED: confirmar planes, precios, trial y gracia');
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535)
    issues.push('PORT: entre 1 y 65535');
  if (
    !Number.isInteger(settings.sessionDays) ||
    settings.sessionDays < 1 ||
    settings.sessionDays > 90
  )
    issues.push('SESSION_DAYS: entre 1 y 90');
  if (
    !Number.isFinite(settings.backupIntervalHours) ||
    settings.backupIntervalHours < 1 ||
    settings.backupIntervalHours > 168
  )
    issues.push('BACKUP_INTERVAL_HOURS: entre 1 y 168 horas');
  if (!['info', 'warn', 'error'].includes(settings.logLevel))
    issues.push('LOG_LEVEL: info, warn o error');
  if (settings.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.supportEmail))
    issues.push('SUPPORT_EMAIL: dirección válida');
  return issues;
}
export function validateProductionConfig() {
  if (!config.production) return;
  const issues = productionIssues();
  if (issues.length)
    throw new Error('Configuración de producción incompleta: ' + issues.join('; '));
}
