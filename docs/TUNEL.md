# Publicar el sistema con un túnel

El sistema sigue corriendo en esta PC. El túnel solo le da una dirección HTTPS pública y estable,
abriendo la conexión desde adentro hacia afuera: no hay que abrir puertos en el router ni reglas en
el firewall, y no importa que el proveedor de internet cambie la IP.

Lo que cuesta: **la PC tiene que estar prendida y con internet**. Si se apaga, se suspende o se
queda sin red, el sistema deja de estar disponible para todos los teléfonos, no solo para esta
máquina. No hay copia del sistema en la nube; el túnel es un caño, no un servidor.

Agente elegido: **ngrok**.

---

## Antes de empezar: una cuenta abierta

En modo desarrollo el sistema crea cuentas con claves que están escritas en el repositorio. Mientras
esto solo escuchaba en la red local no era grave. Publicado en internet es una puerta abierta a la
consola SaaS completa, y los barridos automáticos encuentran un dominio nuevo en horas.

| Cuenta | De dónde sale la clave | Qué hacer |
|---|---|---|
| Superadministrador de la plataforma | La fija el arranque si no existe ninguna cuenta, y está escrita en [src/seed.js](../src/seed.js) | Cambiarla desde el sistema antes de publicar |
| Usuarios del taller demo | Igual, en el mismo archivo | `SEED_DEMO=false` evita que se vuelvan a sembrar |

El arranque no rota esas claves solo: crea la cuenta únicamente si no existe ninguna, así que
cambiarla desde el sistema es definitivo. Si el taller demo tiene datos de mentira que no querés
accesibles, borrarlo.

Esto no queda librado a que alguien se acuerde. **El servidor se niega a arrancar si `APP_URL` es
una dirección pública y la contraseña de administrador es una de las obvias**
([src/server.js](../src/server.js)), porque publicar así es dejar la consola SaaS abierta. Si
necesitás arrancar igual, justamente para entrar a cambiarla, `ALLOW_WEAK_ADMIN=true`.

---

## Paso 1 · Habilitar el agente (necesita administrador)

Windows Defender clasifica ngrok como aplicación potencialmente no deseada: es una detección
genérica que Microsoft aplica a las herramientas de túnel porque el ransomware las usa para sacar
datos. En esta PC está comprobado dos veces. Instalado con winget, Defender eliminó el binario y el
reintento de instalación falló a mitad de la descarga. Bajado del sitio oficial de ngrok, el archivo
quedó en disco, pero al ejecutarlo Windows respondió que «contiene un virus o software
potencialmente no deseado» y acto seguido también lo borró.

Por eso el orden importa: **primero la exclusión, después la descarga**. Al revés, el archivo
desaparece.

**1. Excluir la carpeta.** PowerShell **como administrador**:

```powershell
$carpeta = "$env:LOCALAPPDATA\Programs\ngrok"
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
Add-MpPreference -ExclusionPath $carpeta
```

**2. Bajar el agente.** PowerShell normal, sin administrador:

```powershell
$carpeta = "$env:LOCALAPPDATA\Programs\ngrok"
Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile "$carpeta\ngrok.zip" -UseBasicParsing
Expand-Archive -Path "$carpeta\ngrok.zip" -DestinationPath $carpeta -Force
Remove-Item "$carpeta\ngrok.zip"
& "$carpeta\ngrok.exe" version
```

Si el último comando imprime la versión, quedó. `scripts/tunnel.js` busca el agente en esa carpeta,
así que no hace falta tocar el PATH.

La exclusión cubre esa carpeta y nada más. Se eligió una carpeta creada para esto, y no la de
paquetes de winget, justamente para que no termine cubriendo software que se instale después: lo que
se deje ahí adentro no lo revisa el antivirus.

Es una decisión con costo real. Si preferís no tocar Defender, la alternativa es cambiar de agente
—Tailscale y Cloudflare no están marcados—, y lo único que cambia de esta guía son los pasos 1 y 2:
`APP_URL`, el APK, el script del túnel y el resto quedan igual.

## Paso 2 · Cuenta, token y dominio

1. Crear la cuenta en <https://dashboard.ngrok.com>.
2. Copiar el *authtoken* de **Your Authtoken** y registrarlo una sola vez:

   ```powershell
   & "$env:LOCALAPPDATA\Programs\ngrok\ngrok.exe" config add-authtoken TU_TOKEN
   ```

3. En **Domains**, crear el dominio estático que incluye el plan gratuito. Queda algo del tipo
   `algo-algo-1234.ngrok-free.app`. Anotalo: esa es la dirección del sistema.

