# DATOS QUE NECESITO QUE ME PROPORCIONES

Esta lista procede de revisar código, configuración, documentación, Git, base local y variables disponibles. No hay `.env` productivo ni credenciales externas utilizables en el entorno. No enviar secretos por chat, adjuntarlos al repositorio ni incluirlos en documentación: colocarlos en el entorno privado de despliegue o indicar la ubicación autorizada en un gestor de secretos.

## 1. Identidad y contactos

| Qué proporcionar | Uso | Obligatorio | Formato / destino |
|---|---|---|---|
| Confirmar **Mecan Cloud** o indicar el nombre definitivo | Sitio, acceso, correos y panel | Sí, confirmar o sustituir | Texto en `APP_NAME` y nombre de plataforma en Panel SaaS |
| Dominio definitivo y acceso autorizado a su DNS | HTTPS, enlaces de recuperación y acceso público | Sí | URL HTTPS en `APP_URL`; host sin protocolo en `PUBLIC_HOST` para Compose |
| Nombre legal del titular o empresa | Identificación del responsable en páginas legales | Sí | Texto en `COMPANY_LEGAL_NAME` |
| Identificador fiscal y país de operación | Identificación comercial y determinación de integración fiscal | Sí para el cierre comercial; indicar expresamente si no aplica | Identificador real en `COMPANY_TAX_ID`; país como texto, sin inventar un registro |
| Dirección comercial real | Contacto e identificación legal | Sí | Texto en `COMPANY_ADDRESS` |
| Email de soporte atendido | Contacto, respuesta comercial y documentación | Sí | Dirección en `SUPPORT_EMAIL`; sustituir `soporte@mecan.local` en el Panel SaaS |
| Teléfono de contacto | Contacto público | Opcional | Texto internacional en `COMPANY_PHONE` |
| Logo definitivo, si se reemplaza la marca textual actual | Identidad visual | Opcional | Archivo SVG/PNG/WebP autorizado o ruta del archivo; no bloquea el resto |

## 2. Administrador de plataforma

| Qué proporcionar | Uso | Obligatorio | Formato / destino |
|---|---|---|---|
| Email real del propietario | Crear y recuperar la cuenta maestra | Sí | `SUPERADMIN_EMAIL` |
| Contraseña inicial privada | Primer arranque sin acceso demo | Sí | Guardar solo en `SUPERADMIN_PASSWORD`, mínimo 14 caracteres; no enviarla aquí |
| Confirmar si la base productiva será nueva o si debe conservarse/importarse otra instalación | Evitar llevar demos o perder datos reales | Sí | «Base nueva» o ubicación de un respaldo existente y alcance autorizado de migración. La base revisada contiene accesos locales/demo |

El alta inicial no reemplaza contraseñas de un administrador ya existente. Si se conservará una instalación, se necesita acceso autorizado a esa cuenta o al procedimiento de recuperación, no publicar su clave.

## 3. Correo transaccional

Elegir SMTP o un receptor webhook real. SMTP ya está implementado y probado contra un servidor SMTP local; falta verificar tu proveedor y dominio reales.

| Qué proporcionar | Uso | Obligatorio | Formato / destino |
|---|---|---|---|
| Transporte seleccionado | Recuperación de acceso y avisos de suscripción | Sí | `EMAIL_TRANSPORT=smtp` o `webhook`; `disabled` es solo desarrollo |
| Host SMTP | Conexión al servicio de correo | Si se usa SMTP | `SMTP_HOST`, nombre de servidor obtenido en la consola del proveedor |
| Puerto SMTP | Conexión segura | Si se usa SMTP | Entero en `SMTP_PORT`, normalmente 587 o 465 |
| Usuario SMTP | Autenticación | Si se usa SMTP | `SMTP_USER`, valor de la sección SMTP del proveedor |
| Contraseña SMTP | Autenticación privada | Si se usa SMTP | Guardar en `SMTP_PASSWORD`; obtener una credencial SMTP o contraseña de aplicación, no una clave inventada |
| Tipo de TLS | Cifrado de transporte | Si se usa SMTP | Para 587: `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`; para 465: `SMTP_SECURE=true` |
| Remitente verificado | Entrega y reputación del correo | Si se usa SMTP | Dirección en `EMAIL_FROM`; confirmar verificación de dominio/remitente en el proveedor |
| Dirección de respuesta distinta del remitente | Respuestas de destinatarios | Opcional | `EMAIL_REPLY_TO` |
| URL del receptor de notificaciones | Alternativa a SMTP o transporte externo configurado | Si se usa webhook | URL HTTPS en `NOTIFICATION_WEBHOOK_URL`; el receptor debe implementar el contrato descrito en OPERATIONS.md |
| Secreto compartido del receptor | Autenticación del webhook | Si se usa webhook | Guardar en `NOTIFICATION_WEBHOOK_SECRET`, mínimo 32 caracteres. El receptor debe usar el mismo valor |

