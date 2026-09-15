# Testing — MecanCloud

[Comandos declarados](ejecucion.md). La presencia de pruebas no acredita una ejecución reciente.

Separar unitarias de integración/E2E. Estas últimas requieren una DB de prueba expresamente identificada, migraciones controladas y datos de fixture; no reutilizar una DB compartida por defecto.

## Suites localizadas
- [e2e/global-teardown.js](<../e2e/global-teardown.js>)
- [e2e/product.spec.js](<../e2e/product.spec.js>)
- [integration/postgres.spec.js](<../integration/postgres.spec.js>)
- [integration/fixtures/legacy.js](<../integration/fixtures/legacy.js>)

Registrar comando, fecha, revisión y resultado real; consultar proyecto.json y el informe del cambio.
