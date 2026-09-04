# Fases de la primera versión

## Fase 1 — Núcleo seguro multi-tenant

- Esquema SaaS/operativo separado, sesiones, roles, permisos y auditoría.
- Aprovisionamiento transaccional y aislamiento derivado de sesión.
- Entitlements y límites centralizados, sin condiciones por nombre de plan.

## Fase 2 — Operación autónoma del taller

- Sucursales, empleados, clientes, vehículos, servicios, órdenes e inventario.
- Facturación/caja del taller separadas de la cobranza SaaS.
- Branding, configuración, onboarding y soporte.

## Fase 3 — Administración de la plataforma

- Dashboard financiero, clientes SaaS, ficha 360°, planes y feature flags.
- Suscripciones, trials, gracia, suspensión, reactivación y cancelación.
- Cobranza y pagos manuales con comprobante y auditoría.

## Fase 4 — Adquisición y experiencia

- Sitio público, precios dinámicos, FAQ, contacto, registro y login únicos.
- Interfaces visualmente separadas para público, taller y plataforma.

## Fase 5 — Calidad operacional

- Pruebas de fuga de datos, IDs manipulados, permisos, cobros e idempotencia.
- Health check, exportación por tenant, política de retención y guía de backup.
- Checklist de despliegue y migración de SQLite a PostgreSQL/RLS.
