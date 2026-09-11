# spec-94 — Recogida: cuatro estados, y la carga que no estaba en ninguno

**Status:** in progress
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

Los cubos miran **dónde están los bultos**, no en qué punto del papeleo va la
carga. Y la columna que sabe dónde están, cuando hay una ruta de por medio, es
**`pickup_routes.status`** — no `manifests.reception_status`, que no distingue
una carga cerrada en el andén de una que ya salió. La sección siguiente explica
por qué, y cuánto costó averiguarlo.

**Cuando hay ruta viva, manda la ruta.** «Ruta viva» = existe la fila de
`pickup_routes` referenciada por `pickup_route_id` y su `deleted_at IS NULL`.

| Pestaña | Predicado (manifiestos vivos: `deleted_at IS NULL AND status <> 'cancelled'`) | Significado |
|---|---|---|
| **Por retirar** | sin ruta viva, `reception_status IS NULL`, `status <> 'completed'` | sigue en el punto de recogida, sin cuadrilla asignada |
| **En punto de retiro** | ruta viva con `pr.status NOT IN ('in_transit','received')` | la cuadrilla está allí: yendo, escaneando, o ya cerrada con el camión sin arrancar |
| **Camino a bodega** | ruta viva con `pr.status = 'in_transit'`, **o** sin ruta viva y `reception_status IN ('awaiting_reception','reception_in_progress')` | el camión salió hacia el hub |
| **En bodega** | ruta viva con `pr.status = 'received'`, **o** sin ruta viva y (`reception_status = 'received'` **o** `status='completed' AND reception_status IS NULL`) | recibida en el hub, o cerrada sin ruta (flujo viejo) |

**Exhaustivo y disjunto**, y se comprueba así: **con** ruta viva decide
`pr.status`, y el cubo 2 se lleva todo lo que no sea `in_transit` ni `received`
— incluido `draft`, y cualquier valor que el enum gane mañana. Por eso está
escrito como negación y no como lista: una lista positiva abriría un hueco
nuevo cada vez que alguien añada un estado de ruta, que es exactamente el fallo
que este spec existe para cerrar. **Sin** ruta viva decide `reception_status`
(cubo 3 sus dos valores intermedios, cubo 4 `received`), y si también es NULL
decide `status` (cubo 4 si `completed`, cubo 1 si no). El enum de recepción
tiene exactamente tres valores (`20260318000001:72`), así que los cubos 3 y 4
cubren el dominio no-nulo sin solaparse. Ningún estado vivo queda fuera y
ninguno cae en dos.

**Una ruta soft-deleted ya no esconde nada.** No vacía
`manifests.pickup_route_id`, pero tampoco es «ruta viva», así que el manifiesto
cae por sus propias columnas en el cubo 1, 3 o 4 en vez de desaparecer. Esa
trampa la resuelve ahora el modelo, no una cláusula del `JOIN`.

`reception_status='received'` con `status <> 'completed'` **no es alcanzable**:
`20260812000006:185-189` escribe las dos columnas en el mismo `UPDATE`, y la
rama `'received'` del trigger (`20260625000001:197-200`) sólo dispara después
de él. Por eso el brazo sin-ruta del cubo 4 no necesita mirar `status` para el
caso `received`.

Las claves internas siguen siendo `pending` / `routed` / `in_transit` /
`completed`: **sólo cambian las etiquetas en castellano**, así que ni los tests
ni las query keys se mueven por un renombrado.

**El cubo nuevo es a nivel de operador, no del usuario firmado.** Es todo el
punto: `get_my_active_pickup_route()` es por usuario a propósito — responde
«¿en qué estoy trabajando yo?» — y esta pestaña responde otra pregunta
distinta, «¿dónde está cada carga ahora mismo?». Heredar aquel alcance
reproduciría el agujero.

## Por qué manda la ruta, y no `status` ni `reception_status`

**Contra `status`.** `close_manifest` (`20260916000001:167-174`) escribe
`status='completed'` y su `UPDATE` no toca `pickup_route_id` ni
`reception_status`. Así que una carga cerrada y firmada en el andén del
retailer, con la ruta todavía `in_progress`, es `completed` con los bultos en
el camión, en el punto de retiro, y pueden estarlo durante horas. Un modelo que
la mandara a «En bodega» por su `status` afirmaría algo falso sobre dónde están
los bultos — y nombrar el lugar físico es justamente la regla que elegimos. La
etiqueta vieja («Completados») nunca afirmó una ubicación, así que nunca se
equivocó; la nueva sí lo haría.

