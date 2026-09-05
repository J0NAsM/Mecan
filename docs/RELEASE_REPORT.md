# Reporte verificable de cierre técnico

Revisión: 5 de septiembre de 2026, zona America/Asuncion.

## 1. Estado final

**Parcialmente completado. No listo para publicación comercial autónoma.**

La operación local del taller y la administración SaaS con cobranza manual están integradas y verificadas en los escenarios descritos abajo. No se declara terminado el objetivo: no existe una pasarela de pago autónomo integrada ni evidencia de operación en el host productivo. Tampoco se atribuye validez fiscal a los comprobantes internos.

PostgreSQL es ahora un requisito explícito. Se completaron el esquema nativo, el pool/transacciones, la importación de la base local y el backup/restauración nativos con pruebas reales. **La conversión del runtime está terminada:** `src/db.js` solo abre PostgreSQL, no existe fallback SQLite y las 60 pruebas Node, las 10 de integración y las 16 de navegador se ejecutaron contra una base PostgreSQL real. SQLite queda únicamente en el camino de importación y recuperación de instalaciones anteriores (`scripts/legacy/`, `src/backups.js`, `src/migrations/`), al que el servidor HTTP no llega nunca.

## 2. Qué se terminó o corrigió

- Aislamiento: tenant derivado de sesión, controles de lectura/escritura, guardas de relaciones e inmutabilidad de propiedad en base; verificación de archivos, búsquedas, exportaciones y documentos imprimibles.
- Autorización: prevención de escalamiento, separación de gestionar compras y pagar, protección de costos y fichas 360, edición/baja de empleados y revocación de sesiones. Caja dispone de acceso visible a pagos de proveedores.
- Acceso: recuperación y cambio de contraseña, clave temporal obligatoria, límites persistentes y corrección del primer acceso de empleados. El límite de cambio autenticado se aplica por usuario para no bloquear a todo un taller detrás de una IP.
- Orden completa: recepción, inspección, diagnóstico, presupuesto, aprobación registrada, técnico, repuestos, calidad, comprobante, cobros parciales, entrega y garantía.
- Garantías sin cargo: reclamo vinculado a una nueva orden del mismo vehículo; autorización con permiso específico y motivo; repuestos/costos, calidad, constancia de importe cero y entrega sin cobros ficticios. Una constancia sin cargo puede anularse antes de entregar y reemitirse conservando la auditoría.
- Presupuestos: revisión versionada antes de autorización, conservación del anterior y eliminación de conceptos en borrador. Lo aprobado permanece protegido.
- Inventario/compras: apertura, reserva, ajuste, traslado, consumo autorizado, devolución completa de un consumo no utilizado, reposición, recepción, costo promedio, deuda y pagos a proveedores. Repetir referencias con datos incompatibles de ajuste/reserva/traslado devuelve error.
- Finanzas: importes con precisión monetaria, impuestos/moneda conservados en documentos, protección contra doble factura y sobrecobro, caja transaccional, ingresos separados de utilidad y métricas SaaS separadas por moneda. ARPU excluye pruebas gratuitas.
- Suscripción: deuda y pagos parciales, vencimiento/gracia/suspensión, reactivación tras impago prolongado, bloqueo administrativo respetado y avisos. Nunca se borra información por impago.
- Catálogos/UX: edición, archivo/reactivación, búsqueda y paginación, configuración que conserva campos no enviados, navegación por rol, menú móvil, formularios numéricos corregidos y documentos para imprimir/guardar como PDF sin costos internos.
- Historial financiero responsive: tabla en escritorio y registros verticales etiquetados en móvil, sin desplazamiento horizontal para consultar método, importe, estado o corrección. Encabezados accesibles y etiquetas de búsqueda para lectores de pantalla.
- Seguridad de contenido: nombres de adjuntos normalizados a su tipo real, límites y cuotas, rutas privadas, exportaciones CSV protegidas frente a fórmulas y eliminación de estilos de la antigua maqueta pública.
- Notificaciones: audiencia por permiso, importes de cobros fuera del acceso de mecánicos/inventario, lecturas individuales y referencias aisladas por tenant/canal. La migración conserva lecturas históricas atribuibles y rechaza destinatarios cruzados sin borrar información.
- Cierres diarios: pantalla y CSV utilizan el día del taller, no medianoche UTC, incluyendo días de 23/25 horas y cambios de horario a medianoche. La presentación respeta monedas de cero, dos y tres decimales.
- Reintentos de pago: método, referencia, fecha explícita y moneda no pueden cambiar reutilizando una operación; caja separa referencias de cobros y pagos a proveedores.
- Corrección financiera: reversión completa de registros erróneos de cobros y pagos a proveedores, con permiso separado, motivo obligatorio, contrapartida única de caja y saldo restablecido. Conserva originales, entregas, garantías y recepciones físicas. El historial identifica el registro revertido; los pagos a proveedores tienen búsqueda/paginación. No ejecuta devoluciones bancarias ni notas de crédito fiscales.
- Fechas financieras: una fecha sin hora se registra en el día local correspondiente; no admite pagos futuros. Dashboard mensual y reportes usan la zona del taller. Los aportes y correcciones de caja no se presentan como utilidad.
- Conciliación previa a publicación: verifica saldos/estados contra pagos vigentes y enlaces de caja de cobros, pagos a proveedores y reversiones; detecta inconsistencias sin reescribirlas.
- Operación: SMTP real con cola/reintentos, consola de fallos, backups de base y adjuntos con manifiesto/hash, restauración con copia anterior, migración controlada y exportación sin contraseñas/tokens.
- Entrega técnica: dependencias fijadas, `.env.example`, documentación, Docker/Compose/Caddy y CI. El proxy no recibe los secretos de aplicación.
- PostgreSQL: 72 tablas de dominio más dos de metadatos; migraciones SQL con checksum, 184 guards nativos, claves compuestas de tenant, unicidad de email y cantidades/importes `NUMERIC`. Pool asíncrono con transacción por conexión y bloqueo explícito por tenant/recurso; errores de consultas, operaciones anidadas o tareas sin esperar no pueden confirmarse como éxito.
- Conservación de datos: importador toma una copia consistente de SQLite, valida migraciones/integridad/saldos, compara cada valor y conteo y solo carga un destino vacío. Una importación inválida revierte filas y estado de triggers. Se importó la instalación local completa: 123 filas, dos talleres, tres usuarios; el original no se modificó.
- Continuidad PostgreSQL: `pg_dump` con snapshot y adjuntos, manifiesto/hash, restauración real transaccional en otra base vacía, rechazo de destino ocupado, respaldo alterado y restauración sobre el origen. Respaldo de la copia PostgreSQL local: `backups/mecan-pg-2026-09-05T03-57-48-123Z-6a1b3cd2`.

