# Mecan Cloud

SaaS multi-tenant para talleres. Incluye aplicación del taller, sitio público y consola independiente de plataforma. El estado comercial de producción no se deduce de que el build pase: consultar [aceptación](docs/ACCEPTANCE.md) y [datos externos](docs/PRODUCTION_INPUTS.md).

**PostgreSQL nativo:** el servidor HTTP, servicios, sesiones, workers y vistas utilizan el pool asíncrono PostgreSQL. No existe fallback SQLite. El esquema, importación y respaldos nativos se verifican con una base real. La publicación comercial sigue pendiente de los cierres e integraciones del [reporte](docs/RELEASE_REPORT.md).

## Desarrollo

Node.js 24, npm, PostgreSQL 18 y almacenamiento persistente para adjuntos. `pg` conecta PostgreSQL y Nodemailer entrega correo. SQLite solo se utiliza al importar/recuperar instalaciones anteriores.

```powershell
npm ci
Copy-Item .env.example .env
# Configurar DATABASE_URL y TLS; SUPERADMIN_EMAIL/PASSWORD para el alta inicial local.
npm run migrate
npm start
```

Abrir http://localhost:3000. Solo en desarrollo y con `SEED_DEMO=true`:

- Plataforma: `admin@mecan.local` / `Admin123!`.
- Taller: `dueno@demo.local` / `Demo123!`.

Estas cuentas son demostrativas, nunca credenciales de producción. Los campos vacíos del ejemplo deben completarse para crear un administrador nuevo. La configuración carga `.env` sin sobrescribir variables del proceso. El [runner Windows aislado](docs/POSTGRESQL.md#desarrollo-windows-aislado) inyecta la conexión de desarrollo privada sin imprimirla.

## Verificación

```powershell
npm run check
npm run test:postgres
npx playwright install chromium
npm run test:e2e
npm audit --omit=dev --audit-level=high
npm run production:check
```

El frontend es HTML renderizado en servidor con CSS y JavaScript propios; no existe una aplicación React ni una compilación frontend separada. `build` valida todos los módulos del backend, scripts y JavaScript del navegador, además de los activos requeridos. Playwright verifica las pantallas y los flujos reales en escritorio, notebook, tablet y móvil, incluidos los cinco roles de empleados.

Resultados y límites de entrega: [reporte verificable de cierre](docs/RELEASE_REPORT.md).

## Operación

```powershell
npm run backup
npm run migrate
npm run restore -- <directorio-del-respaldo>
npm run export-tenant -- <tenant-id> <destino.json>
```

Antes de actualizar: respaldar y detener versiones incompatibles durante la migración. La restauración exige `RESTORE_DATABASE_URL` y `RESTORE_STORAGE_PATH` en otra base/directorio vacíos: nunca sobrescribe el origen. Los backups incluyen dump PostgreSQL, adjuntos y manifiesto SHA-256. La exportación por taller recorre una instantánea consistente sin contraseñas ni tokens; los binarios quedan en el respaldo completo.

## Acceso directo en el escritorio

```powershell
npm run desktop:shortcut
```

Crea «Mecan Cloud» en el escritorio con el icono del sistema. Al abrirlo prepara la base, levanta el
servidor y abre el navegador; cerrar la ventana detiene el sistema. No instala un servicio ni
modifica el arranque de Windows. Si `.env` define `DATABASE_URL` usa esa base; si no, recurre al
PostgreSQL local aislado del proyecto, que es de desarrollo. Cuando otro programa ya ocupa el puerto
lo advierte en lugar de abrir el navegador en la aplicación equivocada.

`npm run desktop:shortcut -- -Remove` lo elimina. `npm run desktop:start` hace lo mismo sin crear el
acceso directo. Si `APP_URL` es una dirección HTTPS, además abre el túnel y espera a que responda
antes de dar el sistema por listo.

## Publicar en internet con un túnel

```powershell
npm run tunnel
```

Da una dirección HTTPS pública y estable sin abrir puertos en el router ni en el firewall: la
conexión la abre el agente desde adentro hacia afuera. El sistema sigue corriendo en esta máquina,
así que **tiene que quedar prendida y con internet**; el túnel es un caño, no un servidor.

`APP_URL` es la única fuente de la dirección pública: la leen el script del túnel, la comprobación
de origen del servidor y la app Android. Desde que apunta al túnel, el sistema se usa por esa
dirección también desde esta PC —por `localhost` las pantallas cargan pero los formularios fallan,
porque el origen no coincide—. Las cookies pasan a viajar con `Secure` y se envía HSTS, que ahora
dependen de que el transporte sea HTTPS y no de `NODE_ENV`.

Antes de exponerlo hay que cerrar las cuentas con claves publicadas en el repositorio
(`admin@mecan.local` y los usuarios demo). Todo el procedimiento, incluida la exclusión que pide
Windows Defender para el agente, está en [publicar con un túnel](docs/TUNEL.md).

## Aplicación móvil (Android)

```powershell
npm run mobile:publish -- --bump --version 1.1.0 --notes "Qué cambió"
```

El proyecto Android está en [movile/](movile/README.md). Es un contenedor de la misma aplicación
web —no una segunda implementación que pueda quedar atrasada— y se actualiza sola: consulta
`/movil/actualizacion.json`, descarga el APK publicado, verifica su huella SHA-256 y pide
confirmación antes de instalarlo. La página pública `/movil` ofrece la descarga inicial.

El servidor solo lee `MOBILE_RELEASES_PATH`; no compila ni firma nada. La clave de firma queda fuera
de Git y **debe respaldarse**: sin ella los teléfonos ya instalados no pueden recibir
actualizaciones. El comportamiento en un teléfono real todavía no se probó, porque este entorno no
tiene emulador ni dispositivo conectado.

## Producción

`Dockerfile` instala dependencias de ejecución y clientes PostgreSQL 18, y usa un usuario no privilegiado. `compose.yaml` conecta la aplicación privada con Caddy y PostgreSQL externo mediante `DATABASE_URL`; mantiene adjuntos y respaldos en volúmenes persistentes. Se necesitan dominio, configuración comercial/legal y transporte de correo reales. Ver [operación](docs/OPERATIONS.md).

PostgreSQL coordina escrituras por taller entre conexiones y procesos. La configuración Compose actual despliega un nodo de aplicación con adjuntos locales; varias réplicas requieren almacenamiento compartido autorizado y coordinación de tareas/respaldo. No se ha demostrado capacidad para miles de talleres ni alta disponibilidad; no se promete ese rendimiento sin mediciones del entorno real.

La cobranza SaaS implementada es manual con reactivación automática después de verificar el pago. No hay checkout ni cargos con tarjeta automáticos. Los comprobantes del taller son internos, no facturación fiscal autorizada. Ninguna pasarela, proveedor fiscal, WhatsApp, SMS o S3 se presenta como conectado.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md)
- [Mapa funcional](docs/FUNCTIONAL_MAP.md)
- [Seguridad](docs/SECURITY.md)
- [Operación y recuperación](docs/OPERATIONS.md)
- [Publicar con un túnel](docs/TUNEL.md)
- [Aceptación y evidencias](docs/ACCEPTANCE.md)
- [Datos externos para el cierre](docs/PRODUCTION_INPUTS.md)
- [Aplicación móvil y actualización del APK](movile/README.md)
