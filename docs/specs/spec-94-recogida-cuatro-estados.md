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
- `get_in_transit_manifests` (`20260813000001`) exige `reception_status IS NOT
  NULL` **y** `status != 'completed'`. La segunda cláusula es la que hoy evita
  el solape con Completados; sin ella las dos pestañas mostrarían las mismas
  filas.
- `get_completed_manifests` exige `status = 'completed'`.

Un manifiesto **enganchado a una ruta pero todavía no entregado** no cumple
ninguna de las tres. Su única superficie es el panel de ruta activa, y ése lee
`get_my_active_pickup_route()` (`20260820000005:47-60`), acotado al usuario
firmado (líder **o** tripulación activa, ruta `in_progress`). Con
`admin@musan.com` — que no es ninguno de los dos — la carga no existe en la
pantalla. Tampoco llega al panel Recogida de Ops Control, que exige ≥1 bulto
`verificado` (`20260912000001`) y ésta tiene cero.

Segunda cara del mismo agujero: `CancelRouteButton` sólo se renderiza cuando
`activeRoute.driver_id === userId` (`page.tsx:243`, `route/active/page.tsx:355`),
así que un admin tampoco puede liberar la ruta desde la UI — aunque
`cancel_pickup_route` sí le autoriza por rol.

## El modelo de estados

Los cubos miran **dónde están los bultos** (`reception_status` y
`pickup_route_id`), no en qué punto del papeleo va la carga (`status`). Es una
corrección deliberada sobre el primer borrador de este spec, y la razón está en
la sección siguiente.

| Pestaña | Predicado sobre `manifests` (vivas: `deleted_at IS NULL AND status <> 'cancelled'`) | Significado |
|---|---|---|
| **Por retirar** | `pickup_route_id IS NULL AND reception_status IS NULL AND status <> 'completed'` | sigue en el punto de recogida, sin cuadrilla asignada |
| **En punto de retiro** | `pickup_route_id IS NOT NULL AND reception_status IS NULL` | cuadrilla asignada: yendo, escaneando, o ya cerrada con el camión todavía allí |
| **Camino a bodega** | `reception_status IN ('awaiting_reception','reception_in_progress')` | retiro verificado, el camión vuelve al hub |
| **En bodega** | `reception_status = 'received'`, **o** `status='completed' AND pickup_route_id IS NULL AND reception_status IS NULL` | recibida en el hub, o cerrada sin ruta (flujo viejo) |

**Exhaustivo y disjunto**, y se comprueba así: con `reception_status` no nulo,
su valor decide entre el cubo 3 y el 4 — el enum tiene exactamente tres valores
(`20260318000001:72`), así que los dos cubos cubren el dominio no-nulo sin
solaparse; con `reception_status` nulo, decide `pickup_route_id` (cubo 2 si lo
hay); sin ninguno de los dos, decide `status` (cubo 4 si `completed`, cubo 1 si
no). Ningún estado vivo queda fuera y ninguno cae en dos.

`reception_status='received'` con `status <> 'completed'` **no es alcanzable**:
`20260812000006:185-189` escribe las dos columnas en el mismo `UPDATE`, y la
rama `'received'` del trigger (`20260625000001:197-200`) sólo dispara después
de él. Por eso el brazo 1 del cubo 4 no necesita mirar `status`.

Las claves internas siguen siendo `pending` / `routed` / `in_transit` /
`completed`: **sólo cambian las etiquetas en castellano**, así que ni los tests
ni las query keys se mueven por un renombrado.

**El cubo nuevo es a nivel de operador, no del usuario firmado.** Es todo el
punto: `get_my_active_pickup_route()` es por usuario a propósito — responde
«¿en qué estoy trabajando yo?» — y esta pestaña responde otra pregunta
distinta, «¿dónde está cada carga ahora mismo?». Heredar aquel alcance
reproduciría el agujero.

## Por qué los cubos no miran `status`

`close_manifest` (`20260916000001:167-174`) escribe `status='completed'` y **no
toca `pickup_route_id` ni `reception_status`** — verificado contra la función
viva en QA, no deducido del fichero. Así que una carga cerrada y firmada en el
andén del retailer, con la ruta todavía `in_progress`, queda `completed` con
`reception_status IS NULL`: los bultos están en el camión, en el punto de
retiro, y pueden estarlo durante horas.