- Acceso directo de escritorio: `npm run desktop:shortcut` crea el acceso con icono propio; al abrirlo prepara la base, arranca el servidor y abre el navegador, y cerrar la ventana detiene el sistema. Usa `DATABASE_URL` si `.env` la define y, si no, la base local aislada. Comprueba que el `/health` que responde sea el de esta aplicación, porque en Windows dos procesos pueden ocupar el mismo puerto en interfaces distintas.
- Aplicación Android en `movile/`: contenedor de la misma aplicación web, no una segunda implementación. Sesión persistente, subida de archivos, descargas con la sesión vigente, pantalla de reintento sin conexión y actualización propia. `/movil` publica la descarga inicial, `/movil/actualizacion.json` el manifiesto y `/movil/apk/<nombre>` el archivo en flujo.
- Canal de actualización del APK: manifiesto con SHA-256 verificado en el dispositivo, descarga restringida al mismo origen del servidor configurado, `applicationId` y `versionCode` comprobados antes de instalar, solo HTTPS en la compilación de publicación y confirmación de la persona en el diálogo del sistema. El servidor no anuncia una versión si el archivo no existe o su tamaño no coincide con el declarado.

El frontend sigue siendo SSR y el backend Node.js 24. La conversión a PostgreSQL está terminada en el runtime. Se separaron servicios y rutas de cierre, y se centralizaron dinero, tiempo, paginación, permisos, configuración y respaldos. El servidor principal todavía conserva una parte importante de la composición de rutas/vistas.

## 3. Pruebas ejecutadas

