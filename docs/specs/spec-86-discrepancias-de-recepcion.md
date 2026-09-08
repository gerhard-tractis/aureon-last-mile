# Spec-86: Discrepancias de Recepción — el bulto que se retiró y no llegó

> **Related:** **spec-85** (**entrega la tabla única de discrepancias: fase 1
> — esquema — y fase 2 — RPCs — ya mergeadas**), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre de carga en recogida, que escribe discrepancias `operation_type = 'pickup'` vía `record_discrepancies`), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (su «2 faltantes de 44» lee la misma tabla), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (`open_route_reception`, `complete_route_reception`), [spec-62](spec-62-reception-mobile.md) (la hoja de cierre móvil), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`route_receptions` y el guard de `discrepancy_notes`)

**Status:** backlog
**Verify:** unit, sql, e2e-qa
**Bloqueado por:** nada a nivel de esquema — spec-85 fase 1 y fase 2 ya están
mergeadas (PR #657 incluido, spec-80 fase 1 ya consume el mismo esquema en
`main`). Ver *Precondición* abajo: el bloqueo real que queda es sólo sobre la
mitad de la fase 2 (la pata de indemnización), y depende de una decisión del
usuario, no de spec-85.

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
- **Fase 2: sólo parcialmente bloqueada.** La pata "Resuelta" (bulto aparece,
  pasa a `resolved` vía `resolve_discrepancy`) no depende de nada que falte:
  el RPC existe y el escaneo que dispara el avance de estado ya vive en
  producción. La pata "Perdida → indemnización" sí depende de una decisión
  abierta (ver *Decisión abierta que hereda spec-85* abajo) y de spec-85 fase
  3 ("`lost` e indemnización"), ambas esperando al usuario. Ése es el único
  bloqueo legítimo que queda en todo este spec, y afecta a media fase, no a
  las tres. Se separa en **fase 2a** (desbloqueada) y **fase 2b** (bloqueada)
  más abajo por esa razón.

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
4. **Enganche de indemnización** para `lost`: una referencia nullable donde el
   flujo de indemnización (no construido, ver *Fuera de alcance*) pueda
   colgarse sin una segunda migración sobre datos vivos. Spec-85 no la
   entregó — es una fase futura declarada, "3 — `lost` e indemnización",
   `[blocked]` en spec-85.

### Decisión abierta que hereda spec-85

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

### Fase 1 — Captura por paquete al cerrar la recepción `[pending]`

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

### Fase 2a — Resolver: el bulto aparece `[pending]`

El bulto aparece, se escanea en recepción, el paquete avanza a `en_bodega`
por el camino normal (`trg_reception_scan_advance_package_status`) y la
discrepancia pasa a `resolved` vía `resolve_discrepancy(p_id, 'resolved',
p_resolution)` (spec-85 fase 2). La resolución **no** mueve el estado del
paquete por su cuenta: lo hace el escaneo, y la fila sólo lo registra. Dos
escritores del mismo estado es como se producen los desacuerdos.

No depende de nada pendiente: `resolve_discrepancy` existe y el disparador de
avance de estado ya vive en producción.

### Fase 2b — Perdida e indemnización `[blocked]`

Pasa a `lost` vía el mismo `resolve_discrepancy`, con autor y motivo, y marca
la indemnización según la decisión abierta de más abajo (*Decisión abierta
que hereda spec-85*) y de spec-85 fase 3b. Sigue siendo el único bloqueo
legítimo que queda en todo el spec.

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
5. Marcar `lost` deja autor, momento y motivo, y el enganche de indemnización
   poblado.
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
