# Spec-75: Despacho en escritorio — pre-ruta, monitor de carga y en ruta

> **Related:** [spec-54](spec-54-ui-rebrand.md) (rebranding, fase 4 «Módulos, uno por PR»), [spec-70](spec-70-dispatch-state-machine.md) (máquina de estados de ruta), [spec-71](spec-71-load-positions-staging-pass.md) (`get_pre_route_snapshot`, posiciones de carga), [spec-72](spec-72-blocks-delivery-sequence.md) (secuencia de paradas), [spec-73](spec-73-capacity-ladder-truck-topup.md) (`fleet_vehicles.capacity_packages`), [spec-74](spec-74-per-bulto-staging.md) (staging por bulto), [spec-76](spec-76-despacho-movil-carga.md) (móvil de cuadrilla)

**Status:** in progress
**Verify:** unit

_Date: 2026-09-03_

---

## Goal

Rehacer las cuatro pestañas de Despacho en escritorio contra el canvas nuevo. Hoy el módulo funciona pero está dibujado como cuatro listas; el rediseño lo convierte en cuatro vistas con una pregunta cada una:

1. **`1a` — Pre-ruta.** Seleccionar órdenes, ver el impacto geográfico y armar la ruta en la misma vista.
2. **`1b` — En carga.** Monitor en vivo de lo que está cargando cada cuadrilla.
3. **`1c` — Seguimiento de una ruta en carga.** Solo lectura: el escritorio ve escanear a la cuadrilla.
4. **`1d` — En ruta.** Lo que ya está en DispatchTrack, ordenado por lo que va mal. *Completadas* es la misma tabla filtrada, al pie.

Las 4 pestañas pasan a vivir en el header del módulo, con su conteo, en vez de depender del sidebar.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, `Despacho.dc.html`, artboards `1a`–`1d` | Geometría, jerarquía y copy |
| `design_handoff_aureon_rebrand/README.md`, secciones *1c* y *3f* | Intención de diseño previa del módulo y de la pre-ruta |
| `spec-70`–`spec-74` | Máquina de estados, RPC y columnas ya implementadas |
| Este spec | Decisiones del lado del repo, desviaciones y plan |

**El canvas renumera.** El handoff antiguo llamaba `1c` a Despacho escritorio y `3f` a la pre-ruta; el canvas nuevo los llama `1a`–`1d`. Donde ambos hablan del mismo pixel manda el canvas, que es posterior. Lo del handoff que sigue vigente son sus decisiones de producto (fila por orden y no por grupo, qué filtros se van, arrastrar y soltar), recogidas abajo.

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `1a` Pre-ruta | `/app/dispatch` pestaña Pre-ruta | **Las tres columnas ya existen**: `PreRouteBoard.tsx` compone `UnroutedColumn` + `RoutePlanCanvas` + `RouteDraftPanel` (spec-54 fase 4.2). Falta el delta — ver decisión 2 |
| `1b` En carga | `/app/dispatch` pestaña En carga | Existe: `DispatchInProgressTab.tsx`, tarjetas en grid |
| `1c` Seguimiento de ruta | `/app/dispatch/[routeId]` | Existe: `RouteBuilder.tsx` (364 líneas) + `RoutePanel.tsx`, sin el modo solo-lectura del mock |
| `1d` En ruta / Completadas | `/app/dispatch` pestañas En ruta y Completadas | Existen como listas sin las métricas de cabecera ni el orden por incidencia |

### No-goals

- **No se toca el backend.** Las ~14 rutas bajo `api/dispatch/**` y los RPC de `spec-70`–`74` se consumen tal como están. Este spec no agrega migraciones.
- **No se implementa el móvil.** `2a`–`2l` son `spec-76` y `spec-77`; `3a` es `spec-78`.
- **No se rediseña el sidebar.** `spec-67` ya fijó la arquitectura de navegación. Las pestañas del módulo van en el header del módulo, no en el sidebar.
- **No se introduce librería de mapas nueva.** El mapa de `1a` se dibuja con el mismo enfoque que ya usa el repo; si hoy no hay mapa real en pre-ruta, se implementa el contenedor y las polilíneas con los tokens `--color-map-surface` / `--color-map-line`, no con un proveedor nuevo.
- **No se construye el mapa ni la tarjeta de métricas de 4 columnas de `1a`** (decisión 10), ni **arrastrar y soltar sobre vehículos** (decisión 11). Los dos dependen de trabajo que no existe todavía — el optimizador cableado y un proveedor de mapas en un caso, una columna de vehículos en el otro.
- **No se fuerza tema oscuro.** Decisión heredada de `spec-54`: el usuario elige.
- **Optimizar y crear N rutas** reusa `useCreateRouteFromSelection`. No se escribe un optimizador nuevo ni se conecta OR-Tools en este spec — queda para un spec futuro (refinamiento OR-Tools / TomTom).

