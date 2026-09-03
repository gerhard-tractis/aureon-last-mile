# Spec-75: Despacho en escritorio — pre-ruta, monitor de carga y en ruta

> **Related:** [spec-54](spec-54-ui-rebrand.md) (rebranding, fase 4 «Módulos, uno por PR»), [spec-70](spec-70-dispatch-state-machine.md) (máquina de estados de ruta), [spec-71](spec-71-load-positions-staging-pass.md) (`get_pre_route_snapshot`, posiciones de carga), [spec-72](spec-72-blocks-delivery-sequence.md) (secuencia de paradas), [spec-73](spec-73-capacity-ladder-truck-topup.md) (`fleet_vehicles.capacity_packages`), [spec-74](spec-74-per-bulto-staging.md) (staging por bulto), [spec-76](spec-76-despacho-movil-carga.md) (móvil de cuadrilla)

**Status:** backlog

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
| `1a` Pre-ruta | `/app/dispatch` pestaña Pre-ruta | Existe: `pre-route/PreRouteBoard.tsx` (125 líneas) + `RouteBuilder.tsx` (364) |
| `1b` En carga | `/app/dispatch` pestaña En carga | Existe: `DispatchInProgressTab.tsx`, tarjetas en grid |
| `1c` Seguimiento de ruta | `/app/dispatch/[routeId]` | Existe: `RoutePanel.tsx`, sin el modo solo-lectura del mock |
| `1d` En ruta / Completadas | `/app/dispatch` pestañas En ruta y Completadas | Existen como listas sin las métricas de cabecera ni el orden por incidencia |

### No-goals

- **No se toca el backend.** Las ~14 rutas bajo `api/dispatch/**` y los RPC de `spec-70`–`74` se consumen tal como están. Este spec no agrega migraciones.
- **No se implementa el móvil.** `2a`–`2l` son `spec-76` y `spec-77`; `3a` es `spec-78`.
- **No se rediseña el sidebar.** `spec-67` ya fijó la arquitectura de navegación. Las pestañas del módulo van en el header del módulo, no en el sidebar.
- **No se introduce librería de mapas nueva.** El mapa de `1a` se dibuja con el mismo enfoque que ya usa el repo; si hoy no hay mapa real en pre-ruta, se implementa el contenedor y las polilíneas con los tokens `--color-map-surface` / `--color-map-line`, no con un proveedor nuevo.
- **No se fuerza tema oscuro.** Decisión heredada de `spec-54`: el usuario elige.
- **Optimizar y crear N rutas** reusa `useCreateRouteFromSelection`. No se escribe un optimizador nuevo ni se conecta OR-Tools en este spec — queda para un spec futuro (refinamiento OR-Tools / TomTom).

## Decisiones

1. **Los tokens ya existen: no se añade ninguno.** El canvas declara `--surface`, `--text`, `--ok`… porque es un HTML autocontenido. `globals.css` ya tiene el equivalente rebrandeado y los valores coinciden exactamente con el canvas en ambos temas (`#ca9a04` / `#e6c15c` de acento, `#f8fafc` / `#13110d` de fondo, más `--color-map-surface` y `--color-text-body`). La tabla de equivalencias del handoff sigue siendo la referencia de nombres. **No** se crea una capa de tokens de módulo.

2. **`RouteBuilder.tsx` se parte, y es parte de este spec.** Tiene 364 líneas, ya viola la regla de 300, y `1a` es exactamente la pantalla que lo hace crecer: pasa a ser tres columnas simultáneas. Se divide según las tres columnas del mock — selección de órdenes, impacto geográfico, armado de la ruta — cada una con su propio árbol y su propio test. No es refactor no relacionado: es el archivo que hay que tocar para construir `1a`.

3. **La capacidad ya está en el schema, con otro nombre.** El handoff pedía `ALTER TABLE vehicles ADD COLUMN package_capacity`. Eso **no se hace**: `spec-73` ya añadió `fleet_vehicles.capacity_packages` (migración `20260904000001_spec73_vehicle_capacity.sql`), que es la columna que alimenta las barras de ocupación de `1a`, `1b` y `1c`. Ojo con las dos tablas de vehículos del repo (`vehicles` y `fleet_vehicles`): la capacidad vive en `fleet_vehicles`, y la UI debe leer de ahí. El estado *sin capacidad configurada* del mock es el caso `capacity_packages IS NULL` y se muestra como tal, sin barra falsa.

4. **`1c` es estrictamente solo lectura, y el canvas lo rotula.** Lleva un badge `SOLO LECTURA` y no monta acciones de escaneo. *Cerrar ruta* no existe aquí: cerrar es de la cuadrilla, en `2i`. **Pero despachar sí es de escritorio**: `1b` ofrece *Despachar a DispatchTrack* sobre una ruta ya en `LISTA PARA DESPACHO`, y `3a` también. La regla real es que **cerrar** es exclusivo de la cuadrilla y **despachar** lo puede hacer cualquiera de las tres superficies sobre una ruta ya cerrada. El label del artboard `1c` («cerrar y despachar se hacen desde el móvil») describe esa ruta concreta en estado `EN CARGA`, no una regla del módulo.

