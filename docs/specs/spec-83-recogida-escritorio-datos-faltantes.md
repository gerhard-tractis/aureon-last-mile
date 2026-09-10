# Spec-83: Recogida en escritorio (`5a`) — ventana de retiro, ocupación y merma

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**su fase 4.4 construyó esta pantalla contra el mock `1l` y difirió estos tres datos con razón escrita**), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre que produce la merma que aquí se muestra), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`; **corrección 2026-09-09**: la asignación no aterriza aquí — el usuario decidió que la define el líder de recogida en el punto de retiro, in-situ, no desde este panel de escritorio), [spec-61](spec-61-pickup-route-crew.md) (panel de armado de ruta), [spec-73](spec-73-capacity-ladder-truck-topup.md) (capacidad de vehículo en Despacho — precedente directo)

**Status:** awaiting_user_test — fase 1 y 4 `[done]`, fase 3 `[parked]`
(decisión del usuario, se retoma cuando el rollout lo pida). Sólo queda fase 2
`[blocked]`: falta que el usuario decida qué gana el borde izquierdo de la
fila cuando ventana y merma coinciden (ver `> Bloqueo:` en la fase 2). Ningún
agente puede tomar nada más aquí hasta esa decisión.
**Verify:** unit, e2e-qa

> **Nota (2026-09-07).** El punto 1 («Merma en cierres», «2 faltantes de 44»)
> dependía de *«la decisión del enum en spec-80»*. Esa decisión se movió a
> spec-85, que crea una tabla única de discrepancias con `operation_type`
> (`discrepancy_operation_enum`: `pickup` / `reception`). La merma se lee de
> ahí — vía `get_discrepancies(p_operation_type := 'pickup', p_source_id :=
> <manifest_id>)` (spec-85 fase 2) — en vez de necesitar un estado nuevo en
> `packages`. La tercera opción que este spec temía («sólo `discrepancy_notes`»,
> que dejaba la merma no consultable) queda descartada.

_Date: 2026-09-07_

## Mock de diseño

Este spec valida contra **`docs/design/Recogida.dc.html`, pantalla `5a`** (la única que cubre —
escritorio de Recogida). El mock manda en diseño; este spec manda en comportamiento. Si
discrepan, se implementa el mock y la discrepancia se escribe aquí, no se resuelve en silencio.

Nótese que la pantalla ya construida (fase 4.4 de spec-54) se hizo contra el mock **anterior**,
`1l` del handoff original — no contra este archivo. Lo que este spec cierra son los tres datos
que `1l` también pedía y que `5a` vuelve a pedir; la estructura de dos columnas no cambia entre
una versión y la otra.

Si al implementar aparece un caso que `5a` no contempla — un estado de error de estas tres
columnas, o qué se muestra mientras la ventana de retiro no tiene dato — es un hallazgo para
escalar al usuario, no algo que inventar.

Esta referencia caduca con el diseño: si el usuario actualiza los mocks, hay que volver a bajar
el fichero (`docs/design/README.md`) y comprobar que `5a` sigue siendo la misma pantalla.

---

## Goal

Cerrar las tres omisiones que la fase 4.4 de spec-54 declaró conscientemente al construir `/app/pickup`, y que el mock `5a` vuelve a pedir.

**La pantalla ya existe y es correcta.** `ManifestTable`, `PickupRouteDraftPanel`, `TodayClosuresPanel` y `StatTile` se construyeron contra el mock `1l` y siguen siendo la estructura de `5a`: dos columnas, manifiestos a la izquierda, ruta en armado y cierres del día a la derecha. Este spec **no la rediseña**.

## Lo que spec-54 difirió, y por qué

Vale la pena citarlo entero, porque el razonamiento sigue vigente y la decisión aquí es si se paga el dato o se mantiene la omisión:

> - **Sin columna VENTANA.** El mock la muestra («09:00–13:00», «cierra 12:30» en rojo) y tiñe el borde izquierdo de la fila según cuán cerca esté el cierre. `get_pending_manifests` no devuelve ventana de retiro. Inventar un plazo en la pantalla que decide qué recoge la cuadrilla sería peor que omitir la columna.
> - **Sin «cierre de retiros 18:00»** en el subtítulo, por lo mismo.
> - **Sin ocupación estimada del vehículo.** Necesita capacidad en `vehicles` y volumen en `packages`; ninguna de las dos existe. Un porcentaje adivinado en la pantalla que decide si un furgón va lleno sería activamente dañino.
> - **Los cierres no marcan faltantes.** El mock muestra «2 faltantes de 44» en paleta warning; `get_completed_manifests` da totales pero no verificados.

`5a` pide las cuatro otra vez. Ninguna se puede satisfacer con lo que hay en la base de datos hoy.

---

## Los tres datos

### 1. Ventana de retiro

`5a`: columna `VENTANA` con `09:00–13:00`, y `cierra 12:30` en rojo cuando aprieta. Subtítulo «cierre de retiros 18:00». El borde izquierdo de la fila se tiñe por proximidad al cierre.

**Dónde vive.** La ventana es del **punto de recogida**, no del manifiesto: el local abre y cierra a la misma hora todos los días.

**Corrección (2026-09-08).** Esto decía que `pickup_points.pickup_locations`
es un JSONB `{name, address, comuna}` y presentaba la ventana como una decisión
de modelo abierta entre tres opciones — (a) fija por punto, (b) por punto y
día, (c) por manifiesto. Es falso, y la opción (a) **ya está elegida por el
esquema**: `20260318000004_agent_suite_tables.sql:68-69` declara
`pickup_locations` como `[{name, address, comuna, lat, lng, contact_name,
contact_phone, operating_hours}]` — `operating_hours` es exactamente la
ventana fija por punto de (a). Y `sla_config` (`:64-66` del mismo archivo)
declara `pickup_cutoff_time`, que es el «cierre de retiros 18:00» del
subtítulo. Ninguno de los dos campos lo puebla nadie hoy, pero el modelo de
datos no es la decisión pendiente — poblarlos y leerlos sí lo es.

La única decisión que sigue abierta, y que sí le toca al usuario: **el
conflicto del borde izquierdo de la fila.** Hoy significa progreso de escaneo;
si además debe señalar proximidad al cierre, hay que decidir si se cambia el
significado o se añade una segunda señal visual. Eso no lo resuelve el
esquema.

### 2. Ocupación estimada del vehículo

`5a`, panel de ruta en armado: «Furgón · 12,4 m³ · RTHK-72 · Ocupación estimada **68%**».

Necesita las dos mitades:

- **Capacidad del vehículo.** El mock ya la muestra («12,4 m³»), así que es un campo en `vehicles`. Barato.
- **Volumen del bulto.** Caro. `packages` tiene `declared_dimensions` y `verified_dimensions` (ambos existen en el esquema), pero están vacíos en la práctica: nada del ingreso los llena.

**Mirar spec-73 antes de diseñar nada aquí.** La escalera de capacidad y el top-up de camión en Despacho ya se enfrentaron a este problema; si allí se resolvió con un proxy (peso, conteo de bultos, o una capacidad en «bultos equivalentes»), Recogida debe usar **el mismo** proxy o los dos módulos darán números distintos para el mismo furgón, que es peor que no dar ninguno.

Si spec-73 no lo resolvió, la posición honesta sigue siendo la de spec-54: **omitir el porcentaje**. Un 68% inventado en la pantalla que decide si el furgón sale lleno es activamente dañino.

### 3. Merma en los cierres del día

`5a`, panel de cierres: `CARGA-99785 · Ripley · **2 faltantes de 44**` en paleta warning, junto a los cierres limpios `38/38 paquetes`.

**Este es el más fácil de los tres, y spec-80 lo habilita — pero no como decía este párrafo.** Hoy `get_completed_manifests` da totales pero no verificados, y derivar la merma exige una consulta por manifiesto.

**Corrección (fix round 1, 2026-09-07):** el párrafo original decía que spec-80 fase 1 "registra los faltantes al cerrar" y que la cifra "queda escrita en el cierre". Es falso con el alcance ya corregido de esa fase: `close_manifest` **no persiste nada de faltantes** — devuelve `out_missing_count` (y verificados/ajenos) derivado por consulta en el momento de la llamada, y no vuelve a escribirlo en ningún sitio. La persistencia real vive en `discrepancies` (spec-85), vía `record_discrepancies`, que llama la fase 2 de spec-80 — no la fase 1. Ver la nota "Resuelto" justo debajo, que ya reflejaba esto correctamente; este párrafo había quedado sin actualizar.

**Resuelto (2026-09-07): la merma se lee de `discrepancies`** ([spec-85](spec-85-discrepancias.md)) — `kind='missing'`, `operation_type='pickup'`, agrupado por manifiesto. No se añadió ningún valor a `package_status_enum`; la discrepancia es una fila con ciclo de vida propio, así que la cifra es consultable y además dice si se resolvió.

---

## Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **1 — Merma en cierres** | «2 faltantes de 44» | spec-85 fase 2 + spec-80 fase 2 |
| **2 — Ventana de retiro** | Columna VENTANA y semáforo de cierre | decisión sobre el borde izquierdo de la fila (progreso vs. proximidad al cierre) |
| **3 — Ocupación** | El porcentaje, o su omisión razonada | spec-73 |
| **4 — Diff visual del resto** | Lo que difiera entre `1l` y `5a` sin datos nuevos | — |

### Fase 1 — Merma `[done]`

**Archivos:** migración (`get_completed_manifests`), `components/pickup/TodayClosuresPanel.tsx`, tests

Al reescribir el RPC con `CREATE OR REPLACE`, **usar como plantilla la definición de la migración más reciente**, nunca la original (regla de `CLAUDE.md`).

**Corrección (2026-09-08).** Esto decía que la última era
`20260428000001_sort_manifests_by_created_at.sql` «salvo que algo posterior la
haya tocado». Sí la ha tocado, y seguir la instrucción literal habría sido la
trampa: `20260813000001_spec53_package_labels.sql:234-314` hace `DROP
FUNCTION` + `CREATE OR REPLACE` de `get_completed_manifests`, añadiendo
`labels_printed_at` y `labels_printed_by_name` (impresión de etiquetas,
spec-53). Verificado con `git grep -l get_completed_manifests
packages/database/supabase/migrations/` (2026-09-08): las cuatro migraciones
que la tocan son `20260310100002`, `20260427000001`, `20260428000001` y
`20260813000001`, en ese orden — **`20260813000001` es la plantilla correcta
hoy**, no `20260428000001`. Usar la de abril habría borrado las dos columnas
de spec-53 y hecho desaparecer la impresión de etiquetas del panel de cierres.
Quien tome esta fase debe repetir el `git grep` antes de escribir la
migración — puede haber otra posterior a `20260813000001` para cuando se lea
esto.

- [ ] Test pgTAP del RPC con un manifiesto cerrado con faltantes y otro limpio.
- [ ] Test del panel: paleta warning sólo cuando hay merma.
- [x] Implementar.

> Implementado por: `feat/spec-83-fase-1-merma`, PR #696 (mergeado 2026-09-09,
> squash). Migración `20260917000002` — renumerada desde `...0001` por colisión
> de timestamp con spec-84 fase 1 (#698). Plantilla tomada de
> `20260813000001_spec53_package_labels.sql`, la más reciente que define
> `get_completed_manifests`, tras repetir el `git grep` que este spec exige:
> usar la de abril habría borrado `labels_printed_at`/`labels_printed_by_name`.
> Review: dos rondas adversariales. Ronda 1 — tres bloqueantes: el pgTAP
> abortaba en el fixture antes de la primera aserción (una fila `resolved` sin
> `resolved_at` violaba `discrepancy_resolved_has_when`, inmediato y no
> diferible: 0 `ok` de 5 planeadas); el filtro de estado faltaba; y la aserción
> que protege las columnas de spec-53 era vacua (vaciar `u.full_name` a `NULL`
> dejaba los 5 tests en verde). Ronda 2 — aprobada, más el cambio de
> `COUNT(*)` a `COUNT(DISTINCT d.package_id)`.
> QA: pgTAP ejecutado contra `spec52-pg` leyendo las líneas TAP crudas de
> `psql` (el resumen de `scripts/pgtap-local.sh` sólo hace `grep ERROR:` y es
> ciego a `not ok`): **6/6 `ok`**. Mutación verificada por el revisor sobre esa
> misma salida: `status = 'open'` voltea 1/4/5; sin filtro de estado voltea 1;
> `u.full_name` → `NULL::TEXT` voltea 6. Frontend 31/31 con `--pool=forks`.
> CI verde en `932d1ca`; Vercel desplegado.

**Decisión de producto (2026-09-09).** `missing_count` filtra
`status <> 'resolved'`, no `= 'open'`. Una merma resuelta deja de ser merma
—criterio del usuario— pero **`lost` sigue contando**: es el disparador del
futuro workflow de indemnización (`20260913000005`), no un cierre limpio. Con
`= 'open'`, el jefe de operaciones declarando un bulto perdido habría apagado
la alarma y pintado el peor desenlace como carga completa. El fixture
`CARGA-83-3` (un `'lost'` solo, sin ninguna `'open'`) existe para impedir esa
regresión.

El histórico que el usuario pidió **ya existe y no hizo falta construirlo**:
`discrepancies` guarda `status`, `detected_at`, `resolved_at` y
`resolved_by_user_id`, y la tabla lleva trigger de auditoría
(`audit_discrepancies_changes`), así que cada transición queda en `audit_logs`
con actor y momento.

> Downstream: si el panel llega a querer distinguir «cerró con merma en su día»
> de «tiene merma ahora», la vía barata son dos columnas —`missing_count` (lo
> que pinta la alarma) y `missing_ever_count` (todas, como texto neutro)— sobre
> el dato que ya está. Fase aparte, no ampliación de ésta.
> Heredado, no arreglado aquí: `TodayClosuresPanel.tsx` usa
> `{row.total_packages ?? 0}`, así que un manifiesto sin conteo muestra
> «N faltantes de 0». Viene de spec-54 y está igual en la rama de cierre
> limpio — va a un barrido de copy, no a esta fase.

### Fase 2 — Ventana `[in_progress]`

**Desbloqueada (2026-09-09). El usuario delegó la decisión: «haz lo que creas
que debas hacer». La tomo yo y queda escrita aquí, no en la cabeza de nadie.**

**Decisión: el borde izquierdo NO gana una tercera señal. La proximidad al
cierre de ventana va en su propia columna, con semáforo.**

El razonamiento, para que quien lo herede pueda discutirlo con datos y no
reabrirlo por gusto:

- El borde izquierdo ya carga **dos** significados (`ManifestTable.tsx:103-110`):
  selección y «en progreso»/merma. Los dos son **estados de la fila** — cosas
  que le pasan a ese manifiesto ahora.
- La proximidad al cierre de ventana **no es un estado de la fila**: es un dato
  del punto de retiro (`operating_hours`, `sla_config.pickup_cutoff_time`) que
  además cambia solo con el paso del tiempo, sin que nadie toque nada.
- Un canal visual con tres significados obliga a un árbitro, y un árbitro
  significa que **una de las tres señales se oculta justo cuando importa**. La
  merma es dinero y la ventana es tiempo: esconder cualquiera de las dos para
  mostrar la otra es la decisión equivocada en los dos sentidos.

Los datos van en una columna; los estados, en el borde. El tercer punto del
checklist ya contemplaba «columna y semáforo» — ahora es la única vía, no una
alternativa.

- [x] Decidir qué gana el borde izquierdo — **decidido: nada nuevo. El borde
      conserva selección y merma; la ventana no lo toca.**
- [ ] Poblar `operating_hours` / `pickup_cutoff_time` donde falten (nadie los
      escribe hoy) y hacer que `get_pending_manifests` los devuelva.
      **Corrección tras review round 2 (2026-09-10): esta casilla estaba
      marcada `[x]` sin haberse hecho.** Lo que existe es el camino de
      escritura (formulario admin + rutas API) y la lectura en
      `get_pending_manifests` — la propia migración lo dice: "no data is
      written here". Hoy sigue sin haber ni un solo punto de retiro con
      `operating_hours`/`pickup_cutoff_time` configurado, en QA ni en
      prod. Consecuencia real tras el merge: la columna VENTANA sale gris
      (`sin_datos`) en TODAS las filas hasta que un humano abra el
      formulario punto por punto. Falta, y queda fuera de esta fase por ser
      trabajo operativo, no de código: (a) que alguien con el dato real
      (horario real del punto, hora de cierre de retiros del operador) lo
      cargue fila por fila desde el admin ya construido, o (b) un
      backfill/seed de QA si se quiere ver la columna en verde/ámbar antes
      de eso. Ninguna opción es inventar el dato — sigue el mismo criterio
      que spec-54 ya sentó para esta pantalla. **Nota de review round 3:**
      si se opta por (b), ese seed debe escribir `HH:MM` estricto, no
      `HH:MM:SS`. El formulario ya tolera `HH:MM:SS` al cargar (normaliza
      con `.slice(0, 5)`, fix de la propia ronda 3), así que un seed con
      segundos ya no deja el punto irreeditable — pero seguir dependiendo
      de esa normalización en vez de escribir el formato limpio desde el
      origen es acumular una capa de tolerancia que no hace falta.
- [x] Columna de ventana con semáforo, sin tocar `border-l-*`.

**Archivos:** `apps/frontend/src/components/pickup/ManifestTable.tsx` (columna
nueva, **sin tocar `border-l-*`**), migración para `get_pending_manifests`, y el
poblado de `operating_hours`/`pickup_cutoff_time`.

**Depende de:** ninguna.

**Implementación (2026-09-10, pendiente de review/QA — la fase queda
`[in_progress]`, no se cierra aquí):**

- **Lógica pura** — `apps/frontend/src/lib/pickup/pickupWindowStatus.ts`:
  `getPickupWindowStatus` (tres estados: `sin_datos`/`dentro_de_plazo`/
  `cerca_del_cierre`; `sin_datos` es el default cuando no hay ventana ni
  cutoff, nunca `dentro_de_plazo`) y `formatPickupWindowLabel`. El cutoff
  (`sla_config.pickup_cutoff_time`) gana sobre el fin de ventana cuando
  ambos existen, por ser el límite operador-wide más estricto. Umbral de
  "cerca del cierre": 60 minutos — decisión visual mía, el spec la delegó
  explícitamente.
- **Lectura** — migración `20261003000001`, plantilla
  `20260820000006_spec61_pending_manifests_exclude_routed.sql` (confirmada
  como la más reciente vía `git grep` el 2026-09-10). `get_pending_manifests`
  añade `pickup_window_start/end` y `pickup_cutoff_time`, derivados de
  `pickup_points.pickup_locations->0->'operating_hours'` y
  `pickup_points.sla_config->>'pickup_cutoff_time'`. Sin cambios de ACL — la
  función nunca tuvo GRANT explícito y no está en el alcance del audit de
  spec-88.
- **Escritura** — hoy nadie podía poblar estos campos aunque el esquema los
  tiene desde marzo. `PickupPointForm.tsx` gana tres campos (Apertura,
  Cierre, Cierre de retiros), extraídos a `PickupPointLocationFields.tsx` +
  `pickupPointFormSchema.ts` compartido para no exceder 300 líneas. Las dos
  rutas API (`/api/pickup-points`, `/api/pickup-points/[id]`) validan y
  persisten `sla_config` y `pickup_locations[].operating_hours`.
- **Columna** — `ManifestTable.tsx` gana una octava columna (`GRID` de 7 a 8
  celdas) con punto de semáforo + etiqueta. `border-l-*` no se tocó — sigue
  siendo únicamente selección/merma, verificado con un test dedicado.
- **Tests:** 14 en `pickupWindowStatus.test.ts` (unit, mutation-tested — ver
  abajo), 9 en `pickupPageHelpers.test.ts` (+2 nuevos), 14 en
  `ManifestTable.test.tsx` (+5 nuevos), 6 en `PickupPointForm.test.tsx` (+3
  nuevos), pgTAP `spec83_fase2_pending_manifests_pickup_window.test.sql`
  (4/4 `ok`, verificado con `psql` crudo, no con el resumen de
  `pgtap-local.sh`) + `spec61_pending_excludes_routed.sql` actualizado y
  re-verificado sin fallos.
- **Mutation testing manual sobre `pickupWindowStatus.ts`, 5 mutantes:**
  1. `sin_datos → dentro_de_plazo` en el guard de ausencia — muere (4 tests).
  2. `<=` → `<` en el umbral de 60 min — **sobrevivió** a la suite original
     (sin caso exactamente en el borde); cerrado con un test a los 60 min
     exactos y otro a 59:01; ahora muere.
  3. Invertido el orden de precedencia cutoff/window-end en el `??` — muere.
  4. Regex de hora debilitada a `/(\d+):(\d+)/` — **sobrevivió** (ningún caso
     cubría una hora fuera de rango); cerrado con un test para `'25:00'`;
     ahora muere.
  5. `&&` → `||` en `formatPickupWindowLabel` (ventana a medio llenar) —
     **sobrevivió**; cerrado con un test de ventana con sólo el inicio;
     ahora muere.

  2 de 5 sobrevivieron a la primera pasada. Se cerraron con un test nuevo
  cada uno, no se descartaron.
- **Trampa de TanStack Query v5 (`networkMode:'online'` pausando sin red):**
  no se introdujo una instancia nueva de `pending ?? []` — la única que
  existe (`page.tsx:117`) es preexistente a esta fase, no se tocó. `sin_datos`
  se calcula por fila a partir de campos ausentes/`null`, no de la ausencia
  de la query completa, así que no hereda ese problema, pero tampoco lo
  arregla: si la query en pausa deja `pendingRows` vacío, la tabla entera se
  ve vacía, columna de ventana incluida — declarado, no corregido aquí.
- **Gap cerrado tras review round 2:** ya existen tests para la ruta PUT
  (`[id]/route.test.ts`, **5 tests**, no 4 como decía una versión anterior
  de esta nota: 401, 400 por formato inválido, `sla_config` omitido queda
  intacto, y los dos casos de merge/clear descritos abajo. Ronda 3 añadió
  dos más: 403 y 400 por hora basura en `operating_hours` a nivel de ruta —
  7 en total hoy). Ver el resto de esta sección para el detalle de qué
  encontró cada ronda.

**Review round 2 (2026-09-10) — 3 bloqueantes, 2 menores de datos y 4
menores de documentación, todos cerrados:**

1. **B1 — `??` con cadena vacía (mutante superviviente confirmado).**
   `pickupCutoffTime ?? pickupWindowEnd` no cae al `windowEnd` cuando el
   cutoff es `''` (string vacío no es `null`/`undefined`). Un formulario
   nuevo con el campo en blanco —el caso más probable en producción durante
   semanas— dejaba una ventana bien poblada en `sin_datos` con la etiqueta
   mostrando el rango real al lado: el semáforo contradiciendo el texto.
   Corregido con `nonBlank()` (trata `''`/espacios como ausente) aplicado en
   `resolveCloseTime` **y** en `formatPickupWindowLabel`. Tests nuevos:
   cutoff vacío, cutoff sólo-espacios, y el mismo par para la etiqueta.
2. **B2 — el PUT no podía borrar un cutoff.** `values.cutoff ? {...} :
   undefined` en modo edición producía una clave omitida, y la ruta salta
   toda clave `undefined` — vaciar el campo y guardar no hacía nada, para
   siempre. Corregido: en modo `edit` el formulario **siempre** envía
   `sla_config`, con `pickup_cutoff_time: valor || null` — nunca omite la
   clave. `null` es ahora un valor de escritura válido y distinto de
   "omitido" en el esquema de la ruta.
3. **B3 — el PUT machacaba `sla_config` entero.** Un `UPDATE` que sólo
   cambiaba el nombre borraba silenciosamente `max_delivery_hours` y
   cualquier otra clave que el formulario no muestra. Corregido: la ruta
   ahora lee el `sla_config` actual antes de actualizar y hace
   `{...actual, ...enviado}` — sólo las claves enviadas se tocan.
4. **Validación de formato en las tres capas.** No existía ninguna. Regex
   compartida (`TIME_HH_MM_REGEX`, `apps/frontend/src/lib/pickup/timeFormat.ts`)
   usada en `pickupPointFormSchema.ts` (formulario) y en
   `pickupPointApiSchemas.ts`, nuevo, compartido entre las dos rutas API —
   cierra B1 de paso (un cutoff con formato inválido ya no puede ni
   guardarse) y evita literales tipo "Cierra banana" en la interfaz.
5. **`HH:MM:SS` cae en `sin_datos`.** El *camino de escritura* exige
   `HH:MM` estricto (rechaza segundos, para forzar un formato limpio al
   entrar), pero la *lectura pura* (`parseTimeToday`) ahora tolera un
   `:SS` final — un dato poblado directamente por SQL (backfill futuro,
   seed de QA) es más probable en esa forma que en la que este formulario
   siempre guarda.
6. **Menores de documentación, todos corregidos en el propio código/migración:**
   la nota de ACL de la migración tenía la conclusión correcta con la
   premisa falsa (afirmaba "no default privileges"; medido: sí existen y el
   `DROP`+`CREATE` los re-concede a `anon`; la seguridad real viene de
   `SECURITY INVOKER` + RLS, y un llamador anónimo mide
   `ERROR: permission denied for table manifests`, no un resultado vacío) —
   corregida. Zona horaria local sin normalizar: anotada en
   `parseTimeToday`. Ventana ya cerrada (23:00 contra un cierre de 13:00) no
   tiene un cuarto estado — es decisión de producto, declarada en
   `getPickupWindowStatus`, no resuelta aquí. `MIN(name)`/`MIN(start)`
   agregados por separado cuando una carga tiene órdenes en dos puntos:
   documentado en la migración con el mitigante real (`MIN(end)`/
   `MIN(cutoff)` son siempre los más estrictos — nunca sobrestima el tiempo
   disponible, sólo puede mostrar el texto del punto equivocado).

Rama `feat/spec-83-fase-2-ventana`, PR #738. Ronda 1 aprobó lo esencial
(lógica pura, migración, `spec61_pending_excludes_routed`, borde izquierdo
intacto, 9/10 mutantes) y encontró B1-B3 más los menores listados arriba,
todos cerrados en esta ronda con TDD (RED confirmado antes de cada fix). La
fase sigue `[in_progress]` — evidencia formal de review/QA la añade quien
corresponda tras verificarla, no quien implementa.

**Review round 3 (2026-09-10) — mergeable, un fix de código y tres notas.**

Confirmó, con evidencia propia y no repetida de la ronda 2: el mutante
equivalente de B1 lo es de verdad (mutación + razonamiento de tipos + fuerza
bruta sobre 5832 combinaciones, cero diferencias); aplicar `nonBlank` en la
etiqueta también era necesario (quitarlo de ahí sólo muere); el merge de
`sla_config` **aborta** en vez de machacar si la lectura previa falla
(`update` llamado 0 veces); y cierra un vector no pedido — una clave no
declarada dentro de `sla_config` la descarta zod y el merge restaura la
existente, así que un cliente no puede escribir claves arbitrarias por esa
ruta. 11/12 mutantes muertos, incluido el que sobrevivió en ronda 2.

**Fix de código — normalización de `HH:MM:SS` al cargar el formulario.**
Un punto poblado con `HH:MM:SS` (el cast natural de una columna `TIME`)
quedaba **irreeditable**: el schema estricto rechazaba el valor sin tocar en
CADA submit, incluso uno que sólo cambiaba el nombre — sin salida salvo
reescribir los tres campos a mano. No se perdía nada (el envío entero se
rechaza, no se aplica parcial), pero el admin quedaba bloqueado. Corregido
con `toHHMM()` (`.slice(0, 5)`) en los tres `defaultValues` de
`PickupPointForm.tsx` — normaliza al cargar, nunca al guardar (el schema de
escritura sigue exigiendo `HH:MM` estricto). Test nuevo, RED confirmado
antes del fix. Consecuencia para el punto pendiente de poblado (más
arriba): si el backfill/seed escribe `HH:MM:SS`, ahora sí es editable desde
este formulario — pero **el seed debería escribir `HH:MM` estricto de
todos modos**, para no depender de esta normalización en ningún punto de la
cadena.

**Notas al spec, no al código:**

1. **Carrera entre administradores, ensanchada por B2.** Sin bloqueo
   optimista: A abre la ficha a las 10:00 con cutoff `12:30`; B lo cambia a
   `12:00`; A guarda sólo el nombre a las 10:10 → como en edición **siempre**
   se reenvía `sla_config`, viaja el `12:30` rancio de A y revierte el
   cambio de B sin aviso. Si A había vaciado el campo, viaja `null` y
   **borra** lo que B acababa de poner — esto último es nuevo en esta fase:
   antes de B2 el blanco no se enviaba, así que no pisaba nada. Es el
   patrón de todo este formulario (ninguno de sus campos tiene control de
   concurrencia), y arreglarlo pide bloqueo optimista (ETag/`updated_at`
   comparado en el PUT) — otra fase, no ésta.
2. **`pickup_locations` sigue siendo overwrite ciego, ahora asimétrico con
   `sla_config`.** La misma ruta trata las dos columnas JSONB con criterios
   opuestos: `sla_config` mergea, `pickup_locations` reemplaza el array
   entero con lo que el formulario construye — y la ventana vive
   precisamente en `pickup_locations[0]`. Un punto de retiro con más de una
   ubicación (el esquema es un array por algo) pierde toda ubicación desde
   la segunda en adelante en el primer guardado desde este formulario, que
   sólo edita `[0]`. No se ha visto ese caso en los datos hoy, pero el
   formulario no lo impide ni lo advierte.
3. **Nits:** el gate 403 de la ruta PUT funcionaba pero no tenía test
   afirmándolo — añadido. Ninguna prueba de ruta ejercitaba una hora basura
   dentro de `operating_hours` (sólo los tests del esquema del formulario lo
   demostraban) — añadido un test de ruta para `pickup_locations[0]
   .operating_hours.start = 'banana'`. Y esta misma sección decía "4 tests"
   donde ya había 5 — corregido, con el conteo actualizado a 7 tras esta
   ronda.

### Fase 3 — Ocupación `[parked]`

**Decisión del usuario (2026-09-09), textual:** «No hay capacity para esto
ahora, y no es bloqueante para el rollout con tenant. Se retoma cuando el
rollout lo pida.»

No se mueve a otro spec: se retoma **en este mismo spec** cuando el rollout lo
pida, no se descarta. Hasta entonces no se toma ni se despacha en paralelo con
nada.

- [ ] Leer spec-73 y decidir: mismo proxy, o omisión razonada escrita en este spec.
- [ ] Si se implementa: capacidad en `vehicles` primero, que es la mitad barata y ya se muestra en el mock.

### Fase 4 — Diff visual `[done]`

**Archivos:** `apps/frontend/src/components/pickup/ManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupRouteDraftPanel.tsx`, `apps/frontend/src/components/pickup/TodayClosuresPanel.tsx`, `apps/frontend/src/components/StatTile.tsx`, y sus tests

- [x] Diff contra el mock. **Nota:** `1l` ya no existe como artboard independiente en `docs/design/`; el único mock de Recogida en el repo es `docs/design/Recogida.dc.html`, artboard **`5a`** (línea 50 en adelante). Ese es el que se usó como fuente de verdad — no hay un `1l` contra el cual comparar por separado, así que el diff fue "código actual contra `5a`", filtrando lo que `5a` pide y que depende de datos que las fases 2 y 3 (bloqueadas/pendientes) todavía no proveen.
- [x] **Conservar la séptima columna** (impresión de etiquetas, spec-53). Sigue ahí — no se tocó `GRID` ni la columna de impresión.

**Hallazgos y fixes (dentro del alcance declarado, sin datos nuevos):**

1. **`TodayClosuresPanel.tsx` — «de 0» inventado, en las dos ramas.** La línea de merma usaba `{row.total_packages ?? 0}` (heredado de spec-54). Un manifiesto cerrado con `total_packages` nulo mostraba «N faltantes de 0», que lee como si no se hubiera esperado nada. **Ronda 1 sólo arregló la rama con merma** y la nota que dejé aquí mismo decía que la rama limpia tenía el mismo `?? 0` — la leí, arreglé una y dejé la nota describiendo un estado que ya sólo era medio verdad. Corregido ahora en ambas: si `total_packages` es `null`, se omite la cláusula numérica en las dos ramas («N faltante(s)» sin «de M»; sólo el nombre del cliente sin «M paquetes»).
2. **`TodayClosuresPanel.tsx` — retailer ausente en la línea de merma.** El spec (línea 99) y el mock (`5a`, línea 266) dicen `Ripley · 2 faltantes de 44`; el código de la ronda 1 sólo mostraba `2 faltantes de 44`, sin el cliente — pese a que la rama limpia, tres líneas más abajo, sí lo mostraba. Corregido: ambas ramas anteponen `{retailer_name ?? 'Sin cliente'} · `.
3. **`TodayClosuresPanel.tsx` — cierre limpio como razón verificado/total, no total pelado.** El mock (`5a`, líneas 261, 271, 276) muestra `38/38 paquetes`, no `38 paquetes`. Corregido: `verificados = total_packages - missing_count` (en la rama limpia `missing_count` es siempre 0, así que `verificados === total`, pero la fórmula generaliza si el día de mañana un cierre limpio deja de implicar cero discrepancias).
4. **`PickupRouteDraftPanel.tsx` — falta el punto de recogida en la fila de manifiesto de la ruta en armado.** El mock (`Recogida.dc.html:238`) muestra `Falabella · La Florida · 42 paq.`; el código sólo mostraba `Falabella · 12 paq.`. `pickupPoint` ya existe en `ManifestRow` (se usa en `ManifestTable.tsx`) — no era un dato faltante, sólo no se leía en este componente. Corregido.

Tests nuevos para cada uno de los cuatro, TDD confirmando rojo por la razón correcta antes de implementar. Mutation-tested manualmente: revertir el prefijo del retailer en la línea de merma mata 2 tests; revertir el ratio verificado/total a un total pelado mata el test que exige `38/38`; ambos confirmados con la implementación restaurada después.

**Divergencias encontradas y NO tocadas (declaradas, no arregladas):**
1. **Fondo de fila completo en `TodayClosuresPanel` cuando hay merma.** El mock (`5a`, líneas 264-268) sólo tiñe el badge del ícono (`bg:var(--warn-bg)`) — la fila en sí no lleva fondo, sólo el `border-bottom` normal. El código actual aplica `bg-status-warning-bg` a la fila completa. **Reencuadre tras revisión:** no es una decisión de producto del usuario — la fase 1 pedía «paleta warning **sólo cuando hay merma**», sin especificar a nivel de fila o de ícono; el teñido de fila completa fue una elección de implementación de `#696` y de su propio test (`TodayClosuresPanel.test.tsx`, que exige `row.className` contenga `'status-warning'`). Bajo la regla de desempate del propio spec-83 («El mock manda en diseño; este spec manda en comportamiento. Si discrepan, se implementa el mock y la discrepancia se escribe aquí»), el mock gana en este punto porque es diseño puro, no comportamiento. **No lo cambié** en esta fase porque tocarlo rompe el test de fase 1 escrito hace minutos y el criterio de esta fase es no interferir con lo que otra acaba de cerrar — pero el registro correcto es: *hallazgo abierto, mock vs. una implementación que fijó más de lo que la fase 1 pedía*, no una decisión cerrada del usuario.
2. **Panel "VEHÍCULO Y CONDUCTOR" inline con barra de ocupación** (`5a`, dentro del panel de ruta en armado). El mock muestra el vehículo/conductor elegidos inline, con "Cambiar", antes de crear la ruta. La implementación actual (`PickupRouteDraftPanel.tsx` + `StartRouteButton.tsx`, spec-61) selecciona el vehículo en un diálogo modal al momento de confirmar, y no hay conductor que elegir (lo asigna quien lidera la ruta). **No es un dato faltante** — es un modelo de interacción distinto, decidido en spec-61 con sus propios tests. `StartRouteButton.tsx` y `VehicleSelect.tsx` no están en el alcance de archivos de esta fase, y reescribir el flujo de creación de ruta para que coincida con el mock sería un cambio de comportamiento, no un diff visual. Se declara sin tocar.
3. **Texto del botón de confirmación.** Mock: "Crear ruta y generar QR". Código: "Iniciar ruta de retiro" (en `StartRouteButton.tsx`, fuera de alcance). Mismo motivo que (2): cambiar el texto sin cambiar el archivo que lo posee, o cambiar el archivo fuera del alcance declarado, no corresponde a esta fase.
4. **La barra de ocupación estimada** (68%) — ya cubierta por la fase 3 de este mismo spec (`[pending]`, depende de spec-73); no se inventó ningún porcentaje aquí, consistente con la decisión de spec-54.
5. **La columna VENTANA y el semáforo de cierre** — cubiertos por la fase 2 (`[blocked]`); `ManifestTable.tsx` sigue sin esa columna, correctamente.

