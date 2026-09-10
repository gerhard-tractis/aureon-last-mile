# spec-94 — Recogida: cuatro estados, y la carga que no estaba en ninguno

**Status:** backlog
**Verify:** unit, sql, e2e-qa
**Downstream:** spec-82-recogida-movil-asignacion-y-ruta.md, spec-83-recogida-escritorio-datos-faltantes.md

## El hallazgo

QA, 2026-09-10. Cuatro cargas de Musan sembradas, y la pantalla de Recogida en
escritorio muestra tres: una en Pendientes, dos en Completados. La cuarta no
está en ninguna pestaña, ni en Ops Control, ni en ningún otro sitio.

Estado real en la base de datos de QA ese día:

| Carga | `status` | `reception_status` | `pickup_route_id` | Dónde se ve |
|---|---|---|---|---|
| `CARGA-EASY-002` | pending | — | — | Pendientes |
| `CARGA-EASY-001` | completed | received | ✓ | Completados |
| `CARGA-PARIS-002` | completed | received | ✓ | Completados |
| `CARGA-PARIS-001` | in_progress | **NULL** | **PR-2026-3524** | **en ninguna parte** |

`CARGA-PARIS-001` está enganchada a la ruta de recogida `PR-2026-3524`,
`in_progress` desde las 01:25 de ese día, con `lider@musan.com` de líder y el
usuario `…018` de tripulación. Sus 28 bultos siguen todos en `ingresado`: la
ruta se abrió y se abandonó sin escanear nada.

## Por qué desaparece

Las tres pestañas de escritorio **no particionan** el espacio de estados:

- `get_pending_manifests` (`20261003000001`) excluye toda carga cuyo manifiesto
  tenga `status='completed' OR reception_status IS NOT NULL OR pickup_route_id
  IS NOT NULL` — la exclusión de spec-61.
- `get_in_transit_manifests` exige `reception_status IS NOT NULL`, que sólo se
  escribe cuando la ruta pasa a `in_transit`
  (`trg_pickup_routes_set_manifest_reception_status`).
- `get_completed_manifests` exige `status = 'completed'`.

Un manifiesto **enganchado a una ruta pero todavía no entregado** no cumple
ninguna de las tres. Su única superficie es el panel de ruta activa, y ése lee
`get_my_active_pickup_route()`, que está acotado al usuario firmado (líder **o**
tripulación activa). Con `admin@musan.com` — que no es ninguno de los dos — la
carga no existe en la pantalla. Tampoco llega al panel Recogida de Ops Control,
que exige ≥1 bulto `verificado` y ésta tiene cero.

Segunda cara del mismo agujero: `CancelRouteButton` sólo se renderiza cuando
`activeRoute.driver_id === userId`, así que un admin tampoco puede liberar la
ruta desde la UI — aunque `cancel_pickup_route` sí le autoriza por rol.

## El modelo de estados

La base de datos ya distingue los dos tramos del viaje; lo que faltaba eran las
etiquetas y la cuarta pestaña. Cuatro cubos mutuamente excluyentes, sin solape
y sin hueco:

| Pestaña | Predicado sobre `manifests` | Significado |
|---|---|---|
| **Por retirar** | sin fila de manifiesto, o `pickup_route_id IS NULL AND reception_status IS NULL AND status <> 'completed'` | sigue en el punto de recogida, sin cuadrilla asignada |
| **En punto de retiro** | `pickup_route_id IS NOT NULL AND reception_status IS NULL AND status <> 'completed'` | cuadrilla asignada: yendo o escaneando |
| **Camino a bodega** | `reception_status IS NOT NULL AND status <> 'completed'` | retiro verificado, el camión vuelve al hub |
| **En bodega** | `status = 'completed'` | recibida / cerrada |

Las claves internas siguen siendo `pending` / `routed` / `in_transit` /
`completed`: **sólo cambian las etiquetas en castellano**, así que ni los tests
ni las query keys se mueven por un renombrado.

**El cubo nuevo es a nivel de operador, no del usuario firmado.** Es todo el
punto: `get_my_active_pickup_route()` es por usuario a propósito — responde
«¿en qué estoy trabajando yo?» — y esta pestaña responde otra pregunta
distinta, «¿dónde está cada carga ahora mismo?». Heredar aquel alcance
reproduciría el agujero.

## Vocabulario

Se eligió nombrar **el lugar físico de los bultos**, no el tramo del viaje: es
la pregunta que se hace quien supervisa, y desambigua ida y vuelta sin
explicación. «En ruta» junto a «En tránsito» habría sido peor que el estado
actual.

**Recepción no se toca.** `ArrivalsPanel`, `IncomingRoutesList` y
`arrivals.ts` siguen diciendo «En tránsito» para ese mismo estado de base de
datos. Allí el observador ya está en la bodega, así que «En tránsito» se lee
como «viene hacia mí» y no compite con nada; la ambigüedad sólo existe en
Recogida, que es donde hay dos tramos que nombrar. Queda anotado como lo que
es: dos nombres para un mismo estado, en dos pantallas que rara vez se miran
juntas.

## Fase 1 — `get_routed_manifests` `[pending]`

**Depende de:** ninguna

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP nuevo en `packages/database/supabase/tests/`