## Orden alterado: `spec-76` va primero

**Decisión del usuario, 2026-09-03.** Las fases 1–3 (shell del módulo, columna de pre-ruta, filtros, monitor `1b`) están hechas. Las fases 4 y 5 quedan **en pausa** hasta que `spec-76` esté implementado.

**Por qué.** La fase 4 convierte `1c` en solo lectura, lo que **le quita el escaneo al escritorio**. El reemplazo — las pantallas móviles de cuadrilla — es `spec-76`, que todavía no existe. Hacerlo en el orden original dejaba una ventana en la que una cuadrilla que hoy escanea en un navegador de escritorio o ≥1024 px se queda sin pantalla. Se construye primero el reemplazo y después se apaga lo viejo.

Cuando `spec-76` esté en producción, la fase 4 retoma: `1c` pasa a solo lectura, se parte `RouteBuilder.tsx` (364 líneas) y `RoutePanel.tsx` (260) si hace falta.

**Hallazgo que sobrevive de la fase 4** (verificado, no re-derivar): `/app/dispatch/[routeId]` es una URL compartida por tres superficies — `1c` en escritorio, `2c`/`2e` móvil de cuadrilla (`spec-76`), `3a` tablet (`spec-78`). El mecanismo ya existe y se usa igual en `/app/reception/route/[routeId]`: `useIsBelowLg()` de `hooks/useViewport.ts`, con `false` por defecto en tests. Al introducir la rama, los tests de escaneo/sellado/despacho de `RouteBuilder.test.tsx` deben seguir afirmando el comportamiento real e intacto con `useIsBelowLg → true`.

## Decisiones

1. **Los tokens ya existen: no se añade ninguno.** El canvas declara `--surface`, `--text`, `--ok`… porque es un HTML autocontenido. `globals.css` ya tiene el equivalente rebrandeado y los valores coinciden exactamente con el canvas en ambos temas (`#ca9a04` / `#e6c15c` de acento, `#f8fafc` / `#13110d` de fondo, más `--color-map-surface` y `--color-text-body`). La tabla de equivalencias del handoff sigue siendo la referencia de nombres. **No** se crea una capa de tokens de módulo.

2. **CORREGIDO — `RouteBuilder.tsx` no es la pre-ruta, y las tres columnas de `1a` ya existen.** La primera versión de este spec afirmaba que `RouteBuilder.tsx` era la pantalla de pre-ruta y que había que partirlo en tres columnas para construir `1a`. **Las dos mitades son falsas**, verificado contra el código: `RouteBuilder.tsx` (364 líneas) es la pantalla de **una ruta**, en `/app/dispatch/[routeId]` — importa `ScanZone`, `PackageRow`, `RouteBlockList`, `TopupSuggestions` y `VehicleCapacityBar`. En el canvas nuevo eso es **`1c`**, y partirlo corresponde a la **fase 4**. Y `1a` ya tiene sus tres columnas: `PreRouteBoard.tsx` compone `UnroutedColumn` + `RoutePlanCanvas` + `RouteDraftPanel`, y su propio comentario lo dice — «el layout de tres columnas que pide el mock… bajo 1024px las columnas se apilan» (spec-54 fase 4.2). **Causa raíz: la renumeración.** El handoff antiguo llamaba `1c` a «Despacho escritorio», y el comentario de `PreRouteBoard` dice «(mock 1c)» con **esa** numeración; el canvas nuevo usa `1a` = pre-ruta y `1c` = seguimiento de una ruta. Es exactamente la trampa que este spec advierte en *Fuente de verdad* y en la que cayó igual: **antes de tocar un archivo, confirmar qué pantalla es por sus imports y su ruta, nunca por su número.** Lo que `1a` necesita es el **delta** sobre las columnas existentes — fila por orden en vez de por grupo, chevron con `sku_items`, el cambio de filtros (decisión 6), el pie de selección, arrastrar y soltar con acciones masivas, y las polilíneas y métricas del `RoutePlanCanvas`, que ya existe (no hay librería de mapas en `package.json` y no se agrega ninguna).

