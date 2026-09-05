# Clave de firma del APK

Este directorio guarda `mecan-release.jks` y `signing.properties`. **Ninguno de los dos se versiona
en Git** y no deben salir de un lugar privado.

## Por qué importa conservarla

Android solo acepta una actualización si el APK nuevo está firmado con la **misma** clave que el
instalado. Si se pierde este archivo:

- las apps ya instaladas dejan de poder actualizarse para siempre;
- la única salida es publicar un APK con otro `applicationId`, desinstalar el anterior en cada
  dispositivo y volver a instalar, perdiendo la sesión guardada.

Por eso: copia `mecan-release.jks` y `signing.properties` a un respaldo cifrado fuera de esta
máquina antes de distribuir la primera versión.

## Reemplazarla por una propia

Si prefieres generar la clave desde cero (por ejemplo, con datos de tu empresa en el certificado):

```powershell
keytool -genkeypair -v -keystore movile/keystore/mecan-release.jks -alias mecan `
  -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12 `
  -dname "CN=Tu Empresa, O=Tu Empresa, L=Tu Ciudad, C=PY"
```

Después actualiza `signing.properties` con `storeFile`, `storePassword`, `keyAlias` y `keyPassword`.
Hazlo **antes** de repartir la primera versión: cambiar de clave más adelante rompe las
actualizaciones de quienes ya la tengan instalada.
