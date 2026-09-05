# Aceptación del cierre

## Estado

**Parcialmente completado. No autorizado para publicación comercial todavía.**

El objetivo no se marca completo porque no hay dominio/host productivo, datos comerciales y legales aprobados, proveedor real de correo validado, cobro autónomo integrado ni prueba de operación en infraestructura final. Pasar pruebas locales no demuestra estos requisitos.

## Evidencia local

- `npm run check`: build de backend/frontend SSR y suite Node de seguridad, datos y negocio.
- `npm run test:e2e`: navegación pública, alta real, panel del taller/SaaS, cinco roles y operación completa en escritorio/notebook/tablet/móvil.
- `tests/release.test.js`: versiones de presupuesto, reservas, devolución, transferencias, costo promedio, permisos, SMTP local real y paginación sobre PostgreSQL.
- `integration/postgres.spec.js`: migraciones nativas, importación íntegra, rollback, concurrencia y backup/restauración reales; `tests/legacy-migration.test.js` conserva la recuperación SQLite anterior.
- `tests/postgres-concurrency.test.js`: suspensión/permisos/sesiones durante espera real de bloqueo, cobro frente a vencimiento, ajustes duplicados y cambios/reset de contraseña simultáneos.
- `tests/postgres-admin.test.js`: comprobación de producción de solo lectura y exportación aislada por cursores, sin secretos ni sobrescritura de archivos.
- `tests/http-isolation.test.js`: ataques por URL/ID a órdenes, clientes, vehículos y archivos de otro taller.
- `tests/http-workflow.test.js` y `e2e/product.spec.js`: secuencia de recepción a entrega.
- `tests/workshop-workflow.test.js`: falta de stock, compra, recepción, deuda, pago y guardas de workflow.
- `tests/core.test.js`: SaaS, límites, cobros parciales y separación de plataforma/taller.
- Garantías sin cargo y corrección auditada de cobros/pagos: pruebas de autorización, idempotencia, saldo, caja y conservación de entrega/recepción física.
- Instalación SQLite anterior preservada e importada a PostgreSQL: 72 tablas de dominio y 123 filas. Es una copia local con accesos demo, no una base lista para publicarse.
- `tests/mobile-release.test.js`: publicación del APK, manifiesto, descarga íntegra con hash coincidente, ausencia de versión publicada, manifiesto que no corresponde al archivo en disco y rechazo de rutas ajenas al directorio de versiones.
- APK Android: `assembleRelease` compila y firma (verificado con `apksigner`, esquema v2, RSA 4096). Dos versiones consecutivas publicadas con el mismo certificado, condición que Android exige para aceptar una actualización.
- Acceso directo de escritorio: ejecutado; prepara la base, arranca el servidor, confirma que el `/health` que responde es el propio y abre el navegador.
- `npm audit --omit=dev --audit-level=high`: revisión de dependencias de ejecución.
- `npm run production:check`: falla deliberadamente con la configuración local no productiva e identifica los campos faltantes sin revelar valores secretos.

Los resultados cuantitativos de la última ejecución están en [reporte de cierre](RELEASE_REPORT.md). Las capturas/traces de navegador son artefactos locales ignorados por Git, no datos de clientes.

## Requisitos de publicación que faltan demostrar

1. Configuración final y legal aprobada; sin cuentas demo en la base comercial.
2. DNS y HTTPS reales; build de imagen y arranque en host final.
3. Recuperación de contraseña y avisos recibidos usando el proveedor real, no solo SMTP de prueba.
4. Pago autónomo con la pasarela elegida, firma de webhooks, reintentos, idempotencia y reconciliación contra pagos reales.
5. Facturación fiscal, si forma parte de lo que se venderá, contra un emisor/proveedor autorizado.
6. Respaldo cifrado fuera del host, restauración operativa, alertas y responsables.
7. Prueba de carga/capacidad y recuperación ajustada al volumen y disponibilidad acordados.
8. Aplicación Android probada en un teléfono real: instalación, sesión, subida de archivos y ciclo completo de actualización sobre una versión anterior instalada. Este entorno no tiene emulador ni dispositivo; lo verificado hasta ahora es la compilación, la firma y la distribución desde el servidor. Basta un teléfono con Android 8.0 o superior, sin datos del propietario.
9. Respaldo de la clave de firma del APK (`movile/keystore/`) fuera de esta máquina, antes de repartir la primera versión. Sin ella, ningún teléfono ya instalado puede recibir actualizaciones nunca más.

Estos son bloqueos o verificaciones pendientes reales, no funcionalidades presentadas como completadas. Los datos externos están consolidados en [una sola lista](PRODUCTION_INPUTS.md).
