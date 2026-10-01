# Diagnóstico visual 3D, presupuestos y documentos del taller

Módulo incorporado para CM PERFORMANCE – Estética Automotriz sobre la operación existente de la
orden de trabajo. No crea clientes, vehículos, órdenes ni presupuestos paralelos: agrega el mapa de
daños por pieza y lo conecta con el presupuesto, la mano de obra, los materiales y la impresión.

## Flujo

Cliente → Vehículo → Recepción (orden) → **Diagnóstico 3D** → Presupuesto → Autorización →
Trabajos, mano de obra y materiales → Calidad → Comprobante → Entrega.

1. En la orden, «Iniciar diagnóstico 3D» abre `/workshop/orders/:id/diagnosis-3d`.
2. Se elige la carrocería (8 tipos), el color, y se selecciona una pieza (clic o lista). La pieza se
   separa, gira hacia la cámara y el resto del vehículo se desvanece (easing cúbico).
3. En modo aislado se pinta el daño con pincel esférico (6–60 cm, smoothstep) por gravedad: Leve,
   Moderado, Grave, Crítico, o se borra. Se registran gravedad de la pieza, zona, descripción, costo de
   reparación, mano de obra, materiales, observaciones y fotografías.
4. El estado se guarda en PostgreSQL (autoguardado, Ctrl+S, al ocultar la página y antes de enviar
   «Finalizar» o «Pasar al presupuesto») con control de revisión: si otra persona guardó antes, el
   guardado se rechaza sin pisar su trabajo y el estudio queda en solo lectura hasta recargar. Sin
   conexión con el servidor, avisa y reintenta solo. Un diagnóstico sin daños también se puede guardar.
5. «Finalizar diagnóstico» completa la inspección y el diagnóstico existentes con el resumen de daños
   y, opcionalmente, pasa los costos al presupuesto; si todavía no hay costos, finaliza igual y no
   agrega conceptos. En estado de presupuesto, «Pasar al presupuesto» agrega lo pendiente.
6. Los documentos se imprimen desde la orden.

El diagnóstico es editable en Recibida, Inspección, Diagnóstico y Presupuesto en preparación. Desde el
envío del presupuesto queda de solo lectura y conserva el historial.

## Datos (migración `003_vehicle_damage_diagnosis.sql`)

Solo agrega columnas opcionales y tablas nuevas:

| Tabla | Cambio |
|---|---|
| `customers` | `tax_id` (RUC), separado de `document` (C.I.) |
| `vehicles` | `body_type` (8 carrocerías), `model_3d_id` (biblioteca local), `notes` |
| `estimates` | `payment_terms` (forma de pago), `work_time_value` + `work_time_unit` (horas/días) |
| `estimate_items` | `vehicle_part` (pieza), `responsible_user_id`, `damage_part_id` (origen en el diagnóstico) |
| `damage_assessments` | uno por orden: carrocería, pintura, notas, revisión, autoría |
| `damage_assessment_parts` | por pieza: gravedad, **presión 0–100 (dato independiente)**, zona, descripción, costos, materiales, trazos del pincel, quién y cuándo |

Los trazos se guardan como sellos `[x, y, z, radio_cm, gravedad]` con la posición normalizada a la
caja de la pieza. Reproducirlos reconstruye el mapa en cualquier carrocería: la escena 3D es solo una
vista de los datos. Guardas PostgreSQL verifican que el diagnóstico sea del vehículo de la orden, que
los autores y responsables pertenezcan al taller y que un concepto solo apunte al diagnóstico de su
propia orden; el tenant de cada fila es inmutable.

## Presupuesto, mano de obra y materiales

- Cada pieza dañada con costo genera, una sola vez por tipo, un concepto **Servicio** (reparación) y
  otro **Mano de obra**, con la pieza y el vínculo al diagnóstico. Una pieza en «Sin daño» no suma
  costo en ningún lado (totales, mapa impreso ni presupuesto). Si se borra un concepto importado,
  vuelve a quedar pendiente solo ese concepto. El cálculo de subtotal/IVA/total es
  el existente (`insertEstimateItem`, extraído de `addEstimateItem`), no uno nuevo.
