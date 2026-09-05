# Seguridad

## Controles implementados y verificados

- Scrypt con sal aleatoria; sesión opaca almacenada como hash; cookies HttpOnly/SameSite y Secure en producción.
- Recuperación de contraseña con token hasheado, expiración, un solo uso y revocación de sesiones. La cola conserva temporalmente el enlace para enviarlo y elimina ese payload tras entrega o expiración.
- Cambio obligatorio de clave temporal para empleados. Cambios de rol/acceso invalidan sesiones.
- CSRF en formularios públicos y autenticados, verificación de Origin, CSP sin estilos inline, HSTS, nosniff y bloqueo de frames.
- Rate limit persistente de login, alta, contacto y recuperación; IP/identidad hasheadas.
- Tenant derivado de sesión, filtros parametrizados y guardas de relaciones en base. Pruebas HTTP contra IDs de otro taller.
- Permisos backend para operaciones y vistas, separación de pagos a proveedores respecto de compras y prevención de escalamiento de roles.
- Autorizar trabajos sin cargo y revertir registros financieros requieren permisos específicos, no incluidos por defecto en gerencia/caja/recepción. Reversiones inmutables, motivo obligatorio, idempotencia y contrapartida transaccional de caja.
- Notificaciones financieras restringidas por permiso también al marcar lectura; destinatarios y lecturas protegidos por tenant, sin deduplicación cruzada entre talleres.
- PDF/PNG/JPEG/WebP con firma de contenido, límite de 7 MB, cuota por taller y rutas privadas contenidas. Las descargas son adjuntos; no se publican directorios de almacenamiento.
- Historial auditado de operaciones críticas y errores públicos sin stack traces ni SQL.
- Validación de configuración de producción, copias verificables y bloqueo de restauración con servidor activo.

## Límites explícitos

No se afirma ausencia universal de vulnerabilidades: las pruebas cubren los casos identificados y la implementación revisada. No hay pentest independiente ni certificación.

PostgreSQL no tiene RLS activada en este esquema; los filtros de lectura son responsabilidad de la aplicación. Las claves compuestas y triggers protegen relaciones y propiedad, pero no autorizan por sí solos consultas arbitrarias realizadas por un operador con acceso directo a la base. Las operaciones de dominio revalidan sesión, membresía, permisos y estado bajo bloqueo del tenant. La conexión de producción no puede ser superusuario ni crear roles/bases.

La inspección de firmas de archivos no es un antivirus ni un desarmador de PDF. Proteger el volumen, restringir cuentas del host y evaluar análisis antimalware si el entorno de operación lo exige. Los logos HTTPS externos se cargan en el navegador, sin proxy de descarga ni acceso del servidor a la URL.

SMTP tiene entrega al menos una vez en escenarios de fallos de red; un identificador estable y el reclamo transaccional reducen duplicados, pero no garantizan que todos los receptores dedupliquen.

El gestor de secretos, cifrado del disco, respaldo externo, DNS y TLS dependen del host de producción. No se validaron credenciales ni proveedores externos inexistentes en el entorno.

La aplicación Android instala sus propias actualizaciones, así que ese canal es un punto sensible y
tiene controles propios: el manifiesto anuncia el hash SHA-256 del APK y la app lo verifica antes de
instalar; la descarga debe pertenecer al mismo origen que el servidor configurado, de modo que un
manifiesto no pueda desviar la instalación a otro host; el `applicationId` publicado debe coincidir
con el instalado; y la compilación de publicación **solo admite HTTPS**, porque sobre HTTP en claro
un atacante en la misma red podría sustituir el APK y el hash no protegería —viajaría por el mismo
canal manipulable—. La instalación siempre la confirma la persona en el diálogo de Android; la app
no puede instalar en silencio.

La clave de firma vive fuera de Git y fuera de la imagen Docker. Android solo acepta una
actualización firmada con la misma clave que la instalada: su respaldo es un requisito operativo, no
una recomendación. El puente `window.MecanApp` queda expuesto solo al origen propio, porque la
navegación dentro del contenedor está restringida al servidor configurado y cualquier otro enlace se
abre en el navegador del sistema.

## Comprobaciones antes de publicar

Ejecutar pruebas unitarias/integración y navegador, revisión de dependencias, `production:check`, restauración aislada y verificación de correo/cobro reales. No subir `.env*`, datos, adjuntos, backups o exportaciones a Git.