La configuración SMTP se obtiene en el proveedor contratado; no se necesita instalar un plugin ni otorgar acceso al correo personal.

## 4. Planes y reglas comerciales

| Qué proporcionar | Uso | Obligatorio | Formato / destino |
|---|---|---|---|
| Confirmación o reemplazo de planes, precios, moneda y capacidades existentes | Oferta pública y facturación SaaS | Sí | Tabla por plan. Actualmente: Esencial **149.000 PYG/mes**, Profesional **299.000 PYG/mes**, Multi-sucursal **549.000 PYG/mes**. Revisar límites en `/saas/plans` |
| Confirmación del trial, aviso y suspensión | Automatizar vencimientos | Sí | Días enteros. Actualmente: trial 14; aviso desde vencimiento durante 5; gracia hasta el día 10; suspensión desde ese límite |
| Política de reactivación, cancelación, retención y reembolsos | Condiciones de servicio y tratamiento de pagos | Sí | Texto aprobado. La implementación no elimina información por impago; el pago total levanta suspensión financiera, no bloqueos administrativos. Un período ya vencido reinicia un período utilizable al pagar; no hay cargos acumulados mientras está suspendido |
| Moneda/impuesto y garantía predeterminados ofrecidos al taller | Configuración inicial, sin atribuir validez fiscal | Sí, confirmar valores por defecto | Actualmente PYG, impuesto 10%, garantía 90 días y texto editable. Cada taller puede configurar sus reglas |
| Instrucciones reales para pago manual | Permitir que el titular sepa cómo abonar | Sí mientras se use cobranza manual | Texto en `SAAS_PAYMENT_INSTRUCTIONS`: método, beneficiario, cuenta/identificador necesario, referencia y canal de comprobante. Solo datos comerciales que deban mostrarse al cliente |
| Aprobación final de esas reglas | Retirar el bloqueo comercial de configuración | Sí | `COMMERCIAL_CONFIG_APPROVED=true` únicamente después de revisar valores y textos; no es una prueba de integración externa |

## 5. Pago autónomo y facturación fiscal

| Qué proporcionar | Uso | Obligatorio | Formato esperado |
|---|---|---|---|
| Proveedor/pasarela elegida y paquete técnico de la cuenta comercial | Implementar checkout y confirmación automática de pago | Sí para el objetivo de operar sin intervención del propietario | Nombre del proveedor, país, monedas/métodos habilitados, ID de comercio/cuenta, documentación y URLs de sandbox/producción, contrato de webhooks y ubicación privada de credenciales |
| País/régimen fiscal, emisor y proveedor o mecanismo autorizado de facturación | Emitir documentos fiscales reales si el producto debe hacerlo | Sí si se venderá como emisor de factura fiscal | País, identificador del emisor, requisitos de numeración/timbrado/certificados, documentación del proveedor y acceso privado a su entorno de prueba |

Estado real: el código tiene cobranza manual y comprobantes internos. **No existe un adaptador de pasarela ni de facturación fiscal que pueda activarse colocando una clave.** No hay nombres de variables reales de esas integraciones que sea correcto inventar. Se necesita el paquete técnico completo del proveedor elegido para implementar y probar el adaptador; las credenciales se cargarán exclusivamente en su configuración privada. El pago autónomo sigue siendo un bloqueo funcional del objetivo comercial completo, no una integración simulada.