- Los conceptos manuales admiten pieza y responsable; al autorizar, el responsable pasa a
  `work_order_labor.technician_user_id`. Las revisiones de presupuesto copian estos datos.
- Los materiales siguen siendo artículos de inventario (`PART`); «recibido» es la cantidad realmente
  utilizada en la orden (`active_work_order_parts`), sin un segundo registro de stock.
- La descripción ofrece como sugerencias los servicios del catálogo del taller.

## Documentos (`/workshop/orders/:id/print?type=`)

Usan el mismo motor de impresión que presupuesto, comprobante y entrega, con la identidad del taller
tomada de su configuración:

| `type` | Documento en papel que reemplaza | Contenido |
|---|---|---|
| `materials` | Control de materiales e insumos | Vehículo, cliente, materiales utilizados (o presupuestados), mano de obra aparte, observaciones, monto total, «Verificado por» y firma y sello |
| `damage` | Presupuesto y diagnóstico visual | Lugar y fecha (ciudad de Configuración), interesado, vehículo, mapeo de daños (esquema de las 13 zonas coloreado por gravedad con costos), detalle por pieza, detalles, monto total (el del presupuesto con IVA si ya existe; si no, «estimado sin IVA»), firmas de cliente y encargado |
| `service` | Presupuesto del servicio | Fecha, folio, responsable, cliente con C.I./RUC/forma de pago, vehículo con entrada/salida, detalle del servicio por pieza y responsable, tiempo estimado, lista de materiales con «recibido», subtotal/IVA/total del presupuesto |

## Modelos 3D

- Las 8 carrocerías paramétricas (`public/diagnosis3d/vehicle-configs.js`) son las que se diagnostican:
  13 piezas como `THREE.Group` con `userData` (`isPart`, `partId`, `partName`, `pressure`, `meshes`,
  `paintColor`, `originalVertexColorsData`, `hasDamage`); las puertas traseras solo en carrocerías de
  cuatro puertas.
- La biblioteca local «Mecan 1.1 Offline» (`MODEL_LIBRARY_PATH`) aporta modelos GLB de referencia
  visual. Ver [su README](../Mecan%201.1%20Offline/README.md).
- Three.js 0.160.0 se sirve desde `public/vendor/three` (`npm run vendor:three`); no hay CDN. La CSP
  admite `blob:` solo en imágenes y conexiones para las texturas embebidas en los GLB.

## Permisos

Sin permisos nuevos: ver requiere `orders.view`; editar, `orders.diagnose` (finalizar desde
Recibida también `orders.inspect`); pasar al presupuesto, `orders.estimate`; fotos, `documents.upload`;
imprimir, `orders.print`; catálogo de modelos, `vehicles.view`.

## Verificación registrada (2026-09-28, equipo local, sobre un clúster PostgreSQL 18.6 desechable)

- `node --test`: 78/78, incluidas 3 pruebas nuevas (persistencia por pieza, revisión concurrente,
  validación de trazos y carrocería, paso al presupuesto idempotente, revisión de presupuesto,
  responsable en mano de obra, documentos, aislamiento entre talleres y resolución de la biblioteca).
- `node --test integration/postgres.spec.js`: 10/10 ejecutada aislada (esquema con 76 tablas y 192
  triggers, importación legada SQLite, backup y restauración). Encadenada justo después de la batería
  completa, la limpieza `DROP DATABASE` de la prueba de restauración agotó el statement timeout de 30 s
  2 de 3 veces en este equipo Windows; las aserciones de restauración no fallaron.
- `playwright test`: 15/16; el caso móvil de «operación completa» superó su límite de 90 s bajo carga
  y pasó al repetirse aislado (1,6 min).
- Recorrido en Chromium (escritorio 1440×900, tablet 820, móvil 390): recepción, diagnóstico,
  pintura de daño, guardado, recarga con reconstrucción exacta, mapa de calor, modelo de referencia,
  finalización con 3 conceptos al presupuesto y los tres documentos; sin errores de consola ni
  desbordamiento horizontal.

Pendiente: no se probó en la app Android ni en un teléfono real; el logo del taller sigue limitado a
URL HTTPS (sin conexión se imprime el nombre del taller).
