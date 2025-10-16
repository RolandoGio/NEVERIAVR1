# Estado actual del sistema por rol

Este documento resume cómo está funcionando hoy el backend/local app respecto a autenticación, módulos y permisos para los roles **SUPERSU**, **ADMIN** y **CAJERO**.

## Arquitectura y autenticación
- El servidor Express levanta los módulos de catálogo, recepciones, técnico, promociones, inventario y ventas dentro del mismo proceso y comparte utilidades de sesión, bitácora y salud.【F:app/electron/api.js†L1-L127】
- El inicio de sesión valida código y contraseña, crea una sesión de 30 días y expone `/api/me` para que la UI recupere el rol activo; cualquier petición autenticada recibe `req.user` mediante el inyector global.【F:app/electron/api.js†L33-L101】

## Módulos funcionales

### Catálogo maestro
- Todas las sesiones autenticadas pueden listar categorías y productos con sus presentaciones.【F:app/electron/api.catalog.js†L12-L46】
- Sólo el rol SUPERSU puede crear, actualizar o desactivar categorías y productos, dejando trazabilidad en `AuditLog`. No hay endpoints para ADMIN o CAJERO en estas operaciones.【F:app/electron/api.catalog.js†L19-L95】

### Recepciones de inventario
- Cualquier usuario autenticado puede consultar presets, listar recepciones, ver detalle y la auditoría asociada.【F:app/electron/api.receipts.js†L89-L152】
- La creación deja las recepciones en estado `LOCKED`, genera lotes internos y movimientos de inventario dentro de una transacción con bitácora.【F:app/electron/api.receipts.js†L155-L252】
- El cajero sólo puede editar, bloquear o eliminar una recepción mientras esté `OPEN`; ADMIN y SUPERSU no tienen restricciones por estado y además reciben comentarios automáticos cuando desbloquean o cierran.【F:app/electron/api.receipts.js†L45-L325】
- Las operaciones sobre ítems (agregar, editar, eliminar) validan permisos con la misma regla `canEditReceipt` y registran movimientos y auditoría en cada cambio.【F:app/electron/api.receipts.js†L327-L360】

### Inventario (consultas y conversiones)
- El resumen de stock por SKU, kardex y listado simple aceptan a cualquier usuario autenticado, mientras que los totales agregados (`/summary`) y todo el flujo de conversiones (resolver, convertir, desde recepción, log y reversión) exigen ser ADMIN o SUPERSU.【F:app/electron/api.inventory.js†L15-L360】
- Las conversiones registran salidas y entradas enlazadas, guardan auditoría con la regla aplicada y permiten revertir con guardas anti doble revertido para mantener la trazabilidad.【F:app/electron/api.inventory.js†L92-L360】

### Aperturas técnicas (helado/topping)
- Todos los roles autenticados pueden abrir aperturas si el producto corresponde, consultar listados, detalle, logs y políticas de cierre; el sistema impide duplicar aperturas abiertas por producto/tipo.【F:app/electron/api.tech.js†L8-L258】
- Sólo ADMIN y SUPERSU pueden ajustar contadores; el cierre anticipado exige comentario al cajero mientras que ADMIN/SUPERSU generan uno automático, y SUPERSU puede simular madurez desde la query string.【F:app/electron/api.tech.js†L263-L377】
- Reabrir requiere comentario obligatorio del cajero, autocomenta para ADMIN/SUPERSU y bloquea si ya existe otra apertura `OPEN`. La eliminación restringe al cajero a aperturas `OPEN` con contador 0 (y helados jóvenes) mientras que ADMIN/SUPERSU pueden borrar en cualquier estado.【F:app/electron/api.tech.js†L379-L494】

### Promociones
- Cualquier usuario autenticado puede leer las promociones vigentes y probarlas contra un carrito en memoria mediante `/api/promos/apply`. Sólo ADMIN y SUPERSU pueden sobreescribir `promos.yaml` vía `/api/promos` tras validar las reglas.【F:app/electron/api.promos.js†L284-L313】

