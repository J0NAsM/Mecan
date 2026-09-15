# Arquitectura — MecanCloud

Node HTTP/SSR propio; PostgreSQL; Android nativo/WebView

Aplicación de gestión con operación y entrega comercial documentadas.

## Límites que preservar
No introducir React ni fallback SQLite: los .db antiguos son material legado. Mantener datos, firmas y releases existentes.

## Fuentes
- [docs/ARCHITECTURE.md](<../docs/ARCHITECTURE.md>)
- [package.json](<../package.json>)
- [movile/build.gradle](<../movile/build.gradle>)
- [movile/app/build.gradle](<../movile/app/build.gradle>)

Los detalles existentes se mantienen en sus fuentes; no consolidar componentes por semejanza de nombres.
