# Operación y despliegue

## Configuración

Copiar `.env.example` a `.env` para desarrollo. Para Compose, copiarla a `.env.production`; ambos archivos están ignorados por Git. Las variables reales están agrupadas y comentadas en el ejemplo. No escribir secretos en esta documentación.

En producción: `NODE_ENV=production`, `SEED_DEMO=false`, dominio HTTPS en `APP_URL`, correo real y datos aprobados. `SUPERADMIN_EMAIL/PASSWORD` solo crean el primer administrador: no rotan automáticamente una cuenta existente. Usar cambio de contraseña desde la cuenta. No reutilizar la base demo como base comercial sin revisar sus accesos y datos.

## Despliegue con Compose

1. Configurar DNS del dominio; `PUBLIC_HOST` lleva solamente el host, y `APP_URL` la URL HTTPS del mismo host.
2. Aprovisionar PostgreSQL 18 externo y completar `DATABASE_URL`/TLS en `.env.production`; la cuenta de aplicación no debe ser superusuario ni crear roles/bases. Colocar la CA privada, si corresponde, en `certificates/` y usar `/app/certificates/nombre.pem`. Colocar términos y privacidad aprobados en `legal/`; sus rutas son `/app/legal/terminos.txt` y `/app/legal/privacidad.txt`.
3. Ejecutar `npm ci`, `npm run check`, `npm run test:postgres` y `npm run test:e2e` contra una base de pruebas separada, nunca producción.
4. Construir con `docker compose --env-file .env.production build`. Para actualizar una instalación, crear y verificar un backup, detener `app` y ejecutar `docker compose --env-file .env.production run --rm --no-deps app node scripts/migrate.js`.
5. Levantar con `docker compose --env-file .env.production up -d`. Verificar `docker compose --env-file .env.production exec app node scripts/production-check.js` y `https://DOMINIO/health`.
6. Verificar login, correo de recuperación, alta, documentos privados, registro de un pago real autorizado y una restauración en un entorno separado.

Compose no expone el puerto de la aplicación al host; solo Caddy publica 80/443. El proxy recibe únicamente `PUBLIC_HOST`, no las credenciales del correo o del administrador. Sobrescribe la IP reenviada. No habilitar `TRUST_PROXY=true` si también se puede acceder directamente al servidor de aplicación.

El contenedor usa raíz de solo lectura, usuario no privilegiado, capacidades retiradas, logs limitados y volúmenes para adjuntos y respaldos. La base PostgreSQL se conecta por `DATABASE_URL` y se administra en su infraestructura; no se incluye una base con contraseña predeterminada. Antes de agregar réplicas, resolver almacenamiento compartido, programación de respaldos y capacidad total de conexiones.

El entorno de desarrollo usado para esta revisión no tiene Docker: la configuración está preparada, pero el build de imagen y la puesta pública deben verificarse en el host de despliegue. CI incluye construcción Docker.

## Migraciones

`npm run migrate` aplica las migraciones PostgreSQL nativas dentro de una transacción y un bloqueo exclusivo de migración. Comprueba checksums y rechaza versiones desconocidas. No modifica migraciones ya aplicadas. El backup es un paso explícito anterior, no se omite ni se sustituye por el hecho de que el DDL sea transaccional.

El servidor también verifica/aplica migraciones al iniciar. Para una actualización incompatible: respaldar, detener las instancias anteriores, migrar y luego iniciar; conservar el respaldo hasta terminar la aceptación. El baseline incluye el esquema de taller/SaaS y la segunda migración registra importaciones históricas.

Instalaciones SQLite anteriores: usar `npm run postgres:import -- <origen.db>` hacia PostgreSQL vacío; conserva el origen y aplica las migraciones legacy a una copia privada antes de validar/importar. La recuperación de un backup SQLite antiguo sigue disponible como `node scripts/legacy/restore-sqlite.js <directorio> --confirm`, usando `DATABASE_PATH`; no es el comando de restauración de PostgreSQL.

## Respaldo y restauración

`npm run backup -- D:\\Backups\\Mecan` crea un directorio con `database.dump`, `storage/` y `manifest.json`. `pg_dump` usa una instantánea PostgreSQL consistente; se verifica tamaño y SHA-256 de adjuntos y dump. Si un archivo desaparece durante la copia, falla y no declara un respaldo válido. No existe borrado automático de respaldos.

En producción se ejecuta cada `BACKUP_INTERVAL_HOURS` (24 por defecto). Es una copia local: configurar además réplica cifrada fuera del host, retención y alerta de fallo mediante la infraestructura elegida. Un backup local no protege contra pérdida total del servidor.

Para restaurar, aprovisionar otra base y directorio vacíos, configurar privadamente `RESTORE_DATABASE_URL`/`RESTORE_STORAGE_PATH` y TLS del destino, y ejecutar:

```powershell
npm run restore -- <directorio-del-respaldo>
```

El comando comprueba el manifiesto, rechaza el origen y destinos ocupados, y restaura PostgreSQL en una sola transacción junto a una copia verificada de los adjuntos. La instalación anterior permanece intacta. Tras validar la recuperación, coordinar una ventana de corte y cambiar las conexiones/rutas; el comando no redirige usuarios automáticamente. No restaurar respaldos de procedencia desconocida. Los respaldos contienen datos privados y requieren permisos/cifrado apropiados.

## Correo