### Ventas
- Las rutas de cotización, confirmación, listado, detalle y movimientos sólo permiten acceder a CAJERO, ADMIN o SUPERSU; usan el motor de promociones para aplicar reglas antes de persistir la venta y descargar inventario básico.【F:app/electron/api.sales.js†L16-L439】
- Las promociones de ventas leen el mismo archivo `promos.yaml` y generan líneas de regalo o descuentos, preservando la bitácora de cada venta confirmada con los totales e inventario procesado.【F:app/electron/api.sales.js†L323-L398】

### Interfaz de escritorio
- La aplicación de React en Electron muestra botones según el rol autenticado: sólo SUPERSU ve Catálogo, mientras que los tres roles operativos ven Recepciones y Técnico. El token se almacena en `localStorage` y se reutiliza para `/api/me` y bitácoras rápidas.【F:app/src/ui/main.jsx†L28-L152】

## Resumen por rol

### SUPERSU
- Control absoluto del catálogo maestro (CRUD completo) y parámetros técnicos expuestos en productos y presentaciones.【F:app/electron/api.catalog.js†L19-L95】
- Permisos amplios en recepciones, inventario avanzado, aperturas técnicas, promociones y ventas, incluyendo acciones exclusivas como ajustar contadores sin comentario obligatorio o simular madurez.【F:app/electron/api.receipts.js†L45-L325】【F:app/electron/api.inventory.js†L214-L360】【F:app/electron/api.tech.js†L263-L377】【F:app/electron/api.promos.js†L289-L313】【F:app/electron/api.sales.js†L16-L439】

### ADMIN
- Puede operar recepciones, inventario avanzado, aperturas técnicas (con privilegios de comentario), promociones y todo el flujo de ventas, pero sólo tiene lectura en el catálogo maestro.【F:app/electron/api.catalog.js†L12-L46】【F:app/electron/api.receipts.js†L45-L325】【F:app/electron/api.inventory.js†L214-L360】【F:app/electron/api.tech.js†L263-L494】【F:app/electron/api.promos.js†L289-L313】【F:app/electron/api.sales.js†L16-L439】

### CAJERO
- Puede crear recepciones y operarlas mientras estén `OPEN`, consultar stock/kardex, abrir/cerrar aperturas con las validaciones descritas, consumir promociones existentes y ejecutar ventas completas con el motor de descuentos activo.【F:app/electron/api.receipts.js†L45-L360】【F:app/electron/api.inventory.js†L15-L256】【F:app/electron/api.tech.js†L8-L494】【F:app/electron/api.promos.js†L284-L313】【F:app/electron/api.sales.js†L16-L439】
- No tiene endpoints para editar catálogo, conversiones avanzadas ni para guardar nuevas promociones, por lo que depende de ADMIN/SUPERSU para esos procesos.【F:app/electron/api.catalog.js†L19-L95】【F:app/electron/api.inventory.js†L214-L360】【F:app/electron/api.promos.js†L289-L313】

## Estado de entrega
- ✅ Autenticación por rol, sesiones persistentes y distribución de módulos en Express/Electron.
- ✅ Catálogo maestro operado exclusivamente por SUPERSU con bitácora completa.
- ✅ Recepciones con lotes internos, bitácora y reglas de edición por rol.
- ✅ Inventario con consultas, kardex y conversiones controladas por permisos.
- ✅ Aperturas técnicas de helado/topping con reglas de comentario y contadores.
- ✅ Motor de promociones y flujo de ventas operativos vía API.
- ✅ UI de escritorio para login, home, catálogo, recepciones y módulo técnico.
- ❌ UI dedicada para ventas, promociones avanzadas y conversiones de inventario (hoy sólo API).
- ❌ Panel de laboratorio/feature flags, reportes PDF y envío por Telegram descritos en la visión completa.
- ❌ Workflows extendidos de aprobación de códigos nuevos y parametrización avanzada desde la interfaz.

### Detalle del estado de entrega

