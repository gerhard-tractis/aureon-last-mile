# Spec-54: Rebranding de la UI de operaciones

> **Related:** [spec-42](spec-42-order-inspector.md) (Order Inspector), [spec-29](spec-29-ops-control-mission-deck.md) (Ops Control), [spec-45](spec-45-module-activation-layer.md) (module activation drives nav visibility), `docs/architecture/phased-rollout-strategy.md`

**Status:** in progress

_Date: 2026-08-13_

---

## Goal

Rebranding completo de la UI de operaciones contra el handoff de diseño **Aureon Rebrand** (Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`), con dos objetivos declarados en el handoff:

1. Que un **jefe de operaciones** entienda de un vistazo qué requiere acción.
2. Que un **supervisor de bodega / conductor** pueda operar en móvil sin fricción y sin conexión.

El handoff cubre 12 pantallas (6 escritorio, 5 móvil, 1 panel lateral), un sistema de tokens con tema claro y oscuro, y una nueva arquitectura de navegación.

## Fuente de verdad

| Artefacto | Rol |
|---|---|
| `Aureon Rebrand.dc.html` (Claude Design) | **Canónico.** Medidas, colores y jerarquía finales. La opción `2a` es la pantalla de referencia tokenizada. |
| `design_handoff_aureon_rebrand/README.md` | Intención de diseño, mapeo prototipo → codebase, plan de fases. |
| Este spec | Registro del lado del repo: decisiones, desviaciones y estado por fase. |

**Regla de precedencia:** cuando el README y el prototipo difieren en un valor, **gana el prototipo** (es la versión hifi). Las discrepancias detectadas están listadas abajo.

## Non-Goals

- Proveedor de mapas real. Los mapas son superficies tokenizadas de placeholder (`--color-map-surface` / `--color-map-line`) con overlays de datos reales. Integrar Mapbox/MapLibre/Google es un spec aparte.
- Variante `1b` *map-first* (`/app/operations-control?view=map`). Diferida — se implementa después de que `2a` esté en producción, si se pide.
- Cambios en la capa de datos. TanStack Query, los hooks de `src/hooks/**`, Dexie y `syncManager` se usan tal como están.
- Nuevas librerías de UI. Se mantiene shadcn-ui + Tailwind + `lucide-react`.
- Cambios de routing. Las rutas siguen siendo las de `src/app/app/**`.
- Rediseño de la landing (`src/app/(landing)/**`). Fuera de alcance: conserva Fraunces y su paleta.

## Decisiones tomadas

1. **Tema en móvil: el usuario elige.** El handoff recomendaba *forzar* oscuro en las pantallas de escaneo móvil. Se descarta. Las 5 pantallas móviles se implementan tokenizadas en claro y oscuro, y el toggle es alcanzable desde móvil. Razón: el operario trabaja tanto en bodega con poca luz como en la calle a pleno sol; imponer un tema resuelve un caso y rompe el otro.
2. **Archivo no reemplaza a Fraunces.** `--font-display` (Fraunces) lo usa casi en exclusiva la landing (`src/app/(landing)/**` + `dashboard/components/Chapter.tsx`). Se añade un token nuevo `--font-heading` → Archivo para la app, y la landing queda intacta.
3. **Contadores de la sidebar: una sola consulta.** El README nombra cuatro hooks (`useDistributionKPIs`, `useDispatchKPIs`, `usePendingManifests`, `useIncomingRoutes`). Ejecutar los cuatro en cada página del producto son cuatro round-trips permanentes por navegación. En su lugar se reutiliza `usePipelineCounts`, que ya existe y ya resuelve todas las etapas en **una** llamada al RPC `get_pipeline_counts`, con `staleTime` 30s y `refetchInterval` 60s.
4. **El azul `info` no se elimina del theme.** El handoff pide sacarlo de la UI de operación, y así se hace — pero `--color-status-info*` se conserva en `globals.css` porque lo consumen módulos fuera de este alcance. Se deja de usar en las pantallas rediseñadas.

## Discrepancias prototipo vs README

Resueltas a favor del prototipo:

| Token | README | Prototipo (usado) |
|---|---|---|
| success (claro) | `#22c55e` / `#dcfce7` | `#10b981` / `#ecfdf5` / borde `#a7f3d0` |
| warning-bg (claro) | `#fef9c3` | `#fffbeb` |
| error-bg (claro) | `#fee2e2` | `#fef2f2` |
| accent-muted (claro) | `#fef9c3` | `#fffdf5` |

Además, el prototipo usa tres tokens que el README no lista y que hacen falta para reproducirlo:

- `--color-status-{success,warning,error}-text` — el color de texto sobre el tinte de estado. Hoy no existe; los componentes lo improvisan.
- `--color-sidebar-raised` — fondo de los badges de contador en la sidebar.
- `--color-accent-foreground` ya existe pero con el valor equivocado para el botón primario del rediseño (`#ffffff` en vez de `#2b2620`).

## Fases

Cada fase es un PR revisable por separado. El handoff advierte explícitamente contra un PR único: tocaría `dispatch`, `distribution`, `pickup` y `reception` a la vez con 72 tests que mantener verdes.

| Fase | Alcance | Estado |
|---|---|---|
| **1 — Tokens y tipografía** | `globals.css`, `tailwind.config.ts`, `layout.tsx` (fuentes). Sin tocar componentes. | ✅ #401 |
| **2 — Shell** | `AppLayout.tsx`, `components/sidebar/*`, `TopBar` nuevo, `ThemeToggle` al topbar. | ✅ #403, breadcrumb #407 |
| **3 — Primitivos compartidos** | `MetricCard`, `StatusBadge`, `EmptyState`, fila de tabla, campo de escaneo, bloque de resultado de escaneo, tarjeta de andén, barra apilada. | ✅ #408 |
| **4 — Módulos, uno por PR** | Torre de control ✅ → Despacho ✅ → Distribución ✅ → Recogida ✅ → Recepción ✅ → móvil `1h` ✅ `1i` ✅ `1k` ✅, `1g` bloqueada. | ✅ salvo `1g` |
| **5 — Opcional** | Variante `1b` y proveedor de mapas. | diferida (non-goal) |

---

## Fase 1 — Tokens y tipografía

**Archivos:** `src/app/globals.css`, `tailwind.config.ts`, `src/app/layout.tsx`

### Tokens añadidos

Los tres bloques de modo (`html.light`, `html.dark`, `html.custom`) reciben:

```css
--color-border-strong   /* bordes de botones secundarios y casillas */
--color-text-body       /* texto de párrafo y celdas de tabla */
--color-map-surface     /* fondo del lienzo de mapa */
--color-map-line        /* vialidad y contornos */
--color-sidebar-raised  /* fondo de badges de contador en la sidebar */
```

Y los tokens de estado ganan una variante de texto:

```css
--color-status-success-text
--color-status-warning-text
--color-status-error-text
```

### Valores ajustados

Alineados con el prototipo: `--color-accent-muted`, `--color-accent-foreground`, `--color-border-subtle` (dark), y los tres tríos de estado en claro. `html.custom` recibe los mismos valores base que `html.light` — `BrandingProvider` sigue inyectando overrides en runtime sin cambios.

### Tipografía

Tres familias vía `next/font/google`, cargadas en `layout.tsx`:

| Rol | Familia | Variable CSS | Utilidad Tailwind |
|---|---|---|---|
| Display de app | **Archivo** 400/500/600/700 | `--font-heading` | `font-heading` |
| Cuerpo | **Inter** 400/500/600 | `--font-sans` | `font-sans` |
| Numérico | **JetBrains Mono** 400/500/600/700 | `--font-mono` | `font-mono` |

`--font-sans` y `--font-mono` dejan de apuntar a Geist. `--font-display` (Fraunces) y `--font-manifest` (IBM Plex Mono, etiquetas de manifiesto) no se tocan.

`font-mono` recibe `font-variant-numeric: tabular-nums` en la capa base: la regla del handoff es que **todo número que se compara va en mono tabular**.

### Verificación

`src/app/__tests__/design-tokens.test.ts` parsea `globals.css` y afirma que cada modo declara el conjunto completo de tokens, que ninguno queda sin valor, y que `tailwind.config.ts` expone los nuevos como utilidades. Es la red que impide que un modo se quede atrás cuando se añada un token en el futuro.

---

## Fase 2 — Shell

**Archivos:** `src/components/AppLayout.tsx`, `src/components/sidebar/SidebarNavItem.tsx`, `src/components/sidebar/SidebarBrand.tsx` (nuevo), `src/components/sidebar/navigation.ts` (nuevo), `src/components/TopBar.tsx` (nuevo), `src/components/ThemeToggle.tsx`, `src/hooks/useNavCounts.ts` (nuevo)

### Navegación agrupada

La lista plana de 10 ítems pasa a dos secciones con encabezado:

```
OPERACIÓN                                  GESTIÓN
  Torre de control   (era "Ops Control")     Dashboard ejecutivo
  Recogida      (n)  (era "Pickup")          Capacidad
  Recepción     (n)                          Conversaciones  ·(punto si hay sin leer)
  Distribución  (n)                          Auditoría
  Despacho      (n)                          Admin (solo role admin)
```

- Sidebar 216px expandida / 56px colapsada. Encabezados de sección en `font-mono` 9.5px, `letter-spacing:.13em`, `--color-sidebar-section`, mayúsculas; ocultos al colapsar.
- Ítem activo: fondo `--color-surface`, borde izquierdo 2px `--color-sidebar-text-active`, label en activo con `font-weight:600`.
- Cada ítem de OPERACIÓN lleva contador a la derecha: neutro (`--color-sidebar-raised`) por defecto, warning cuando la cola excede el umbral del módulo. Se ocultan al colapsar.
- `useSidebarPin` y los tooltips en estado colapsado se conservan sin cambios.
- Las reglas de visibilidad por rol/permiso y `enabledModules` (spec-45) se conservan **exactamente**; solo cambia el agrupamiento y las etiquetas. La lista se extrae a `navigation.ts` para poder testear el filtrado sin montar el layout.

### Umbrales de contador

Definidos en `navigation.ts`, no en el componente:

| Ítem | Estados de `get_pipeline_counts` | Umbral warning |
|---|---|---|
| Recogida | `ingresado` | 50 |
| Recepción | `verificado` | 50 |
| Distribución | `en_bodega` | 250 |
| Despacho | `asignado` + `en_carga` + `listo_para_despacho` | 80 |

`useNavCounts` envuelve `usePipelineCounts` y hace el mapeo. Devuelve `null` mientras carga, para que el badge no parpadee en cero.

### TopBar

Barra de 56px que reemplaza los botones flotantes `absolute top-3 right-4` del layout actual.

- Fondo `--color-surface`, borde inferior `--color-border`.
- Izquierda: breadcrumb `Sección / Página`, 12px, derivado de la ruta (`usePathname`) contra el mismo `navigation.ts`, de modo que la nav y el breadcrumb no puedan divergir.
- Derecha, en orden: buscador (270px, "Buscar orden, paquete o RUT…", `kbd` con `/`), toggle de tema, `CapacityAlertBell`.
- **El chip de sync se difirió a la fase 4 (Recepción) — hecho ahí.** El handoff lo pide aquí, pero implementarlo obliga a desmontar `ConnectionStatusBanner` — que hoy es `fixed top-0` de ancho completo, vive en el layout raíz (cubre también auth y landing) y tiene sus propios tests e i18n. Ese cambio es de comportamiento offline, no de shell, y va junto con la cola de sincronización de `1e`, donde se rescribe la redacción ("se guardan en el dispositivo y se envían solos…"). Meterlo en el PR del shell es exactamente lo que el plan por fases existe para evitar.
- El buscador abre `InspectorSearchPalette`, que ya existe; el atajo `/` se mantiene.
- En viewports `<lg` el topbar sustituye a la barra de hamburguesa actual: hamburguesa + breadcrumb + toggle de tema + campana. El buscador se colapsa a icono. Así el toggle de tema **es alcanzable en móvil**, que es la decisión (1).

### ThemeToggle

Pasa a segmented control de dos opciones (Claro / Oscuro) con icono de sol y luna, 11px, `weight:600`; activa con fondo `--color-surface`. La opción `custom` (white-label) sigue apareciendo como tercer segmento **solo** cuando `hasBranding` es true — no se pierde funcionalidad de spec de branding. `useTheme` no cambia.

### Verificación

TDD. Tests nuevos/actualizados:

- `AppLayout.test.tsx` — secciones renderizadas, etiquetas nuevas ("Torre de control", "Recogida"), filtrado por rol/permiso/módulo intacto, topbar presente, atajo `/`.
- `sidebar/navigation.test.ts` — filtrado y agrupamiento puros.
- `useNavCounts.test.ts` — mapeo de estados a ítems y umbral warning.
- `TopBar.test.tsx` — breadcrumb derivado de la ruta, toggle visible en móvil, buscador abre la paleta.
- `ThemeToggle.test.tsx` — segmento `custom` solo con branding.

Cobertura global se mantiene sobre 70%.

---

## Fases 3–5

Se detallan al abrirlas, contra las secciones correspondientes del README del handoff (`1c` Despacho, `1d` Distribución/quicksort, `1e` Recepción, `1f` Order Inspector, `1g`–`1k` móvil). El orden de módulos es: Torre de control → Despacho → Distribución → Recepción → móvil.

Reglas que aplican a todas ellas y que se verifican en review:

- Ninguna zona táctil móvil por debajo de **44px**; los botones de acción principal, 52–60px.
- Ningún hex literal en componentes. Si hace falta uno, falta un token.
- Todo número comparable en `font-mono` tabular.
- El oro es acento de marca y de selección, **nunca** un color de estado.
- Cada estado codificado por dos canales: color + forma.
- Los mensajes offline dicen qué pasa con el trabajo del usuario, no el estado técnico de la red.


---

## Fase 4.1 — Torre de control

**Ruta:** `/app/operations-control` · **Mock:** `2a`

Componentes nuevos: `StageRail` (reemplaza `StageStrip`), `AtRiskPanel` (reemplaza `AtRiskTable`), `PromiseCard`, `FleetCard`, `TowerHeader`. Eliminados: `StageStrip`, `AtRiskTable`, `AtRiskBanner` — el panel de acción absorbe el trabajo del banner.

La página deja de usar `PageShell`: la fila de título del mock lleva subtítulo en vivo y acción primaria junto al `h1`, y el cuerpo es una grilla de dos columnas a altura completa. Envolver eso en `PageShell` era pelear con él.

### Datos — lo que sí y lo que no

`useDayPromise` (nuevo) alimenta la tarjeta "Promesa del día" desde `get_pipeline_counts`, **no** desde el snapshot de ops-control: el snapshot excluye a propósito `entregado` (ver `20260513000004`), y esta tarjeta trata sobre todo de lo que ya aterrizó. Los cuatro segmentos particionan el total sin doble conteo — una orden entregada tarde ya no está *en riesgo*, se resolvió.

**No se muestra OTIF**, aunque el mock lo incluye. La base define OTIF como `on_time / total_orders` (`20260309000005`) y `get_pipeline_counts` no lleva señal de on-time. `delivered/total` es otro número; ponerle la etiqueta OTIF en la pantalla que el jefe de operaciones reporta hacia arriba sería peor que omitirlo. Pendiente: conectar el rollup de dashboard.

**No se construye el segmentado Hoy / Mañana / Semana.** `useOpsControlSnapshot` no acepta fecha, así que las tres opciones mostrarían hoy. Un control muerto es peor que no ofrecer la opción todavía; vuelve cuando el RPC acepte fecha.

`AtRiskOrder` gana `comuna` — el snapshot ya la traía y la tabla se escanea por comuna.

### Deuda tocada de paso

`useActiveRoutes` tenía el bug de `rpc` desprendido (mismo que #404 y `usePipelineCounts`). Corregido con `callRpc` porque la Torre ahora lo consume. **Quedan 11 sitios** con el mismo idiom: `hooks/dashboard/{useCpoChapter,useNorthStars,useOtifChapter}`, `hooks/pickup/useManifests`, `useCapacityCalendar`, `useCapacityUtilization`, `useForecastAccuracy`. Merecen su propia pasada.

### Seguimiento conocido

La página monta su propio `OrderInspector` para el clic en fila, y `AppLayout` monta otro para la paleta de búsqueda. Son estados independientes; si algún día se abren a la vez, unificar vía contexto en lugar de duplicar el Sheet.


---

## Fase 4.2 — Despacho

**Ruta:** `/app/dispatch` · **Mock:** `1c`

La pestaña Pre-ruta pasa de lista apilada a **tablero de tres columnas** (`330px | 1fr | 322px`), que es el cambio central del mock: qué está sin rutear, cómo se ve el plan y qué va a contener la ruta, todo visible mientras decides. Bajo 1024px las columnas se apilan.

Componentes nuevos: `PreRouteBoard`, `UnroutedColumn`, `RoutePlanCanvas`, `RouteDraftPanel`, `UnmappedComunasNotice`, más `useUnroutedGroups` (`buildGroups` / `summariseSelection`, puros y testeados aparte).

La cabecera de página cambia: las cinco `MetricCard` iguales se reemplazan por título + pestañas en línea con su conteo + "SIN RUTEAR n" + acción primaria. Cinco tarjetas del mismo tamaño no decían para qué era la pantalla.

### Datos — lo que sí y lo que no

**Agrupación: `Por andén` y `Por comuna` solamente.** El mock ofrece además *Por cliente* y *Por SLA*. `get_pre_route_snapshot` devuelve andenes con sus comunas y conteos — no trae cliente ni SLA por grupo. Los dos chips que faltan esperan a que el RPC devuelva esos datos, no se pintan como opciones muertas.

Una comuna puede aparecer bajo más de un andén — eso es justo lo que marca `has_split_dock_zone_warnings` — así que al agrupar por comuna los conteos **suman** en vez de sobrescribirse, y se listan los andenes entre los que está repartida.

**El mapa es un placeholder tokenizado y declarado como tal.** No hay proveedor de mapas.

**No se muestran DISTANCIA / DURACIÓN / OCUPACIÓN / CPO EST.** Los cuatro salen del optimizador OR-Tools, que no tiene cableado en el frontend. La tira de métricas reporta lo que la selección *sí* contiene: órdenes, paquetes, comunas, grupos. Inventar cifras plausibles en una pantalla de planificación sería peor que no mostrarlas.

**La columna derecha no dibuja conductor, ocupación de vehículo ni secuencia de paradas.** Eso pertenece a una ruta que existe: la asignación vive en `/app/dispatch/[routeId]` y la secuencia necesita el optimizador. Antes de "Armar ruta" no hay ruta ni secuencia, así que el panel muestra lo que la ruta *va a* contener y dice dónde ocurre el resto.

### Código muerto eliminado

`PreRouteTab` quedó sin referencias y era la única raíz de `AndenCard` → `ComunaBreakdown` → `OrderList`, `PreRouteSelectionBar` y `usePreRouteSelection`. Todo eliminado con sus tests: código muerto con tests verdes es el peor tipo, porque parece mantenido.

`PreRouteFilters` **se conserva y se reutiliza** en el tablero. El board lee `date` y `window` de la URL, así que borrar el único control que los fija habría dejado al operador clavado en hoy/todas.


---

## Fase 4.3 — Distribución / modo rápido

**Ruta:** `/app/distribution/quicksort` · **Mock:** `1d`

La pantalla más sensible del sistema: se usa de pie, a distancia, con las manos ocupadas. Todo sale de ahí — campo de escaneo de 78px siempre enfocado, resultado como el elemento más grande de la pantalla y persistente hasta el siguiente escaneo, y grilla de andenes que muestra dónde fue el último paquete sin que el operario despegue la vista del mesón.

Aquí es donde se cobran los primitivos de la fase 3: `ScanField`, `ScanResult` y `DockCard` se usan por primera vez.

Componentes: `QuickSortScanner` (misma máquina de estados, presentación nueva), `RecentScansPanel` (nuevo), `DockCard` (fase 3), tarjetas KPI en la página.

### El flujo de dos pasos se conserva

**El mock muestra un escaneo de un paso** — escanear paquete → aparece ANDÉN 3. El código real tiene dos: escanear paquete → mostrar destino → **escanear el andén para confirmar**, y `validateDockDestination` rechaza el andén equivocado.

Ese segundo paso es un control de verificación real, no un rodeo de UI. Adoptar el flujo del mock habría eliminado una comprobación de seguridad que el autor del diseño probablemente no sabía que existía. **Se conserva el flujo de dos pasos y solo cambia su presentación.** Si se decide que la verificación sobra, que sea una decisión de operaciones explícita, no un efecto secundario del rebranding.

### Datos — lo que sí y lo que no

- **SECTORIZADOS**, no "SECTORIZADOS HOY": `useSectorizedByZone` cuenta paquetes en estado `sectorizado` sin filtrar por fecha. Etiquetarlo "hoy" sería falso.
- **EN ESTA SESIÓN** reemplaza a **RITMO** (`312 /h`). El ritmo necesita marcas de tiempo por escaneo que ningún endpoint entrega hoy; el conteo de sesión es real y es lo que el operario contrasta con su propio turno.
- **PENDIENTES** y **CONSOLIDACIÓN** salen de `useDistributionKPIs`.
- **Sin barra de ocupación en las tarjetas de andén.** `DockZone` no tiene campo de capacidad, así que no hay porcentaje que mostrar. `DockCard` se ajustó para **ocultar la barra** cuando no hay dato, en vez de pintar una barra al 0% permanentemente — que se lee como defecto de render, no como "sin dato".
- **"Últimos escaneos" es de sesión, no del servidor.** `useDockScans` consulta por batch, y aquí un batch es un paquete, así que no existe un feed de escaneos recientes. El alcance de sesión además es lo que el operario necesita: confirmación de lo que acaba de hacer, para pillar un error en segundos.
- **COMUNAS SIN ZONA** baja al pie de ese panel (`useUnmatchedComunas`), donde el operario lo ve mientras trabaja, en vez de un banner arriba que la grilla empuja fuera de pantalla.


---

## Fase 4.1b — Paquetes en las tarjetas del flujo

Cambio de diseño posterior: las tarjetas del rail de la Torre ganan una línea con el conteo de paquetes bajo el conteo de órdenes (mono 10px, `--color-text-muted`, `white-space:nowrap`, entre la cifra y la barra de salud).

**No hace falta tocar ningún endpoint.** `get_ops_control_snapshot` ya devuelve un array `packages` en cada orden y manifiesto — verificado contra el proyecto en vivo: 1.262 de 1.283 órdenes (98%) traen al menos un paquete, 1.421 en total.

`countPackages` (`lib/packages.ts`) suma **filas de paquete**, la misma unidad que `get_pre_route_snapshot` reporta como `package_count`. Las cajas físicas son otro número (`packages.declared_box_count`, ver spec-53/55) y no es lo que "paquetes" significa en el resto del producto.

Devuelve `null` —y la tarjeta oculta la línea— cuando ningún ítem de la etapa trae `packages`. Las etapas basadas en rutas (Reparto, y la parte de rutas de Andenes) no tienen paquetes en el snapshot: mostrar "0 paquetes" diría que la etapa está vacía, cuando lo cierto es que no tenemos el dato.


---

## Fase 4.4 — Recogida (escritorio)

**Ruta:** `/app/pickup` · **Mock:** `1l`

Corrección al plan: la primera versión de este spec decía que Recogida no tenía mock. Sí lo tiene — `1l`, añadido al archivo de diseño después del handoff original. El plan de fase 4 lo omitía por error, igual que a `1f` (Order Inspector, todavía pendiente).

Dos columnas (`1fr 340px`): los manifiestos por retirar a la izquierda, la ruta en armado y los cierres del día a la derecha. Bajo 1024px se apilan.

Componentes nuevos: `ManifestTable`, `PickupRouteDraftPanel`, `TodayClosuresPanel`, más `pickupSummary.ts` (`pendingTotals` / `clientBreakdown` / `completedToday`, puros y testeados aparte). `StatTile` se extrae a `components/` en su tercera copia — la Torre, quicksort y ahora Recogida tenían cada una la suya.

Las tarjetas pasan a tabla, que es el cambio central del mock.

### Datos — lo que sí y lo que no

- **Sin columna VENTANA.** El mock la muestra ("09:00–13:00", "cierra 12:30" en rojo) y tiñe el borde izquierdo de la fila según cuán cerca esté el cierre. `get_pending_manifests` no devuelve ventana de retiro. Inventar un plazo en la pantalla que decide qué recoge la cuadrilla sería peor que omitir la columna. El borde izquierdo lleva en su lugar el progreso de escaneo, que sí es real.
- **Sin "cierre de retiros 18:00"** en el subtítulo, por lo mismo.
- **Sin ocupación estimada del vehículo.** Necesita capacidad en `vehicles` y volumen en `packages`; ninguna de las dos existe. Un porcentaje adivinado en la pantalla que decide si un furgón va lleno sería activamente dañino.
- **Sin la comuna en negrita dentro del punto de recogida.** El RPC devuelve solo el nombre del punto (`MIN(pp.name)`), no la comuna.
- **Los cierres no marcan faltantes.** El mock muestra "2 faltantes de 44" en paleta warning; `get_completed_manifests` da totales pero no verificados, así que la merma no se puede derivar sin una consulta por manifiesto. `useDiscrepancies` sigue siendo el lugar que responde "qué faltó".

### Desviación deliberada del mock

La tabla lleva **una séptima columna** que el mock no tiene: la impresión de etiquetas de spec-53. Vivía en `ManifestCard` y un rediseño que la eliminara en silencio sería una regresión funcional, no un cambio visual. Va como icono, con `stopPropagation` para no confundirse con la selección de la fila.

Por la misma razón, el código de carga es un botón que abre el flujo de escaneo: el clic en la fila es selección para armar la ruta, y abrir el escaneo es la acción principal de la pantalla — no podía quedarse sin acceso.

### Flujo de armado de ruta

Marcar manifiestos → `start_pickup_route(vehicleId)` → `add_manifest_to_route` por cada uno. Si alguno falla, la ruta igual existe: se avisa cuántos no entraron en vez de dejar que el conductor salga con carga incompleta. Con una ruta ya abierta el panel se aparta — `start_pickup_route` permite una sola ruta activa por conductor, así que ofrecer crear otra es ofrecer un error.


---

## Fase 4.5 — Recepción

**Ruta:** `/app/reception/route/[routeId]` · **Mock:** `1e`

Tres columnas (`300px 1fr 340px`): las rutas a la izquierda, el conteo al centro, la cola de sincronización a la derecha. La sesión de conteo deja de ser una página estrecha aislada — el receptor cambia de ruta sin volver al listado.

Componentes nuevos: `RouteSwitcherColumn`, `ReceptionCounts`, `SyncQueuePanel`, `SyncChip`, más `useSyncQueue`.

### El chip de sync vuelve a casa

Es la pieza que la fase 2 dejó pendiente. `ConnectionStatusBanner` — barra fija de ancho completo sobre la página — **se elimina**; su lectura de estado pasa a `useSyncQueue` y se muestra en el topbar como chip, que es lo que pedía el handoff.

La redacción sigue la regla del handoff: dice qué pasa con el trabajo del operario, no que la red está caída. "SIN CONEXIÓN · 14 EN COLA" en el chip; en el panel, *"Sin conexión. Los escaneos se guardan en el dispositivo y se envían solos al recuperar señal. Puedes seguir contando."*

El chip **no renderiza nada** estando en línea y con la cola vacía — el estado normal no necesita cromo. El banner anterior sí lo ocupaba.

### Desviaciones del mock

- **Las pestañas son Entrantes / En descarga / Cerradas**, no *Entrantes / Retornos / Cerradas*. Los retornos son *rutas de retorno*, otra entidad con su propio flujo de sesión; meterlas en este switcher cambiaría qué navega la columna, no cómo se ve. Los tres estados de una ruta entrante son los que el listado de recepción ya modela.
- **La barra de progreso solo aparece en la ruta abierta.** `useIncomingRoutes` devuelve `expected_packages` pero no un conteo recibido, así que una barra en las demás filas sería inventada — muestran su total esperado. La ruta abierta sí tiene el dato, del snapshot.
- **`ReceptionScanner` se conserva tal cual**, no se reemplaza por `ScanField`. Lleva `useScannerAutoSubmit` (detección de ráfaga del lector) que #411 y #418 acaban de corregir; cambiarlo por el primitivo perdería eso. Unificarlos exige portar `useScannerAutoSubmit` dentro de `ScanField` — trabajo aparte.

### Código muerto eliminado

`RouteReceptionHeader` queda sin referencias: su código de ruta pasa al encabezado de página y su barra de progreso a la columna izquierda, donde ahora lleva semántica `role="progressbar"` con `aria-valuenow` / `aria-valuemax`.

---

## Fase 4.6 — Ruta activa del conductor (móvil)

**Ruta:** `/app/pickup/route/active` · **Mock:** `1i`

El mock `1i` está redactado para una ruta de **entregas**: paradas con ETA, ventana horaria, botón de navegación, y un desglose entregadas/fallidas/restan. Esta pantalla es la ruta de **retiro** (pickup) del conductor — el dominio real es manifiestos por verificar, no paradas de entrega. No se forzó la pantalla hacia el mock; se restyleó lo que existe.

Componentes nuevos: `RouteProgressHeader`, `RouteMapPlaceholder`, `NextManifestCard`, `RouteCompleteNotice`, `UpcomingManifestList`, más `lib/pickup/manifestProgress.ts` (helpers puros compartidos), reutilizando `StackedProgress` (creado en fase 3 anticipando esta pantalla) para la barra apilada.

### Datos — lo que sí y lo que no

- **Sin badge de SLA ni "CIERRE EST."** `pickup_routes` no tiene columna de deadline ni de estado SLA (ver `20260625000001_spec47_pickup_routes_consolidated_reception.sql`). Omitido, igual que en 4.4 (recogida escritorio).
- **Sin segmento "FALLIDAS" en la barra apilada ni en las métricas.** `scan_result_enum` es `verified | not_found | duplicate` — `not_found` es un escaneo que no coincide con el manifiesto, no un "no se pudo entregar". No hay un estado de fallo por paquete distinto de "aún no verificado". La barra lleva dos segmentos (verificados / restantes) en vez de tres, y la fila de métricas es VERIFICADOS / RESTAN / MANIFIESTOS en vez de las cuatro del mock.
- **Sin mapa real.** No hay proveedor de mapas en el proyecto (fuera de alcance) ni geometría de ruta en ningún lado del esquema. `RouteMapPlaceholder` usa los tokens `--color-map-surface` (fondo) y texto/ícono en `text-text-secondary` — **no** `--color-map-line`, que en modo oscuro da ~1.9:1 contra el fondo del mapa y vuelve el placeholder invisible; ese token queda reservado para trazar la polilínea el día que exista.
- **Dirección: existe, y se usa.** Corrección a una versión anterior de esta nota, que decía que no había dirección ni lat/lng — `manifests.pickup_location` (TEXT, sin join) está en la misma fila que `useRouteManifests` ya selecciona. Se agrega al `select` y se muestra en `NextManifestCard`. Con eso, **"ABRIR NAVEGACIÓN" también existe**: un link `https://maps.google.com/?q=<dirección>` no necesita proveedor de mapas — se renderiza sobre `RouteMapPlaceholder` cuando el manifiesto destacado tiene `pickup_location`, y se omite (no se deshabilita) cuando es `null`.
- **Sin botón "llamar".** Corrección a la misma nota anterior: sí existe un teléfono de contacto (`pickup_points.pickup_locations[].contact_phone`, ver `lib/api/pickup-points.ts`) — la afirmación de que "no hay teléfono" era falsa. Lo que falta es el camino para llegar a él desde esta pantalla: `manifests` no guarda `pickup_point_id`, solo el texto libre `pickup_location`; `pickup_points` solo se une hoy vía `orders.pickup_point_id` en los RPCs de recogida. Añadirlo aquí requeriría ese join, que esta consulta cliente-a-tabla no hace. Se omite el botón por esa razón — no porque el dato no exista.
- **Sin ETA ni "más opciones" en la tarjeta "siguiente manifiesto".** No hay tiempos por manifiesto en ningún lado, y no hay un menú de acciones secundarias definido para esta pantalla.
- **"Siguiente manifiesto" ya no dependía de un orden real — ahora sí.** `useRouteManifests` no tenía `.order(...)`; el orden de Postgres es arbitrario y el hook refresca al volver el foco, así que la tarjeta destacada (y su número de posición) podía saltar de un manifiesto a otro entre refrescos sin que nada hubiera cambiado. Se agregó `.order('created_at', { ascending: true })` — el más antiguo (el primero agregado a la ruta) primero. **Ascendente, no descendente como los RPC de listado de manifiestos** (`20260428000001_sort_manifests_by_created_at.sql`): esos son un historial de cargas recién llegadas, un tipo de pantalla distinto. Esta es una cola de trabajo a la que el conductor agrega desde la misma pantalla (`handleAdd` invalida esta consulta) — con orden descendente, un manifiesto recién agregado aparecería en la posición 0, saltaría directo a "Siguiente manifiesto" y renumeraría cada badge en pantalla, reintroduciendo la misma inestabilidad que el `.order(...)` vino a resolver. El número en la tarjeta es la posición estable de un manifiesto en esa lista — no una secuencia de visita geográfica como "PARADA 19 de 24" del mock, que esta pantalla no puede modelar.
- **Total de paquetes desconocido ≠ cero.** `manifests.total_packages` es nullable (OCR/carga manual no lo garantiza). `verified_count < (total_packages ?? 0)` leía un total desconocido como cero, así que un manifiesto sin conteo se mostraba como "ya completo" y desaparecía de la lista de pendientes; con algunos escaneos ya hechos mostraba un "5/0" imposible. `lib/pickup/manifestProgress.ts` centraliza la regla: un total `null` es DESCONOCIDO, nunca cero. El encabezado muestra el denominador como "—" (y una nota "total pendiente de definir en N manifiestos") en vez de sumar solo los totales conocidos y presentarlo como si fuera el total real de la ruta.
- **`total_packages: 0` cuenta como no-completo, igual que `null`.** Decisión deliberada (round 2 de revisión): `isManifestComplete` no trata `0 >= 0` como "listo". Un manifiesto nunca espera legítimamente cero paquetes; un 0 real casi siempre significa que el intake (OCR o manual) todavía no registró el conteo. Coincide con el predicado que ya tenía `RouteManifestList` antes de este cambio (`expected > 0 && verified >= expected`).
- **Ruta completa ya no reutiliza la tarjeta de "siguiente".** Antes, cuando todos los manifiestos estaban verificados, la tarjeta caía a `routeManifests[0]` y seguía mostrando un botón "Verificar" para trabajo que ya no existía. `RouteCompleteNotice` es el estado explícito para ese caso — sin CTA fabricado.

### Lista completa detrás de un toggle

El mock pone la lista completa de paradas detrás de "Ver las 24 paradas". Se implementó igual: `RouteManifestList` (ya existente) queda oculta por defecto y aparece con "Ver los N manifiestos" (singular "Ver el manifiesto" cuando hay exactamente uno) — con `aria-expanded` / `aria-controls` hacia el panel. El toggle no se renderiza cuando la ruta no tiene manifiestos: no hay nada que mostrar u ocultar, y el estado vacío de `RouteManifestList` queda visible directo. `AddManifestSheet` y `CloseRouteButton` no se tocaron: misma lógica de mutación, mismos data-testid.

`RouteManifestList` en sí **sí cambió de comportamiento**, no solo de posición en la pantalla: su predicado de "completo" y su etiqueta de progreso pasaron a `lib/pickup/manifestProgress.ts` (`isManifestComplete` / `progressLabel`) para compartir la misma corrección de `total_packages` nulo que el resto de esta fase (ver más abajo). Sus dos tests originales se preservaron sin tocar; se agregó uno nuevo para el caso `total_packages: null`.

### Accesibilidad de la barra de progreso

`StackedProgress` (compartido con la Torre) expone el desglose solo en su atributo `title`, que los lectores de pantalla no anuncian de forma confiable. En vez de cambiarle el contrato de accesibilidad a un componente que usan otras pantallas, esta pantalla lo envuelve con una oración `sr-only` con los mismos números ("18 de 24 paquetes verificados").

---

## Fase 4.7 — Distribución (estado inicial del módulo)

**Ruta:** `/app/distribution` · **Mock:** `3d`

El ítem de nav Distribución aterrizaba en una pantalla sin tocar: `1d` es el modo rápido, y el landing no tenía mock hasta `3d`. Mismo hueco que Recogida antes de `1l` y Recepción antes de `3c`.

Componentes nuevos: `OutboundDockGrid`, `ActiveSortersPanel`, más `useDistributionOverview` y el RPC `get_distribution_overview` (`20260817000002`).

### La primera versión del mock no era construible

`3d` llegó apoyado en **olas** (Ola 2 de 3, abierta 11:40, cierre previsto 14:00, "Cerrar ola 2") y en **estaciones** de trabajo. Ninguno de los dos existe en el esquema: no es una columna que falte, es un concepto que falta, y era la idea organizadora de la pantalla. Se levantó antes de escribir código y el diseño se corrigió:

- **olas → lotes.** `dock_batches` sí existe (open/closed, `closed_at`, `package_count`), así que "5 lotes abiertos · último cierre 11:40" es real.
- **estaciones → operarios activos.** Derivable de `dock_scans` (`scanned_by`, `scanned_at`, `batch_id` → zona).
- **ritmo** pasa a ser calculable: escaneos aceptados en la última hora.

Queda una sola brecha: **la capacidad del andén**. El mock muestra `168 / 180 paq.`, la barra de llenado y el badge `CASI LLENO`; `dock_zones` no tiene columna de capacidad. Se muestra el conteo sin denominador y sin barra — la misma decisión que toma `DockCard`. Añadir `dock_zones.capacity` desbloquea las tres cosas, pero necesita superficie de administración para fijarla, así que es un seguimiento y no un número inventado aquí.

### Un solo RPC nuevo

`get_distribution_overview` devuelve lotes abiertos, último cierre, clasificados hoy, ritmo de la última hora y quién está escaneando. Los cinco salen de `dock_batches` + `dock_scans`, así que viajan juntos en una llamada. Todo lo demás de la pantalla ya tenía hook y no se duplica.

"Clasificados hoy" se cuenta desde los **escaneos**, no desde el estado del paquete: el estado es el actual, y un paquete que siguió avanzando dejaría de contar para el turno en que se clasificó.

---

## Fase 4.8 — Móvil: lo que se hizo y lo que quedó bloqueado

Las cinco pantallas móviles del handoff (`1g`–`1k`) no eran el mismo tipo de
trabajo. Tres eran rediseños de pantallas que ya existían y funcionaban; dos
son pantallas nuevas cuyo elemento central depende de datos que el esquema no
tiene. Se implementaron las tres primeras y se documentan aquí las otras dos,
en vez de construirlas contra datos inventados.

| Mock | Ruta | Resultado |
|---|---|---|
| `1h` Escaneo de recogida | `/app/pickup/scan/[loadId]` | ✅ #447 |
| `1i` Ruta activa | `/app/pickup/route/active` | ✅ #450 |
| `1k` Reingresos | `ReturnReceptionSession` | ✅ #449 |
| `1g` Home del operario | — | ⛔ bloqueada (abajo) |
| `1j` Parada y prueba de entrega | — | ⛔ bloqueada (abajo) |
| `3e` Distribución handheld | — | pendiente, no bloqueada |

### El mock móvil asume un dominio de reparto que el producto todavía no tiene

Es el mismo hallazgo tres veces, y conviene nombrarlo una sola vez: `1i`, `1j`
y buena parte de `1g` están dibujados para un conductor **repartiendo**. Lo que
existe hoy es el lado de **recogida** — se retiran manifiestos de puntos de
recogida. No hay secuencia de paradas, ni ETA por parada, ni resultado de
entrega, ni plazo SLA por ruta.

`1i` se implementó contra lo que sí existe (código de ruta, patente, hora de
salida, manifiestos verificados sobre esperados) en lugar de forzar la pantalla
hacia semántica de reparto. Las omisiones concretas están en la Fase 4.6.

### `1g` — Home del operario: falta el vínculo usuario ↔ conductor

El elemento dominante del mock es la tarjeta "TU TAREA AHORA": la siguiente
tarea **de esta persona**. No es construible.

`public.drivers` no tiene `user_id` ni ninguna referencia a `auth.users`, y
ninguna migración posterior la agrega. Las rutas apuntan a `driver_id`, pero
nada conecta esa fila con la cuenta que tiene el teléfono en la mano. El
sistema no puede responder "cuál es *mi* próxima tarea".

Lo que sí se podría construir hoy:

- el saludo — `public.users.full_name` existe;
- ESCANEADOS — los escaneos llevan `scanned_by` / `user_id`, así que un conteo
  personal del día es real;
- PENDIENTES HOY — solo a nivel de operador, no "tuyas";
- la tab bar — es navegación.

Lo que no: la tarjeta de tarea y la lista "DESPUÉS DE ESTA", que son la razón
de ser de la pantalla.

**Qué la desbloquea:** una columna `drivers.user_id` (o una tabla de asociación
`users` ↔ `drivers`), más una superficie de administración para mantener ese
mapeo. Es trabajo de esquema con su propio spec, no un rediseño.

### `1j` — Parada y prueba de entrega: no hay dónde guardar la prueba

Pide foto, firma y RUT al entregar. No existe flujo de entrega en el frontend
y, sobre todo, no hay dónde guardar la prueba: `delivery_attempts` es una tabla
de métricas para FADR (`attempt_number`, `status`, `failure_reason`,
`attempted_at`) — sin firma, sin foto, sin RUT, y sin bucket de storage.

**Qué la desbloquea:** migración para la prueba de entrega, un bucket de
storage, RPCs de escritura y encolado offline para capturas hechas sin señal.
Es una funcionalidad, no un restyle.

### Deuda transversal encontrada de paso

**47 usos de modificadores de opacidad sobre tokens del proyecto no generan CSS
en absoluto.** `tailwind.config.ts` mapea cada token a un `var(--color-…)`
pelado, sin `<alpha-value>`, así que Tailwind 3 no puede componer alfa y
descarta la clase en silencio. `hover:border-accent/50`, `focus:ring-accent/40`,
`bg-accent/10` y compañía se leen bien en el código y no existen en pantalla.
Se corrigieron los casos dentro de estas pantallas; el resto sigue.

Arreglarlo de raíz es un cambio de configuración (tokens en canales RGB o
`color-mix()`) que haría aparecer ~47 tintes hoy invisibles de una sola vez —
un cambio visual transversal que merece su propio PR y revisión.