Un modelo que mandara esa carga a «En bodega» por su `status` afirmaría algo
falso sobre dónde están los bultos — y nombrar el lugar físico es justamente la
regla que elegimos. La etiqueta vieja («Completados») nunca afirmó una
ubicación, así que nunca se equivocó; la nueva sí lo haría. Ejemplo del mismo
camión, al mismo tiempo, con el modelo corregido:

| | CARGA-A (cerrada en el andén 09:00) | CARGA-B (sin cerrar) |
|---|---|---|
| 09:00–11:00, camión parado en el andén | En punto de retiro, con chip «cerrada 09:00» | En punto de retiro |
| 11:00–13:00, en la carretera | Camino a bodega | Camino a bodega |

`reopen_pickup_route` (`20260812000005:255-256`) llega al mismo estado por el
otro lado: devuelve la ruta a `in_progress` y limpia `reception_status`, pero
no revierte `manifests.status`. Con cubos que miran ubicación, esa carga vuelve
sola a «En punto de retiro», que es donde está.

**Coste aceptado:** el cubo 2 mezcla «por escanear» con «ya cerrada». Se
distinguen por un chip en la fila, no por pestaña. Es el precio de que la
pestaña signifique un lugar y no un trámite.

## `'cancelled'`: quién lo escribe, y por qué no tiene pestaña

`manifest_status_enum` incluye `'cancelled'` (`20260310100000:33`) y el frontend
lo modela como estado terminal (`pickupMobileHelpers.ts:45,49`).

**Sí tiene un productor, y está en QA.** El generador de escenarios
(`packages/database/seed-qa/scenarios/pickup.ts:38-41`) inserta cuatro
manifiestos, uno por valor de `reception_status_enum`, y el cuarto es
`QA-LOAD-004`: `status='cancelled'` **con** `reception_status='awaiting_reception'`.
Una versión anterior de este spec afirmó que no lo escribía nadie; el grep se
había hecho sobre `packages/database/supabase/migrations/` y `apps/`, no sobre
`packages/database/seed-qa/`. Ninguna migración ni código de aplicación lo
escribe — pero el seed de QA sí, y QA es donde corre el `e2e-qa` que este spec
declara.

**Decisión: una carga cancelada no aparece en ninguna de las cuatro pestañas**,
y los cuatro predicados la excluyen. Las razones, en orden:

1. `QA-LOAD-004` es cobertura sintética de enum, no un estado operativo: existe
   para que el seed toque los tres valores de `reception_status_enum`, y sus
   compañeras (`:38-40`) tampoco tienen filas en `orders`. No representa a una
   carga que alguien vaya a buscar en pantalla.
2. `remove_manifest_from_route` termina con `status = 'pending'`, así que el
   botón de la fase 3, sobre una carga cancelada, la **des-cancelaría** en
   silencio.

**Efecto visible en QA, dicho por delante:** hoy `QA-LOAD-004` aparece en «En
tránsito» (`get_in_transit_manifests` sólo excluye `completed`). Tras la fase 1
desaparece de la pantalla. Es intencionado, y es lo que hay que reconocer al
verlo en el `e2e-qa` en vez de tratarlo como una regresión.

Si algún día un flujo real empieza a cancelar manifiestos, `'cancelled'`
necesita su propio destino y esta decisión se reabre. Hoy no lo tiene.

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

## Fase 1 — las cuatro RPC, y la partición demostrada `[pending]`

**Depende de:** ninguna

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP nuevo en `packages/database/supabase/tests/`

**Las cuatro, no una.** Un borrador anterior creaba `get_routed_manifests` y
dejaba `get_in_transit_manifests` y `get_completed_manifests` particionando por
`status`. Eso no es un matiz de redacción: con esas dos intactas, la carga
cerrada en el andén (`status='completed'`, ruta `in_progress`, `rs NULL`) la
devuelven **`get_routed_manifests` y `get_completed_manifests` a la vez** — un
solape real, en el estado normal de la operación — y en cuanto sale el camión
la devuelve sólo `get_completed_manifests`, o sea «En bodega» con el camión en
la carretera: el hallazgo original, intacto. La verificación de más abajo
falla contra su propio fixture obligatorio. Una migración, cuatro funciones.

