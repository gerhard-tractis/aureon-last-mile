# Spec-86: Discrepancias de Recepción — el bulto que se retiró y no llegó

> **Related:** **spec-85** (en redacción por el usuario — **crea la tabla única de discrepancias; sin ella este spec no se puede implementar**), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre de carga en recogida, que escribe discrepancias `source_process = 'pickup'`), [spec-83](spec-83-recogida-escritorio-datos-faltantes.md) (su «2 faltantes de 44» lee la misma tabla), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (`open_route_reception`, `complete_route_reception`), [spec-62](spec-62-reception-mobile.md) (la hoja de cierre móvil), [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`route_receptions` y el guard de `discrepancy_notes`)

**Status:** backlog
**Verify:** unit, sql, e2e-qa
**Bloqueado por:** spec-85. Ninguna fase de este spec puede empezar hasta que la tabla única de discrepancias exista. Quien lo desbloquea: el usuario, entregando spec-85.

_Date: 2026-09-07_

---

## ⚠️ Precondición dura

**Este spec no se implementa hasta que spec-85 esté hecho.** Spec-85 crea la
tabla única de discrepancias con el campo que identifica el proceso que la
genera (`pickup` / `reception`). Este spec **no la define y no la crea** — sólo
escribe y lee filas `source_process = 'reception'`.

**Spec-85 debe declarar `**Downstream:** spec-86`** junto a su `**Status:**`, y
ninguna de sus fases pasa a `[done]` sin releer este spec contra lo que
realmente se mergeó — la forma de la tabla, los nombres de las columnas y la
decisión abierta de más abajo. Es la regla de #641, y este spec es exactamente
el caso que describe: escrito contra una tabla que todavía no existe.

Todas las fases nacen `[blocked]` a propósito. No hay ninguna que un agente
pueda tomar antes: la fase 1 escribe en esa tabla, la 2 la actualiza y la 3 la
lee. Empezar cualquiera antes obligaría a inventar un esquema provisional y
migrarlo después, que es exactamente lo que la tabla única evita.

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

No define la tabla; declara lo que consume. Si spec-85 entrega otra forma, este
spec se ajusta a ella, pero necesita cubrir:

1. **Grano de paquete.** Una fila por bulto, no por cierre. El texto libre de
   `route_receptions.discrepancy_notes` sigue existiendo como comentario del
   cierre, pero deja de ser el registro.
2. **`source_process`** distinguiendo `pickup` de `reception`.
3. **Ciclo de vida** `open → resolved | lost`, con quién resolvió, cuándo y por
   qué.
4. **Enganche de indemnización** para `lost`: una referencia nullable donde el
   flujo de indemnización (no construido, ver *Fuera de alcance*) pueda
   colgarse sin una segunda migración sobre datos vivos.

### Decisión abierta que hereda spec-85

**Si los desenlaces son los mismos para ambos procesos, o dependen de quién
responde.** No se decidió aquí porque la tabla es de spec-85. La asimetría real:

| | Falta en recogida | Falta en recepción |
|---|---|---|
| Estado del paquete | `ingresado` — nunca se retiró | `verificado` — lo tuvimos en custodia |
| Qué pasó | El retail no lo entregó / no estaba en el punto | Se perdió **en nuestra custodia** |
| Quién responde | No nosotros | **Nosotros** — indemnización |

**Recomendación:** estados compartidos (`open / resolved / lost`) pero razones y
consecuencias por `source_process`. Un `lost` de recepción marca la
indemnización; un `lost` de recogida cierra como merma del retail y no la marca.
Una tabla, un panel, y nunca se etiqueta mal de quién es la pérdida.

---

## Fases

### Fase 1 — Captura por paquete al cerrar la recepción `[blocked]`

`complete_route_reception(p_route_id, p_discrepancy_notes text)` (SECURITY
DEFINER, def viva en QA) hoy sólo exige texto cuando
`received_count < expected_count`, y no escribe nada por paquete.

Gana un payload por paquete, y **abre una discrepancia por cada paquete esperado
sin `reception_scan` recibido**, con o sin razón. El conjunto esperado ya es
computable: `get_route_reception_snapshot` devuelve `expected_packages`, armado
desde los `pickup_scans` verificados de la ruta.

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

### Fase 2 — Resolver: apareció, o se perdió `[blocked]`

Dos desenlaces desde el panel:

- **Resuelta** — el bulto aparece, se escanea en recepción, el paquete avanza a
  `en_bodega` por el camino normal (`trg_reception_scan_advance_package_status`)
  y la discrepancia pasa a `resolved`. La resolución **no** mueve el estado del
  paquete por su cuenta: lo hace el escaneo, y la fila sólo lo registra. Dos
  escritores del mismo estado es como se producen los desacuerdos.
- **Perdida** — pasa a `lost`, con autor y motivo, y marca la indemnización
  según la decisión que herede spec-85.

### Fase 3 — Ver: la vista Discrepancias en Ops Control `[blocked]`

Lista las discrepancias abiertas con orden, paquete, carga, ruta, quién cerró la
recepción y desde cuándo está abierta. Sigue el patrón de panel de etapa que ya
existe; no inventa una pantalla nueva.

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
- **La captura del lado recogida.** Es spec-80 fase 1, que escribe en la misma
  tabla con `source_process = 'pickup'`.
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