RPC nueva, `LANGUAGE sql STABLE SECURITY INVOKER`, misma forma que sus tres
hermanas (`get_pending_manifests`, `get_in_transit_manifests`,
`get_completed_manifests`), acotada por `public.get_operator_id()` y
`deleted_at IS NULL`.

Predicado: `pickup_route_id IS NOT NULL AND reception_status IS NULL AND status
<> 'completed'`.

Devuelve las columnas de manifiesto que ya devuelven sus hermanas, más lo que
la fila necesita para ser accionable:

- `route_id`, `route_code`, `route_started_at`, `driver_name` — JOIN a
  `pickup_routes` y de ahí a `users`.
- `verified_count` — **no es decorativo**: la guarda 7 de
  `remove_manifest_from_route` rechaza cualquier manifiesto que ya tenga un
  escaneo `verified`. Sin esta columna la UI ofrecería un botón que siempre
  lanza excepción.

`get_pending_manifests` **no se modifica**. Su cláusula de exclusión ya deja
fuera exactamente lo que esta RPC recoge, así que ningún comportamiento
existente se mueve. Si en el futuro hubiera que tocarla, se re-templa desde
`20261003000001_spec83_fase2_pending_manifests_pickup_window.sql`, la última
definición — la regla de `CLAUDE.md`.

Tampoco hace falta trabajo de autorización nuevo: `remove_manifest_from_route`
ya admite `operations_manager` / `admin` / `super_admin` sobre una ruta ajena,
y ya deja el manifiesto en forma limpia de `pending` (limpiando `completed_at`
y las cuatro columnas de firma — importa, porque una carga cerrada por la vía
de todo-discrepancias puede llegar a este estado).

**Verificación:** pgTAP con las cuatro cargas del fixture en los cuatro
estados, comprobando que **cada una aparece en exactamente una** de las cuatro
RPC. Ésa es la prueba que no existía: hoy ninguna afirma la partición, y por
eso el hueco pasó desapercibido. `scripts/pgtap-local.sh` (los tests SQL no
corren en CI).

## Fase 2 — la pestaña «En punto de retiro» y el renombrado `[pending]`

**Depende de:** spec-94 fase 1

**Archivos:** `apps/frontend/src/hooks/pickup/useRoutedManifests.ts`, `apps/frontend/src/hooks/pickup/usePickupManifestTabs.ts`, `apps/frontend/src/components/pickup/RoutedManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupDesktopView.tsx`, `apps/frontend/src/app/app/pickup/page.tsx`, `apps/frontend/src/components/pickup/PickupManifestTabs.tsx`, `apps/frontend/src/components/pickup/PickupManifestTabs.test.tsx`

- `useRoutedManifests.ts` — hook nuevo, junto a los otros tres, mismas
  `PICKUP_QUERY_OPTIONS`.
- `RoutedManifestTable.tsx` — tabla propia, con su juego de columnas (ruta ·
  líder · abierta hace · bultos · acciones). **No** una novena columna en
  `ManifestTable`, cuyo grid de píxeles fijo ya va por ocho y el fichero por
  232 líneas.
- `usePickupManifestTabs.ts` — `page.tsx` está hoy en **exactamente 300
  líneas**, el límite de `CLAUDE.md`. Las cuatro consultas y el mapeo a filas
  se extraen aquí, así que la pestaña nueva entra sin que el fichero crezca.
- Renombrado de etiquetas en `PickupDesktopView.tsx` (`TABS` y los tres
  `emptyMessage`), claves internas intactas.
- Móvil sin cambios: sigue con sus tres secciones. Es la pantalla de inicio de
  turno de la cuadrilla, no una superficie de supervisión.
- **Limpieza en alcance:** `PickupManifestTabs.tsx` está muerto — sólo lo
  importa su propio test; `page.tsx` usa `PickupDesktopView`. Lleva además el
  vocabulario viejo («Activos / En tránsito / Completados»), así que dejarlo
  significa que un grep de las etiquetas nuevas encuentra un fichero que
  miente. Se borran los dos.

## Fase 3 — «Quitar de la ruta» desde la pestaña `[pending]`

**Depende de:** spec-94 fase 2

**Archivos:** `apps/frontend/src/components/pickup/RoutedManifestTable.tsx`, `apps/frontend/src/hooks/pickup/useRemoveManifestFromRoute.ts`

Cada fila ofrece «Ver ruta» y «Quitar de la ruta». La segunda llama a
`remove_manifest_from_route(p_route_id, p_manifest_id)`, que ya existe
(spec-64) y ya autoriza al rol: deja `pickup_route_id = NULL` y la carga vuelve
a «Por retirar», con la ruta viva para las demás cargas.

**La acción se deshabilita cuando `verified_count > 0`**, con la razón escrita
en la fila — «ya tiene N bultos verificados; debe cerrarse desde la ruta». Es
la semántica real de la guarda 7, dicha por delante en vez de descubierta como
un toast de error.

## No incluido, y por qué

**Caducidad de rutas abandonadas.** Nada en el sistema envejece una ruta de
recogida abierta y sin actividad: `PR-2026-3524` lleva horas así, y esta
pestaña la mostrará indefinidamente como «abierta hace N h». Es una decisión de
política con riesgo real —una cuadrilla tarda horas de forma legítima— y no una
consecuencia de este hallazgo. Se nombra aquí para que no se lea como olvido;
si se construye, será en un spec propio.
