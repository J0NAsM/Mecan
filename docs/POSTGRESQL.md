# PostgreSQL: estado comprobado y operación

## Estado real

PostgreSQL es el destino requerido para la base completa. Están implementados y probados contra PostgreSQL 18.6 real:

- Esquema nativo de las 72 tablas de dominio, migraciones con checksum y registro de importación; 74 tablas incluyendo metadatos.
- Importes/cantidades en `NUMERIC`, cuotas de archivos en `BIGINT`, índices, claves foráneas, unicidad y 184 guards nativos PL/pgSQL.
- Claves compuestas `(tenant_id, referencia)` que impiden enlazar datos de talleres diferentes; unicidad de email sin distinguir mayúsculas y una membresía de taller por usuario.
- Pool `pg` asíncrono; una conexión por transacción, contexto aislado mediante `AsyncLocalStorage`, rollback y bloqueos explícitos por tenant/recurso entre procesos. No reejecuta automáticamente operaciones con efectos externos.
- Importación de una copia consistente de SQLite sin modificar el origen; comparación de todos los valores y conteos, conciliación financiera previa, rechazo de destinos ocupados y rollback de datos/estado de triggers si falla.
- `pg_dump` con snapshot consistente y adjuntos privados; manifiesto SHA-256; `pg_restore` transaccional en otra base vacía. Rechaza respaldos alterados, destinos ocupados y restauración sobre el origen.

**La aplicación HTTP utiliza PostgreSQL nativo.** Sesiones, servicios, páginas y workers son asíncronos; las pruebas HTTP de operación/aislamiento se ejecutan contra PostgreSQL. No hay fallback SQLite, worker síncrono ni conversión de dialecto SQL. `prepare` únicamente transforma los marcadores de parámetros a `$1…`; `iterate` usa cursores por lotes. El arranque productivo verifica migraciones, guards, conciliación, cuentas demo y privilegios de conexión.

La instalación local fue copiada a PostgreSQL: 72 tablas, 123 filas, dos talleres y tres usuarios. La base de origen conserva las migraciones 001–011; la copia se actualizó a 012 antes de importarse. Conserva también las cuentas demo: esa copia no es una base comercial nueva ni debe publicarse tal cual.

## Configuración

Guardar `DATABASE_URL` únicamente en el entorno privado. Formato: `postgresql://usuario:clave-url-encoded@host:puerto/base`, sin parámetros de URL. `DATABASE_SCHEMA=mecan` es el esquema exclusivo del producto.

`DATABASE_SSL_MODE=verify-full` valida certificado y nombre del servidor; `DATABASE_SSL_CA_FILE` permite una CA privada. No hay modo `no-verify`. `disable` se admite en loopback/desarrollo o con la declaración explícita `DATABASE_TRUSTED_NETWORK=true` para una red privada controlada. Timeouts y tamaño máximo del pool figuran en `.env.example`; no multiplicar conexiones sin considerar todas las réplicas y workers.

Para los comandos nativos se necesita `pg_dump`/`pg_restore` compatibles con la versión del servidor. `POSTGRES_BIN_PATH` indica su directorio si no están en `PATH`. Docker instala los clientes 18 desde el [repositorio oficial PostgreSQL para Debian](https://www.postgresql.org/download/linux/debian/). El código no pasa contraseñas en argumentos de procesos ni escribe la conexión en los logs.

La cuenta de aplicación debe tener acceso a su base y propiedad/permisos de creación en su esquema exclusivo para migrar. No debe tener `SUPERUSER`, `CREATEROLE`, `CREATEDB`, `REPLICATION` ni `BYPASSRLS`. La cuenta de desarrollo y la cuenta aislada de CI pueden crear bases para probar restauraciones; no deben reutilizarse en producción. Aprovisionar la base y la cuenta productiva desde el proveedor o un administrador de infraestructura.

## Comandos con PostgreSQL disponible

```powershell
npm run postgres:migrate
npm run postgres:import -- C:/ruta/autorizada/origen.db
npm run test:postgres
npm run postgres:backup
npm run production:check
```

La importación solo acepta un esquema destino vacío. Las migraciones se conservan si la importación de datos falla; no quedan filas parcialmente importadas. Los guards de inserción se suspenden dentro de una transacción con bloqueos exclusivos para cargar estados históricos, sin volver a ejecutar recepciones/cobros. Las claves foráneas, checks y unicidad siguen vigentes; los guards se reactivan antes del commit y el rollback también restaura su estado. Las migraciones aplicadas no deben editarse: cualquier cambio posterior requiere otro archivo SQL.

Para restaurar, crear previamente **otra base vacía** y un directorio vacío. Configurar `RESTORE_DATABASE_URL` y `RESTORE_STORAGE_PATH` privadamente, junto al TLS correspondiente al destino, y ejecutar:

```powershell
npm run postgres:restore -- C:/ruta/al/respaldo/mecan-pg-fecha
```

Solo restaurar respaldos propios/de confianza: un hash detecta cambios accidentales, no certifica la procedencia de un archivo SQL. Una restauración fallida puede dejar copias de adjuntos en el destino de recuperación para diagnóstico; no se declara verificada ni se sobrescribe una instalación existente. La base se restaura en una sola transacción. La copia externa, su cifrado y su política de retención requieren el destino de infraestructura indicado en la lista única de datos.

## Desarrollo Windows aislado

Los [binarios publicados para Windows](https://www.postgresql.org/download/windows/) están disponibles mediante el enlace oficial de EDB. La instalación local usada para las pruebas es 18.6, descomprimida en `.runtime/postgresql/18.6/pgsql`; no instala un servicio del sistema.

```powershell
npm run postgres:dev
node scripts/dev-postgres.js exec node scripts/postgres-migrate.js
node scripts/dev-postgres.js exec node --test integration/postgres.spec.js
node scripts/dev-postgres.js exec node --test --test-concurrency=1
node scripts/dev-postgres.js exec node node_modules/@playwright/test/cli.js test
node scripts/dev-postgres.js exec node scripts/postgres-backup.js
npm run postgres:stop
```

El servidor escucha únicamente en `127.0.0.1:55432` y exige SCRAM. La clave aleatoria local se guarda en `.runtime/postgresql/dev-connection.json`, ignorado por Git; no es una credencial del propietario ni se reutiliza en producción. No exponer ese directorio a otros usuarios del equipo.

El generador `scripts/legacy/postgres-baseline.js` documenta la conversión inicial desde una SQLite vacía en memoria; no lo carga el runtime PostgreSQL. El baseline generado es SQL nativo versionado, no una conversión de consultas en cada petición.

## Verificación observada

`test:postgres`: 10 pruebas de infraestructura, sin simulaciones ni omisiones, incluyendo importación válida e inválida, rollback, unicidad, referencias entre tenants, stock, concurrencia de 20 escrituras, backup y restauración reales con adjuntos. Las baterías HTTP, servicios y navegador también utilizan PostgreSQL; sus resultados y límites se registran en el [reporte](RELEASE_REPORT.md). Ninguna de estas pruebas certifica capacidad para miles de talleres.

CI incorpora un servidor PostgreSQL real y clientes 18 desde el [repositorio oficial para Ubuntu](https://www.postgresql.org/download/linux/ubuntu/). La configuración remota todavía debe ejecutarse en su entorno; no se afirma haber ejecutado GitHub Actions desde este equipo.