**Contra `reception_status`, que es lo que costó la tercera vuelta.** Leer el
cuerpo de `close_manifest` no basta: hay un trigger `BEFORE UPDATE` vivo desde
spec-08 y nunca redefinido, `trg_manifest_reception_status`
(`20260318000001:295-319`), que rellena `reception_status='awaiting_reception'`
en **toda** transición hacia `status='completed'` cuando viene NULL — sin mirar
`pickup_route_id` ni la ruta. Verificado contra `pg_proc` en la base de QA, no
deducido del fichero.

Consecuencia: `awaiting_reception` **no significa «va en camino»**. Significa
«cerrada, sin recibir todavía», y se escribe en dos situaciones que no se
parecen: cuando la ruta arranca de verdad (`close_pickup_route` → ruta
`in_transit` → trigger de spec-47), y cuando se cierra una carga con el camión
todavía parado en el andén. Un modelo que leyera esa columna mandaría la
segunda a «Camino a bodega» con la cuadrilla aún dentro de la bodega del
retailer — la misma mentira que la versión anterior, una columna más allá.

La única columna del sistema que sabe si el camión salió es
`pickup_routes.status`. Por eso manda ella.

Ejemplo del mismo camión, al mismo tiempo, con el modelo corregido:

| | CARGA-A (cerrada en el andén 09:00) | CARGA-B (sin cerrar) |
|---|---|---|
| 09:00–11:00, camión parado en el andén | En punto de retiro, con chip «cerrada 09:00» | En punto de retiro |
| 11:00–13:00, en la carretera | Camino a bodega | Camino a bodega |

`reopen_pickup_route` (`20260812000005:255-262`) llega al mismo estado por el
otro lado: devuelve la ruta a `in_progress` y limpia `reception_status`, pero
no revierte `manifests.status`. Con la ruta mandando, esa carga vuelve sola a
«En punto de retiro», que es donde está — y ya no depende de qué columna del
manifiesto quedó a medio limpiar.

**Coste aceptado:** el cubo 2 mezcla «por escanear» con «ya cerrada». Se
distinguen por un chip en la fila, no por pestaña. Es el precio de que la
pestaña signifique un lugar y no un trámite.

**Segundo coste, del mismo modelo:** si se cancela la ruta de una carga ya
cerrada, el trigger la desengancha y limpia `reception_status`
(`20260625000001:203-207`) pero no revierte `status`, así que aparece en «En
bodega» sin haberse movido nunca del andén. Es raro —cancelar una ruta con
cargas cerradas dentro— y no tiene arreglo desde este spec: haría falta que el
trigger revirtiera `status`, que es cirugía sobre spec-47. Queda dicho.

## `'cancelled'`: quién lo escribe, y por qué no tiene pestaña

`manifest_status_enum` incluye `'cancelled'` (`20260310100000:33`) y el frontend
lo modela como estado terminal (`pickupMobileHelpers.ts:45,49`).

**Sí tiene un productor, y está en QA.** El generador de escenarios
(`packages/database/seed-qa/scenarios/pickup.ts:38-43`) inserta cuatro
manifiestos, uno por valor de `reception_status_enum`, y el cuarto (`:42`) es
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
   compañeras (`:39-41`) tampoco tienen filas en `orders`. No representa a una
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

## Las fases 1 y 2 se mergean juntas

**La fase 1 no se puede desplegar sola.** Su migración saca de
`get_completed_manifests` toda carga cerrada en el andén con la ruta todavía
`in_progress` — el estado normal de la operación durante horas — y quien la
recoge es `get_routed_manifests`, a la que **ningún hook del frontend llama
hasta la fase 2**. Entre un merge y el otro, esas cargas desaparecerían de
«Completados», del StatTile «Completados hoy» y de `TodayClosuresPanel` con sus
faltantes: el agujero de `CARGA-PARIS-001` ensanchado a la operación normal, y
esta vez causado por nosotros.

Como el merge a `main` despliega, las dos fases van en **un solo PR**. La fase 3
sí puede ir aparte: añade una acción, no cambia ningún predicado.

Hallado en el review de la fase 1 (2026-09-10), no al planificar — la tabla de
dependencias decía «fase 2 depende de fase 1» y eso es cierto para construir,
pero no dice nada sobre desplegar. Son dos preguntas distintas.

## Fase 1 — las cuatro RPC, y la partición demostrada `[in_progress]`