| Verificación | Resultado observado |
|---|---|
| `npm test` / `npm run check` | 60 aprobadas; 0 fallidas, omitidas o pendientes. Todas contra PostgreSQL |
| `test:postgres` contra PostgreSQL 18.6 local | 10 aprobadas; 0 fallidas/omitidas; migraciones, importación íntegra, rollback, asociaciones cruzadas, stock, unicidad, 20 escrituras concurrentes entre pools, backup/restauración nativos con adjuntos |
| `npm run test:e2e` | 16 aprobadas en Chromium: escritorio 1920×1080, notebook 1366×768, tablet 820×1180 y móvil Pixel 7 |
| Revalidación responsive | Batería completa de 16 escenarios nuevamente aprobada; el servidor de estas pruebas ya usa PostgreSQL, igual que el runtime |
| Distribución del APK (`tests/mobile-release.test.js`) | 4 aprobadas: manifiesto y descarga íntegra con hash coincidente; 404 sin versión publicada; manifiesto que no corresponde al archivo en disco no se anuncia; la ruta de descarga rechaza `signing.properties`, `manifest.json`, recorridos `../` y extensiones añadidas |
| Acceso directo de escritorio | Ejecutado: prepara la base local, arranca el servidor, confirma `/health` propio y abre el navegador. Detecta que otro programa ocupe el puerto en lugar de mostrar la aplicación equivocada |
| Alta desde navegador | Crea tenant, propietario, sucursal y trial; guarda onboarding y permite acceder |
| Operación desde navegador | Cliente → vehículo → recepción → diagnóstico/presupuesto → autorización → trabajo/repuesto → calidad → comprobante → tres cobros parciales → entrega/garantía; corrección y nuevo cobro sin duplicar entrega |
| Reclamo de garantía desde navegador | Reclamo → vincular reparación → autorización sin cargo → trabajo → calidad → constancia cero → entrega → resolución |
| Compra desde navegador | Reposición → proveedor/compra → recepción → pago → reversión → pago corregido; stock conserva la entrada física |
| Revisión por roles desde navegador | Gerencia, recepción, mecánico, caja e inventario: crear acceso, cambiar clave temporal, abrir pantallas permitidas, rechazar rutas prohibidas, filtrar avisos financieros y registrar lecturas independientes |
| Responsive y consola | Sin desbordamiento de página ni errores de consola en los recorridos probados; historial financiero móvil sin scroll horizontal; menú móvil abre/cierra; constancia de entrega e historiales inspeccionados visualmente |
| Concurrencia HTTP | Ocho peticiones simultáneas con la misma referencia generan un consumo, una factura, un pago y una sola reversión con su contrapartida; ocho cobros adicionales sobre saldo cero se rechazan |
| Aislamiento HTTP | Rechaza fichas, edición, archivo, ajustes, descargas e impresión de otro tenant; búsqueda/exportación no muestran sus datos; registros ajenos sin cambios |
| Falta de stock | Solicitud → compra → recepción → inventario → deuda → pago; pruebas positivas y negativas de stock/precio autorizado |
| SaaS | Pago manual/parcial, idempotencia, suspensión/reactivación y bloqueo administrativo; MRR/ARPU por moneda |
| SMTP | Entrega real a un servidor SMTP local de prueba, un reclamo concurrente y eliminación del enlace de reset después del envío |
| Backup/restauración | Verificación de integridad/hash y restauración real de base y adjuntos, conservando copia anterior |
| `npm run smoke` | Aprobado contra un servidor temporal: health, sitio, taller y Panel SaaS; servidor de prueba detenido después |
| `npm audit` y `npm audit --omit=dev --audit-level=high` | 0 vulnerabilidades reportadas por el registro consultado |
| Migración local | 001–011 aplicadas con respaldo completo previo; integridad correcta, 0 violaciones de claves foráneas y conciliación financiera del taller sin diferencias |
| `git diff --check` | Sin errores de whitespace; secretos/datos/respaldos/capturas fuera de los archivos para versionar |

Las pruebas de navegador tuvieron fallos intermedios que se corrigieron y se volvieron a ejecutar: selector ambiguo tras agregar búsqueda, estilos redirigidos durante cambio obligatorio de contraseña y bloqueo compartido por IP. La última ejecución indicada es la completa posterior a las correcciones, no una selección de pruebas que omita esos casos.

Advertencia no funcional del ejecutor Playwright: conflicto de variables `NO_COLOR`/`FORCE_COLOR` de la terminal. No corresponde a errores de consola de la aplicación.

Inestabilidad observada, no corregida: `integration/postgres.spec.js` falló una vez con una consulta cancelada por `statement_timeout` al ejecutarse inmediatamente después de la batería completa, con la máquina cargada. Tres ejecuciones posteriores del mismo archivo pasaron sin cambios en el código. Es sensible al tiempo bajo contención, no un fallo funcional reproducible; queda anotado en lugar de ocultarse.

## 4. Build

`npm run build`: **aprobado**, 69 archivos JavaScript y activos públicos verificados. Comprueba backend, scripts, JavaScript del navegador y los scripts de publicación del APK. Las migraciones SQL se verifican ejecutándolas en la batería PostgreSQL. Este proyecto SSR no requiere ni tiene un bundle React/Vite separado.

APK Android: **compilado y firmado** con el SDK 36 y Gradle 9.3.1 de esta máquina. `assembleRelease` produce un APK de 0,6 MB, verificado con `apksigner` (esquema v2, RSA 4096). Se publicaron dos versiones consecutivas para comprobar el canal de actualización: ambas quedaron firmadas con el mismo certificado, condición que Android exige para aceptar una actualización.

