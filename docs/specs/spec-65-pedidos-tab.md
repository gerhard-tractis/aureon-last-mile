# Spec-65: Pedidos — lista global, ficha de pedido e Order Inspector

> **Related:** [spec-54](spec-54-ui-rebrand.md) (rebranding; `1f` quedó pendiente en su fase 4), [spec-42](spec-42-order-inspector.md) (Order Inspector original), [spec-49](spec-49-easy-webhook-dispatch-guide-url.md) (webhook de DispatchTrack), [spec-45](spec-45-module-activation-layer.md) (activación de módulos), `docs/architecture/phased-rollout-strategy.md`

**Status:** in progress

_Date: 2026-08-22_

---

## Goal

Implementar las tres pantallas de **Pedidos** del handoff de diseño **Aureon Rebrand** (Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`):

| Mock | Qué es | Ruta |
|---|---|---|
| `3a` | Lista global de pedidos con vistas guardadas y riel de filtros | `/app/orders` (nueva) |
| `3b` | Ficha de pedido — página dedicada, bitácora unificada, prueba de entrega | `/app/orders/[id]` (nueva) |
| `1f` | Order Inspector — panel lateral de 720px desde cualquier pantalla | `src/components/inspector/**` (rediseño) |

`3a` es **navegación**: el único lugar que muestra todas las órdenes sin importar su etapa.
`3b` es **investigación**: reconstruir qué pasó cuando hay un reclamo.
`1f` es **triage en contexto**: responder "¿qué pasó con esta orden?" sin salir de Despacho o Distribución.

`1f` estaba en el alcance de spec-54 fase 4 y quedó sin implementar (ver spec-54, línea de corrección al plan). Se recupera aquí porque comparte toda su capa de datos con `3b`.

## Fuente de verdad

| Artefacto | Rol |
|---|---|
| `Aureon Rebrand.dc.html`, artboards `3a` / `3b` / `1f` | **Canónico.** Medidas, colores y jerarquía finales. |
| `design_handoff_aureon_rebrand/README.md`, secciones `3a / 3b` y `1f` | Intención de diseño y mapeo prototipo → codebase. |
| Este spec | Registro del lado del repo: decisiones, desviaciones y plan por fase. |

**Regla de precedencia:** cuando el README y el prototipo difieren, gana el prototipo.

> **Nota de versión.** El diseñador revisó `3b` el 2026-08-21: el evento expandido dejó de mostrar el JSON crudo como contenido principal y ahora muestra una rejilla de cuatro campos en lenguaje llano (MOTIVO · INTENTO · UBICACIÓN · RESPALDO) traducidos del webhook, con el payload detrás de *Ver datos técnicos*. Este spec describe la versión revisada. La razón declarada: *"un jefe de operaciones resolviendo un reclamo no debería tener que leer un payload"*.

## Non-Goals

- **Vistas guardadas persistidas por usuario.** Las siete pestañas son presets fijos y el estado vive en la URL. Ver *Decisión 2*.
- **Mutaciones nuevas.** La barra de acciones masivas solo ofrece lo que ya tiene mutación. Ver *Decisión 3*.
- **Backfill de eventos históricos.** `webhook_events` es append-only desde el deploy. Ver *Riesgo aceptado*.
- **Generación de POD en PDF.** El botón "Descargar POD (PDF)" del mock no se implementa: no existe generador de PDF en el repo. Ver *Desviaciones*.
- **Proveedor de mapas real.** El bloque GEOLOCALIZACIÓN de `3b` usa la superficie tokenizada de placeholder (`--color-map-surface` / `--color-map-line`) igual que el resto del rebranding.
- **Variante móvil de `3a` / `3b`.** El handoff no las diseñó. Las páginas colapsan a una columna bajo 1024px, sin rediseño propio.

---

## Decisiones tomadas

### 1. La bitácora se alimenta de una tabla append-only nueva

`3b` necesita el historial evento por evento con su payload, porque la rejilla de cuatro campos se **compone** de los campos del webhook: el motivo sale de `substatus` (que ya viene en español), `accuracy_m: 12` se formatea a *a 42 m de la dirección*, y `signature: null` a *firma no*.

Hoy eso no se puede: `beetrack-webhook` hace **upsert** sobre `dispatches` con `onConflict: operator_id,provider,external_dispatch_id`. Hay una fila por parada, no por evento, y `raw_data` guarda el último payload fusionado (`mergeDispatchRawData`). Cada evento anterior se pisa.

Y el lado Aureon tampoco sirve como destino: `audit_logs.user_id` es `NOT NULL`, así que el webhook —que no tiene usuario— no puede escribir ahí. Hoy no escribe.

**Decisión:** tabla `webhook_events`, append-only, más un `INSERT` en la Edge Function. El upsert de `dispatches` **no se toca** — sigue siendo el estado actual de la parada, y nada que lo consume cambia.

### 2. Vistas: presets fijos, estado en la URL

El mock muestra siete pestañas más "Guardar vista" y "+ Nueva vista". No existe tabla `user_preferences` ni `saved_views` en el repo.

**Decisión:** las siete pestañas son presets en código que escriben los filtros en la URL — que es exactamente lo que pide el handoff (*"los filtros van en la URL para poder compartir una vista"*). **"Guardar vista" copia el enlace compartible** en vez de persistir una fila. "+ Nueva vista" no se implementa.

Razón: compartir una vista sigue funcionando, que es el requisito real; una tabla nueva con RLS y CRUD por una pestaña personalizada no se paga sola en un spec que ya trae tres pantallas y una Edge Function.

**Task 6, ronda 4 — un "Limpiar" compartido no sobrevivía al viaje.** Bug real, no una desviación de diseño: "Limpiar" en una pestaña que implica filtros (p. ej. "En reparto") producía `?vista=en-reparto`, idéntico byte a byte a un enlace que nadie tocó nunca. El destinatario abría ese enlace y veía los filtros de la pestaña reaplicados en silencio, justo lo que la regla "la URL es la única fuente de verdad" existe para evitar. Arreglado con un marcador propio de Task 6 fuera del esquema de Task 4 — `filtros=0` (`CLEARED_PARAM`, igual que `PAGE_PARAM`) — que `handleClearAll`/`handleFiltersChange` escriben cuando el resultado queda vacío, y que la fusión de filtros en `page.tsx` respeta para NO reaplicar los filtros del preset. Sin cambios en `filtersToSearchParams` ni en el contrato de Task 4.

### 3. La barra de acciones masivas solo ofrece lo que existe

El mock lista Reasignar ruta · Marcar excepción · Reintentar entrega · Notificar cliente · Exportar. Solo la última no necesita backend.

**Decisión:** se implementa **Exportar CSV** (cliente, sobre las filas seleccionadas). Las otras cuatro **no se renderizan**. No se renderizan deshabilitadas: un control muerto en una pantalla de operación se lee como roto, no como pendiente. Quedan listadas en *Desviaciones* para que el trabajo siguiente sea visible.

### 4. El ítem de nav "Pedidos" no lleva `ModuleKey`

La lista global de pedidos no es un módulo opcional: cualquier operador que tenga órdenes la necesita. Sigue el patrón de `Dashboard ejecutivo` (sin `module`), con visibilidad por permiso.

**Decisión:** `isVisible` = `admin` · `operations_manager` · permiso `customer_service`. Sin `module`.

**Task 6, ronda 1 — el gate NO vive en un `layout.tsx`.** `/app/orders/new` y `/app/orders/import` son rutas hermanas bajo el mismo segmento `orders/`, y ambas traen su propio gate inline (`ALLOWED_ROLES = ['admin', 'operations_manager']`), un conjunto **más estrecho** que el de arriba (que además admite `customer_service`). Un `layout.tsx` en `orders/` envolvería a las tres rutas y **ampliaría** quién llega a `/new` y `/import`, no la reduciría. Por eso `OrdersClientGate` se importa directo en `apps/frontend/src/app/app/orders/page.tsx`, sin `layout.tsx` de por medio. **No lo "prolijees" a un layout compartido** sin volver a comparar los dos conjuntos de permisos primero — hacerlo le daría acceso a `customer_service` a crear/importar pedidos, algo que hoy no puede hacer.

**Task 6, ronda 4 — flash del gate mientras cargan los permisos, repo-wide, no propio.** `OrdersClientGate` usa `permissions.length > 0` como señal de "claims cargados" (igual que `DispatchClientGate`/`DistributionClientGate`, el patrón que este task debía copiar), no un flag real de carga — un usuario sin acceso ve la lista brevemente antes de la redirección. `useOperatorId()` no expone el `loading: boolean` que `GlobalContext` sí trae internamente (solo reexporta `operatorId`/`role`/`permissions`/`userId`). Arreglarlo de verdad implica extender `useOperatorId()` y tocar cada `*ClientGate` existente — fuera de alcance de Task 6. No se inventó un heurístico local (p. ej. tratar `operatorId` nulo como "cargando") porque puede confundir un usuario legítimo con cero permisos con uno aún cargando, y mostrarle una página en blanco es peor que el flash.

### 5. La clasificación SLA se duplica en SQL, con test de paridad

`3a` filtra, ordena y cuenta por SLA. Hacerlo en el cliente obligaría a traer todas las órdenes; el mock habla de 12.847 en 30 días.

`classifyRisk` (`src/app/app/operations-control/lib/sla.ts`) es hoy la autoridad y vive en TypeScript: ventana efectiva = `rescheduled_*` si las tres columnas están, si no `delivery_*`; `late` si faltan minutos < 0; `at_risk` si ≤ `AT_RISK_HOURS * 60` (6h); `none` si no hay `delivery_window_end`.

**Decisión:** función SQL `order_sla_status(...)` que replica esas reglas, consumida por `get_orders_list` y por `get_nav_counts`. `classifyRisk` sigue siendo la autoridad del cliente para Torre de control. **Un test de paridad** recorre una tabla de casos límite por ambos caminos y exige el mismo veredicto — sin ese test la duplicación se desincroniza sola.

### 6. `3b` y `1f` comparten capa de datos y bloques, no layout

Ambas responden la misma pregunta sobre los mismos datos, pero el mock de `3b` son tres columnas con panel de POD propio: no es el drawer ensanchado.

**Decisión:** un hook `useOrderDossier(orderId)` y cinco componentes de presentación sin fetching (`OrderLifecycleTimeline`, `OrderPackageList`, `UnifiedEventLog`, `ProofOfDelivery`, `WhyLateBlock`). `1f` compone un subconjunto dentro del `Sheet`; `3b` los compone todos en la página. El formateo webhook → lenguaje llano vive en **un** módulo (`lib/orders/event-decoder.ts`) y ambas lo usan.

---

## Riesgo aceptado — la bitácora nace vacía

`webhook_events` no se puede rellenar hacia atrás: los payloads históricos ya se pisaron. Hasta que la tabla acumule, la bitácora de cualquier orden existente muestra su mitad Aureon (desde `audit_logs`) más **una** entrada DispatchTrack derivada del `dispatches.raw_data` actual.

Es decir: **`3b` se va a ver delgada en QA el día uno.** Eso es el dato, no la implementación. Se documenta aquí para que no se diagnostique como bug ni se re-depure (ver `project_qa_stale_bundle_pwa` como precedente del mismo tipo de falsa alarma).

Mitigación en pantalla, no en datos: cuando una orden no tiene ningún `webhook_events`, la bitácora muestra un `EmptyState` explícito — *"Sin eventos de courier registrados. El registro de eventos empezó el DD/MM; las órdenes anteriores a esa fecha solo conservan su último estado."* — y no un vacío mudo.

---

## Modelo de datos

### Tabla nueva: `webhook_events`

```sql
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  provider             routing_provider_enum NOT NULL,
  order_id             UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  external_dispatch_id VARCHAR(100),
  external_route_id    VARCHAR(100),
  event_type           VARCHAR(80) NOT NULL,
  occurred_at          TIMESTAMPTZ NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload              JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Notas de forma, cada una con su razón:

- **`order_id` nullable.** Idéntico a `dispatches.order_id`: el webhook puede llegar antes de que exista la orden. Un evento huérfano se guarda igual y se resuelve por `external_dispatch_id` cuando la orden aparece.
- **Sin `deleted_at`.** Es un registro de lo que un tercero nos mandó, no una entidad del dominio. No se borra suave; no se borra.
- **Sin constraint de unicidad.** Es append-only a propósito: DispatchTrack reenvía, y un reenvío es un hecho que queremos ver en la bitácora, no un duplicado a suprimir. La UI agrupa por `(event_type, occurred_at)` al renderizar.
- **`occurred_at` vs `received_at`.** El primero sale del payload (`time_of_management` → `arrived_at` → fallback `received_at`); el segundo es nuestro reloj. `3b` ordena por `occurred_at` y muestra `received_at` en la línea *"Recibido de DispatchTrack a las HH:MM:SS"*.

Índices:

```sql
CREATE INDEX IF NOT EXISTS idx_webhook_events_order
  ON public.webhook_events(operator_id, order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_dispatch
  ON public.webhook_events(operator_id, provider, external_dispatch_id);
```

RLS: `ENABLE ROW LEVEL SECURITY`, política `SELECT` con `USING (operator_id = public.get_operator_id())` — el mismo helper que usan `dispatches` y `routes` (`20260306000001`, política `dispatches_tenant_isolation`). `INSERT` solo por `service_role` (la Edge Function). Sin `UPDATE` ni `DELETE` para `authenticated`.

### Cambio en `beetrack-webhook`

Un `INSERT` en `webhook_events` **antes** del upsert de `dispatches`, en la misma función. Reglas:

- El insert va antes porque el registro del hecho no debe depender de que el upsert resuelva; si el upsert falla y devuelve 500, DispatchTrack reintenta y tendremos dos eventos — que es correcto, pasaron dos entregas.
- Un fallo del insert **no** aborta el webhook: se registra con `console.error` y el handler sigue. Perder una línea de bitácora es peor que perder el estado de la parada, pero mucho menos grave que rechazar el webhook.
- `event_type` sale de `body.event` cuando viene; si no, se deriva del par `status` / `substatus_code` con la misma lógica que ya usa `dispatchRow`.

### Función nueva: `order_sla_status`

```sql
CREATE OR REPLACE FUNCTION public.order_sla_status(
  p_delivery_date             DATE,
  p_delivery_window_end       TIME,
  p_rescheduled_delivery_date DATE,
  p_rescheduled_window_start  TIME,
  p_rescheduled_window_end    TIME,
  p_delivered_at              TIMESTAMPTZ,
  p_now                       TIMESTAMPTZ
) RETURNS TABLE (sla_status TEXT, minutes_remaining INT)
LANGUAGE sql IMMUTABLE;
```

Devuelve `'late' | 'at_risk' | 'ok' | 'none'` con la misma tabla de verdad que `classifyRisk`. `AT_RISK_HOURS = 6` se declara una vez como constante en el cuerpo y se comenta que su gemelo vive en `sla.ts`.

### Función nueva: `get_orders_list`

```sql
get_orders_list(
  p_operator_id   UUID,
  p_date_from     DATE,
  p_date_to       DATE,
  p_statuses      TEXT[],      -- leading_status, NULL = todas
  p_sla           TEXT,        -- 'late' | 'at_risk' | NULL
  p_route_ids     UUID[],
  p_driver        TEXT,
  p_client        TEXT,        -- retailer_name / tenant_client
  p_comunas       TEXT[],
  p_has_pod       BOOLEAN,
  p_min_attempts  INT,
  p_search        TEXT,
  p_limit         INT,
  p_offset        INT
) RETURNS TABLE (
  id UUID, order_number TEXT, customer_name TEXT,
  leading_status TEXT, package_count INT,
  route_label TEXT, driver_name TEXT,
  sla_status TEXT, minutes_remaining INT,
  last_event_at TIMESTAMPTZ, last_event_label TEXT,
  has_pod BOOLEAN, total_count BIGINT
)
```

`total_count` viaja como columna repetida (`COUNT(*) OVER ()`) para no gastar un segundo round-trip en la paginación. Es un patrón nuevo en este repo: la paginación de Torre de control (`useAtRiskOrders`) pagina **en el cliente** sobre el snapshot completo, lo que aquí no sirve — 12.847 órdenes en 30 días no se traen al navegador para mostrar 12 filas.

Orígenes de cada columna:

| Columna del mock | Origen |
|---|---|
| PEDIDO | `orders.order_number` |
| CLIENTE | `orders.customer_name` |
| ESTADO | `orders.leading_status` → `StatusBadge` |
| PQT | `COUNT(packages)` con `deleted_at IS NULL` |
| RUTA · CONDUCTOR | `orders → dispatches.route_id → routes.external_route_id` + `routes.driver_name` |
| SLA | `order_sla_status(...)` |
| ÚLTIMO EVENTO | el más reciente entre `audit_logs` y `webhook_events` para esa orden |
| POD / SIN POD | `dispatches.raw_data ? 'photo_url'` o `? 'signature'`, solo en filas entregadas |

### Cambio en `get_nav_counts`

Se añade la columna `orders BIGINT` — el conteo de órdenes en `late` o `at_risk`, vía `order_sla_status`, que es el número que el mock muestra en el ítem Pedidos (47) y coincide con el preset por defecto. `countKeyThresholds` gana `orders: 40`.

`CREATE OR REPLACE` sobre la definición de `20260817000001_spec54_nav_counts.sql` — que es la última, según la regla de CLAUDE.md.

---

## Arquitectura de componentes

```
src/app/app/orders/
  page.tsx                        3a — server component, lee searchParams
  _client.tsx                     3a — estado de filtros ↔ URL
  [id]/page.tsx                   3b — ficha
  components/
    OrderViewTabs.tsx             7 presets
    OrderFilterRail.tsx           riel de 230px
    ActiveFilterChips.tsx         chips + "Limpiar"
    OrdersDataTable.tsx           filas de 41px
    OrdersBulkBar.tsx             selección + Exportar CSV

src/components/orders/
  OrderLifecycleTimeline.tsx      línea de tiempo con marca de tiempo por hito
  OrderPackageList.tsx            paquetes + el que bloquea en paleta warning
  UnifiedEventLog.tsx             AUREON + DISPATCHTRACK, rejilla de 4 campos
  ProofOfDelivery.tsx             foto · firma · geolocalización
  WhyLateBlock.tsx                causa compuesta desde datos

src/components/inspector/
  OrderInspector.tsx              1f — recompone los bloques en el Sheet
  (OrderLifecycleRibbon.tsx se elimina — lo reemplaza OrderLifecycleTimeline)

src/hooks/
  useOrdersList.ts                get_orders_list
  useOrderDossier.ts              orden + paquetes + bitácora + POD
src/lib/orders/
  event-decoder.ts                webhook → {motivo, intento, ubicación, respaldo}
  order-view-presets.ts           los 7 presets y su serialización a URL
  orders-csv.ts                   exportación
```

Ningún archivo por sobre 300 líneas. `OrderInspector.tsx` baja de 147 líneas a menos, porque deja de tener markup propio de paquetes e historial.

### `WhyLateBlock` — se compone, no se escribe

El bloque más importante de `1f`. El texto se arma con: etapa donde está detenida + motivo de `REASON_LABELS` (`src/app/app/operations-control/lib/labels.es.ts`) + tiempo en esa etapa + acción sugerida.

**Si la causa no se puede determinar, el bloque no se renderiza.** Nunca un texto genérico. Esto es requisito explícito del handoff y va como test.

### `event-decoder.ts` — formateo, no traducción

**Corrección respecto de la primera versión de este spec (PR #507).** Ese texto decía que hacía falta un mapa de código → etiqueta en español, sembrado desde los valores observados en QA. Es falso, y la consecuencia era una dependencia inventada entre la fase 1 y la fase 4.

**DispatchTrack manda el motivo ya legible.** El webhook trae las dos cosas y las dos se guardan desde `20260306000001`:

| Campo | Tipo | Ejemplo real |
|---|---|---|
| `dispatches.substatus` | `VARCHAR(255)` | `Nadie en casa` · `Dirección incorrecta` · `Rechazado` |
| `dispatches.substatus_code` | `VARCHAR(10)` | `07` · `12` · `05` |

Los ejemplos salen de las fixtures de `ReturnsPanel.test.tsx`, que son la forma real del payload. spec-43 ya lleva ese par a `orders.return_reason` / `return_reason_code` vía `process_failed_delivery`, `ReturnsPanel.tsx` renderiza el código crudo en su columna mono, y existe el rollup `get_failure_reasons`.

Es decir: **no hay tabla de traducción en el repo porque no hace falta ninguna.** La etiqueta viene en el payload.

Lo que sí hace `event-decoder.ts`, y es todo lo que hace:

- **MOTIVO** — `substatus` tal cual. `substatus_code` es la clave estable para agrupar y filtrar, no algo que traducir.
- **UBICACIÓN** — `accuracy_m` → *"a N m de la dirección"*. Si el campo no viene, la fila no se renderiza.
- **RESPALDO** — presencia de `photo_url` y de `signature` → *"Foto sí · firma no"*.
- **INTENTO** — `attempt` cuando viene.

Los códigos en inglés del mock (`CONSIGNEE_ABSENT`) son ilustrativos del diseñador, no nuestro contrato — ver *Desviaciones*.

**Un motivo vacío no se inventa:** si `substatus` viene nulo, el campo MOTIVO muestra `sin motivo informado` y el `substatus_code` al lado, en vez de una etiqueta plausible.

---

## Desviaciones respecto del mock

Cada una es un dato que el schema no tiene. Ninguna se rellena con un placeholder plausible.

| Mock | Qué muestra | Por qué no se implementa |
|---|---|---|
| `3b` / `1f` cabecera | RUT del cliente (`16.482.913-2`) | `orders` no tiene columna de RUT. Se muestra solo el nombre. *(De paso: el placeholder del buscador global dice "Buscar orden, paquete o RUT…" y `useOrderSearch` nunca buscó por RUT — la promesa es falsa hoy. Se corrige el texto.)* |
| `3b` DIRECCIÓN | "Sin conserjería registrada · 2 fallos previos en esta torre" | No existe inteligencia de dirección ni conteo de fallos por edificio. Se omite la línea entera. |
| `3b` ORIGEN DE LOS DATOS | "Eventos recibidos 9 de 14" | No hay noción de total esperado de eventos. Se muestra solo el conteo recibido. |
| `3b` POD | "Descargar POD (PDF)" | No hay generador de PDF en el repo. Botón fuera de alcance. |
| `3a` barra masiva | Reasignar ruta · Marcar excepción · Reintentar entrega · Notificar cliente | Sin mutación existente. Ver *Decisión 3*. |
| `3a` cabecera | "+ Nueva vista" | Sin persistencia de vistas. Ver *Decisión 2*. |
| `3b` bitácora / POD | Motivos en inglés (`CONSIGNEE_ABSENT`) | Ilustrativos del diseñador. DispatchTrack manda `substatus` en español (`Nadie en casa`) más `substatus_code` numérico (`07`). Se muestra lo que llega. |
| `1f` pestañas | "Conversación (N)" | Se implementa, **gated** por `ModuleKey.CONVERSATIONS`. Si el módulo está apagado, la pestaña no existe (no aparece en cero). |
| `3a` pestañas | Conteo en las siete pestañas (47 · 12.847 · 318 · 23 · 61 · 12 · 904) | No existe un RPC de conteo por faceta sobre todo el dataset — traerlos los siete costaría siete queries por carga de página. Solo la pestaña activa muestra su conteo (`total_count` de la query ya hecha); las inactivas no muestran número, ni cero, ni spinner (Task 6, ronda 1). |
| `3a` filtro ESTADO | Conteo por estado en el riel (318 · 23 · 96 · 904 · 12) | Mismo motivo que arriba. `OrderFilterRail.StatusFilterOption.count` es opcional (Task 6, ronda 2 — originalmente se pasó `count: 0`, que la revisión del controller correctamente rechazó por afirmar un dato falso); se omite por completo, sin badge vacío. |
| `3a` filtro RUTA | Todas las rutas, históricas incluidas | `useActiveRoutes` solo cubre rutas con despachos hoy/en curso. Se usa igual (el shape encaja) pero con una leyenda visible bajo el select — "Solo rutas activas" — para que la ausencia de una ruta antigua se lea como límite de la vista, no como que la ruta no existe (Task 6, ronda 2). |
| `3a` cabecera — "Exportar CSV" | Exporta el dataset filtrado completo (12.847 filas en el mock) | `get_orders_list` pagina en bloques de 50 y no existe un RPC de exportación completa. Construir uno (o un loop de páginas en el cliente) es lógica nueva, no wiring — fuera de alcance de Task 6. El botón se llama **"Exportar página (N)"**, con N = filas cargadas en pantalla, precisamente para no prometer más de lo que hace (Task 6, ronda 3 — la etiqueta original, "Exportar CSV", exportaba silenciosamente solo la página cargada junto a un subtítulo con el total real, un bug de confianza: el usuario lo descubre recién al abrir el archivo). Seguimiento recomendado: un RPC `export_orders_list_csv` sin `p_limit`/`p_offset` que reutilice los filtros de `get_orders_list` — se prefiere sobre un loop de páginas en el cliente porque un `totalCount` en los miles no debe bajar cada fila al navegador solo para reserializarla como texto. |

---

## Plan de implementación

Cuatro PRs.

**Dependencia real, ahora acotada.** La fase 4 necesita que la fase 1 esté desplegada y acumulando para que la bitácora tenga filas — pero **no** para saber qué vocabulario usar: el motivo llega legible en `substatus`, así que `event-decoder.ts` se puede escribir y testear sin esperar a ver eventos reales. Las fases 2 y 3 son independientes de la 1 y pueden ir en paralelo.

**Dependencia externa, bloqueante para la fase 1.** El commit `58b3294` (`fix(webhook): adopt our own dispatch row, and move packages not orders.status`, rama `fix/webhook-dupes-and-packages`) no está en `main` ni tiene PR abierto, y toca `beetrack-webhook/index.ts` — el mismo archivo donde la fase 1 añade el `INSERT`. Tiene que mergear antes, o la fase 1 se escribe contra una versión obsoleta del handler.

TDD en todas. Vitest corre local (`npm run test -w apps/frontend`) — ver `project_vitest_cannot_run_locally`.

### Fase 1 — `webhook_events` y el registro de eventos

**PR 1.** Sin UI.

1. Test de la migración: la tabla existe, RLS activa, `authenticated` puede `SELECT` solo su `operator_id`, no puede `INSERT`.
2. Migración `2026XXXX_spec65_webhook_events.sql`.
3. Test en `beetrack-webhook/index.test.ts`: un evento entrante inserta exactamente una fila con `payload` íntegro; dos eventos del mismo `dispatch_id` insertan **dos** filas; un fallo del insert no cambia el status code de la respuesta.
4. `INSERT` en `packages/database/supabase/functions/beetrack-webhook/index.ts`.

**Criterio de salida:** desplegado en QA y con filas acumulándose. Anotar aquí la fecha del primer evento — el `EmptyState` de la bitácora la nombra.

`Primer evento registrado en QA: ____`

### Fase 2 — SLA en SQL y `get_orders_list`

**PR 2.** Sin UI.

1. **Test de paridad SLA** primero: una tabla de ~12 casos (sin ventana · reprogramada parcial · reprogramada completa · vencida por 1 min · en el límite de 6h · entregada) evaluada por `classifyRisk` y por `order_sla_status`, exigiendo el mismo veredicto.
2. `order_sla_status`.
3. Tests de `get_orders_list`: aislamiento por `operator_id` (obligatorio), cada filtro por separado, `total_count` correcto con `p_offset > 0`, orden estable.
4. `get_orders_list` + `get_nav_counts` con la columna `orders`.
5. `useOrdersList` y la extensión de `useNavCounts` / `countKeyThresholds`.

### Fase 3 — `3a`, la lista

**PR 3.**

1. Tests de `order-view-presets.ts`: cada preset serializa a URL y vuelve idéntico; una URL desconocida cae al preset "Todas" sin lanzar.
2. Tests de componentes: `OrderFilterRail` emite el cambio, `ActiveFilterChips` refleja lo aplicado y "Limpiar" vacía, `OrdersDataTable` marca el borde SLA por estado, `OrdersBulkBar` aparece solo con selección.
3. `orders-csv.ts` + test (comillas, comas y acentos en `customer_name`).
4. Implementación, ítem de nav `Pedidos` en `OPERATION_ITEMS`, y `breadcrumbForPath` — ojo: el comentario de `EXTRA_CRUMBS` ya anticipa este caso (*"lo que deja que `/app/orders/new` gane a un hipotético ítem `/app/orders`"*), así que la regla de prefijo más largo debe seguir verde. Test explícito de que `/app/orders/new` sigue rotulando *Nuevo pedido*.

### Fase 4 — `3b` y `1f`

**PR 4.**

1. Tests de `event-decoder.ts`: `substatus` se muestra tal cual; `substatus` nulo → `sin motivo informado` más el código; `signature: null` → *firma no*; `accuracy_m` ausente → el campo UBICACIÓN no se renderiza.
2. Tests de `WhyLateBlock`: con causa determinable compone la prosa nombrando etapa, motivo y tiempo; **sin causa determinable no renderiza nada**.
3. Tests de `UnifiedEventLog`: mezcla ordenada por `occurred_at`, badge de origen correcto, `EmptyState` cuando no hay `webhook_events`, y "Ver datos técnicos" colapsado por defecto.
4. Tests de `ProofOfDelivery`: firma ausente muestra el estado explícito nombrando el campo nulo, no un vacío.
5. `useOrderDossier`, los cinco componentes, `3b`, y el recableado de `OrderInspector` (borrar `OrderLifecycleRibbon`).
6. Actualizar spec-54: marcar `1f` como entregado aquí.

---

## Criterios de aceptación

1. `/app/orders` lista órdenes de todas las etapas, filtra por los siete presets, y la URL resultante abierta en otra sesión reproduce la misma vista.
2. El contador de Pedidos en la sidebar coincide con el total del preset "SLA en riesgo".
3. `order_sla_status` y `classifyRisk` coinciden en toda la tabla de casos límite.
4. Un evento de DispatchTrack en QA aparece en la bitácora de `3b` con su rejilla de cuatro campos traducida, y su JSON accesible bajo *Ver datos técnicos*.
5. Un segundo evento sobre la misma parada aparece como **dos** líneas de bitácora, no una.
6. Una orden sin causa determinable no muestra el bloque "Por qué está atrasada" — ni vacío ni genérico.
7. Una orden entregada sin firma muestra el estado explícito de POD nombrando el campo nulo.
8. Ninguna consulta nueva sin `operator_id`; ningún archivo nuevo sobre 300 líneas.