**Depende de:** ninguna

**Archivos:** migración nueva en `packages/database/supabase/migrations/`, test pgTAP nuevo en `packages/database/supabase/tests/`

**Las cuatro, no una.** Un borrador anterior creaba `get_routed_manifests` y
dejaba `get_in_transit_manifests` y `get_completed_manifests` particionando por
`status`. Eso no es un matiz de redacción: con esas dos intactas, la carga
cerrada en el andén la devolvían **dos RPC a la vez** — un solape real, en el
estado normal de la operación — y en cuanto salía el camión la devolvía sólo
`get_completed_manifests`, o sea «En bodega» con el camión en la carretera: el
hallazgo original, intacto. La verificación de más abajo
falla contra su propio fixture obligatorio. Una migración, cuatro funciones.

Cada una se re-templa desde su última definición — la regla de `CLAUDE.md`:

| Función | Última definición | Predicado nuevo |
|---|---|---|
| `get_pending_manifests` | `20261003000001` | cubo 1, más el brazo `UNION ALL` de abajo |
| `get_routed_manifests` | *nueva* | cubo 2 |
| `get_in_transit_manifests` | `20260813000001` | cubo 3 |
| `get_completed_manifests` | `20261004000001` | cubo 4 |

**Las cuatro necesitan el `LEFT JOIN` a `pickup_routes`**, no sólo la nueva:
desde que manda la ruta, «sin ruta viva» es parte del predicado de los cubos 1,
3 y 4, y eso no se puede evaluar sin mirar la tabla. `ruta_viva` se escribe una
vez —`pr.id IS NOT NULL`, con el `JOIN` trayendo sólo filas no soft-deleted— y
las cuatro la usan.

Las cuatro añaden `status <> 'cancelled'`, **pero no en el mismo sitio**. En
las tres que parten de `manifests` va en el `WHERE`. En `get_pending_manifests`
va **dentro de la subconsulta `NOT IN`**, junto a `completed` /
`reception_status` / `pickup_route_id` — nunca en el `WHERE` sobre el `LEFT
JOIN` a `manifests`: ahí `m.status <> 'cancelled'` evalúa a NULL cuando no hay
fila de manifiesto, NULL no es true, y la cláusula **borraría de Pendientes
toda carga que aún no tiene fila en `manifests`**, que es exactamente el
conjunto que ese `LEFT JOIN` existe para preservar. (`(m.status IS NULL OR
m.status <> 'cancelled')` también sirve; la subconsulta es más limpia.)

Sobreviven las columnas de spec-53 (etiquetas), spec-83 fase 1
(`missing_count`) y spec-80 fase 2b (`signature_operator`) — se re-templan, no
se reescriben desde cero.

### `get_routed_manifests`

`LANGUAGE sql STABLE SECURITY INVOKER`, misma forma que sus hermanas, acotada
por `public.get_operator_id()` y `deleted_at IS NULL`. Predicado literal, para
que no haya que ir a buscarlo a la tabla del modelo:

```sql
FROM public.manifests m
LEFT JOIN public.pickup_routes pr
       ON pr.id = m.pickup_route_id
      AND pr.deleted_at IS NULL
WHERE m.operator_id = public.get_operator_id()
  AND m.deleted_at IS NULL
  AND m.status <> 'cancelled'
  AND pr.id IS NOT NULL                              -- ruta viva
  AND pr.status NOT IN ('in_transit','received')
```

`NOT IN`, no `IN ('draft','in_progress')`: el cubo 2 es el complemento, así que
un valor nuevo en `pickup_route_status_enum` aterriza aquí en vez de caerse del
modelo. Un estado de ruta nuevo que no cayera en ninguna RPC sería este mismo
bug otra vez.

**La condición de soft-delete va en el `ON`, no en el `WHERE`, en las cuatro
funciones.** En el `WHERE` convierte el `LEFT JOIN` en un `INNER` de hecho y
recrea el agujero original: una ruta soft-deleted **no** vacía
`manifests.pickup_route_id`, así que ese manifiesto se caería de esta RPC y de
las otras tres a la vez — invisible, exactamente como `CARGA-PARIS-001`. En el
`ON`, `pr.id` sale NULL, el manifiesto no tiene «ruta viva», y cae por sus
propias columnas en el cubo 1, 3 o 4, como dice el modelo.

Devuelve lo que sus hermanas, más:

