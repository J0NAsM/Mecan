# Mecan 1.1 Offline

Distribución portátil de Mecan y biblioteca local de modelos 3D de vehículos. La carpeta se copia
completa a otra PC con Windows y funciona **sin conexión a internet**: aplicación, Node, PostgreSQL,
base de datos, catálogo, modelos, miniaturas e índices están adentro.

La única fase que usa internet es la **recopilación inicial** de modelos. Después, la aplicación solo
lee archivos locales: ningún modelo se vuelve a pedir a internet.

## Uso diario

1. Doble clic en `Iniciar Mecan 1.1 Offline.cmd`.
2. El primer arranque crea la base PostgreSQL en `data/postgres` y deja en `data/PRIMER-ACCESO.txt`
   el usuario y la clave temporal de la consola de plataforma.
3. Se abre `http://127.0.0.1:3111`. Para el taller, crear la cuenta en `/signup` y completar
   **Configuración** con los datos que imprimen los documentos (nombre legal, dirección, ciudad,
   teléfono, email).
4. Cerrar la ventana detiene el servidor y la base.

Puertos por defecto: aplicación `3111`, PostgreSQL `55451` (solo `127.0.0.1`). Si otro programa los
usa, el lanzador lo informa y se detiene; se cambian en `data/offline.json`.
`node tools/launcher/start.js --check` arranca, verifica la salud y los modelos locales, y se detiene.

## Estructura

```
Mecan 1.1 Offline/
├── Iniciar Mecan 1.1 Offline.cmd   lanzador (lo genera el empaquetado)
├── app/                            copia de la aplicación + dependencias de producción (generada)
├── runtime/                        node.exe y PostgreSQL 18 (bin, lib, share) (generados)
├── data/                           base de datos, adjuntos, respaldos, configuración local (privado)
├── models/<categoría>/<marca>/<modelo>/<año o variante>/
│   ├── model.glb                   formato interno único (GLB)
│   ├── model-low.glb               nivel de detalle adicional, si la fuente lo publica
│   ├── thumbnail.webp              miniatura 512×384
│   ├── metadata.json               ficha completa del modelo
│   └── ATTRIBUTION.txt             licencia, autor y fuentes
├── catalog/
│   ├── models.json                 archivos físicos (id, marca, modelo, SHA-256, licencia, fuentes…)
│   ├── vehicles.json               vehículos: AVAILABLE o 3D_NOT_AVAILABLE
│   ├── brands.json · licenses.json · sources.json
│   ├── requested-vehicles.json     vehículos que el taller necesita (editable)
│   ├── license-policy.json         política de licencias (editable)
│   └── report.json                 informe detallado de la última ejecución
├── thumbnails/<id>.webp            miniaturas pequeñas (192×144) para listados
├── cache/                          paquetes descargados una sola vez (no se versiona)
├── INFORME.md                      informe legible de la última ejecución
└── tools/
    ├── downloader/collect.js       recopilación (única fase con internet)
    ├── importer/import-local.js    importación manual sin internet
    ├── converter/convert.js        glTF/OBJ → GLB
    ├── validator/validate.js       revalida SHA-256 y estructura GLB sin internet
    ├── launcher/start.js           arranque portátil
    ├── lib/                        HTTP, ZIP, glTF, OBJ, licencias, catálogo, miniaturas, informe
    └── sources/                    adaptadores: github, open_assets, public_3d, custom
```

Categorías: `cars`, `motorcycles`, `trucks`, `buses`, `vans`, `pickups`, `suv`, `other`.

## Recopilar, importar y validar

Desde esta carpeta (requiere Node ≥ 24; en la PC de origen, también Playwright para las miniaturas):

```powershell
node tools/downloader/collect.js                 # todas las fuentes
node tools/downloader/collect.js --sources=custom,open_assets --no-thumbnails
node tools/importer/import-local.js              # bandeja tools/sources/custom/inbox (sin internet)
node tools/validator/validate.js                 # SHA-256 + estructura; marca INVALID lo alterado
node tools/converter/convert.js entrada.gltf salida.glb
```

Repetir la recopilación es seguro: lo que ya figura en el catálogo con su archivo presente no se
descarga; los paquetes ZIP se reutilizan desde `cache/`. Un fallo individual queda en el informe y
la ejecución continúa.

