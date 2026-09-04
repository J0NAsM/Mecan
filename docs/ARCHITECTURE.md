# Arquitectura

## Límites del sistema

La plataforma distingue dos contextos incompatibles: `PLATFORM` para el superadministrador y `TENANT` para los talleres. Un usuario de taller posee una membresía, rol y sucursal. `resolveContext` obtiene todo desde la sesión; las rutas operativas no aceptan un tenant enviado por el cliente.

El núcleo usa una arquitectura modular pragmática:

1. HTTP analiza la solicitud, autentica, valida CSRF y exige permisos.
2. Servicios de dominio verifican estado, pertenencia, límites y datos.
3. Operaciones sensibles abren `BEGIN IMMEDIATE`, escriben los agregados relacionados y auditan antes de confirmar.
4. Restricciones, índices y triggers sirven como última defensa de integridad.
5. Las vistas SSR presentan únicamente acciones válidas para el estado y el rol.

## Agregados principales

- SaaS: tenant, plan, feature, suscripción, factura, pago e historial.
- Organización: sucursal, usuario, membresía, rol y configuración.
- Relación: cliente, vehículo, comunicación, documento e historial.
- Operación: recepción, inspección, diagnóstico, presupuesto, orden, asignación, tiempo, calidad, entrega y garantía.
- Abastecimiento: artículo, movimiento, solicitud, orden de compra, recepción, cuenta por pagar y pago.
- Finanzas del taller: factura, ítems, cobro y movimiento de caja.

La orden de trabajo es el agregado central. `workflow.js` define transiciones válidas y `workshop-operations.js` impide saltos. Las secuencias de documentos se actualizan atómicamente y las operaciones repetibles usan claves idempotentes únicas por tenant.

## Escalabilidad

SQLite en WAL ofrece una v1 simple y estable en un único nodo. Los límites de dominio, `tenant_id`, repositorios parametrizados y servicios transaccionales permiten reemplazar persistencia sin rediseñar el producto. Para varias instancias se requiere PostgreSQL, RLS, un pool transaccional y una cola de trabajos compartida.