Cada una se re-templa desde su última definición — la regla de `CLAUDE.md`:

| Función | Última definición | Predicado nuevo |
|---|---|---|
| `get_pending_manifests` | `20261003000001` | cubo 1, más el brazo `UNION ALL` de abajo |
| `get_routed_manifests` | *nueva* | cubo 2 |
| `get_in_transit_manifests` | `20260813000001` | `reception_status IN ('awaiting_reception','reception_in_progress')` |
| `get_completed_manifests` | `20261004000001` | `reception_status='received' OR (status='completed' AND pickup_route_id IS NULL AND reception_status IS NULL)` |

Las cuatro añaden `status <> 'cancelled'`. Sobreviven las columnas de spec-53
(etiquetas), spec-83 fase 1 (`missing_count`) y spec-80 fase 2b
(`signature_operator`) — se re-templan, no se reescriben desde cero.

### `get_routed_manifests`

`LANGUAGE sql STABLE SECURITY INVOKER`, misma forma que sus hermanas, acotada
por `public.get_operator_id()` y `deleted_at IS NULL`. Devuelve lo que ellas,
más:

- `route_code`, `route_started_at`, `driver_name`, `route_status` — vía
  **`LEFT JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id AND
  pr.deleted_at IS NULL`**, y de ahí a `users`.

  **`LEFT`, y la condición en el `ON`, no en el `WHERE`.** Un borrador anterior
  filtraba la fila por `pr.deleted_at IS NULL`, lo que recrea el agujero
  original: una ruta soft-deleted **no** vacía `manifests.pickup_route_id`, así
  que ese manifiesto quedaba excluido de esta RPC, excluido de
  `get_pending_manifests` por tener ruta, y fuera de las otras dos por no tener
  `reception_status` — invisible, exactamente como `CARGA-PARIS-001`. Con
  `LEFT JOIN` la fila sobrevive y `route_status` sale NULL, que es justo la
  señal que la fase 3 necesita (guarda 2 del RPC de quitar, no la 3).
- `closed_at` — `completed_at` cuando `status='completed'`, para el chip
  «cerrada HH:MM».
- `verified_count` — la **guarda 7** de `remove_manifest_from_route` rechaza
  cualquier manifiesto con un escaneo `verified`. Se cuenta con
  `scan_result='verified' AND package_id IS NOT NULL AND deleted_at IS NULL`:
  el `package_id IS NOT NULL` es el que hace que este número signifique
  **exactamente** lo que la guarda mira. La subquery de `get_pending_manifests`
  no lo lleva, así que no vale copiarla tal cual.

### El brazo `UNION ALL` de `get_pending_manifests`

El CTE `pending` arranca en `orders` con `o.deleted_at IS NULL` y agrupa por
`(external_load_id, retailer_name)` — tiene que ser así, porque una carga puede
no tener fila en `manifests` todavía (se crea al abrir el flujo de escaneo).
Pero eso abre el mismo agujero que este spec cierra: **un manifiesto vivo del
cubo 1 cuyas órdenes estén todas soft-deleted no lo devuelve ninguna de las
cuatro RPC**. Se cierra con un brazo sobre `manifests` sin ninguna orden viva.

Tres cosas que el implementer descubriría si no estuvieran escritas:

- **`UNION ALL`, no `UNION`.** Los brazos son disjuntos por construcción (uno
  exige `EXISTS` una orden viva, el otro lo contrario), así que la
  deduplicación sobre trece columnas es un sort regalado.
- **El `ORDER BY` hay que envolverlo.** El cuerpo vigente termina en `ORDER BY
  (verified_count > 0) DESC, load_created_at DESC`, y PostgreSQL sólo admite
  nombres de columna de salida u ordinales en el `ORDER BY` de un `UNION` — no
  expresiones, y `load_created_at` ni siquiera es un nombre de salida (la
  columna se llama `created_at`). La forma que compila es `SELECT * FROM
  ( <brazo1> UNION ALL <brazo2> ) u ORDER BY (u.verified_count > 0) DESC,
  u.created_at DESC`.