| Alcance | Estado | Avance estimado | Qué ya se implementó | Qué falta según documento/flujo objetivo |
| --- | --- | --- | --- | --- |
| Autenticación por rol y módulos en Express/Electron | ✅ | 100 % | Login por código+contraseña, sesiones de 30 días, `req.user` inyectado y todos los módulos montados en el mismo servidor local-first.【F:app/electron/api.js†L1-L127】 | Sin pendientes técnicos; sólo mantenimiento rutinario. |
| Catálogo maestro operado por SUPERSU | ✅ | 100 % | CRUD de categorías/productos exclusivo para SUPERSU con auditoría y control de presentaciones/tipos.【F:app/electron/api.catalog.js†L19-L95】 | Pendientes futuros limitados a mejoras de UI (fuera de este alcance). |
| Recepciones con lotes y reglas por rol | ✅ | 95 % | Creación con estado `LOCKED`, lotes internos, bitácora, permisos diferenciados y edición masiva protegida.【F:app/electron/api.receipts.js†L45-L360】 | Falta incorporar ventana configurable desde UI y flujo de propuestas de códigos nuevos tal como pide el documento maestro. |
| Inventario con consultas, kardex y conversiones | ✅ | 90 % | Consultas por rol, conversiones y reversiones con trazabilidad y guardas anti doble revertido.【F:app/electron/api.inventory.js†L15-L360】 | Aún no hay interfaz para conversiones avanzadas ni parametrización visual de reglas de stock mínimo. |
| Aperturas técnicas helado/topping | ✅ | 95 % | Apertura/cierre, ajustes por rol, reabrir con justificación y bitácora de contadores/aperturas.【F:app/electron/api.tech.js†L8-L494】 | Restan alertas configurables desde UI y panel de investigación descritos en el documento completo. |
| Motor de promociones y ventas vía API | ✅ | 85 % | Motor aplica reglas declaradas en `promos.yaml`, calcula totales, persiste ventas y descarga inventario básico.【F:app/electron/api.sales.js†L16-L398】 | Hace falta UI POS completa, sandbox de pruebas y gestión visual de prioridades/compatibilidades como detalla el documento. |
| UI de escritorio (login/home/catálogo/recepciones/técnico) | ✅ | 80 % | Navegación por rol, pantallas operativas para catálogo (SUPERSU), recepciones y técnico, almacenamiento de sesión en `localStorage`.【F:app/src/ui/main.jsx†L28-L152】 | Pendiente agregar vistas para ventas, inventario avanzado, laboratorio y reportes solicitados. |
| UI dedicada para ventas/promos/conversiones | ❌ | 0 % | No existe pantalla en React para POS, editor de promociones ni conversiones; sólo endpoints API. | Implementar POS completo, editor de promos con prioridades y herramientas de conversión visuales. |
| Panel de laboratorio, reportes PDF y Telegram | ❌ | 0 % | No se ha iniciado desarrollo de toggles, generación de PDF ni cola de envío. | Construir panel de feature flags, generadores HTML→PDF y bot con cola offline según el plan por fases. |
| Workflows extendidos de aprobación de códigos y parametrización avanzada | ❌ | 10 % | Validaciones de permisos actuales impiden editar catálogo sin SUPERSU y registran bitácoras básicas. | Falta UI para aprobar códigos nuevos desde recepciones, extender parámetros globales y permitir al Admin gestionar excepciones desde interfaz. |

## Plan para completar los pendientes

A continuación se detalla cómo puedo implementar cada bloque faltante directamente en el repositorio, incluyendo los archivos a crear o modificar y los comandos de soporte que tendrás que ejecutar cuando quieras verificar cada entrega.

### 1. UI dedicada para ventas, promociones y conversiones

- **Qué haré:**
  - Crear un submódulo `app/src/ui/sales` con componentes como `POSApp.jsx`, `PromoSummary.jsx` y `TicketSidebar.jsx` para la experiencia de caja.
  - Reutilizar el `authFetch` existente añadiendo hooks específicos (`useSalesApi.js`, `usePromoSimulator.js`).
  - Exponer rutas nuevas en `app/src/ui/main.jsx` protegidas por rol (CAJERO, ADMIN, SUPERSU).
  - Añadir vistas de conversión en `app/src/ui/inventory/ConversionPanel.jsx` consumiendo `api.inventory.js`.