- `route_code`, `route_started_at`, `driver_name`, `route_status` — del mismo
  `JOIN`, y de ahí a `users`. `route_status` es además la señal que la fase 3
  necesita para deshabilitar el botón cuando la ruta no está `in_progress`
  (guardas 2 y 3 del RPC de quitar).
- `closed_at` — `completed_at` cuando `status='completed'`, para el chip
  «cerrada HH:MM» **y para «Cierres de hoy»** (ver abajo).
- `missing_count` — la misma subconsulta que spec-83 fase 1 puso en
  `get_completed_manifests` (`COUNT(DISTINCT d.package_id)` sobre
  `discrepancies` con `kind='missing'`, `operation_type='pickup'`, no
  soft-borradas, `status <> 'resolved'`). No es simetría decorativa: es lo que
  impide que el re-templado apague la única superficie donde esa cifra se
  pinta. Ver «Cierres de hoy» más abajo.
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

### «Cierres de hoy» no puede quedarse colgando del cubo 4

`get_completed_manifests` tiene **dos** consumidores, no uno: la pestaña
(`page.tsx:99`) y `closures` (`page.tsx:118` → `completedToday`), que alimenta
el StatTile «Completados hoy» (`PickupDesktopView.tsx:125`) y
`TodayClosuresPanel`. Y `missing_count` se renderiza **únicamente** ahí
(`TodayClosuresPanel.tsx:45,48,78`) — en ningún otro sitio de la app.

Re-templar esa RPC sobre `reception_status` la saca justo de las cargas
cerradas en el andén, y el resultado no es un desfase, es una pérdida:

- **D1 09:00** — la cuadrilla cierra CARGA-A en el andén con 3 faltantes.
  `completed_at = D1 09:00`, ruta `in_progress`, `rs NULL` → cubo 2, fuera de
  `get_completed_manifests`. El panel no la muestra ese día.
- **D2** — la recepción del hub cierra, `rs='received'`, y ahora sí entra en la
  RPC. Pero `20260812000006:188` usa `COALESCE(completed_at, NOW())`: **no
  pisa** el `completed_at` de D1, y `completedToday` compara contra hoy
  (`pickupSummary.ts:51-57`). Tampoco la muestra ese día.
- **Resultado: ese cierre no aparece nunca, y sus 3 faltantes tampoco.**

La tesis de este spec —los cubos miran el lugar— vale para las **pestañas**.
`closures` no es una pestaña: es un contador de trámites, y un trámite ocurre
cuando se cierra la carga, esté donde esté el camión.

**Decisión: `closures` se construye desde las TRES fuentes** que pueden
contener un cierre de hoy — cubo 2 por `closed_at`, cubo 3 por `closed_at`,
cubo 4 por `completed_at`. Por eso las RPC de los cubos 2 y 3 devuelven
`closed_at` y `missing_count`.

**Tres y no dos**, que fue el error de la primera versión de esta sección: con
sólo los cubos 2 y 4, una carga cerrada a las 09:00 desaparece del panel a las
11:00 —cuando `close_pickup_route` manda la ruta a `in_transit` y la carga pasa
al cubo 3— y reaparece a las 13:00 al recibirse. El contador de trámites del
día parpadea hacia abajo durante todo el viaje, que son horas, y con él se
esconden los faltantes. Es la misma mentira que el spec cierra para las
pestañas, un cubo más allá.

**No hay duplicación:** los tres cubos son disjuntos por construcción, así que
una carga cerrada y recibida el mismo día sale **una** vez, con su
`completed_at` de las 09:00 preservado por el `COALESCE(completed_at, NOW())`
de `20260812000006:188`.

### La verificación

**Asignación, no sólo partición.** «Cada fila aparece exactamente una vez» pasa
en verde con la fila en la RPC equivocada: la carga cerrada con
`reception_status='awaiting_reception'` aparecía exactamente una vez —en
`get_completed_manifests`— mientras la tabla decía «Camino a bodega». La
aserción es:

> cada carga viva del operador aparece en la RPC que **su predicado nombra**, y
> en ninguna otra, con los cuatro predicados de la tabla escritos literalmente
> en el test.

(«Exactamente una vez» es un corolario de eso, no una comprobación aparte.)

**«Carga viva» son dos poblaciones, no una**, y ésta es la parte que se escapó
en la ronda anterior: toda fila viva de `manifests`, **y** todo
`external_load_id` con órdenes vivas que todavía **no** tiene fila en
`manifests`. La segunda es la mitad del contrato de `get_pending_manifests` que
el `LEFT JOIN` existe para preservar; acotar el test a `manifests` la deja
ciega justo donde el `status <> 'cancelled'` mal colocado haría daño.

