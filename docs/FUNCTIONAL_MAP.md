# Mapa funcional v1

| Área | Estado | Alcance verificado |
|---|---|---|
| Registro, tenant, sucursal inicial y onboarding | Completo | Alta transaccional, trial, plan, propietario y configuración. |
| Planes, límites, feature flags y overrides | Completo | Resolución central, límites por uso y excepción por tenant. |
| Suscripción, vencimiento, gracia, suspensión y reactivación | Completo | Ciclo programado, datos conservados, pagos parciales e idempotencia. |
| Panel maestro y cobranza SaaS | Completo | MRR/ARR/ARPU/churn, actividad, uso, búsqueda, prioridad, deuda y comprobante. |
| Roles, permisos, empleados y sucursales | Completo | Permisos granulares en backend, roles personalizados y límites de plan. |
| Clientes y vehículos 360 | Completo | Historial conectado, deuda, comunicaciones, servicios, repuestos, archivos y garantía. |
| Agenda, recepción, inspección y diagnóstico | Completo | Recepción rápida y validación de relación cliente/vehículo/sucursal. |
| Presupuesto, autorización y orden de trabajo | Completo | Estados centralizados y conceptos autorizados vinculados a la orden. |
| Experiencia del mecánico y tiempos | Completo | Mis trabajos, prioridad, instrucciones, iniciar, pausar y finalizar. |
| Repuestos e inventario | Completo para v1 | Apertura, compra, consumo, trazabilidad, no-negativo e idempotencia. Transferencias/reservas avanzadas quedan como ampliación. |
| Compras y cuentas por pagar | Completo | Solicitud, orden, recepción, stock, deuda y pago transaccional. Cotizaciones comparativas son ampliación. |
| Calidad, facturación, cobro, caja y entrega | Completo | Guardas de workflow, saldos, caja atómica, entrega y garantía. |
| Rentabilidad y reportes | Completo para v1 | Ventas, cobros, costos directos, gastos, utilidad, servicios, técnicos y CSV/impresión. |
| Búsqueda global | Completo | Cliente, teléfono, documento, vehículo, patente, VIN, orden y producto. |
| Archivos, notificaciones, soporte y auditoría | Completo | Privacidad por tenant, bandeja interna, webhook extensible, tickets y trazabilidad. |
| Sitio comercial y responsive | Completo | Inicio, funciones, precios, FAQ, contacto, acceso y alta. |
| Pasarela, fiscal, WhatsApp/SMS y objetos S3 | Requiere proveedor | No se presentan como integraciones activas; se configuran con servicios externos. |
| Alta disponibilidad multi-instancia | Requiere infraestructura | La v1 soportada es single-node; PostgreSQL/RLS y cola compartida son el siguiente paso. |