SMTP: `EMAIL_TRANSPORT=smtp`, host, puerto, usuario, contraseña, remitente y TLS. Puerto 587 con STARTTLS: `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`. Puerto 465: `SMTP_SECURE=true`. Obtener estos campos en el servicio contratado y verificar dominio/remitente allí.

Alternativa webhook: `EMAIL_TRANSPORT=webhook`, URL HTTPS y secreto compartido. El receptor recibe POST JSON con canal, evento, título, mensaje y payload; debe entregar el correo y deduplicar `idempotency-key`. Un 2xx significa aceptado por ese receptor, no prueba lectura del email.

La consola `/saas/readiness` muestra fallos y reintentos sin exponer el contenido de recuperación. Los tokens usados/expirados son de un solo uso; un correo vencido requiere solicitar recuperación nueva.

## Cobranza SaaS

Los precios se acuerdan por ciclo; un descuento se aplica al importe facturado. Trial predeterminado: 14 días. Desde el vencimiento: aviso durante 5 días, gracia hasta el día 10 y suspensión desde ese límite. Esos valores pertenecen a la configuración comercial y deben confirmarse.

El pago parcial no reactiva una cuenta suspendida. El saldo total debe quedar cancelado. Un bloqueo o cancelación administrativa no se levanta al registrar un pago. Si el período pagado ya terminó, el servicio reactivado empieza un período utilizable desde el pago; no se acumulan cargos automáticos mientras está suspendido. Confirmar esta política en los términos comerciales.

`SAAS_PAYMENT_INSTRUCTIONS` se muestra al titular del taller. Solo el administrador de plataforma registra la verificación del pago. No hay pasarela automática. La suspensión nunca elimina datos.

## Aplicación móvil y actualizaciones

```powershell
npm run mobile:publish -- --bump --version 1.1.0 --notes "Qué cambió"
```

Compila el APK firmado y deja el archivo y `manifest.json` en `MOBILE_RELEASES_PATH`
(`./movile/releases` por omisión). Desde ese momento `/movil` ofrece la descarga y las apps ya
instaladas detectan la versión al abrirse —como máximo una consulta cada 6 horas— o al pulsar
«Buscar actualizaciones».

- El servidor solo lee ese directorio. En Compose se monta de solo lectura en `/app/movile-releases`,
  así que publicar una versión **no requiere reconstruir la imagen**: basta dejar los archivos y que
  el contenedor los vea.
- `--mandatory` publica una versión que no se puede posponer desde la app. Usarlo solo cuando
  seguir con la versión anterior sea un problema real, porque interrumpe el trabajo hasta instalar.
- Se conservan los últimos 3 APK (`--keep`) para poder volver atrás publicando de nuevo un
  `versionCode` mayor con el contenido anterior. Android nunca instala un `versionCode` menor sobre
  uno mayor: retroceder exige publicar hacia adelante.
- La clave de firma (`movile/keystore/`) queda fuera de Git y de la imagen. **Respaldarla fuera de la
  máquina antes de repartir la primera versión**: sin ella ningún teléfono instalado puede volver a
  actualizarse.

Antes de anunciar una versión conviene comprobar que el servidor la ve:

```powershell
curl https://<dominio>/movil/actualizacion.json
```

Si responde 404 con `{"published": false}`, el manifiesto falta o no coincide con el APK en disco; el
servidor prefiere no anunciar nada antes que ofrecer una descarga inconsistente.

## Monitoreo

`npm run production:check` verifica migraciones PostgreSQL, guards activos, restricciones/índices, accesos demo y privilegios de conexión. Concilia comprobantes del taller, cuentas de proveedor y facturas SaaS con pagos vigentes, además de caja. Opera sobre una instantánea de solo lectura y no corrige datos automáticamente. Una diferencia exige investigar y conservar el respaldo; no borrar movimientos para que la comprobación pase. El arranque de producción exige la misma comprobación de base.

`/health` comprueba acceso a la base, no correo, cobros externos ni recuperación de desastres. Registrar y alertar sobre `request_failed` con estado 5xx, `notification_delivery_failed`, `subscription_worker_failed` y `backup_finished` con fallo. Los eventos de negocio y auditoría permanecen separados de los errores técnicos.

`npm run smoke` usa las variables opcionales `SMOKE_BASE_URL`, `SMOKE_WORKSHOP_EMAIL/PASSWORD` y `SMOKE_ADMIN_EMAIL/PASSWORD`. Utilizar cuentas de prueba autorizadas, no publicar contraseñas.

## Correcciones de registros de pago

En el historial de cobros de una orden o de pagos a proveedores, «Corregir registro» requiere `billing.reverse` o `purchases.reverse`. Solo el propietario los tiene por defecto; puede delegarlos explícitamente. Se requiere motivo y confirmación. La operación revierte el registro completo, restablece el saldo, conserva el original y agrega una contrapartida de caja en la fecha de corrección. No cambia existencias, entregas ni garantías.

Es una corrección de gestión interna: **no devuelve dinero, no revoca transferencias y no emite notas de crédito**. No usarla para representar una devolución comercial real. Si el pago realmente existió, su devolución debe seguir el circuito bancario/fiscal que corresponda, aún no integrado. Un cobro correcto nuevo se registra con una nueva referencia de operación.

Las fechas de pago sin hora se interpretan en el día del taller; las del Panel SaaS usan America/Asuncion, igual que su presentación. No se reescriben fechas históricas. Una fecha futura se rechaza.