Fixture, sobre el conjunto real de la tabla y no sobre cuatro filas elegidas:
carga cerrada en el andén con ruta `in_progress`, la misma tras salir el
camión (ruta `in_transit`), la misma ya recibida, carga con órdenes vivas y sin
fila de manifiesto, carga con todas sus órdenes soft-deleted, carga
`cancelled`, ruta soft-deleted, y **una ruta en `draft`** — la rama que hace
falsificable el `NOT IN` del cubo 2.

**Un fixture que cierre una carga tiene que hacerlo en dos pasos.**
`trg_manifest_reception_status` rellena `reception_status='awaiting_reception'`
en cualquier `UPDATE` que lleve a `status='completed'` con la columna en NULL,
así que un fixture de un solo paso nunca produce el estado que cree producir.
Es lo que rompió los fixtures de spec-80 fase 2b y spec-83 fase 1 al
re-templar: representan «carga recibida en el hub», y hay que escribirles
`reception_status='received'` explícitamente.

`scripts/pgtap-local.sh` — los tests SQL no corren en CI, y el contenedor es
compartido entre worktrees.

## Fase 2 — la pestaña «En punto de retiro» y el renombrado `[in_progress]`

**Depende de:** spec-94 fase 1

**Archivos:** `apps/frontend/src/hooks/pickup/useRoutedManifests.ts`, `apps/frontend/src/hooks/pickup/usePickupManifestTabs.ts`, `apps/frontend/src/hooks/pickup/useManifests.ts`, `apps/frontend/src/components/pickup/RoutedManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupDesktopView.tsx`, `apps/frontend/src/app/app/pickup/page.tsx`, `apps/frontend/src/lib/pickup/pickupPageHelpers.ts`, `apps/frontend/src/hooks/pickup/pickupSummary.ts`, `apps/frontend/src/components/pickup/TodayClosuresPanel.tsx`, `apps/frontend/src/components/pickup/ManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupManifestTabs.tsx`, `apps/frontend/src/components/pickup/PickupManifestTabs.test.tsx`, y el ripple del nullable: `apps/frontend/src/components/pickup/PickupMobileStartRoute.tsx`, `apps/frontend/src/components/pickup/PickupRouteDraftPanel.tsx`, `apps/frontend/src/components/pickup/PickupMobileClientGroup.tsx`, `apps/frontend/src/lib/pickup/pickupStartRouteGrouping.ts`

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
  lista de clientes pasa a salir de la unión de los cuatro conjuntos, y el
  buscador gana código de ruta y nombre de líder en la pestaña nueva. Eso vive
  en un `matchesSearchTermRouted` aparte, **no** dentro de
  `matchesSearchTerm`: las filas del cubo 2 son `RoutedManifest` y no
  `ManifestRow`, así que meterlo en la misma función obligaría a ensanchar el
  tipo de todas las demás. El placeholder del buscador tiene que nombrar los
  campos nuevos cuando la pestaña activa es la del cubo 2 — una capacidad que
  no se anuncia no existe para quien la necesita.
- **«Cierres de hoy» pasa a leer dos fuentes**, como decide la fase 1:
  `completedToday` (`pickupSummary.ts:51-57`) se aplica a las filas del cubo 4
  por `completed_at` y a las de `get_routed_manifests` por `closed_at`, y
  `TodayClosuresPanel` acepta las dos. Sin esto, un cierre en el andén con
  faltantes no se pinta ningún día — el detalle está en la fase 1.
- **El NULL llega vivo hasta quien decide escribir.** `order_count` /
  `package_count` pueden ser NULL (brazo 2 de `get_pending_manifests`) y eso
  significa «desconocido». Ningún mapper de filas puede coalescerlo: el `?? 0`
  tiene que vivir en el render, nunca antes. Si `totalsToRows` lo aplasta, la
  guarda de `handleRowOpen` no ve el NULL y `openPendingManifest` escribe un
  `0` fabricado en `manifests.total_orders` — permanente, y justo lo que el
  docstring de esa función prohíbe. La regla se prueba con un test que haga
  clic en una fila con `order_count: null` y afirme que el `update` **no**
  lleva `total_orders`; sin ese test la línea que protege esto se puede
  revertir sin que nada se ponga rojo.
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
