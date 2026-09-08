# Spec-83: Recogida en escritorio (`5a`) — ventana de retiro, ocupación y merma

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**su fase 4.4 construyó esta pantalla contra el mock `1l` y difirió estos tres datos con razón escrita**), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre que produce la merma que aquí se muestra), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`; la asignación puede aterrizar aquí), [spec-61](spec-61-pickup-route-crew.md) (panel de armado de ruta), [spec-73](spec-73-capacity-ladder-truck-topup.md) (capacidad de vehículo en Despacho — precedente directo)

**Status:** backlog
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

### Fase 1 — Merma `[pending]`

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
- [ ] Implementar.

### Fase 2 — Ventana `[blocked]`

**Corrección (2026-09-08):** el modelo (a) — ventana fija por punto de
recogida — ya lo eligió el esquema (`pickup_locations[].operating_hours`,
`sla_config.pickup_cutoff_time`); no hay migración de modelo que decidir. Esta
fase sigue `[blocked]`, pero sólo por la decisión real: qué gana en el borde
izquierdo de la fila.

- [ ] Decidir con el usuario: el borde izquierdo cambia de significado
      (progreso → proximidad al cierre) o se añaden dos señales distintas.
- [ ] Poblar `operating_hours` / `pickup_cutoff_time` donde falten (nadie los
      escribe hoy) y hacer que `get_pending_manifests` los devuelva.
- [ ] Columna y semáforo, con la decisión del borde ya tomada explícitamente.

### Fase 3 — Ocupación `[pending]`

- [ ] Leer spec-73 y decidir: mismo proxy, o omisión razonada escrita en este spec.
- [ ] Si se implementa: capacidad en `vehicles` primero, que es la mitad barata y ya se muestra en el mock.

### Fase 4 — Diff visual `[pending]`

**Archivos:** `apps/frontend/src/components/pickup/ManifestTable.tsx`, `apps/frontend/src/components/pickup/PickupRouteDraftPanel.tsx`, `apps/frontend/src/components/pickup/TodayClosuresPanel.tsx`, `apps/frontend/src/components/StatTile.tsx`, y sus tests

- [ ] Screenshot diff `1l` contra `5a`. Se espera poco: `5a` es el mismo diseño con los datos que faltaban.
- [ ] **Conservar la séptima columna** (impresión de etiquetas, spec-53). El mock no la tiene y spec-54 la añadió a propósito: quitarla sería una regresión funcional disfrazada de fidelidad al diseño.

---

## Riesgos

- **Este spec puede cerrarse casi entero como «no se hace».** Es un resultado legítimo: spec-54 ya decidió una vez que estos datos no se inventan. Lo que no es legítimo es implementarlos con datos adivinados para que la pantalla se parezca al mock.
- **Divergencia con Despacho en capacidad.** Dos módulos calculando ocupación con proxies distintos es peor que uno solo sin ocupación.
- **El borde izquierdo ya significa algo.** Cambiarlo en silencio rompe una señal que la cuadrilla ya lee.