3. **La capacidad ya está en el schema, con otro nombre.** El handoff pedía `ALTER TABLE vehicles ADD COLUMN package_capacity`. Eso **no se hace**: `spec-73` ya añadió `fleet_vehicles.capacity_packages` (migración `20260904000001_spec73_vehicle_capacity.sql`), que es la columna que alimenta las barras de ocupación de `1a`, `1b` y `1c`. Ojo con las dos tablas de vehículos del repo (`vehicles` y `fleet_vehicles`): la capacidad vive en `fleet_vehicles`, y la UI debe leer de ahí. El estado *sin capacidad configurada* del mock es el caso `capacity_packages IS NULL` y se muestra como tal, sin barra falsa.

4. **`1c` es estrictamente solo lectura, y el canvas lo rotula.** Lleva un badge `SOLO LECTURA` y no monta acciones de escaneo. *Cerrar ruta* no existe aquí: cerrar es de la cuadrilla, en `2i`. **Pero despachar sí es de escritorio**: `1b` ofrece *Despachar a DispatchTrack* sobre una ruta ya en `LISTA PARA DESPACHO`, y `3a` también. La regla real es que **cerrar** es exclusivo de la cuadrilla y **despachar** lo puede hacer cualquiera de las tres superficies sobre una ruta ya cerrada. El label del artboard `1c` («cerrar y despachar se hacen desde el móvil») describe esa ruta concreta en estado `EN CARGA`, no una regla del módulo.

5. **`1d` ordena por lo que va mal, no por código de ruta.** El mock ordena por fallidas y antigüedad del último evento, y *Completadas* es la misma tabla filtrada al pie en vez de una pestaña con su propio árbol. Se implementa como una tabla con un filtro, no dos tablas.

6. **Los filtros de pre-ruta cambian como dijo el handoff `3f`.** Se eliminan las pestañas `TODAS / MAÑANA / TARDE / NOCHE`: agrupaban por franja fija mientras `orders.delivery_window_start/end` son horas arbitrarias, y `get_pre_route_snapshot` ya recibe `p_window_start` / `p_window_end` como rango libre. La ventana pasa a columna ordenable + chip de urgencia. La fecha se queda como selector explícito rotulado *Fecha de entrega*, porque es `p_delivery_date` y sin ella el RPC no responde.

7. **Fila por orden, con chevron.** También del handoff `3f`: el `order_rows` que el RPC ya devuelve anidado se aplana; el chevron expande `packages.sku_items`. Un paquete retenido en consolidación se marca en la fila expandida, porque es la causa raíz de las órdenes incompletas que `1a` señala en la columna izquierda (`Calera de Tango · sin andén que la cubra`, `ORD-48177`…).

9. **El breadcrumb ya existe: no se vuelve a dibujar.** Los artboards del canvas muestran la **página completa**, con sidebar, `ÚLTIMA MILLA`, el bloque de usuario y el breadcrumb `Operación / Despacho`. Ese breadcrumb es el del `TopBar`, que `AppLayout` ya monta sobre todo `/app/*`: `sidebar/navigation.ts` define `crumb: 'Operación'` para la sección OPERACIÓN y lo resuelve solo. Volver a dibujarlo en el header del módulo lo pondría dos veces en pantalla — que es exactamente lo que `PageShell.tsx` documenta haber quitado a propósito: «si una ruta necesita un crumb y no lo tiene, agrégalo a `EXTRA_CRUMBS` en `navigation.ts`, **no de vuelta al cuerpo de la página**». Lo que sí es propio del módulo y no está duplicado en ninguna parte es el contador `SIN RUTEAR`, que sí va en el header.

   Regla general para leer este canvas: **distinguir el chrome de la aplicación del chrome del módulo.** Un elemento que aparece en un artboard no implica que haya que construirlo; puede existir ya un nivel más arriba.