- **`pickup_point`, `pickup_window_start/end` y `pickup_cutoff_time` salen NULL
  en el brazo nuevo**, porque los tres vienen de `pickup_points` vía
  `orders.pickup_point_id` y ahí no hay órdenes vivas. Es correcto:
  `20261003000001` documenta que NULL significa «sin datos», nunca «sin
  plazo». **No rellenarlos con un `COALESCE`.**

### La verificación

Dos aserciones, y la segunda es la que importa:

1. **Partición** — para toda fila viva de `manifests` del operador, la unión de
   las cuatro RPC la contiene exactamente una vez.
2. **Asignación** — cada fila viva aparece en la RPC que **su predicado
   nombra**, y en ninguna otra, con los cuatro predicados de la tabla escritos
   literalmente en el test.

Sin la segunda, la primera pasa en verde con la pantalla mintiendo: la carga
cerrada con `reception_status='awaiting_reception'` aparece exactamente una vez
—en `get_completed_manifests`— mientras la tabla dice que va en «Camino a
bodega». Es el mismo defecto que ya tuvo la versión anterior de esta sección:
un test que no puede fallar.

Sobre el conjunto real de la tabla, no sobre cuatro filas elegidas, con el
fixture ampliado a lo que el hallazgo enseñó: carga cerrada en el andén con
ruta `in_progress`, la misma tras salir el camión, carga con todas sus órdenes
soft-deleted, carga `cancelled`, ruta soft-deleted.
`scripts/pgtap-local.sh` — los tests SQL no corren en CI, y el contenedor es
compartido entre worktrees.

## Fase 2 — la pestaña «En punto de retiro» y el renombrado `[pending]`

**Depende de:** spec-94 fase 1

**Archivos:** `apps/frontend/src/hooks/pickup/useRoutedManifests.ts`, `apps/frontend/src/hooks/pickup/usePickupManifestTabs.ts`, `apps/frontend/src/hooks/pickup/useManifests.ts`, `apps/frontend/src/components/pickup/RoutedManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupDesktopView.tsx`, `apps/frontend/src/app/app/pickup/page.tsx`, `apps/frontend/src/lib/pickup/pickupPageHelpers.ts`, `apps/frontend/src/components/pickup/PickupManifestTabs.tsx`, `apps/frontend/src/components/pickup/PickupManifestTabs.test.tsx`

- `useRoutedManifests.ts` — hook nuevo. `PICKUP_QUERY_OPTIONS` está declarado
  **sin `export`** (`useManifests.ts:67`), así que hay que exportarlo — por eso
  `useManifests.ts` está en la lista de archivos.
- `RoutedManifestTable.tsx` — tabla propia (ruta · líder · abierta hace ·
  bultos · chip de cierre · acciones). **No** una novena columna en
  `ManifestTable`, cuyo grid de píxeles fijo ya va por ocho y el fichero por
  232 líneas.
- `usePickupManifestTabs.ts` — `page.tsx` está hoy en **exactamente 300
  líneas**, el límite de `CLAUDE.md`. Se extraen las **cinco** consultas de
  manifiestos que monta hoy (`usePendingManifests`, `useInTransitManifests`,
  `useCompletedManifests`, `useSignatureRescueManifests` y la nueva) con su
  mapeo a filas. No son cuatro: la de rescate también produce filas vía
  `rescueRowsFromCompleted`.
- **Nada de ternarios.** Hay cuatro sitios donde un `TabKey` nuevo cae al
  `else` de `'completed'` sin que `tsc` diga nada: el contador
  (`PickupDesktopView.tsx:156-161`), el `emptyMessage` (`:193-199`), la
  elección de tabla (`:186`) y `rowsForTab` (`page.tsx:121-122`) — este último
  haría que **la pestaña nueva mostrara Completados** bajo la etiqueta nueva.
  Los cuatro pasan a un mapa indexado por `TabKey` o a un `switch` exhaustivo,
  que es lo que convierte el olvido en error de compilación. Son cuatro
  `emptyMessage`, no tres.
- Renombrado de etiquetas en `TABS` (`PickupDesktopView.tsx:36-40`), que son
  literales y no claves i18n; claves internas intactas.
