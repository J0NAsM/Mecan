# Persistencia — MecanCloud

Node HTTP/SSR propio; PostgreSQL; Android nativo/WebView

No introducir React ni fallback SQLite: los .db antiguos son material legado. Mantener datos, firmas y releases existentes.

## Fuentes locales
- [docs](<../docs>)

Versión efectiva de una DB remota, último backup y última restauración: NO DETERMINADO. No inferir esos datos de la versión esperada en código. No editar migraciones aplicadas ni ejecutar DDL como efecto del arranque documental.
