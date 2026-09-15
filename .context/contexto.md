# MecanCloud — contexto

Fecha de revisión estructural: 2026-09-14. Identificador: mecan.

## Producto y alcance
Aplicación de gestión con operación y entrega comercial documentadas.

Tecnología y persistencia: Node HTTP/SSR propio; PostgreSQL; Android nativo/WebView

Dependencias y servidor: Node >=24, PostgreSQL, correo y almacenamiento persistente.

## Lectura obligatoria
1. [Contexto general de Vaults](<../../Vaults/jmartinez/Ecosistema/contexto.md>) y [reglas generales](<../../Vaults/jmartinez/Ecosistema/reglas.md>).
2. [Reglas particulares](reglas.md) y [ejecución y validación](ejecucion.md).
3. Documentación y decisiones del componente que vaya a cambiar.

## Límites
No introducir React ni fallback SQLite: los .db antiguos son material legado. Mantener datos, firmas y releases existentes.

## Fuentes técnicas
- [package.json](<../package.json>)
- [movile/build.gradle](<../movile/build.gradle>)
- [movile/app/build.gradle](<../movile/app/build.gradle>)

## Documentación conservada
- [README.md](<../README.md>)
- [docs/ACCEPTANCE.md](<../docs/ACCEPTANCE.md>)
- [docs/ARCHITECTURE.md](<../docs/ARCHITECTURE.md>)
- [docs/FUNCTIONAL_MAP.md](<../docs/FUNCTIONAL_MAP.md>)
- [docs/OPERATIONS.md](<../docs/OPERATIONS.md>)
- [docs/PHASES.md](<../docs/PHASES.md>)
- [docs/POSTGRESQL.md](<../docs/POSTGRESQL.md>)
- [docs/PRODUCTION_INPUTS.md](<../docs/PRODUCTION_INPUTS.md>)
- [docs/RELEASE_REPORT.md](<../docs/RELEASE_REPORT.md>)
- [docs/SECURITY.md](<../docs/SECURITY.md>)

## Estado verificable
La metadata está en [proyecto.json](proyecto.json). STATUS y último despliegue permanecen NO DETERMINADO hasta contar con evidencia. Una revisión documental no valida el funcionamiento de la aplicación.
[Seguimiento de correcciones y dependencias externas](<../../Vaults/jmartinez/Ecosistema/seguimiento.md>).

No copiar versiones, estado de Git o resultados históricos como si fueran hechos permanentes. Al cambiar una fuente técnica, revisar el contexto y actualizar su hash solo después de comprobar coherencia.

<!-- BEGIN ECOSYSTEM DETAILS -->
## Documentos por tarea

- [arquitectura.md](<arquitectura.md>)
- [testing.md](<testing.md>)
- [base-datos.md](<base-datos.md>)
- [despliegue.md](<despliegue.md>)
- [seguridad.md](<seguridad.md>)
<!-- END ECOSYSTEM DETAILS -->
