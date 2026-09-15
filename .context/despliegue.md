# Despliegue — MecanCloud

Dependencias: Node >=24, PostgreSQL, correo y almacenamiento persistente.

No introducir React ni fallback SQLite: los .db antiguos son material legado. Mantener datos, firmas y releases existentes.

## Artefactos de configuración encontrados
- [compose.yaml](<../compose.yaml>)
- [Dockerfile](<../Dockerfile>)
- [.github/workflows/quality.yml](<../.github/workflows/quality.yml>)

Esto no acredita despliegue efectivo. Host, dominio administrado, certificado, versión desplegada y rollback probado: NO DETERMINADO. Antes de producción comprobar build, datos persistentes, variables privadas, health checks y restauración. No cambiar identidad de volúmenes o redes sin inventariar los existentes.
