# Criterios de aceptación de la v1

La primera versión se acepta cuando `npm run check` termina correctamente y se verifican estas garantías:

- alta transaccional de tenant, propietario, sucursal, rol, trial y suscripción;
- el tenant procede exclusivamente de la sesión autenticada;
- permisos comprobados en servidor y navegación adaptada al rol;
- estados de la orden centralizados, sin facturar antes de autorización/calidad;
- repuestos consumidos únicamente dentro de cantidad autorizada, sin stock negativo ni descuentos duplicados;
- compras recibidas actualizan inventario y cuenta por pagar en una transacción;
- cobros no superan el saldo y generan exactamente un movimiento de caja;
- factura SaaS con saldo parcial, idempotencia y reactivación solo al cancelar la deuda;
- suspensión en modo consulta sin eliminar datos;
- archivos privados por tenant, cuota bloqueada, firma de contenido validada y descarga autorizada;
- errores públicos comprensibles, sin SQL, stack trace o nombres internos;
- migraciones, health check, cierre ordenado, backup, restauración y exportación documentados;
- sitio, panel SaaS y aplicación del taller utilizables en escritorio, tablet y móvil.

## Suite obligatoria

La suite cubre aprovisionamiento, permisos, entitlements, sesiones hasheadas, recuperación de contraseña, rate limit, firmas de archivos, restricciones de base, IDOR HTTP, facturación/caja, cobranza SaaS parcial, flujo completo del taller y falta de stock con compra. El recorrido E2E HTTP ejecuta:

`recepción → inspección → diagnóstico → presupuesto → autorización → asignación → reparación → calidad → factura → cobro → entrega → garantía`

## Integraciones externas

No se consideran aprobadas hasta configurar y probar contra el proveedor elegido: facturación fiscal, pasarela automática, email, WhatsApp/SMS y almacenamiento S3. La plataforma conserva contratos e idempotencia para conectarlas sin falsear resultados.