## Cómo resuelve la aplicación un vehículo

1. Si el vehículo tiene un **modelo 3D asignado** en su ficha, se usa ese.
2. Si no, busca la misma **marca + modelo + año**; si falta el año, una **variante** de la misma marca
   y modelo (año más cercano).
3. Si no hay ninguno, el vehículo queda `3D_NOT_AVAILABLE` y el diagnóstico sigue funcionando con la
   carrocería paramétrica de su tipo. Los modelos **genéricos** solo se ofrecen como referencia
   visual, rotulados como genéricos: nunca reemplazan a una marca o modelo real.

El servidor no hace solicitudes HTTP para esto: lee `catalog/models.json` y sirve el GLB por streaming
desde disco, solo si la ruta está dentro de esta carpeta y el modelo está `VALID`.

## Licencias

Un modelo se incorpora automáticamente solo si **todas** sus licencias permiten redistribución, uso
comercial y obras derivadas (convertir u optimizar es una obra derivada):

- Admitidas: CC0-1.0, CC-BY-4.0, CC-BY-3.0, CC-BY-SA-4.0 (con atribución cuando corresponde).
- Rechazadas: NonCommercial (NC), NoDerivs (ND), licencias de prueba o propietarias
  (p. ej. «Sketchfab Standard»), y todo modelo sin licencia verificable.
- En revisión manual: modelos que incluyen **marcas registradas de terceros** (logos) y repositorios
  hallados por búsqueda, porque la licencia de un repositorio no acredita la procedencia de cada modelo.

Cada modelo conserva su licencia, autor, URL original y la **evidencia** de la licencia (archivo y
texto donde consta). Las licencias CC-BY exigen mostrar la atribución: está en `metadata.json`,
`ATTRIBUTION.txt` y en la página **Modelos 3D** del sistema. Los modelos de Poly Haven se obtienen con
su API pública, que pide acreditar a Poly Haven.

## Fuentes

Configuradas en `tools/sources/sources.config.json` (agregar una fuente no requiere tocar la
aplicación):

| Adaptador | Fuente | Evidencia de licencia |
|---|---|---|
| `open_assets` | Kenney Car Kit, Racing Kit, Toy Car Kit | `License.txt` dentro de cada ZIP (CC0) |
| `github` | Khronos glTF Sample Assets | `metadata.json` por modelo (SPDX) |
| `github` | Kenney Starter Kit Racing | README: «3D models … CC0 licensed» |
| `github` | búsqueda de repositorios | solo descubrimiento: queda en revisión manual |
| `public_3d` | Poly Haven (API) | todos los assets CC0 |
| `public_3d` | Sketchfab (API) | licencia publicada; la descarga requiere token |
| `custom` | bandeja local | `source.json` declarado por quien importa |

**Sketchfab:** la búsqueda es pública, pero descargar requiere un token personal. Con
`SKETCHFAB_API_TOKEN` definido, la recopilación descarga los candidatos con licencia admitida
(CC0/CC-BY/CC-BY-SA) de los vehículos de `requested-vehicles.json`. Sin token quedan registrados como
«pendientes de credencial» en el informe y el vehículo sigue como `3D_NOT_AVAILABLE`.

## Seguridad

Todo archivo descargado es no confiable: solo HTTPS, tamaño máximo, reintentos acotados, verificación
MD5 cuando la fuente la publica, lectura de ZIP en memoria rechazando rutas absolutas, `..`, enlaces
simbólicos y ZIP64, y archivos ejecutables o inesperados ignorados sin extraerse. Los GLB se validan
(firma, versión, tamaño declarado, límites de buffers y accesores, recursos embebidos, extensiones
soportadas por el visor) y se registran por SHA-256. Nada descargado se ejecuta.

## Empaquetar desde el repositorio

```powershell
npm run offline:package            # copia app/, dependencias de producción, Node y PostgreSQL
npm run offline:package -- --no-runtime
```

Nunca copia `.env`, datos, adjuntos ni respaldos del sistema de origen. Para llevar datos existentes
se usa el respaldo/restauración del sistema (`npm run backup` / `npm run restore`) sobre la base local.