- **Buscador y `ClientFilter`** se renderizan encima de las pestañas y
  `clients` sale sólo de las pendientes (`page.tsx:119`). Si todas las cargas de
  un retailer están ruteadas, su chip desaparece justo cuando hace falta. La
  lista de clientes pasa a salir de la unión de los cuatro conjuntos, y
  `matchesSearchTerm` (`pickupPageHelpers.ts`) gana código de ruta y nombre de
  líder para que el buscador signifique algo en la pestaña nueva.
- Móvil sin cambios: sigue con sus tres secciones. Es la pantalla de inicio de
  turno de la cuadrilla, no una superficie de supervisión.
- **Limpieza en alcance:** `PickupManifestTabs.tsx` está muerto — sólo lo
  importa su propio test; `page.tsx` usa `PickupDesktopView`. Lleva además el
  vocabulario viejo («Activos / En tránsito / Completados»), así que dejarlo
  significa que un grep de las etiquetas nuevas encuentra un fichero que
  miente. Se borran los dos.

## Fase 3 — «Quitar de la ruta» desde la pestaña `[pending]`

**Depende de:** spec-94 fase 2

**Archivos:** `apps/frontend/src/components/pickup/RoutedManifestTable.tsx`, `apps/frontend/src/components/pickup/RoutedManifestTable.test.tsx`

Cada fila ofrece «Ver ruta» y «Quitar de la ruta». La segunda **reutiliza
`useRemoveManifestFromRoute`**, que ya existe con su test y ya lo usa
`route/active/page.tsx:55` — no se crea nada nuevo. Detrás está
`remove_manifest_from_route(p_route_id, p_manifest_id)` (spec-64,
`20260824000004`), que ya autoriza a `operations_manager` / `admin` /
`super_admin` sobre una ruta ajena (guarda 4) y deja el manifiesto en forma
limpia de `pending`, limpiando `completed_at` y las cuatro columnas de firma.
La única re-emisión posterior de esa función (`20261002000001:214-215`) es un
`REVOKE`, no un cambio de cuerpo.

La acción se **deshabilita, con la razón escrita en la propia fila**, en tres
casos — cada uno es una guarda del RPC dicha por delante en vez de descubierta
como un toast:

| Condición | Guarda | Razón mostrada |
|---|---|---|
| `verified_count > 0` | 7 | ya tiene N bultos verificados; debe cerrarse desde la ruta |
| `status = 'completed'` | ninguna | la carga ya está cerrada y firmada: quitarla borraría la firma |
| `route_status IS NULL` o `<> 'in_progress'` | 2 y 3 | la ruta ya no admite cambios |

El segundo no lo cubre ninguna guarda del RPC, y es el que más duele: una carga
cerrada por la vía de todo-discrepancias tiene **cero** escaneos `verified`, así
que la guarda 7 la deja pasar y el `UPDATE` borra la firma del cliente. El
`UPDATE` limpia esas columnas a propósito (`20260824000004`, nota del final:
sin eso la carga volvería a «pendiente» arrastrando `completed_at` y una firma
de una entrega que se acaba de deshacer), y `audit_logs` conserva los valores —
pero eso no es motivo para ofrecer el botón.

## No incluido, y por qué

**Caducidad de rutas abandonadas.** Nada en el sistema envejece una ruta de
recogida abierta y sin actividad: `PR-2026-3524` lleva horas así, y esta
pestaña la mostrará indefinidamente como «abierta hace N h». Es una decisión de
política con riesgo real —una cuadrilla tarda horas de forma legítima— y no una
consecuencia de este hallazgo. Se nombra aquí para que no se lea como olvido;
si se construye, será en un spec propio.

**`useUnassignedManifests` (`useRouteManifests.ts:205-227`).** Es una quinta
vista sobre el mismo espacio — el picker de «Agregar carga a la ruta» — con
predicado `pickup_route_id IS NULL AND deleted_at IS NULL AND status <>
'completed'`, al que le falta `reception_status IS NULL` respecto del cubo 1.
Tras el renombrado, el picker y «Por retirar» pueden mostrar conjuntos
distintos sin que nada lo explique. No se alinea aquí porque tocar el picker
arrastra el flujo de armado de ruta, que este spec no abre; queda nombrado para
que el siguiente que lo vea sepa que es conocido y no un descubrimiento.