**Seguimiento declarado, no implementado (fuera de lo que esta fase puede tomar sin ampliar alcance):**
- **`ManifestTable` — falta el pie de paginación del mock** (`5a`, líneas 202-208: "7 de 12 · página 1 de 2" + Anterior/Siguiente). No existe paginación en ningún componente de Recogida escritorio hoy. Es comportamiento, no un ajuste visual, así que no se implementa aquí — pero queda declarado para que el siguiente que toque esta pantalla no asuma que ya está.
- **Nit adjunto:** el badge de merma del mock (`5a:265`) es el glifo `!` en mono 700; el código usa el ícono `TriangleAlert` de `lucide-react`. Cosmético, no tocado.
- **`5a` la pintan 8 componentes; esta fase diffeó 4.** También la pintan `PickupDesktopView.tsx`, `PickupDesktopHeader.tsx`, `PickupManifestTabs.tsx` y `ClientFilter.tsx` (el mock pone el buscador en la cabecera, `5a:58-64`; el código lo pone bajo los `StatTile`). Es una limitación de los `**Archivos:**` que este spec declaró para la fase, no una omisión de quien la ejecutó — pero **`5a` no está completamente revisado** por esta fase, sólo la porción de esos 4 archivos.
- **Referencias muertas a `1l` corregidas donde se tocó el archivo** (`TodayClosuresPanel.tsx`, `PickupRouteDraftPanel.tsx`, `ManifestTable.tsx` — los tres docstrings y comentarios que decían "mock 1l" ahora dicen `5a`). **Quedan sin tocar** en archivos fuera del alcance de esta fase: `PickupDesktopView.tsx` (docstring y dos comentarios), `PickupDesktopHeader.tsx` (docstring), `PickupMobileView.tsx` (comentario) y `PickupRouteDraftPanel.test.tsx` (comentario de test). El hallazgo de esta fase es que `1l` no existe como artboard independiente — el mock vivo es `5a`.