El dominio tiene que ser **fijo**. Un túnel sin dominio da una dirección nueva en cada arranque, y
con eso se rompen dos cosas a la vez: el servidor rechaza todo formulario cuyo origen no coincida
con `APP_URL`, y la app Android exige que la actualización venga del mismo origen que tiene
configurado. Habría que reconfigurar cada teléfono cada vez que se reinicia la PC.

## Paso 3 · Configurar `.env`

```ini
APP_URL=https://TU-DOMINIO.ngrok-free.app
TRUST_PROXY=true
```

`APP_URL` es la única fuente de la dirección pública: de ahí la lee el script del túnel, la
comprobación de origen del servidor y la app. No hay una segunda variable con el dominio, para que
no puedan quedar diciendo cosas distintas.

`TRUST_PROXY=true` es necesario porque ahora todas las visitas llegan a través del agente. Sin eso,
el registro de auditoría y el límite de intentos de acceso verían siempre la misma IP local y no la
de quien realmente entró.

No hace falta tocar `PUBLIC_HOST`: es solo para el despliegue con Compose y Caddy.

## Paso 4 · Arrancar

El acceso directo del escritorio ya lo hace todo: prepara la base, levanta el servidor, abre el
túnel cuando el servidor responde y abre el navegador en la dirección pública.

```powershell
npm run desktop:start
```

Si el servidor ya está corriendo y solo querés el túnel:

```powershell
npm run tunnel
```

El script no le cree al agente: después de levantarlo consulta `/health` **saliendo a internet y
volviendo**, y recién entonces dice que está abierto. Que ngrok informe «tunnel established» no
prueba que la dirección pública llegue a este sistema.

## Paso 5 · Republicar la app

El APK guarda una dirección de servidor sugerida. Para que los teléfonos nuevos ya vengan apuntando
al túnel:

```powershell
npm run mobile:publish -- --bump --version 1.1.0 --server https://TU-DOMINIO.ngrok-free.app --notes "Ahora funciona desde cualquier red"
```

Con el túnel andando ya sirve el **APK de publicación** (el firmado), que hasta ahora no se podía
usar porque exige HTTPS. Y como el servidor es alcanzable desde cualquier lado, la autoactualización
funciona de verdad: la app consulta `/movil/actualizacion.json`, descarga, verifica la huella
SHA-256 e instala.

Los teléfonos que ya tengan la app instalada no se enteran solos del cambio de dirección: hay que
entrar una vez a **Cambiar servidor** y escribir la nueva.

---

## Qué cambia en el día a día

**El sistema se usa por la dirección del túnel, también desde esta PC.** Entrar por
`http://localhost:3000` va a mostrar las pantallas pero va a fallar al guardar cualquier formulario,
porque el servidor rechaza los POST cuyo origen no coincide con `APP_URL`
([src/server.js:3700](../src/server.js#L3700)). No es un error: es la protección contra CSRF
haciendo su trabajo. Usá siempre la dirección pública.

**Las cookies ahora viajan marcadas como `Secure` y se envía HSTS.** Antes eso dependía de
`NODE_ENV=production`, que acá no se puede activar porque exige tener cargados todos los datos
comerciales. Ahora depende de si `APP_URL` es HTTPS, que es lo que corresponde: lo que protege el
transporte no tiene por qué esperar a que esté lista la facturación.

**La pantalla de aviso de ngrok.** El plan gratuito intercala un aviso antes de mostrar el sitio a
cualquier navegador. Dentro de la app no aparece: el WebView usa un User-Agent propio cuando el
servidor es un dominio de ngrok, y así ngrok no lo trata como navegador
([MainActivity.java](../movile/app/src/main/java/py/softshop/mecan/MainActivity.java)). Desde un
navegador de escritorio sí vas a verlo, una vez por sesión, con un botón para continuar.

**Los límites del plan gratuito** (tráfico, conexiones simultáneas, un solo agente conectado a la
vez) están en el panel de ngrok. Si el taller crece, el paso siguiente natural es un dominio propio
—que además saca el aviso— y con eso `APP_URL` cambia a la dirección definitiva y nada más.

## Que sobreviva a un reinicio

El túnel y el servidor viven mientras la ventana esté abierta. Para que vuelvan solos cuando la PC
se reinicie, crear una tarea programada al iniciar sesión (**PowerShell como administrador**):

```powershell
$accion = New-ScheduledTaskAction -Execute "$env:ProgramFiles\nodejs\node.exe" `
  -Argument "scripts\start-desktop.js" -WorkingDirectory "C:\Proyectos\Personal\Mecan"
$disparador = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "Mecan" -Action $accion -Trigger $disparador -RunLevel Limited
```

Conviene además desactivar la suspensión del equipo: una PC dormida es una PC apagada para quien
intenta entrar desde la calle.