8. **Arrastrar y soltar queda fuera de este spec** — ver decisión 11. Lo que el handoff exigía que existiera junto al arrastre — selección múltiple y acciones masivas por teclado — **ya está implementado** en la fase 2, así que la columna es operable sin él.

10. **El mapa y las cuatro métricas del mock no se construyen: no son computables hoy.** `RoutePlanCanvas.tsx` ya tomó esta decisión y la documenta: *«DISTANCIA / DURACIÓN / OCUPACIÓN / CPO EST. … ninguna de las cuatro es computable hoy: vienen del optimizador OR-Tools, que no tiene cableado de frontend, y no hay proveedor de mapas. Inventar números plausibles en una pantalla de planificación sería peor que no mostrar ninguno.»* Es la decisión correcta y **se mantiene**.

    Este spec pedía polilíneas y la tarjeta de métricas en 4 columnas. Implementarlo tal cual significaría **fabricar distancia, duración y costo por orden en la pantalla donde se decide qué sube a un camión**. No se hace. El componente ya dice que es el lugar donde entran cuando lleguen, y el layout no se mueve, así que el trabajo futuro no paga nada por esperar. Mientras tanto la franja de métricas reporta lo que la selección **realmente** contiene (órdenes, paquetes, comunas, grupos).

    Vuelve cuando existan el optimizador cableado y un proveedor de mapas — es el trabajo de ruteo que ya estaba diferido a un spec futuro.

11. **Arrastrar y soltar sobre tarjetas de vehículo queda fuera.** El objetivo del arrastre no existe: la pre-ruta tiene tres columnas — no rutadas, lienzo, ruta en armado — y **ninguna columna de vehículos**. El handoff describía soltar sobre tarjetas de vehículo con barras de capacidad, que es una cuarta columna, es decir una funcionalidad nueva y no un delta sobre lo que hay.

    Además, el propio handoff exigía que el arrastre **nunca fuera el único camino**: la selección múltiple y las acciones masivas por teclado tenían que existir igual. Eso ya está hecho (fase 2), así que la columna es plenamente operable sin arrastre — que era el punto.

    La columna de vehículos y su interacción de arrastre merecen su propio spec, no un injerto sobre un rediseño.

12. **Los rechazos de lectura de `1c` se difieren a `spec-79`, no se cortan.** El mock de `1c` muestra las lecturas rechazadas intercaladas en la lista (`Ya está en RUT-2026-0087 · no se agregó`, `orden incompleta · falta 1 paquete en consolidación`). **Hoy no hay de dónde sacarlas:** ni `POST /api/dispatch/routes/[id]/scan` ni `POST /api/dispatch/load-positions/scan` persisten un rechazo — validan, devuelven el mensaje al dispositivo y no escriben nada; el `insert` en `dock_scans` está fijo en `scan_result: 'accepted'` y corre sólo después de que la validación pasa. No hay fila, no hay `audit_logs`, no hay nada.

    A diferencia del mapa y del arrastre (decisiones 10 y 11), esto **no se corta**: `spec-79` pasa a persistir los rechazos, y entonces `1c` los muestra desde datos reales. El motivo es operativo, no de esta pantalla — ver `spec-79`.

## Plan de implementación (TDD)

Cada paso: test primero, en rojo, luego implementación. Cobertura sobre 70 % (`spec-54`).

### Fase 1 — Shell del módulo `[done]`
1. Test: el header del módulo renderiza las 4 pestañas con su conteo y marca la activa desde la URL.
2. `page.tsx` (244 líneas) pasa a shell delgado de pestañas; cada pestaña es su propio árbol bajo `components/dispatch/`.
3. Test: el contador `SIN RUTEAR` del header. **El breadcrumb NO se implementa aquí** — ver decisión 9.

