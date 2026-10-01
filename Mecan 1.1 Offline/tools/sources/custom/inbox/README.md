# Bandeja de importación manual

Crea una carpeta por modelo con el archivo 3D (`.glb`, `.gltf` + recursos u `.obj` + `.mtl`) y un
`source.json`:

```json
{
  "brand": "Toyota",
  "model": "Ractis",
  "year": 2012,
  "category": "cars",
  "vehicleType": "hatchback",
  "license": "CC-BY-4.0",
  "author": "Nombre del autor",
  "url": "https://enlace-original",
  "evidence": "Dónde consta la licencia",
  "attribution": "Texto de atribución exigido por la licencia"
}
```

Luego ejecuta `npm run import` dentro de «Mecan 1.1 Offline» (o `node tools/importer/import-local.js`).
No requiere internet. Sin `source.json` el modelo queda en revisión y no se incorpora.