`ManifestTable.tsx` y `StatTile.tsx` ya coincidían con lo que `5a` pide sin datos nuevos — tipografías, tamaños, paletas de estado y la séptima columna de impresión ya son fieles. **`StatTile.tsx` no se modificó** — se comprobó `git grep StatTile` y lo usan además `distribution/page.tsx`, `reception/page.tsx`, `DistributionMobileView.tsx`, `PickupMobileActiveRoute.tsx`, `ReceptionCounts.tsx` y un componente local homónimo en `DispatchTabletSidePanel.tsx` que no importa el compartido; al no tocarlo, ninguna de esas pantallas ni sus specs quedan afectadas.

**Impacto downstream.**
- **spec-82** declara a spec-83 como downstream suyo, pero no al revés: `spec-82-recogida-movil-asignacion-y-ruta.md` no menciona `ManifestTable`, `PickupRouteDraftPanel`, `TodayClosuresPanel` ni `StatTile` (verificado con `grep`) — es enteramente móvil (`5b`–`5i`). Nada que reconciliar en esa dirección.
- **Ningún otro spec activo describe estos cuatro componentes de escritorio** más allá de spec-54 (que ya se citó como el origen y quedó superado por este mismo spec) y este propio spec-83.
- El **filtro de merma `status <> 'resolved'`** (spec-85, fase 1 de este spec) no se tocó: esta fase no cambió ninguna consulta ni el hook `useManifests`, sólo el render de campos ya presentes en `CompletedManifest` y `ManifestRow`. El mock no pide nada que lo contradiga — `5a` no distingue estados de discrepancia, sólo muestra el conteo.