## 6. Textos legales aprobados

| Qué proporcionar | Uso | Obligatorio | Formato / destino |
|---|---|---|---|
| Términos de servicio aprobados | Publicación y registro de aceptación versionada | Sí | Archivo de texto UTF-8; ruta en `TERMS_FILE` |
| Política de privacidad aprobada | Publicación, responsable y tratamiento de datos | Sí | Archivo de texto UTF-8; ruta en `PRIVACY_FILE` |

Los textos deben cubrir el servicio realmente ofrecido, responsables, cobro/cancelación, datos, retención y proveedores aplicables. No redacté condiciones empresariales ficticias. En desarrollo aparecen avisos explícitos; el arranque productivo rechaza la ausencia de documentos.

## 7. Infraestructura y continuidad

| Qué proporcionar | Uso | Obligatorio | Formato esperado |
|---|---|---|---|
| Host/proveedor/región de despliegue y mecanismo de acceso autorizado | Instalar, construir contenedor y validar producción | Sí | Identificación del servidor/proyecto, sistema operativo, recursos, acceso mediante cuenta/llave ya instalada o referencia privada. No pegar una llave SSH |
| Conexión PostgreSQL de producción | Base completa del SaaS; no se solicitará una contraseña de SQLite | Sí | Obtener del proveedor host, puerto, nombre de base, usuario y contraseña; guardar la conexión únicamente en `DATABASE_URL` (`postgresql://usuario:clave-url-encoded@host:puerto/base`). La cuenta necesita su esquema exclusivo, sin SUPERUSER, CREATEROLE, CREATEDB, REPLICATION ni BYPASSRLS. No pegar la URL con contraseña en el chat o Git |
| TLS de PostgreSQL y CA cuando sea privada | Verificar identidad y cifrado del servidor | Sí para conexión remota; CA adicional solo si el proveedor la requiere | `DATABASE_SSL_MODE=verify-full`; certificado CA PEM en una ruta indicada por `DATABASE_SSL_CA_FILE`. Nunca desactivar verificación de certificado. `DATABASE_TRUSTED_NETWORK=true` solo si confirmas red privada controlada sin TLS |
| Confirmación del almacenamiento persistente | Conservar archivos y respaldos | Sí | Volúmenes o rutas en `STORAGE_PATH` y `BACKUP_PATH`; indicar almacenamiento y backup del servicio PostgreSQL. `DATABASE_PATH` identifica la instalación SQLite de origen durante la migración, no el destino productivo |
| Destino externo de backup y acceso privado | Recuperación ante pérdida del host | Sí para operación comercial | Proveedor/ubicación y acceso autorizado; política de cifrado, retención y responsables. El respaldo local diario ya está implementado |
| Objetivos de disponibilidad y recuperación | Dimensionamiento, alertas y prueba operativa | Sí | Usuarios concurrentes previstos, tolerancia de caída, pérdida máxima aceptable de datos y tiempo máximo de restauración. No se asume que la instancia local ya soporte miles de talleres |
| Destino/responsable de alertas | Atender caídas, respaldos o emails fallidos | Sí | Email/canal/servicio de monitoreo existente y acceso autorizado |

## 8. Integraciones opcionales

WhatsApp, SMS y almacenamiento S3 **no son obligatorios para usar el flujo local con correo y archivos privados**. Si forman parte de la oferta de lanzamiento, indicar proveedor, cuenta, capacidades contratadas, documentación y ubicación privada de credenciales en el mismo paquete de información. No hay claves de esos servicios en el código ni se presentan como conectados.

No necesito nombres de tablas, stack tecnológico ni otros datos que ya están en el repositorio. PostgreSQL local de prueba puede prepararse sin tus credenciales productivas. Su credencial temporal se genera fuera de Git y no debe reutilizarse en producción. El esquema `mecan`, los límites del pool y los timeouts tienen valores seguros iniciales; no requieren una decisión tuya para avanzar.