Docker: archivos preparados y construcción incluida en CI, pero **no ejecutada en este entorno**, que no tiene Docker. No se realizó despliegue externo ni se afirma que CI remota haya corrido.

## 5. Datos que todavía debe proporcionar el propietario

La única lista completa, con finalidad, obligatoriedad, formato, variables y alternativa temporal, está en [DATOS QUE NECESITO QUE ME PROPORCIONES](PRODUCTION_INPUTS.md). Incluye identidad/dominio, administrador, correo, aprobación comercial, pasarela, alcance fiscal, textos legales e infraestructura/continuidad. Los secretos deben cargarse en un entorno privado, no en Git o chat.

## 6. Bloqueos y límites reales

1. **Cobro SaaS autónomo no integrado.** La cobranza actual exige verificación manual por el propietario. Se necesita elegir proveedor y obtener su paquete técnico para implementar y probar checkout/webhooks/reconciliación reales. No se resuelve únicamente agregando una clave.
2. **Configuración productiva inexistente.** Faltan datos comerciales/legales aprobados, dominio/host, cuenta maestra final y correo real validado. La base local mantiene cuentas demo: no se presenta como base comercial.
3. **Facturación fiscal no integrada**, si es parte de la oferta. Los comprobantes son internos. Se pueden corregir registros de pago erróneos y anular comprobantes sin cobros vigentes antes de entregar; esto no sustituye un reembolso real ni una nota de crédito fiscal.
4. **Despliegue, backup externo y alertas no verificados.** Se necesita infraestructura autorizada y prueba real de restauración fuera del host, entrega de correo y acceso HTTPS.
5. **Aplicación móvil no probada en un dispositivo.** El APK compila, queda firmado y su publicación, manifiesto y descarga están verificados contra el servidor real. Lo que **no** se probó es el comportamiento en un teléfono: instalación, sesión, subida de archivos y el ciclo completo de actualización sobre una versión anterior instalada. Este entorno no tiene emulador ni dispositivo conectado. Es una verificación pendiente, no una funcionalidad ausente, y no requiere información del propietario: basta un teléfono Android 8.0 o superior.
6. **Escala no certificada.** No hay prueba representativa de cientos/miles de talleres ni alta disponibilidad configurada. La prueba local de concurrencia no equivale a certificar capacidad.

La recepción parcial y cancelación del remanente de compras tienen servicio y esquema; la prueba de importación ya conserva dos recepciones con pago/corrección. Su interfaz específica y batería funcional propia todavía deben cerrarse; las pantallas E2E verificadas mantienen el circuito de recepción completa. No hay devolución a proveedor implementada. WhatsApp, SMS y S3 no están conectados ni se presentan como integraciones activas. No se garantiza ausencia universal de vulnerabilidades; no se hizo un pentest independiente.

`src/backups.js` y `src/migrations/` viven bajo `src/` pero solo son alcanzables desde `scripts/legacy/` y la prueba de migración anterior: ningún camino del servidor HTTP los importa. Moverlos junto al resto del código heredado sería más claro, pero es un reordenamiento que no cambia comportamiento y no se hizo.

## 7. Preparación para producción

Están disponibles código integrado, pruebas reproducibles, configuración de producción que rechaza valores incompletos, migraciones, respaldo/restauración y archivos de despliegue. `npm run production:check` termina con **código 1: NO APTO PARA PUBLICACIÓN** con la configuración local actual, y enumera los campos faltantes sin exponer secretos.

El diagnóstico también bloquea explícitamente el runtime SQLite, aunque se completen las credenciales. Los comandos PostgreSQL y la lista única de datos están documentados en [PostgreSQL](POSTGRESQL.md) y [datos externos](PRODUCTION_INPUTS.md). Docker/Compose describen un despliegue PostgreSQL, pero **no se ejecutaron en este entorno**: no hay Docker instalado.

Añadidos en esta revisión, con su alcance real: el acceso directo de escritorio (`npm run desktop:shortcut`), que se ejecutó y funciona sobre la base local de desarrollo; y la aplicación Android de [movile/](../movile/README.md), compilada, firmada y distribuida por `/movil`, con el canal de actualización verificado del lado del servidor y pendiente de prueba en un teléfono. El APK y su clave de firma quedan fuera de la imagen Docker; en Compose el directorio de versiones se monta de solo lectura, de modo que publicar una versión no obliga a reconstruir la imagen.

No se marca el objetivo completo. El siguiente cierre debe comprobar las integraciones e infraestructura reales descritas arriba, no limitarse a cambiar esta documentación a «completado».
