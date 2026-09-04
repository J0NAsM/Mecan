# Operación y despliegue

## Entornos

La versión incluida usa SQLite nativo para que pueda ejecutarse sin infraestructura adicional. Es apropiada para evaluación, pilotos y una primera operación controlada en un único proceso. Para disponibilidad alta o múltiples instancias, migre el adaptador de persistencia a PostgreSQL.

Variables obligatorias en producción:

- `NODE_ENV=production` para cookies `Secure`.
- `APP_URL` con HTTPS y dominio público.
- `DATABASE_PATH` en un volumen persistente cifrado.
- `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` no predecibles antes del primer arranque.
- `SEED_DEMO=false`.
- `NOTIFICATION_WEBHOOK_URL` y `NOTIFICATION_WEBHOOK_SECRET` para recuperación de acceso y canales externos.
- `TRUST_PROXY=true` únicamente cuando todas las solicitudes llegan desde un proxy controlado.

Ubique el servidor detrás de Caddy, nginx o un balanceador con TLS, rate limiting y logs de acceso. Restrinja el acceso al volumen `data/` y a `storage/`; los documentos deben descargarse exclusivamente por la ruta autenticada.

El contenedor puede construirse con `docker build -t mecan-cloud .`. Monte `/app/data` y `/app/storage` como volúmenes persistentes; el proceso corre como usuario sin privilegios y `/health` comprueba aplicación, base y migraciones.

## Backup y restauración

Crear una instantánea consistente mientras el sistema está activo:

```powershell
npm run backup -- D:\Backups\Mecan
```

Comprobar periódicamente restauraciones en un entorno separado. Para restaurar, primero detenga el servidor:

```powershell
npm run restore -- D:\Backups\Mecan\mecan-fecha.db --confirm
```

El comando valida la integridad y conserva una copia de la base activa antes de reemplazarla. `storage/` debe respaldarse junto con la base de datos para mantener documentos coherentes.

Exportación portable de un taller:

```powershell
npm run export-tenant -- <tenant-id> export.json
```

## Retención

Suspensión y vencimiento solo cambian permisos operativos: nunca eliminan filas. La cancelación registra `canceled_at` y `deletion_eligible_at` según `retention_days`. La eliminación definitiva no está automatizada deliberadamente; exige revisión, exportación y aprobación administrativa.

## Escalado a PostgreSQL

1. Reproducir el esquema con UUID, índices compuestos por `tenant_id` y migraciones versionadas.
2. Activar Row Level Security en todas las tablas operativas y establecer el tenant de sesión por transacción.
3. Mantener las comprobaciones de aplicación actuales como segunda barrera.
4. Mover archivos a almacenamiento privado S3 compatible, prefijados por tenant y entregados con URLs firmadas breves.
5. Ejecutar ciclo de suscripciones, notificaciones y webhooks en una cola idempotente.
6. Separar réplicas de lectura para reportes y métricas cuando el volumen lo requiera.

## Seguridad

- Rotar credenciales demo y secretos.
- Añadir rate limiting distribuido al login en el proxy.
- Conectar correo transaccional para invitaciones y recuperación de contraseña.
- Centralizar logs y alertar sobre `IMPERSONATION_STARTED`, `TENANT_BLOCKED` y fallos repetidos de autenticación.
- Ejecutar `npm test` antes de cada despliegue.
- Revisar permisos y restauraciones al menos trimestralmente.

## Health check

`GET /health` responde JSON y puede utilizarse desde el orquestador. Un `200` confirma que el proceso HTTP puede consultar la base y expone el número de migraciones aplicadas.