- **Comandos para probar:**
  - `npm run dev` para levantar la app Electron y validar navegación.
  - `npm test -- sales` si agregamos pruebas unitarias de hooks (opcional pero recomendado).

### 2. Panel de laboratorio, reportes PDF y bot de Telegram

- **Qué haré:**
  - Crear `app/src/ui/lab/LabApp.jsx` con formularios para editar `config/feature-flags.json`, `config/promos.yaml` y parámetros.
  - Añadir un servicio en `app/electron/services/pdf.js` que use `puppeteer` (o `playwright`) para renderizar plantillas HTML almacenadas en `app/assets/reports`.
  - Implementar cola persistente en `app/electron/services/queue.js` (SQLite vía Prisma) y un worker `telegramQueueWorker.js` con `node-telegram-bot-api`.
  - Agregar comandos `npm run generate:reports` (script que invoca el servicio PDF) y `npm run queue:telegram` para disparar el worker manualmente.
- **Comandos adicionales:**
  - `npm install puppeteer node-telegram-bot-api` (una vez).
  - `npx prisma migrate dev --name add_report_queue` para nuevas tablas.
  - `npm run generate:reports` y `npm run queue:telegram` durante QA.

### 3. Workflows extendidos de aprobación y parametrización

- **Qué haré:**
  - Extender `app/electron/api.receipts.js` con endpoints `/proposed-products` y acciones de aprobación/rechazo.
  - Crear modelos Prisma `ProposedProduct` y `ConfigOverride` y generar migraciones.
  - Implementar en la UI (`app/src/ui/receipts/ProposedProductsPanel.jsx`) una bandeja para que ADMIN solicite y SUPERSU apruebe.
  - Añadir formularios en el panel de laboratorio para configurar ventanas de edición, límites de stock y excepciones por producto.
- **Comandos para actualizar esquema:**
  - `npx prisma migrate dev --name proposed_products_workflow`.
  - `npm run dev` para validar flujos front/back.

### 4. Reportes y bitácora avanzada

- **Qué haré:**
  - Incorporar consultas agregadas en `app/electron/api.reports.js` (nuevo archivo) que generen datasets para ventas, inventario y bitácora.
  - Crear plantillas `app/assets/reports/sales.html`, `inventory.html`, `audit.html`.
  - Exponer en la UI un visor `app/src/ui/reports/ReportsApp.jsx` que consuma los PDFs generados y permita reintentos de envío.
- **Comandos de verificación:**
  - `npm run dev` para generar y descargar reportes desde UI.
  - `npm run generate:reports` para smoke test en consola.

### 5. Alertas configurables y controles anti-abuso

- **Qué haré:**
  - Añadir en Prisma un modelo `AlertRule` y servicios en `app/electron/services/alerts.js` para evaluar condiciones (cierre anticipado, stock, patrones de riesgo).
  - Integrar un job recurrente (`app/electron/jobs/alertRunner.js`) orquestado por `node-cron`.
  - Visualizar alertas en `app/src/ui/lab/AlertsPanel.jsx` con filtros por rol.
- **Comandos requeridos:**
  - `npm install node-cron`.
  - `npx prisma migrate dev --name alert_rules`.
  - `npm run dev` para validar alertas en vivo.

### Flujo general para que puedas replicar los pasos

1. **Actualizar dependencias:** ejecutar los `npm install` que acompañan cada bloque antes de compilar.
2. **Aplicar migraciones Prisma:** correr cada `npx prisma migrate dev --name ...` en orden cronológico cuando se agreguen modelos.
3. **Levantar el entorno local:** `npm run dev` para probar la app y los servicios Electron.
4. **Verificar generación de reportes y colas:** correr `npm run generate:reports` y `npm run queue:telegram` después de configurar credenciales en `.env`.
5. **Ejecutar pruebas puntuales:** si se añaden suites, usar `npm test --scope <módulo>` (agregaré scripts específicos al incluir tests).

Con este plan puedo implementar cada funcionalidad pendiente directamente en el repositorio. Tú solo tendrás que copiar las clases/componentes mencionados o ejecutar los comandos señalados cuando quieras verificar o rehacer los pasos en tu entorno.