> Implementado por: implementer — rama `feat/spec-83-fase-4-diff-visual`, PR #702 (mergeado como `8a626ab`).
> Review: reviewer — dos rondas sobre PR #702. Ronda 1: el spec afirmaba
> fidelidad al mock donde no la había, en tres puntos dentro del alcance
> declarado más dos citados textualmente en el propio spec — de ahí nacieron
> los hallazgos 1-4 y las cinco divergencias declaradas arriba. Ronda 2:
> aprobado, con siete mutaciones aplicadas por el reviewer sobre los tests
> nuevos (confirmando que cada fix tiene un test que lo protege) y
> confirmación de que la reescritura del archivo de tests de
> `TodayClosuresPanel` no perdió cobertura de la fase 1.
> QA: PR #702 merged 2026-09-09T03:22:18Z — `gh pr checks 702` verde (Lint,
> Type-Check, Test, Build x2; Vercel). Suite completa de `components/pickup`
> (46 archivos, 423 tests) en verde. Deploy Production sobre el merge commit
> `8a626ab` (`run 34307544481`) llegó completo hasta `Deploy Supabase
> Migrations` → `Verify Production Migrations` → `Deploy to Vercel`, los tres
> en success — esta fase no trae migración propia, pero es la única de este
> lote con el pipeline de producción confirmado de punta a punta.

---

## Riesgos

- **Este spec puede cerrarse casi entero como «no se hace».** Es un resultado legítimo: spec-54 ya decidió una vez que estos datos no se inventan. Lo que no es legítimo es implementarlos con datos adivinados para que la pantalla se parezca al mock.
- **Divergencia con Despacho en capacidad.** Dos módulos calculando ocupación con proxies distintos es peor que uno solo sin ocupación.
- **El borde izquierdo ya significa algo.** Cambiarlo en silencio rompe una señal que la cuadrilla ya lee.
