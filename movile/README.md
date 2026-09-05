# Aplicación Android

Contenedor nativo de la aplicación web del taller, con actualización propia desde el servidor.

La app **no reimplementa** el sistema: carga la misma aplicación web SSR, de modo que órdenes,
clientes, vehículos, inventario, compras, caja, reportes, permisos por rol y consola SaaS son
exactamente los que ya están probados en el navegador, sin una segunda versión que pueda quedar
atrasada. Lo que agrega es lo que un navegador no da: icono propio, sesión persistente, subida de
archivos y descargas con la sesión vigente, pantalla de reintento sin conexión y, sobre todo,
**instalación de sus propias actualizaciones**.

| | |
|---|---|
| Identificador | `py.softshop.mecan` (no cambiarlo: Android lo usa para identificar la app instalada) |
| Mínimo | Android 8.0 (API 26) |
| Compilado contra | API 36 |
| Lenguaje | Java 17, sin Kotlin ni dependencias de terceros fuera de AndroidX |
| Tamaño | ~0,6 MB |

## Cómo se actualiza

1. `publish-release.js` compila el APK firmado y deja en `releases/` el archivo y un `manifest.json`
   con `versionCode`, `versionName`, tamaño y huella SHA-256.
2. El servidor sirve ese manifiesto en `GET /movil/actualizacion.json` y el archivo en
   `GET /movil/apk/<nombre>`. Solo anuncia una versión si el APK existe en disco y su tamaño
   coincide con el declarado: un manifiesto suelto o una copia a medio terminar no llega a los
   dispositivos.
3. La app consulta el manifiesto al abrirse (como máximo una vez cada 6 horas) y siempre que se
   pulse **Buscar actualizaciones** en `/movil`.
4. Si hay una versión mayor, la descarga mostrando progreso, comprueba la huella SHA-256 y se la
   entrega al instalador de Android, que pide confirmación a la persona.

Comprobaciones antes de instalar: el `applicationId` publicado debe coincidir con el instalado, el
`versionCode` debe ser mayor, la descarga debe pertenecer al mismo origen que el servidor
configurado —un manifiesto no puede desviar la instalación a otro host— y el hash debe coincidir. La
compilación de publicación solo admite HTTPS, porque sobre HTTP en claro un atacante en la misma red
podría sustituir el APK y el hash no protegería: viajaría por el mismo canal manipulable.

Una versión pospuesta no vuelve a interrumpir sola; una marcada con `--mandatory` no se puede
posponer.

## Publicar una versión

```powershell
npm run mobile:publish -- --bump --version 1.1.0 --notes "Qué cambió"
```

| Opción | Efecto |
|---|---|
| `--bump` | Incrementa `versionCode` en uno |
| `--version <nombre>` | Fija `versionName`, por ejemplo `1.1.0` |
| `--version-code <n>` | Fija `versionCode` explícitamente |
| `--server <url>` | Servidor sugerido dentro de la app (debe ser `https://`) |
| `--notes <texto>` | Texto que verá la persona en el aviso |
| `--mandatory` | La versión no se puede posponer |
| `--keep <n>` | APK anteriores conservados en `releases/` (por omisión 3) |

`app/version.properties` es la única fuente de la versión y solo este script la cambia, para que el
APK instalado y el manifiesto servido no puedan describir cosas distintas. El script rechaza
publicar un `versionCode` menor o igual al ya publicado, y si la compilación falla restaura la
versión anterior en lugar de dejarla adelantada.

## Firma

`keystore/` guarda la clave con la que se firma el APK y **no se versiona**. Android solo acepta una
actualización firmada con la misma clave que la instalada: perderla deja sin actualizaciones a todos
los dispositivos. Respaldarla fuera de esta máquina antes de repartir la primera versión es parte de
la entrega. El detalle y cómo reemplazarla por una propia están en [keystore/README.md](keystore/README.md).

## Con el sistema publicado por un túnel

Mientras el sistema solo escuchaba en la red local por HTTP, el APK de publicación no servía:
exige HTTPS. Con el túnel andando ([docs/TUNEL.md](../docs/TUNEL.md)) esa es la compilación que
corresponde usar, y la actualización automática pasa a funcionar de verdad, porque el servidor es
alcanzable desde cualquier red y no solo desde la casa.