### Fase 2 — `1a` Pre-ruta (delta sobre las columnas existentes) `[done]`
4. **`RouteBuilder` NO se parte aquí** — eso es fase 4 (`1c`). Esta fase trabaja sobre `UnroutedColumn`, `RoutePlanCanvas` y `RouteDraftPanel`, que ya existen.
5. Test: fila por orden con chevron que expande `sku_items`; paquete retenido marcado.
6. Test: filtros nuevos (comuna, andén, cliente, ventana libre, solo con problemas) y ausencia de las 4 franjas fijas.
7. Test: pie de selección («110 seleccionadas · 254 paquetes · 2 comunas») y acciones masivas.
8. **El mapa y su tarjeta de métricas quedan fuera** — ver decisión 10. `RoutePlanCanvas.tsx` **no se toca**.

### Fase 3 — `1b` En carga `[done]`
9. Test: tarjeta por ruta con sus 4 estados del mock — `EN CARGA`, `LISTA PARA DESPACHO`, `DETENIDA`, `BORRADOR`.
10. Test: `DETENIDA` aparece cuando no hay escaneos en N minutos y nombra la consecuencia («quedan 89 paquetes en el andén»).
11. Test: *Despachar a DispatchTrack* sólo se ofrece en `LISTA PARA DESPACHO` (decisión 4).
12. Test: panel de cuadrillas activas con su ritmo y estado.

### Fase 4 — `1c` Seguimiento `[done]`
12b. **Partir `RouteBuilder.tsx`** (364 líneas, ya sobre el límite de 300). Resuelto por dos vías: `RouteBuilder.tsx` perdió el escaneo y el sellado por completo (decisión 4 — desktop nunca vuelve a escanear ni cerrar, a ningún status) y quedó en 200 líneas divididas en `RouteBuilderHeader.tsx`/`RouteBuilderPackageList.tsx`; el modo solo-lectura no creció ese archivo — es la pantalla nueva `RouteTrackingView.tsx` (y sus propios sub-componentes), que `DispatchRouteSurface.tsx` monta en vez de `RouteBuilder` cuando `routes.status === 'loading'`. `RoutePanel.tsx` perdió el botón «Cerrar Ruta».
13. Test: badge `SOLO LECTURA`; no se monta ninguna acción de escaneo ni de cierre. Hecho en `RouteTrackingView.test.tsx`.
14. Test: último cargado, lista de paquetes, y ocupación del vehículo. Hecho — **sin** las filas de rechazo: decisión 12 es explícita en que hoy no hay de dónde sacarlas (`dock_scans` sólo persiste `scan_result: 'accepted'`); se difieren a spec-79 H4, con comentario en `RouteTrackingScanList.tsx` nombrándolo.

### Fase 5 — `1d` En ruta `[pending]`
15. Test: métricas de cabecera (entregadas, pendientes, fallidas, OTIF) y el sello `DT SINCRONIZADO`.
16. Test: orden por incidencia; *Completadas* como filtro de la misma tabla.

### Fase 6 — Cierre `[pending]`
17. `npm run test -- --pool=forks` y mutation-test antes de push. No hay prettier en este repo.
18. **Sin E2E nuevo.** Decisión del usuario: el E2E de Despacho se concentra en `spec-76` y `spec-77`, donde hay lector real, dispositivo real y una acción irreversible. Aquí el E2E sólo repetiría lo que ya cubren los tests de componente, y Despacho todavía no tiene fixture de E2E — construirla es tarea de `spec-76`. `e2e/dispatch-route.spec.ts` se deja como está (hoy sólo afirma una redirección de URL, no comportamiento).
19. Verificación responsive: las tres columnas colapsan a pestañas bajo 1024px (regla del handoff, *Interactions & Behavior*).

## Riesgos

- **`get_pre_route_snapshot` se redefinió en `spec-74`.** Si hay que tocarlo, usar como plantilla la definición de la migración **más reciente** (`20260902000001_spec74_phase3_partially_staged.sql`), nunca la original — regla de `CLAUDE.md`.
- **Dos tablas de vehículos.** `vehicles` y `fleet_vehicles` coexisten; la capacidad está sólo en la segunda. Leer de la equivocada da barras vacías silenciosamente.
- **El mapa puede no existir hoy en pre-ruta.** Si no hay proveedor, `1a` se entrega con el contenedor y las polilíneas sobre datos del RPC, y el mapa real queda anotado, no inventado.
