# Arquitectura verificada

## Ejecución

Monolito modular Node.js 24, HTTP nativo, vistas SSR y PostgreSQL 18 mediante `pg`. Servicios, páginas y workers esperan consultas y transacciones asíncronas; no hay persistencia SQLite en el runtime HTTP. El importador conserva compatibilidad explícita con instalaciones anteriores. Ver [PostgreSQL](POSTGRESQL.md). SMTP o un receptor webhook real son obligatorios para recuperar acceso en producción.

`src/server.js` compone autenticación, rutas y vistas generales. `src/routes/release.js` agrupa rutas de configuración, catálogos, privacidad, documentos y operación incorporadas durante el cierre. Los servicios de dominio concentran validación, autorización, estados y transacciones. No se migró a otro framework. La sustitución de la persistencia por PostgreSQL es un requisito explícito del objetivo, no una preferencia de refactorización.

## Aislamiento

`resolveContext` obtiene usuario, membresía, tenant, rol y sucursal desde una sesión opaca. Un usuario de taller no escoge el tenant en el cuerpo ni en la URL. El superadministrador solo entra a un taller mediante el modo de soporte explícito y auditado.

Las consultas operativas se parametrizan y filtran por tenant. El baseline PostgreSQL incluye claves compuestas de tenant, guards INSERT/UPDATE de relaciones, inmutabilidad de propiedad, verificación de miembros y vínculos polimórficos de archivos. No hay Row-Level Security activada: la aplicación sigue siendo una barrera imprescindible para lecturas. `withTenantWrite` vuelve a resolver sesión/membresía/permisos/estado bajo el bloqueo del taller y nunca amplía los permisos recibidos.

## Operaciones

La orden conecta recepción, inspección, diagnóstico, versiones de presupuesto, autorización, asignaciones, tiempos, repuestos, calidad, comprobante, cobros, entrega y garantías. `workflow.js` define estados; los servicios rechazan transiciones inconsistentes.

Las transacciones poseen una conexión dedicada y un bloqueo PostgreSQL por tenant/recurso, compartido por llamadas anidadas. No bloquean globalmente otros talleres ni reproducen automáticamente efectos externos. Numeradores, factura por orden, pagos, caja, recepción, reservas, transferencias y devoluciones tienen guardas e idempotencia. El consumo usa precios aprobados; una devolución conserva el original y lo excluye de cantidades activas mediante `active_work_order_parts`.

Los importes se validan con la precisión de su moneda. Las facturas conservan la moneda y los presupuestos su tasa de impuesto. Las horas locales se interpretan usando la zona del taller, no la del servidor.

Los trabajos sin cargo exigen un concepto real, permiso `orders.no_charge` y motivo de aprobación. Su comprobante queda saldado sin inventar un pago ni un movimiento de caja; los costos reales permanecen en rentabilidad.

`payment-reversals.js` revierte registros erróneos mediante una transacción y una contrapartida, no eliminando originales. `payment_reversals` es inmutable; las vistas `effective_workshop_payments` y `effective_purchase_payments` excluyen los originales revertidos del saldo. Las entregas y recepciones físicas no se deshacen por corregir un registro financiero. La conciliación de publicación es de solo lectura y reporta cantidades de inconsistencias, no identidades o importes privados.

## Autorización y presentación

Los permisos se verifican en rutas y servicios. Administrar compras no concede automáticamente permiso para pagar proveedores. Se restringen informes de costos/utilidad, facturas, búsqueda y cliente 360. Un cambio de permisos, rol o acceso revoca sesiones.

`ui.js` comparte formularios, tablas, estados y navegación. `AsyncLocalStorage` aísla formato monetario y horario por solicitud. Los catálogos principales se consultan con búsqueda y paginación en servidor.

## Tareas

La aplicación actualiza suscripciones y despacha avisos periódicamente. La cola persistente tiene intentos, bloqueo con vencimiento y reintentos. SMTP tiene timeout, TLS en producción y acceso a URL/archivos desactivado. SMTP no garantiza entrega exactamente una vez tras un corte de red; los eventos y reclamos concurrentes sí se deduplican.

La audiencia de cada aviso requiere el permiso correspondiente; los cobros requieren `billing.view`, los avisos de suscripción `settings.manage`. Los eventos no clasificados no se difunden a todos los empleados. `notification_reads` conserva la lectura por usuario sin cambiar el estado global de un aviso compartido. Las claves de nuevos avisos incluyen tenant/canal y se siguen reconociendo claves históricas únicamente dentro de su alcance original.

El respaldo programado ejecuta `pg_dump` en otro proceso usando una instantánea exportada. El vencimiento relee la suscripción después del bloqueo del tenant para no sobrescribir una renovación concurrente. Los resets se serializan por cuenta y se revalidan antes de consumir el enlace. Estas protecciones no equivalen a alta disponibilidad.

## Distribución móvil

`src/routes/mobile.js` publica la aplicación Android: `/movil` es la página de descarga,
`/movil/actualizacion.json` el manifiesto que consultan las apps instaladas y `/movil/apk/<nombre>`
la entrega del archivo, transmitido en flujo y con nombre versionado —por eso el contenido de una
URL nunca cambia y puede cachearse—.

El servidor solo **lee** `MOBILE_RELEASES_PATH`: no compila ni firma. La compilación y la firma
ocurren fuera, en [movile/](../movile/README.md), y el resultado se deja en ese directorio. Una
versión solo se anuncia si el APK existe y su tamaño coincide con el declarado en el manifiesto, de
modo que un manifiesto sin archivo, o una copia interrumpida, no llegan a los dispositivos.

La ruta de descarga acepta únicamente nombres con la forma `mecan-<versión>-<código>.apk` dentro del
directorio de versiones; cualquier otro nombre o intento de recorrer directorios responde 404 sin
tocar el disco fuera de esa carpeta.

## Alcance de escala

El despliegue suministrado usa un nodo de aplicación, PostgreSQL externo y adjuntos persistentes locales. El pool admite consultas concurrentes y la coordinación de escritores se comprobó entre conexiones separadas. Para alta disponibilidad o varias réplicas faltan infraestructura compartida, supervisión de tareas y validación representativa de carga; no existe evidencia de capacidad para miles de talleres.
