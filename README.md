# Mecan Cloud

SaaS multi-tenant para la gestión diaria de talleres mecánicos. Incluye sitio comercial y alta autónoma, panel maestro de plataforma, operación por taller y sucursal, flujo de orden de trabajo, compras, inventario, caja, reportes, soporte y auditoría.

## Ejecutar localmente

Requiere Node.js 24 o superior. No instala dependencias de terceros: usa HTTP, criptografía y SQLite nativos de Node.

```powershell
Copy-Item .env.example .env
npm start
```

Abra <http://localhost:3000>. En desarrollo se crean datos demostrativos si `SEED_DEMO=true`:

- Plataforma: `admin@mecan.local` / `Admin123!`
- Taller: `dueno@demo.local` / `Demo123!`

El arranque en `NODE_ENV=production` rechaza estas claves, el seed demo, una URL sin HTTPS y una configuración de notificaciones incompleta.

## Calidad y operación

```powershell
npm run build       # valida sintaxis y activos del servidor/cliente
npm test            # pruebas unitarias, integración y E2E HTTP
npm run check       # build + suite completa
npm run backup -- D:\Backups\Mecan
npm run restore -- D:\Backups\Mecan\mecan-fecha.db --confirm
npm run export-tenant -- <tenant-id> export.json
```

Las migraciones versionadas se aplican automáticamente al iniciar, dentro de transacciones. No edite la base manualmente.

## Arquitectura

- `src/server.js`: composición HTTP y rutas; delega reglas críticas a servicios de dominio.
- `src/services/workshop-operations.js`: workflow transaccional de recepción a entrega, compras, stock, pagos e idempotencia.
- `src/db.js`: esquema, migraciones, restricciones, índices y datos iniciales.
- `src/tenancy.js`: contexto derivado de sesión, permisos y capacidades de plan.
- `src/billing.js`: ciclo SaaS, cobranza, numeración segura y métricas.
- `src/auth.js`, `src/security.js`: scrypt, sesiones opacas, CSRF, recuperación, rate limit y archivos.
- `src/pages/`: vistas operativas 360; `src/ui.js`: sistema visual SSR responsive.
- `tests/`: aislamiento multi-tenant, seguridad, integridad y recorridos E2E.

El navegador nunca decide el tenant. Cada lectura y mutación operativa deriva `tenant_id` de la sesión; los servicios vuelven a comprobar pertenencia y la base incorpora disparadores contra asociaciones cruzadas en entidades críticas.

## Producción

Complete `.env.example`, ejecute `npm run check`, use TLS mediante proxy y monte `data/` y `storage/` en volúmenes persistentes y cifrados. El `Dockerfile` ejecuta como usuario no privilegiado e incluye health check.

Esta entrega es desplegable como instancia única controlada. Para alta disponibilidad o múltiples réplicas de escritura debe migrarse el adaptador de persistencia a PostgreSQL con RLS y los archivos a almacenamiento de objetos privado. Las integraciones de correo/WhatsApp/SMS, pasarela automática y facturación fiscal requieren proveedores y credenciales reales; no se simulan.

Consulte [arquitectura](docs/ARCHITECTURE.md), [mapa funcional](docs/FUNCTIONAL_MAP.md), [seguridad](docs/SECURITY.md), [operación](docs/OPERATIONS.md) y [aceptación](docs/ACCEPTANCE.md).
