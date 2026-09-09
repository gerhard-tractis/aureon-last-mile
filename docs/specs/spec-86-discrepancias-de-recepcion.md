# Spec-86: Discrepancias de Recepción — el bulto que se retiró y no llegó

> **Related:** **spec-85** (**entrega la tabla única de discrepancias: fase 1
> — esquema — y fase 2 — RPCs — ya mergeadas**), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre de carga en recogida, que escribe discrepancias `operation_type = 'pickup'` vía `record_discrepancies`), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (su «2 faltantes de 44» lee la misma tabla), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (`open_route_reception`, `complete_route_reception`), [spec-62](spec-62-reception-mobile.md) (la hoja de cierre móvil), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`route_receptions` y el guard de `discrepancy_notes`)

**Status:** in progress
**Verify:** unit, sql, e2e-qa
**Bloqueado por:** nada. Fase 1 `[done]` (2026-09-09, PR #704/#707); 2a y 3
siguen `[pending]`; fase 2b — la pata de indemnización — pasó a `[parked]` el
2026-09-08 (`dd6f921`, PR #677): el usuario ya decidió que la pantalla de
indemnización es un spec aparte. Ver *Precondición* abajo y la fase 2b misma.

_Date: 2026-09-07_

> **Nota (2026-09-08, ronda de arreglos 2 de spec-85 fase 2, B-3):** este spec
> se escribió contra un esquema que todavía no existía y quedó con nombres
> inventados — `source_process` no es, y nunca fue, el nombre de ninguna
> columna. Lo que spec-85 realmente entregó: la columna es
> `operation_type public.discrepancy_operation_enum` (`'pickup' | 'reception'`),
> el origen es `manifest_id` o `route_reception_id` según ese valor, con una
> columna generada `source_id` que apunta al que corresponda, y los tres RPCs
> son `record_discrepancies(p_operation_type, p_source_id, p_items jsonb)`,
> `resolve_discrepancy(p_id, p_status, p_resolution)` y
> `get_discrepancies(p_operation_type, p_status, p_source_id)`. Este documento
> se corrigió para usar esos nombres en todo el texto de abajo — **sin
> implementar ninguna fase**: siguen `[blocked]` como estaban.

> **Corrección (2026-09-08, ronda de arreglos 3 de spec-85 fase 2, C1):** la
> nota de arriba dejó la razón de bloqueo circular — decía que el spec nace
> `[blocked]` "por diseño propio, no por spec-85", y la sección de
> *Precondición* seguía justificando eso mismo con "empezar cualquier fase
> obligaría a inventar un esquema provisional", que es exactamente la
> dependencia de spec-85 que ya está satisfecha. La sección de abajo se
> reescribió con el dictamen del re-review: **fase 3 y fase 1 están
> desbloqueadas**; sólo la mitad de la fase 2 (indemnización) sigue esperando
> al usuario.

---

## Precondición: qué está desbloqueado y qué no

Spec-85 (esquema + RPCs, fases 1 y 2) ya está mergeado. Este spec **no define
ni crea la tabla** — sólo escribe y lee filas `operation_type = 'reception'`
sobre lo que spec-85 entregó. Eso deja de ser, a partir de aquí, motivo para
que las tres fases nazcan `[blocked]` en bloque:

- **Fase 3 (panel de lectura): desbloqueada.** `get_discrepancies` existe con
  la firma exacta que esta fase cita (`p_operation_type`, `p_status`,
  `p_source_id`). No depende de nada más.
- **Fase 1 (captura al cerrar recepción): desbloqueada a nivel de
  esquema/RPC.** `record_discrepancies` existe y acepta
  `operation_type = 'reception'`. Lo que exige, y ya está advertido en la
  fase misma: reescribir `complete_route_reception` con `CREATE OR REPLACE`
  tomando como plantilla la **última** migración que la define — nunca la
  original — porque esta fase le añade el payload por paquete y la llamada al
  RPC nuevo.
- **Fase 2: dividida en 2a y 2b desde el inicio.** La pata "Resuelta" (bulto
  aparece, pasa a `resolved` vía `resolve_discrepancy`) no depende de nada que
  falte: el RPC existe y el escaneo que dispara el avance de estado ya vive en
  producción — **fase 2a**. La pata "Perdida → indemnización" — **fase 2b** —
  dependía de una decisión abierta del usuario; esa decisión ya se tomó
  (`dd6f921`, 2026-09-08, PR #677): la pantalla de indemnización sale a un
  spec aparte, y por ahora sólo queda el estado de bulto. La fase pasa de
  `[blocked]` a `[parked]` — no espera una decisión, espera su turno.

**Spec-85 debe seguir declarando `**Downstream:** spec-86`** junto a su
`**Status:**`, y ninguna de sus fases pasa a `[done]` sin releer este spec
contra lo que realmente se mergeó. Es la regla de #641, y este spec fue
exactamente el caso que describe: escrito contra una tabla que todavía no
existía, y quedó con nombres inventados hasta la corrección de cabecera.

---

## Goal

Que un bulto **retirado en origen y no llegado al hub** deje un registro por
paquete, con dueño y desenlace, en vez de desaparecer.

Hoy no lo deja, y la orden entera se vuelve invisible.

---

## El agujero, medido

Encontrado en QA (Musan) el 2026-09-07, ruta `PR-2026-2298`:

```
route_receptions:  expected 24 · received 22 · unexpected 0
                   status completed · discrepancy_notes: "Corregir"
```

La recepción se cerró **dos bultos corta**, y lo único que quedó escrito fue esa
palabra en una caja de texto. Los dos bultos:

| orden | paquete | estado | pickup scan | reception scan | nota |
|---|---|---|---|---|---|
| CARGA-EASY-001-ORD-01 | CTN-1 | `verificado` | 1 | **0** | **0** |
| CARGA-EASY-001-ORD-02 | CTN-1 | `verificado` | 1 | **0** | **0** |

Se retiraron en origen (hay `pickup_scan` verificado) y nunca se recibieron. Y
como consecuencia, **las dos órdenes no aparecen en ninguna parte de Ops
Control**:

- **No en Recogida** — `get_ops_control_snapshot` (última def
  `20260912000001`) exige que la carga esté `awaiting_reception` /
  `reception_in_progress`, o en ruta `in_progress`. La carga está `received` y
  la ruta también. Ambas ramas fallan.
- **No en Recepción** — esa etapa exige estado de orden `en_bodega`.
- **En ninguna otra** — `statusStage()` (`lib/ops-control/stage.ts`) mapea
  `en_bodega`, `asignado`, `en_carga`, `listo_para_despacho` y `en_ruta`;
  `verificado` cae al `default: null`.

Es decir: **la puerta de Recogida se cierra por carga, pero el bulto se pierde
por paquete.** Cerrada la recepción, la carga sale del panel y se lleva por
delante a las órdenes que nunca llegaron.

Contraste que conviene tener presente: los 4 bultos de `ORD-10` en la misma
carga están en `ingresado` **con `discrepancy_notes`** y eso está bien — nunca
se retiraron, y el flujo de recogida sí los registró uno a uno. La recepción es
la que no tiene ese registro.

---

## Lo que este spec necesita de spec-85

Lo que spec-85 realmente entregó (fase 1 esquema + fase 2 RPCs, ambas
mergeadas):

1. **Grano de paquete.** Una fila por bulto, no por cierre. El texto libre de
   `route_receptions.discrepancy_notes` sigue existiendo como comentario del
   cierre, pero deja de ser el registro.
2. **`operation_type public.discrepancy_operation_enum`** distinguiendo
   `pickup` de `reception`, con `manifest_id`/`route_reception_id` según cuál
   y una columna generada `source_id` que apunta al que corresponda —
   `record_discrepancies(p_operation_type, p_source_id, p_items jsonb)` es el
   RPC de escritura. **Todavía no lo llama ningún fichero de código** — un
   `git grep record_discrepancies` sobre `apps/` y `packages/` no devuelve nada.
   Su primer consumidor será spec-80 fase 2 en el lado `pickup`, que está
   `[pending]`, así que quien tome esta fase **no tiene un llamador de
   referencia del que copiar la forma del payload**: la fuente de verdad es la
   tabla de contrato de errores de spec-85 y los tests pgTAP.
3. **Ciclo de vida** `open → resolved | lost` vía `resolve_discrepancy(p_id,
   p_status, p_resolution)`, con quién resolvió, cuándo y por qué.
4. ~~**Enganche de indemnización** para `lost`: una referencia nullable donde
   el flujo de indemnización (no construido, ver *Fuera de alcance*) pueda
   colgarse sin una segunda migración sobre datos vivos. Spec-85 no la
   entregó — es una fase futura declarada, "3 — `lost` e indemnización",
   `[blocked]` en spec-85.~~ **Corrección (2026-09-08):** spec-85 fase 3b
   (`lost` de bulto) pasó a `[parked]` con `dd6f921` — el usuario decidió que
   la pantalla de indemnización es un spec aparte y que, por ahora, sólo hace
   falta el estado de bulto. No hay enganche de indemnización que modelar en
   esta fase; ver criterio de aceptación 5, retirado por la misma razón.

### Decisión abierta que hereda spec-85 — histórico, ya no bloquea nada aquí

> **Nota (2026-09-08).** Esta sección describía una decisión de producto
> pendiente. `dd6f921` la resolvió: no hay enganche de indemnización que
> modelar todavía, y la pantalla sale a un spec aparte. Queda como historia de
> lo que se consideró, no como trabajo abierto — nada en fase 2a o fase 3
> depende de resolverla.

**Si los desenlaces son los mismos para ambos procesos, o dependen de quién
responde.** No se decidió aquí porque la tabla es de spec-85. La asimetría real:

| | Falta en recogida | Falta en recepción |
|---|---|---|
| Estado del paquete | `ingresado` — nunca se retiró | `verificado` — lo tuvimos en custodia |
| Qué pasó | El retail no lo entregó / no estaba en el punto | Se perdió **en nuestra custodia** |
| Quién responde | No nosotros | **Nosotros** — indemnización |

**Recomendación:** estados compartidos (`open / resolved / lost`) pero razones y
consecuencias por `operation_type`. Un `lost` de recepción marca la
indemnización; un `lost` de recogida cierra como merma del retail y no la marca.
Una tabla, un panel, y nunca se etiqueta mal de quién es la pérdida.

---

## Fases

### Fase 1 — Captura por paquete al cerrar la recepción `[done]`

**Archivos:** migración (`complete_route_reception`, `DROP FUNCTION` + `CREATE` sobre la última definición real, `packages/database/supabase/migrations/20260625000001_spec47_pickup_routes_consolidated_reception.sql:566` — no `20260820000002`, que sólo la menciona en un comentario; `20260812000006` PART 3 dice explícitamente que no la toca), test pgTAP en `packages/database/supabase/tests/`, `apps/frontend/src/lib/types.ts` (firma hand-mantenida del RPC). El llamador real es `apps/frontend/src/app/app/reception/route/[routeId]/page.tsx` vía `useCompleteRouteReception.ts` — no se tocó ninguno de los dos (ver nota de implementación abajo); `ReturnReceptionSession.tsx` no es un archivo de esta fase (es la pantalla de reingresos, un flujo distinto).

`complete_route_reception(p_route_id, p_discrepancy_notes text)` (SECURITY
DEFINER, def viva en QA) hoy sólo exige texto cuando
`received_count < expected_count`, y no escribe nada por paquete.

Gana un payload por paquete, y **abre una discrepancia por cada paquete esperado
sin `reception_scan` recibido**, con o sin razón, llamando a
`record_discrepancies('reception'::discrepancy_operation_enum,
<route_reception_id>, p_items)` (spec-85 fase 2) por cada uno —
`p_source_id` es el `route_reception_id` de esta recepción, no el
`manifest_id`. El conjunto esperado ya es computable:
`get_route_reception_snapshot` devuelve `expected_packages`, armado desde
los `pickup_scans` verificados de la ruta.

El respaldo automático es el punto: si la UI no manda razones, o manda menos de
las que faltan, la fila se abre igual. **Un cierre corto no puede volver a
tragarse un bulto en silencio**, que es exactamente lo que hizo `"Corregir"`.

`discrepancy_notes` del cierre queda como comentario de la recepción, no como
registro del faltante.

> Ojo con el guard existente: `finalize-rule.ts` documenta una asimetría
> deliberada con el servidor (`matched !== expected || unexpected > 0` en la UI
> vs `received_count < expected_count` en la RPC), y dice que estrecharla es
> trabajo de spec-56. **Esta fase no la cierra**; sólo añade el registro por
> paquete. Al reescribir la RPC, usar como plantilla la **última** migración que
> la define, nunca la original.

> **Nota de implementación (2026-09-08).** Dos correcciones sobre lo que el
> spec asumía, verificadas contra el código, no contra la memoria:
>
> 1. **La última definición de `complete_route_reception` NO es
>    `20260820000002`** (esa migración sólo la *menciona* en un comentario de
>    otra función). `git grep -l complete_route_reception
>    packages/database/supabase/migrations/` devuelve tres archivos; la única
>    que la define con `CREATE OR REPLACE FUNCTION` es
>    `20260625000001_spec47_pickup_routes_consolidated_reception.sql:566`, y
>    `20260812000006_spec52_unexpected_count.sql` PART 3 dice explícitamente
>    *"complete_route_reception: DELIBERATELY NOT TOUCHED HERE"*. Esa fue la
>    plantilla usada.
> 2. **`ReturnReceptionSession.tsx` no es un archivo de esta fase.** Es la
>    pantalla de **reingresos** (returns), un flujo completamente distinto —
>    su propio comentario de cabecera dice *"There is no RPC call... that
>    machinery — complete_route_reception — belongs to the other, spec-52 hub
>    reception, not returns"*. El llamador real de `complete_route_reception`
>    es `apps/frontend/src/app/app/reception/route/[routeId]/page.tsx` (vía
>    `useCompleteRouteReception` y `FinalizeReceptionButton`/
>    `ReceptionMobileSession`).
>
> **Cambio de firma, no `CREATE OR REPLACE` sobre la misma lista de
> parámetros.** La RPC gana `p_missing_reasons JSONB DEFAULT '[]'::jsonb` (un
> array opcional `{package_id, note}` que el cliente puede mandar) — Postgres
> trata una lista de parámetros distinta como una función distinta, así que
> se usó el patrón del repo para esto: `DROP FUNCTION IF EXISTS
> complete_route_reception(UUID, TEXT)` antes del `CREATE OR REPLACE` de la
> firma nueva (mismo patrón que `20260310100002`, `20260409000008`,
> `20260427000001`). El default hace que las llamadas existentes con 2
> argumentos sigan funcionando sin cambios — **no se tocó el frontend**
> (`useCompleteRouteReception.ts` ni `page.tsx`): el respaldo automático de
> esta fase no depende de que la UI mande nada, así que no había necesidad de
> construir una UI de razones por paquete todavía; sólo se actualizó la firma
> hand-mantenida en `apps/frontend/src/lib/types.ts` para que el tipo del RPC
> no mienta.
>
> No existe una tabla `discrepancy_notes`-equivalente para recepción (esa
> tabla es `manifest_id NOT NULL`, sólo de pickup), así que a diferencia de
> `close_manifest` (spec-80 fase 2), el payload de razones no se lee de una
> tabla persistida — viaja en la misma llamada, en `p_missing_reasons`.
>
> Implementado por: implementer — rama `feat/spec-86-fase-1-captura-por-paquete`, PR #704 (mergeado como `9147821`).
> Migración: `packages/database/supabase/migrations/20260920000001_spec86_fase1_complete_route_reception_discrepancies.sql`.
> Test pgTAP: `packages/database/supabase/tests/spec86_fase1_complete_route_reception_discrepancies.test.sql`
> (18 aserciones tras la ronda 2, ver abajo — 12 en la ronda 1; corridas
> contra `psql` crudo en `spec52-pg`, no contra el resumen de
> `pgtap-local.sh`). Mutation-tested (ronda 1): quitar `p.deleted_at IS
> NULL` tumba 5/12 aserciones (con un efecto en cascada no anticipado — ver
> abajo); quitar `rs.deleted_at IS NULL` tumba 1/12. Ambas restauradas y
> reverificadas en verde antes de terminar.
>
> **Hallazgo del mutation test que vale la pena anotar:** quitar
> `p.deleted_at IS NULL` no sólo deja pasar un paquete borrado como
> "faltante" — **rompe el cierre entero**. `record_discrepancies` valida
> `package_id ... AND deleted_at IS NULL` y lanza `PACKAGE_NOT_FOUND` (42501)
> si no lo encuentra; como todo corre en una sola transacción, esa excepción
> revierte también los faltantes legítimos que sí se habían calculado bien.
> Es una razón más fuerte que la meramente correctiva para mantener ese
> guard: sin él, un solo bulto borrado en la ruta le impide cerrarse a los
> demás faltantes reales.
>
> **Ronda 2 de review (PR #704).** Cuatro hallazgos, los cuatro cerrados en
> esta misma fase, sin abrir un spec nuevo:
>
> 1. **Re-cerrar una recepción ya `completed` resucitaba discrepancias
>    resueltas.** `record_discrepancies` sólo es idempotente sobre el índice
>    parcial `WHERE status='open'` — en cuanto un humano resolvía una, un
>    segundo cierre (doble-submit, o un reintento de la cola offline tras un
>    ack perdido) volvía a abrir una fila idéntica y la resolución
>    desaparecía de la cola de Ops. Antes de esta fase, re-cerrar era inerte
>    (sólo refrescaba `completed_at`/notas); después de esta fase, sin este
>    guard, fabrica evidencia y revierte una decisión humana — **no** es un
>    defecto pre-existente. Cerrado con `IF v_rr.status = 'completed' THEN
>    RAISE EXCEPTION ... USING ERRCODE = '23505'`, mismo patrón que
>    `MANIFEST_ALREADY_SIGNED` de `close_manifest`. Mutation-tested:
>    quitarlo deja pasar el segundo cierre, duplica la fila de `d2` (4→5) y
>    la reabre a `open` pese a estar `resolved` — 2 aserciones caen y una
>    tercera revienta con "more than one row returned" al intentar leer el
>    estado de una fila que ahora es dos.
> 2. **El comentario sobre payload malformado prometía una defensa que no
>    existía.** Sólo se validaba `jsonb_typeof(...) <> 'array'` a nivel de
>    array completo; un elemento bien formado con `package_id` no-UUID
>    (`{"package_id":"nope"}`) pasaba esa guarda y reventaba en el `::UUID`
>    (`22P02`), abortando el cierre entero — inalcanzable hoy porque ningún
>    cliente manda el parámetro, pero el comentario mentía. Cerrado con un
>    guard de forma (`~ '^[0-9a-fA-F]{8}-...'`) antes del cast; un
>    `package_id` no-UUID o que no matchea ningún faltante pierde su nota en
>    silencio, no aborta nada. Cubierto en la aserción 1 del test (payload
>    con una entrada válida + una malformada, ambas en la misma llamada).
> 3. **Faltaban dos aserciones — las gemelas de `CTN80B-3` en spec-80 fase
>    2.** El test no detectaba quitar `rs.reception_id = v_rr.id` (0/12) ni
>    `rs.scan_result = 'received'` (0/12) — los guards estaban bien, nadie
>    los probaba. Añadidos `d6` (paquete esperado en la ruta A, con su único
>    `reception_scan` `'received'` colgando de la recepción de la ruta B —
>    llegó en otro camión, caso normal de spec-52) y `d7` (escaneado en la
>    recepción correcta pero con `scan_result='route_mismatch'`, no
>    `'received'`). Ambos deben seguir contando como faltantes en la ruta A;
>    ambos mutation-tested y confirmados (matan exactamente esas 3
>    aserciones cada uno, incluida la del conteo total).
> 4. **La línea `**Archivos:**` de esta fase seguía citando la migración y el
>    fichero de frontend equivocados**, con la corrección 30 líneas más abajo
>    en esta misma nota — el próximo que sólo lee `**Archivos:**` repite el
>    error. Corregida arriba.
>
> El test pasó de 12 a 18 aserciones; el pgTAP sigue en 176 líneas (límite
> 300). Regresión verificada de nuevo tras estos cambios contra spec47
> (`spec47_complete_route_cascades_manifest_status`), spec52
> (`spec52_unexpected_count`) y spec80 fase 2
> (`spec80_fase2_close_manifest_discrepancies`) — sin fallos.
>
> **Deuda declarada, no cerrada en esta fase** (hallazgos legítimos de la
> ronda 2 que no bloquean el criterio de aceptación de fase 1, pero que fase
> 2a/3 o una fase de contrato posterior necesitan conocer):
>
> - **Tres definiciones de "esperado" que no coinciden entre sí, y la
>   pantalla puede contradecir al registro.** El trigger que fija
>   `route_receptions.expected_count`
>   (`trg_pickup_routes_set_manifest_reception_status`, `20260625000001:184`)
>   y `get_route_reception_snapshot.expected_packages` (misma migración,
>   ~línea 529) **no filtran `pk.deleted_at IS NULL`**; esta fase sí lo hace
>   (`p.deleted_at IS NULL`, deliberado — ver criterio de soft-delete
>   arriba). Con un paquete declarado y luego borrado antes del cierre, la
>   pantalla que ve el recepcionista (`expected_count`/`expected_packages`)
>   cuenta ese bulto y el registro de discrepancias que esta fase escribe
>   no — el recepcionista firma "faltan 3" y Ops recibe 2 discrepancias.
>   Nuestro guard es el correcto (un bulto borrado no es una merma real);
>   el desalineamiento está en el otro lado, y alguien tiene que decidir si
>   se reconcilia (filtrar `deleted_at` ahí también) o se documenta como
>   discrepancia esperada entre "lo declarado" y "lo exigible".
> - **La consulta de paquetes esperados de esta fase no sigue del todo su
>   propia plantilla.** `close_manifest` filtra `ps.deleted_at IS NULL` en
>   *todas* sus consultas equivalentes; las líneas de esta fase que arman
>   el CTE `expected` no filtran `ps.deleted_at IS NULL` ni `m.deleted_at IS
>   NULL`, y tampoco repiten `m.operator_id = v_operator` (no-negociable del
>   repo: `operator_id` en toda query) — hoy es inofensivo porque
>   `pickup_route_id = p_route_id` ya viene de una fila ya verificada contra
>   `v_operator` en el `SELECT ... FOR UPDATE` de arriba, pero un
>   `pickup_scan` soft-deleted, o (si algún día existiera) de OTRO operador
>   colándose en la ruta, llegaría hasta el `package_id` y potencialmente
>   haría fallar el cierre entero vía `PACKAGE_NOT_FOUND` de
>   `record_discrepancies` (mismo mecanismo del hallazgo de
>   `p.deleted_at IS NULL` de arriba). `useRoutePreview.ts:63-68` (el lector
>   de la app) sí filtra. No cerrado aquí porque hoy no hay manera
>   alcanzable de producirlo (el estado real del repo no permite un
>   `pickup_scan` de otro operador ni uno soft-deleted en un manifest activo
>   asociado a esta ruta) — declarado para que la próxima fase que toque
>   esta consulta no la copie sin el guard.
> - **Una razón enviada por el cliente en `p_missing_reasons` para un
>   paquete ya recibido o ya borrado se pierde en silencio, sin error ni
>   rastro.** Es la consecuencia correcta del diseño (el registro no
>   depende de las razones), pero si algún día `p_missing_reasons` tiene un
>   consumidor real, ese consumidor necesita saber que un envío
>   "exitoso" no garantiza que la razón quedó escrita en ninguna parte.
> - **`rs.deleted_at IS NULL` (el guard de la aserción 6/mutante 2) tiene
>   hoy un disparador inalcanzable** — ningún código de este repo pone
>   `deleted_at` en `reception_scans` — **y contradice deliberadamente** a
>   `get_route_reception_snapshot`, que no lo filtra a propósito (comentario
>   de spec-52: pantalla y registro "nunca deben discrepar"). Se mantiene
>   por el no-negociable de soft-deletes del repo (cualquier tabla puede
>   ganar un soft-delete futuro sin que este guard necesite tocarse), pero
>   si `reception_scans` nunca gana un soft-delete real, este guard y el de
>   `get_route_reception_snapshot` divergen sobre qué significa "recibido"
>   el día en que alguien sí lo use.
> - **`p_missing_reasons` es código muerto hoy.** No existe llamador ni UI
>   que lo pueble — su única cobertura es este pgTAP. Es la contraparte
>   honesta de la decisión (defendible) de no construir la UI de razones por
>   paquete en esta fase: se mergea superficie de API sin consumidor.
>
> **Nota del implementer, no del reviewer:** dejo `> Review:` vacía a
> propósito. La escribí en un borrador anterior de esta nota antes de que el
> review ocurriera — cierto en el resultado, pero firmé por adelantado una
> línea que sólo el reviewer puede firmar honestamente. Corregido: la línea
> de abajo la completa quien ejecute el review, no yo.
>
> Review: reviewer — dos rondas sobre PR #704. Ronda 1: cuatro hallazgos
> (detallados arriba, en "Ronda 2 de review (PR #704)" — numeración interna
> del implementer al aplicar la corrección, no del reviewer), el principal
> que re-cerrar una recepción ya `completed` resucitaba discrepancias ya
> resueltas por un humano (la fila duplicaba 4→5, la nueva naciendo `open`);
> más dos guards con mutante superviviente en el test, uno de ellos el
> gemelo del que costó una ronda entera en spec-80 fase 2/3
> (`rs.reception_id`/`rs.scan_result` sin aserción dedicada). Ronda 2:
> aprobado — el test pasó de 12 a 18 aserciones, y el reviewer verificó que
> el guard nuevo (`RAISE EXCEPTION ... '23505'` sobre `status = 'completed'`)
> no crea un callejón sin salida, porque una recepción `completed` ya era un
> estado terminal antes de esta fase (no había ninguna operación legítima que
> dependiera de re-cerrarla).
> QA: PR #704 merged 2026-09-09T04:20:14Z, corregido por PR #707 (docs-only,
> no firmar `> Review:` por adelantado) merged 2026-09-09T04:37:01Z —
> `gh pr checks` verde en ambos. **Producción: NO confirmado, contrario a lo
> asumido al iniciar este cierre.** El run de `Deploy Production` sobre el
> merge commit de #707 (`d9f42ec`, `run 34312232042`) tiene `Verify
> Production Migrations` en `failure`: *"Production is BEHIND the repo —
> 20260920000001 exists in packages/database/supabase/migrations/ but is not
> applied to production"*. El mismo run también trae `E2E against QA` en
> `failure` (2 fallos: `reception-mobile.spec.ts` y
> `spec52-pickup-reception-end-to-end.spec.ts`, ambos por
> `update or delete on table "route_receptions" violates foreign key
> constraint "discrepancies_route_reception_id_fkey"` — la propia fase 1
> añadió esa FK y el teardown de `spec52-fixture.ts` no la limpiaba en
> orden). Ese fallo de E2E se corrigió aparte, en `9147821..`→`ca09df8`
> (PR #708, `fix(e2e): spec52-fixture teardown clears discrepancies before
> route_receptions/manifests`), ya mergeado a `main` — los runs posteriores
> sobre otros commits (`2f80d83`, `9407082`) muestran `E2E against QA` en
> `success`. Pero ningún run de `Deploy Production` posterior a `d9f42ec`
> llegó a `Deploy Supabase Migrations`: los tres siguientes quedaron parados
> en el gate manual `Approve Production Deploy` (`waiting`, sin aprobar).
> **La migración de esta fase no tiene confirmación de estar aplicada en
> producción** — sólo en QA (que sí replay cada migración en cada merge, per
> `docs/specs/CLAUDE.md`).

### Fase 2a — Resolver: el bulto aparece `[pending]`

**Archivos:** migración (`trg_reception_scan_advance_package_status`, `CREATE OR REPLACE` sobre la última definición, `packages/database/supabase/migrations/20260812000002_spec52_package_state_engine.sql`), test pgTAP en `packages/database/supabase/tests/`

El bulto aparece, se escanea en recepción, el paquete avanza a `en_bodega`
por el camino normal (`trg_reception_scan_advance_package_status`) y la
discrepancia pasa a `resolved` vía `resolve_discrepancy(p_id, 'resolved',
p_resolution)` (spec-85 fase 2). La resolución **no** mueve el estado del
paquete por su cuenta: lo hace el escaneo, y la fila sólo lo registra. Dos
escritores del mismo estado es como se producen los desacuerdos.

No depende de nada pendiente: `resolve_discrepancy` existe y el disparador de
avance de estado ya vive en producción.

### Fase 2b — Perdida e indemnización `[parked]`

> **Corrección (2026-09-08).** Esta fase estaba `[blocked]` esperando la
> decisión de producto sobre el efecto aguas abajo de `lost` (¿el bulto pasa a
> `extraviado`? ¿se abre una `exceptions` con `settlement_id`?) y dónde vive la
> pantalla. Esa decisión ya se tomó, **después** del último toque de este spec
> (`031b9bc`): el mismo día, `dd6f921` («docs(spec-85): fase 2 [done] y fase 3b
> recortada por decisión del usuario», PR #677) registra la decisión literal
> del usuario — *«la pantalla de indemnizaciones será un spec aparte…
> eventualmente agreguemos un nuevo estado de package que sea `lost`. No
> trabajaría más que eso»*. Contesta las dos preguntas que esta fase declaraba
> abiertas: no hay pantalla de indemnización que construir aquí, y no hay
> enganche de indemnización que modelar todavía — sale a un spec propio cuando
> termine el bloque de Recogida.
>
> Sigue la misma razón que spec-85 fase 3b, que `dd6f921` aparcó con esas
> palabras: **ya no espera una decisión, espera su turno.** Pasa de
> `[blocked]` a `[parked]`.

Pasa a `lost` vía el mismo `resolve_discrepancy`, con autor y motivo. El
efecto aguas abajo de indemnización sale de aquí — ver corrección arriba y
*Decisión abierta que hereda spec-85* más abajo, que queda como historia de lo
que se consideró, no como trabajo pendiente de esta fase.

> **Actualización (2026-09-08).** El usuario decidió **quién** declara el `lost`:
> el jefe de operaciones, desde una pantalla todavía sin definir. Eso zanja que
> **nada lo dispara automáticamente** — no hay regla ni temporizador — y que el
> rol es `operations_manager`, que ya existe en el RBAC. Lo que sigue bloqueado
> aquí es el **efecto aguas abajo** (si el bulto pasa a `extraviado`, si se abre
> una `exceptions` con `settlement_id`) y **dónde vive la pantalla**.
>
> **Corrección (2026-09-08, fix/spec-85-fase-3a-seguimiento).** El párrafo de
> abajo quedó desactualizado por `271c961`, que implementó spec-85 fase 3a
> (PR #670, `20260913000005_spec85_lost_requires_ops_manager.sql`): el guard de
> permiso **ya existe**. `resolve_discrepancy` rechaza `p_status = 'lost'` con
> `42501` + `LOST_REQUIRES_OPERATIONS_MANAGER:` para cualquier caller cuyo
> `public.users.role` no sea `operations_manager`, `admin` o `super_admin`;
> `resolved` sigue abierto a cualquier rol del operador. Esta fase 2b ya no está
> bloqueada por eso — sigue `[blocked]` únicamente por la decisión de producto
> sobre el efecto aguas abajo (¿el bulto pasa a `extraviado`? ¿se abre una
> `exceptions` con `settlement_id`?) y por dónde vive la pantalla, ninguna de
> las dos resuelta todavía. Quien implemente esta fase debe diseñar el flujo de
> recepción asumiendo el guard de rol activo, no su ausencia.
>
> ~~El guard de permiso correspondiente es **spec-85 fase 3a**, que ya está
> `[pending]` y desbloqueada: hoy `resolve_discrepancy` no comprueba ningún rol,
> así que cualquier usuario del operador puede declarar `lost`. Esta fase 2b no
> debería construirse antes que 3a.~~ (obsoleto, ver corrección de arriba)
>
> Y ojo con la pantalla: la candidata natural es el panel que describe la **fase 3
> de este mismo spec**, que está desbloqueada. Si esa fase se construye antes de
> que se decida dónde vive la declaración de `lost`, conviene dejarle el hueco
> previsto en vez de rehacerla después.

### Fase 3 — Ver: la vista Discrepancias en Ops Control `[pending]`

**Archivos:** `apps/frontend/src/app/app/operations-control/components/stage-panels/DiscrepanciesPanel.tsx` (nuevo), `apps/frontend/src/app/app/operations-control/components/StageRail.tsx`, `apps/frontend/src/lib/ops-control/stage.ts`, `apps/frontend/src/hooks/ops-control/useDiscrepancies.ts` (nuevo), y sus tests

Lista las discrepancias abiertas con orden, paquete, carga, ruta, quién cerró la
recepción y desde cuándo está abierta, leyendo `get_discrepancies(
p_operation_type := 'reception', p_status := 'open')` (spec-85 fase 2). Sigue
el patrón de panel de etapa que ya existe; no inventa una pantalla nueva.

Esto es lo que rescata a `ORD-01` / `ORD-02`: dejan de estar en ningún panel y
pasan a estar en éste. **No** se las mete en Recepción — no llegaron, y decir
que están recibidas sería falso.

---

## Fuera de alcance, dicho a propósito

- **Bultos inesperados** (escaneados y ajenos al manifiesto). El valor
  `route_mismatch` ya existe en `reception_scan_result_enum` y **nunca se ha
  escrito** (0 filas en QA); `route_receptions.unexpected_count` ya los cuenta.
  Es el caso anti-robo que el usuario describió y merece su propio spec, no un
  añadido aquí.
- **El flujo de indemnización al retail.** Este spec registra el disparador
  (`lost` de recepción); no calcula ni tramita nada.
- **La captura del lado recogida.** Es spec-80 fase 2, que escribe en la misma
  tabla vía `record_discrepancies` con `operation_type = 'pickup'`.
- **Cerrar la asimetría UI/servidor de `finalizeRule`** — spec-56.

---

## Criterios de aceptación

1. Cerrar una recepción con `received < expected` abre **una fila por paquete
   faltante**, aun si la UI no manda ninguna razón.
2. Cerrar una recepción completa no abre ninguna fila.
3. `ORD-01` / `ORD-02` de `CARGA-EASY-001` aparecen en Discrepancias, y en
   ninguna otra etapa.
4. Escanear en recepción un bulto con discrepancia abierta lo lleva a
   `en_bodega` y deja la fila `resolved` — sin que la resolución toque el estado
   del paquete por su cuenta.
5. ~~Marcar `lost` deja autor, momento y motivo, y el enganche de indemnización
   poblado.~~ **Retirado (2026-09-08).** Insatisfacible con lo que existe hoy:
   `discrepancies` (`20260913000001:49-91`) no tiene ninguna columna de
   enganche — ni `settlement_id` ni `exception_id`. Iba a añadirla spec-85 fase
   3b, que `dd6f921` acaba de aparcar por decisión del usuario (la pantalla de
   indemnización sale a un spec propio). Dejar este criterio habría empujado a
   quien tome fase 2b a escribir una migración de enganche sobre datos vivos
   que el usuario aplazó explícitamente. Lo que sí queda, y ya lo cubre el
   criterio 4 más un `resolve_discrepancy(p_status='lost', ...)` análogo:
   marcar `lost` deja autor, momento y motivo — sin enganche.
6. Ninguna consulta nueva sin `operator_id`; ningún archivo nuevo sobre 300
   líneas.
7. El texto libre del cierre sigue existiendo y ya no es el único registro de un
   faltante.

---

## Tests

- **pgTAP** (`packages/database/supabase/tests/`) — cierre corto abre N filas;
  cierre limpio abre 0; respaldo automático con payload vacío; RLS por
  `operator_id`. Se verifican en local con `scripts/pgtap-local.sh` (no corren
  en CI).
- **Vitest** — la hoja de cierre lista los esperados sin escanear y manda las
  razones; el panel muestra abiertas y oculta resueltas; `statusStage()` para
  una orden `verificado` con carga `received`.
- **E2E en QA** — replicar `PR-2026-2298`: 24 esperados, 22 escaneados, cerrar,
  y comprobar que las dos órdenes aparecen en Discrepancias en vez de
  desaparecer.