Al publicar conviene fijar la dirección para que los teléfonos nuevos ya vengan apuntando:

```powershell
npm run mobile:publish -- --bump --version 1.1.0 --server https://TU-DOMINIO.ngrok-free.app
```

Los teléfonos que ya tienen la app no cambian solos de dirección: hay que entrar una vez a
**Cambiar servidor**.

Sobre dominios de ngrok el WebView usa un User-Agent propio en lugar del suyo. El plan gratuito
intercala una pantalla de aviso ante cualquier petición con User-Agent de navegador, y dentro de
la app eso dejaría la sesión trabada en un aviso que nadie puede aceptar. `UpdateManager` ya usaba
ese mismo User-Agent, y por eso el manifiesto y la descarga del APK nunca chocaron con el aviso
aunque la navegación sí lo hiciera.

## Servidor inicial: la app no pregunta

Al abrirse, la app carga el servidor que trae compilado y solo muestra la pantalla de
**Servidor del taller** si no tiene ninguno. La dirección sale de `app/version.properties`, con
una clave por tipo de compilación:

| Clave | La usa | Contenido |
|---|---|---|
| `defaultServerUrl` | Publicación | La dirección pública. La fija `publish-release.js --server`. Solo `https://` |
| `debugServerUrl` | Depuración | El servidor de la red local, que es `http://` |

Están separadas a propósito. Con una sola clave, la dirección en claro del servidor de pruebas
terminaría dentro del APK firmado: ahí no cargaría —esa compilación no admite tráfico en claro— y
además abriría la puerta que justamente cierra el requisito de HTTPS, porque sobre HTTP alguien en
la misma red puede sustituir el APK de una actualización y la huella SHA-256 no protegería.

Lo que la persona guarda desde la app tiene prioridad sobre lo compilado, así que **Cambiar
servidor** sigue sirviendo para mover un teléfono a otra dirección sin recompilar.

## Compilar sin publicar

```powershell
cd movile
.\gradlew.bat assembleDebug     # apunta a un servidor HTTP de la red local, para probar
.\gradlew.bat assembleRelease   # firmado, solo HTTPS
```

La compilación de depuración instala en paralelo (`py.softshop.mecan.debug`), así que no pisa la
versión de publicación en el mismo teléfono.

`local.properties` apunta al SDK de Android de esta máquina y tampoco se versiona; en otra máquina
hay que regenerarlo con la ruta correspondiente.

Los APK listos para instalar a mano quedan en `apk/`, con una copia de cada compilación y su huella
SHA-256. Es una carpeta de artefactos: no se versiona y se regenera con `gradlew`.

## Estructura

```
movile/
  app/
    version.properties         Versión publicada y servidor inicial de cada compilación
    src/main/java/py/softshop/mecan/
      MainActivity.java        WebView, navegación, descargas, subida de archivos, puente MecanApp
      UpdateManager.java       Consulta, descarga, verificación e instalación de la actualización
      ServerSetupActivity.java Pantalla para indicar la dirección del servidor
      Prefs.java               Servidor configurado y control de cuándo consultar
    src/debug/                 Configuración de red que permite HTTP solo al compilar en depuración
  scripts/publish-release.js   Compila, firma, calcula la huella y escribe el manifiesto
  releases/                    APK publicados y manifest.json que lee el servidor
  keystore/                    Clave de firma (fuera de Git)
```

## Puente con la web

Dentro de la app existe `window.MecanApp` con `isApp()`, `versionName()`, `versionCode()`,
`serverUrl()`, `checkForUpdates()` y `openSettings()`. `public/app.js` lo detecta y solo entonces
muestra el botón **Buscar actualizaciones** y la versión instalada. La navegación queda restringida
al servidor configurado —cualquier otro enlace se abre en el navegador del sistema—, de modo que el
puente únicamente queda expuesto al origen propio.

## Límite de la verificación

El APK compila, queda firmado y su distribución y descarga están probadas contra el servidor real
(`tests/mobile-release.test.js`). El comportamiento en un teléfono —instalación, sesión, subida de
archivos y el ciclo completo de actualización sobre una versión previa— **no se probó**: este
entorno no tiene emulador ni dispositivo conectado. Es una verificación pendiente, no una
funcionalidad ausente.
