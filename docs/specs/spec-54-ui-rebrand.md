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
| **4 — Módulos, uno por PR** | Torre de control ✅ → Despacho ✅ → Distribución → Recepción → móvil. | en curso |
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
- **El chip de sync se difiere a la fase 4 (Recepción).** El handoff lo pide aquí, pero implementarlo obliga a desmontar `ConnectionStatusBanner` — que hoy es `fixed top-0` de ancho completo, vive en el layout raíz (cubre también auth y landing) y tiene sus propios tests e i18n. Ese cambio es de comportamiento offline, no de shell, y va junto con la cola de sincronización de `1e`, donde se rescribe la redacción ("se guardan en el dispositivo y se envían solos…"). Meterlo en el PR del shell es exactamente lo que el plan por fases existe para evitar.
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
