# Mapa funcional y alcance de verificación

Este mapa sustituye las declaraciones genéricas de «todo completo» del documento anterior. Estado global: **parcialmente completado; publicación comercial no aprobada**.

| Módulo | Estado real | Evidencia / límite |
|---|---|---|
| Sitio, precios, registro, tenant, propietario y sucursal | Funcional y probado localmente | Alta desde navegador en escritorio/móvil y pruebas de aprovisionamiento transaccional |
| Login, recuperación y cambio de contraseña | Funcional y probado localmente | Sesiones, expiración, revocación, clave temporal, SMTP local real. Falta entrega con el proveedor productivo |
| Onboarding y configuración | Funcional | Datos, moneda, impuesto, zona horaria, garantía, identidad y documentos; validaciones backend |
| Planes, capacidades y límites | Funcional | Resolución central por plan, bandera global y excepción por tenant; validación de uso |
| Suscripción, vencimiento, gracia, suspensión y reactivación | Funcional con pago manual | Pruebas de saldo parcial, impago prolongado, idempotencia y bloqueo administrativo |
| Cobro SaaS automático | Bloqueado por proveedor no elegido | No existe checkout ni adaptador real; no se sustituye por una pantalla simulada |
| Panel maestro, cobranza, soporte y auditoría | Funcional | Navegación real, búsqueda/filtros, registro de pagos, cambios de plan y estado |
| Sucursales, empleados y roles | Funcional | Edición, activación/baja, roles personalizados, límites y sesiones revocadas; no permite editar al propietario ni elevar privilegios |
| Clientes y vehículos | Funcional | Crear/editar/archivar/reactivar, fichas 360, historial, comunicaciones, búsqueda y paginación |
| Agenda y recepción | Funcional | Turno, reprogramación/cancelación, recepción vinculada, zona horaria y relaciones validadas |
| Inspección y diagnóstico | Funcional y probado de extremo a extremo | Captura, secuencia, responsable e integración con presupuesto |
| Presupuestos y autorizaciones | Funcional | Conceptos, precios, versión revisada antes de aprobación y autorización registrada. Lo aprobado queda protegido |
| Orden, técnicos y tiempos | Funcional y probado de extremo a extremo | Asignar, iniciar, pausar/continuar, finalizar, evidencias y estados de trabajo |
| Inventario | Funcional | Apertura, ajuste, reserva, liberación, consumo autorizado, devolución de consumo completo, traslado y costo promedio |
| Compras y deuda a proveedores | Funcional | Solicitud de orden o reposición de stock, proveedor/costo acordado, compra, recepción y pago parcial transaccional |
| Calidad, comprobantes, caja, cobros y entrega | Funcional y probado de extremo a extremo | No factura sin autorización/calidad; no cobra sobre saldo; pagos parciales, corrección auditada de registros erróneos y entrega con garantía. No ejecuta devoluciones bancarias |
| Facturación fiscal | No integrada | Los documentos son internos y lo indican. Falta régimen/proveedor autorizado |
| Garantías y reclamos | Funcional y probado de extremo a extremo | Vigencia, reclamo, vínculo con nueva reparación, autorización sin cargo, costos/stock/calidad, constancia cero, entrega y resolución sin cobros ficticios |
| Reportes y búsqueda global | Funcional | Ventas netas vs cobros, costos/margen por permisos, carga técnica, stock crítico, CSV y búsqueda de facturas/presupuestos |
| Archivos y documentos privados | Funcional | Tenant, ruta contenida, MIME real, cuota y límite; impresión separada sin costos internos |
| Notificaciones | Funcional | Bandeja, SMTP, receptor webhook, reintentos y avisos SaaS. WhatsApp/SMS no están conectados |
| Backups, restauración y exportación | Funcional y probado | Base + adjuntos + hash, restauración real y conservación anterior. Falta destino externo productivo |
| Responsive | Verificado en navegadores de prueba | Chromium: escritorio, notebook, tablet y Pixel; sin desbordamiento de página ni errores de consola en los recorridos probados |
| Despliegue | Preparado, no publicado | Docker/Compose/Caddy/CI/configuración; falta host, dominio, secretos y ejecución de imagen en el entorno final |
| Aplicación móvil Android | Compilada y distribuida, sin prueba en dispositivo | Contenedor de la misma web con actualización propia verificada por hash; APK firmado y servido por /movil. No se probó en un teléfono ni emulador |
| Capacidad y disponibilidad | No certificadas | Runtime PostgreSQL y coordinación por tenant comprobados; despliegue actual de un nodo con adjuntos locales, sin prueba representativa de miles de talleres o alta disponibilidad |

Los casos de uso financieros soportados no realizan transferencias bancarias ni cargos reales. Registran operaciones verificadas por un usuario autorizado; la automatización de pago depende de una pasarela real.

Ver [aceptación](ACCEPTANCE.md), [arquitectura](ARCHITECTURE.md) y la [lista única de datos externos](PRODUCTION_INPUTS.md).