5. **`1d` ordena por lo que va mal, no por código de ruta.** El mock ordena por fallidas y antigüedad del último evento, y *Completadas* es la misma tabla filtrada al pie en vez de una pestaña con su propio árbol. Se implementa como una tabla con un filtro, no dos tablas.

6. **Los filtros de pre-ruta cambian como dijo el handoff `3f`.** Se eliminan las pestañas `TODAS / MAÑANA / TARDE / NOCHE`: agrupaban por franja fija mientras `orders.delivery_window_start/end` son horas arbitrarias, y `get_pre_route_snapshot` ya recibe `p_window_start` / `p_window_end` como rango libre. La ventana pasa a columna ordenable + chip de urgencia. La fecha se queda como selector explícito rotulado *Fecha de entrega*, porque es `p_delivery_date` y sin ella el RPC no responde.

7. **Fila por orden, con chevron.** También del handoff `3f`: el `order_rows` que el RPC ya devuelve anidado se aplana; el chevron expande `packages.sku_items`. Un paquete retenido en consolidación se marca en la fila expandida, porque es la causa raíz de las órdenes incompletas que `1a` señala en la columna izquierda (`Calera de Tango · sin andén que la cubra`, `ORD-48177`…).

8. **Arrastrar y soltar no es el único camino.** Los botones de acción masiva del pie de la lista se implementan junto con el drag, no después.

## Plan de implementación (TDD)

Cada paso: test primero, en rojo, luego implementación. Cobertura sobre 70 % (`spec-54`).

### Fase 1 — Shell del módulo
1. Test: el header del módulo renderiza las 4 pestañas con su conteo y marca la activa desde la URL.
2. `page.tsx` (244 líneas) pasa a shell delgado de pestañas; cada pestaña es su propio árbol bajo `components/dispatch/`.
3. Test: breadcrumb `Operación / Despacho` y el contador `SIN RUTEAR` del header.

### Fase 2 — `1a` Pre-ruta
4. Test: `RouteBuilder` partido en tres — selección, impacto, armado — cada uno monta y comunica por props tipadas.
5. Test: fila por orden con chevron que expande `sku_items`; paquete retenido marcado.
6. Test: filtros nuevos (comuna, andén, cliente, ventana libre, solo con problemas) y ausencia de las 4 franjas fijas.
7. Test: pie de selección («110 seleccionadas · 254 paquetes · 2 comunas») y acciones masivas.
8. Mapa: contenedor, polilíneas por ruta, la propuesta dasheada, tarjeta de métricas en 4 columnas.

### Fase 3 — `1b` En carga
9. Test: tarjeta por ruta con sus 4 estados del mock — `EN CARGA`, `LISTA PARA DESPACHO`, `DETENIDA`, `BORRADOR`.
10. Test: `DETENIDA` aparece cuando no hay escaneos en N minutos y nombra la consecuencia («quedan 89 paquetes en el andén»).
11. Test: *Despachar a DispatchTrack* sólo se ofrece en `LISTA PARA DESPACHO` (decisión 4).
12. Test: panel de cuadrillas activas con su ritmo y estado.

### Fase 4 — `1c` Seguimiento
13. Test: badge `SOLO LECTURA`; no se monta ninguna acción de escaneo ni de cierre.
14. Test: último cargado, lista de paquetes con sus filas de rechazo (`Ya está en RUT-…`, `orden incompleta`), y ocupación del vehículo.

### Fase 5 — `1d` En ruta
15. Test: métricas de cabecera (entregadas, pendientes, fallidas, OTIF) y el sello `DT SINCRONIZADO`.
16. Test: orden por incidencia; *Completadas* como filtro de la misma tabla.

### Fase 6 — Cierre
17. `npm run test -- --pool=forks` y mutation-test antes de push. No hay prettier en este repo.
18. **Sin E2E nuevo.** Decisión del usuario: el E2E de Despacho se concentra en `spec-76` y `spec-77`, donde hay lector real, dispositivo real y una acción irreversible. Aquí el E2E sólo repetiría lo que ya cubren los tests de componente, y Despacho todavía no tiene fixture de E2E — construirla es tarea de `spec-76`. `e2e/dispatch-route.spec.ts` se deja como está (hoy sólo afirma una redirección de URL, no comportamiento).
19. Verificación responsive: las tres columnas colapsan a pestañas bajo 1024px (regla del handoff, *Interactions & Behavior*).

## Riesgos

- **`get_pre_route_snapshot` se redefinió en `spec-74`.** Si hay que tocarlo, usar como plantilla la definición de la migración **más reciente** (`20260902000001_spec74_phase3_partially_staged.sql`), nunca la original — regla de `CLAUDE.md`.
- **Dos tablas de vehículos.** `vehicles` y `fleet_vehicles` coexisten; la capacidad está sólo en la segunda. Leer de la equivocada da barras vacías silenciosamente.
- **El mapa puede no existir hoy en pre-ruta.** Si no hay proveedor, `1a` se entrega con el contenedor y las polilíneas sobre datos del RPC, y el mapa real queda anotado, no inventado.
