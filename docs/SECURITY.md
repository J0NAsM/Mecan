# Seguridad y modelo de amenazas

## Controles implementados

- Contraseñas derivadas con scrypt y salt aleatorio.
- Tokens de sesión y recuperación almacenados únicamente como SHA-256; cookies HttpOnly, SameSite y Secure en producción.
- CSRF para formularios públicos y autenticados; CSP, HSTS, frame denial, nosniff y política de permisos.
- Rate limit persistente para login y contacto sin almacenar IP/email en claro.
- RBAC granular aplicado en backend; la interfaz filtra acciones y navegación.
- Tenant derivado de sesión y consultas parametrizadas con filtro obligatorio.
- Triggers que rechazan asociaciones cross-tenant críticas aunque se omita una comprobación de aplicación.
- Archivos con ruta contenida, UUID, cuota transaccional, firma PDF/PNG/JPEG/WEBP y descarga privada.
- Auditoría de actor, tenant, sucursal, impersonador, request ID y estado anterior/posterior.
- Errores técnicos solo en logs estructurados; el cliente recibe mensajes seguros.
- Variables de producción validadas al arranque y datos demo prohibidos.

## Operación segura

El proxy debe terminar TLS, limitar tamaño/velocidad, conservar la IP solo si `TRUST_PROXY=true` y proteger `data/`/`storage/`. Los secretos deben provenir de un gestor externo. Monitoree intentos fallidos, impersonación, cambios de permisos, stock, pagos, anulaciones y suspensión.

Antes de alta disponibilidad, PostgreSQL debe habilitar RLS como segunda barrera distribuida. Un análisis SAST/DAST y pentest externo siguen siendo necesarios antes de manejar datos o pagos de clientes a gran escala.
