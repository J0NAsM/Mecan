# Seguridad y variables

No introducir React ni fallback SQLite: los .db antiguos son material legado. Mantener datos, firmas y releases existentes.

Los archivos .env reales se conservan fuera del contexto y deben estar ignorados por Git. Los ejemplos no prueban que una variable sea obligatoria; se mantiene NO DETERMINADO hasta revisar su validación en código.

| NOMBRE_VARIABLE | PROPÓSITO | EJEMPLO_SEGURO | REQUERIDA | FUENTES |
|---|---|---|---|---|
| APP_NAME | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| APP_URL | Origen público de la aplicación | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| BACKUP_INTERVAL_HOURS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| BACKUP_PATH | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| COMMERCIAL_CONFIG_APPROVED | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| COMPANY_ADDRESS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| COMPANY_LEGAL_NAME | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| COMPANY_PHONE | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| COMPANY_TAX_ID | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_CONNECT_TIMEOUT_MS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_IDLE_TIMEOUT_MS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_PATH | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_POOL_MAX | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_SCHEMA | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_SSL_CA_FILE | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_SSL_MODE | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_STATEMENT_TIMEOUT_MS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_TRANSACTION_IDLE_TIMEOUT_MS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_TRUSTED_NETWORK | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| DATABASE_URL | Conexión de base de datos | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| EMAIL_FROM | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| EMAIL_REPLY_TO | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| EMAIL_TRANSPORT | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| HOST | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| LOG_LEVEL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| MOBILE_RELEASES_PATH | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| NODE_ENV | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| NOTIFICATION_WEBHOOK_SECRET | Configuración específica; consultar el consumidor y las fuentes indicadas | REEMPLAZAR_LOCALMENTE | NO DETERMINADO; verificar modo de ejecución | .env.example |
| NOTIFICATION_WEBHOOK_URL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| PORT | Puerto de escucha | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| POSTGRES_BIN_PATH | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| PRIVACY_FILE | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| PUBLIC_HOST | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| RESTORE_DATABASE_URL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| RESTORE_STORAGE_PATH | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SAAS_PAYMENT_INSTRUCTIONS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SEED_DEMO | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| SESSION_DAYS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |
| SMOKE_ADMIN_EMAIL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMOKE_ADMIN_PASSWORD | Configuración específica; consultar el consumidor y las fuentes indicadas | REEMPLAZAR_LOCALMENTE | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMOKE_BASE_URL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMOKE_WORKSHOP_EMAIL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMOKE_WORKSHOP_PASSWORD | Configuración específica; consultar el consumidor y las fuentes indicadas | REEMPLAZAR_LOCALMENTE | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMTP_HOST | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMTP_PASSWORD | Configuración específica; consultar el consumidor y las fuentes indicadas | REEMPLAZAR_LOCALMENTE | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMTP_PORT | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMTP_REQUIRE_TLS | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMTP_SECURE | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SMTP_USER | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| STORAGE_PATH | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SUPERADMIN_EMAIL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SUPERADMIN_PASSWORD | Configuración específica; consultar el consumidor y las fuentes indicadas | REEMPLAZAR_LOCALMENTE | NO DETERMINADO; verificar modo de ejecución | .env.example |
| SUPPORT_EMAIL | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| TERMS_FILE | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env.example |
| TRUST_PROXY | Configuración específica; consultar el consumidor y las fuentes indicadas | NO DETERMINADO | NO DETERMINADO; verificar modo de ejecución | .env, .env.example |

No ejecutar proveedores, pagos, mensajería ni migraciones reales durante una validación documental.
