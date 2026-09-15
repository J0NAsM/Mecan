# Ejecución y validación

## Requisitos y límites
Node >=24, PostgreSQL, correo y almacenamiento persistente.

No introducir React ni fallback SQLite: los .db antiguos son material legado. Mantener datos, firmas y releases existentes.

## Comandos declarados
Ejecutar desde el directorio indicado, después de revisar sus efectos. Esta tabla acredita que existe el script, no que haya pasado recientemente.
Los comandos de prueba pueden escribir archivos o datos. Builds móviles requieren SDK/firma y Maven puede ejecutar pruebas de integración.

| Fuente | Directorio relativo a la raíz | Script o propósito | Comando |
|---|---|---|---|
| [package.json](<../package.json>) | . | start | npm run start |
| [package.json](<../package.json>) | . | dev | npm run dev |
| [package.json](<../package.json>) | . | build | npm run build |
| [package.json](<../package.json>) | . | test | npm test |
| [package.json](<../package.json>) | . | test:e2e | npm run test:e2e |
| [package.json](<../package.json>) | . | test:postgres | npm run test:postgres |
| [package.json](<../package.json>) | . | check | npm run check |

## Configuración y despliegue encontrados
- [compose.yaml](<../compose.yaml>)
- [Dockerfile](<../Dockerfile>)
- [.github/workflows/quality.yml](<../.github/workflows/quality.yml>)

Despliegue efectivo: NO DETERMINADO. No ejecutar Compose, migraciones o arranque contra datos compartidos por inferencia.

## Puertos
Consultar [registro global](<../../Vaults/jmartinez/Infraestructura/Puertos/registro.json>) antes de iniciar varias aplicaciones. Se conservan los puertos actuales; si un proceso ajeno ocupa uno, informar y no detenerlo.

## Cierre de un cambio
Registrar comando, entorno, revisión, fecha y resultado real en proyecto.json o en el informe de validación del cambio. Actualizar documentación afectada y revisar el diff. No confundir la existencia de CI con un resultado aprobado.
