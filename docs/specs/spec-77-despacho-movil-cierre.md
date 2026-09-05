# Spec-77: Despacho en móvil — cerrar la ruta y despachar a DispatchTrack

> **Related:** [spec-79](spec-79-dispatch-handoff-integrity.md) (**arregla H2 y H3; prerrequisito de `2k` y `2l`**), [spec-76](spec-76-despacho-movil-carga.md) (el bucle de carga que precede a estas pantallas), [spec-75](spec-75-despacho-desktop-reshape.md) (escritorio), [spec-78](spec-78-despacho-tablet-anden.md) (tablet del andén), [spec-70](spec-70-dispatch-state-machine.md) (máquina de estados de ruta)

**Status:** in progress
**Verify:** unit, e2e-qa

_Date: 2026-09-03_

---

## Goal

Las cuatro pantallas del final del flujo de carga — el punto donde la operación deja de ser reversible:

| Mock | Qué resuelve |
|---|---|
| `2i` Cerrar con paquetes sin cargar | El cierre nombra la cifra y lo que implica. *Seguir escaneando* es la acción primaria. |
| `2j` Despachar a DispatchTrack | Última revisión de lo que se envía y qué cambia. **La única acción irreversible del módulo.** |
| `2k` DispatchTrack rechazó el envío | El error dice qué pasó, qué **no** cambió y cuál es la salida. |
| `2l` Ruta despachada | Acta de lo que salió y qué sigue en la nave. |

Van en su propio spec y su propio PR precisamente porque son irreversibles: mezclarlas con el bucle de escaneo de `spec-76` significa que un defecto cosmético del escaneo bloquea la revisión del handoff, y al revés.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| Claude Design, proyecto `4656dcbc-00da-4548-a4da-b53e614264c1`, `Despacho.dc.html`, artboards `2i`–`2l` | Geometría, jerarquía y copy |
| `apps/frontend/src/app/api/dispatch/routes/[id]/close/route.ts` | Cierre existente |
| `apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts` | Envío a DispatchTrack; ya contiene `dispatch_failed` |
| `spec-70` | Transiciones `loading → loaded → dispatched` |
| Este spec | Decisiones del lado del repo, desviaciones y plan |

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `2i` Cerrar con faltantes | Hoja/pantalla dentro de la sesión móvil | El endpoint de cierre existe; la confirmación con faltantes no tiene UI móvil |
| `2j` Despachar | Pantalla de confirmación | El endpoint existe; hoy se dispara sin esta revisión |
| `2k` Rechazo de DispatchTrack | Estado de error de `2j` | `dispatch_failed` se registra; no hay pantalla de recuperación |
| `2l` Acta de despacho | Pantalla terminal | No existe: hoy el despacho deja un toast |

### No-goals

- **No se cambia el contrato con DispatchTrack.** Este spec dibuja la confirmación, el error y el acta sobre el endpoint que ya existe. La fase 0 verificó su comportamiento y encontró dos defectos de servidor (H2, H3); se reportan, **no** se arreglan aquí.
- **No se implementa cancelación.** El mock lo dice explícitamente: después de despachar «hay que pedirle a DispatchTrack que la cancele». No hay acción de cancelar en Aureon.
- **No se implementa reapertura de ruta.** `2i` rotula que la ruta no se puede volver a abrir. Corregir un cierre equivocado es intervención de hub, no de andén.
- **No se toca `2a`–`2h`.** Son `spec-76`.
- **No hay migraciones previstas** — sujeto al destino de las notas de `2i` (riesgo 4).

## Decisiones

1. **La acción primaria de `2i` es *Seguir escaneando*, no cerrar.** Cerrar con faltantes es la secundaria y **nombra la cifra** (*Cerrar con 24 sin cargar*) para que nadie lo haga por inercia. Es el mismo criterio que Recepción aplicó en su nota de discrepancia: la salida cómoda no puede ser la destructiva.

2. **El cierre nombra las tres consecuencias, no una.** El copy del mock enumera: los 24 paquetes se quedan en el andén A3 y hay que meterlos en otra ruta · los 148 cargados pasan a `listo_para_despacho` · la ruta no se puede volver a abrir. Las tres se muestran; resumirlas a «¿Confirmar cierre?» es lo que hace que se cierre con faltantes sin querer.

3. **La lista de sin-cargar es paginada, no completa.** El mock muestra 4 con *Ver los 20 restantes*. Con 24 filas la pantalla de confirmación se vuelve scroll infinito y el botón queda fuera de vista, que es exactamente cuando la gente toca a ciegas.

4. **Nota por paquete, opcional en UI y sin regla de servidor inventada.** `2i` ofrece *Nota* por fila. **No** se implementa obligatoriedad: hoy nada en el servidor la exige, y meter la regla sólo en el cliente da la falsa impresión de que está garantizada. Si el negocio la quiere obligatoria, es una regla de servidor y un spec aparte. Esto se anota, no se resuelve por cuenta propia.

5. **`2j` es una revisión, no un botón.** Muestra camión, conductor, fecha de reparto, paradas · paquetes, y un bloque *Qué pasa al despachar* con los cuatro efectos: se crean las paradas en DispatchTrack · los paquetes pasan a `en_ruta` y la ruta a `dispatched` · después no se edita desde Aureon · **si el envío falla, nada cambia**. Esa última línea es la que hace que reintentar sea seguro; la fase 0 la verificó y sólo se sostiene hasta que DT confirma — ver H2. El botón exige `truck_identifier`, que el endpoint valida contra `fleet_vehicles.external_vehicle_id` y rechaza con 422 si no existe.

6. **`2k` dice qué NO cambió — y ya no en una sola frase incondicional.** El mock actual pone *«no se creó nada a medias»* sin condición y ofrece *Reintentar* como acción primaria. Eso sólo es defendible para un rechazo que DT realmente devolvió. **Corrección (verificación de `spec-79` fase 0):** en vez de una frase, `2k` distingue tres estados según lo que el servidor realmente sabe:

   | Error | Copy | Primaria |
   |---|---|---|
   | `DT_API_ERROR` (DT rechazó, con body recibido) | *«DispatchTrack rechazó el despacho. No se creó nada.»* | Reintentar |
   | `DT_ACCEPTED_LOCAL_FAILED` | *«DispatchTrack ya recibió la ruta (nº …). Falta terminar de registrarla acá.»* | **Completar** — nunca Reintentar, y nada en pantalla puede volver a llamar a DT |
   | Sin respuesta (timeout / inalcanzable) | *«No sabemos si DispatchTrack alcanzó a recibir la ruta. Antes de reintentar, verificá si ya existe.»* | **Verificar**, Reintentar degradado |

   La frase incondicional se retira sin importar cuáles de estas opciones terminen implementadas primero. Si la comprobación previa de `spec-79` no está implementada todavía, el tercer estado debe llevar una advertencia explícita de posible duplicado — no puede ofrecer *Verificar* como si el chequeo existiera. El checklist *Antes de reintentar* (verificado: camión y conductor asignados, 24 paradas con dirección y teléfono; advertencia: 2 paradas sin teléfono del receptor) se mantiene para el primer estado, donde reintentar sí es seguro.

7. **`2l` reincorpora al flujo, no a una pantalla vacía.** El acta nombra el id de DispatchTrack (`DT-164972`), las cifras de lo que salió, y **lo que queda pendiente en la nave**: los 24 paquetes que siguen en `asignado` y necesitan otra ruta hoy. Luego ofrece la siguiente carga concreta (`RUT-2026-0090 · Maipú`), no un «volver al inicio». Mismo criterio que el acta de Recogida.

8. **`2l` no dice «sincronizado» si no lo está.** A diferencia de Recogida, aquí sí hay red y el despacho es sincrónico: el acta se muestra **después** de la respuesta de DispatchTrack, así que puede afirmar que la ruta quedó registrada. Si el envío fue aceptado pero la confirmación se perdió, el estado es `2k` con reintento, no un acta optimista.

9. **`sealRoute` crece un modo `force`, y cerrar corto exige un motivo — no un rol.** Un implementador anterior se negó a construir `2i` con razón: el backend no podía sostener "cerrar con N paquetes faltantes" — `sealRoute` (`lib/dispatch/seal-route.ts`) implementaba spec-70 decisión 2 al pie de la letra ("un plan es un compromiso") y la única puerta existente, `DELETE /routes/[id]/packages/[pkgId]`, está reservada a `admin`/`ops_leader` (spec-70 decisión 3, `canRemoveFromPlan`) — deliberadamente **no** a la cuadrilla. La decisión, siguiendo la práctica de la industria (Infor/Oracle *short-shipping*: la responsabilidad viene de un **motivo registrado**, no de un filtro de rol):

   - **Apagado por defecto.** Una llamada sin `force` se comporta exactamente igual que hoy — `409 UNSEALED_STOPS` incluido, sin escribir nada. Esto se fijó con un test antes de tocar el código (`seal-route.test.ts` y `route.test.ts`, cada uno con un caso "PINNED").
   - **Forzar exige un motivo de un vocabulario cerrado.** Sin motivo, `force: true` se rechaza (`400 FORCE_REASON_REQUIRED`), nunca se cierra "por defecto". El vocabulario (`lib/dispatch/force-seal-reasons.ts`) es nuevo — se grepeó el repo primero (`removal_reason`, `adopted_reason`, `return_reason`/discrepancia de Recepción son todos texto libre sin vocabulario detrás) — y es intencionalmente chico: `paquete_no_ubicado`, `turno_terminado`, `vehiculo_lleno`, `paquete_dañado_en_anden`, y `otro` (exige nota no vacía).
   - **El force NO cubre una parada `partially_staged`.** Una orden con algunos bultos ya físicamente en el camión y otros no es un estado mixto: decidir qué mitad va y cuál se queda es un juicio de responsable (la misma razón por la que spec-70 decisión 3 restringe la remoción a un manager), no algo que este endpoint pueda inferir de un motivo a nivel de ruta. Así que el force sigue rechazando (`409 UNSEALED_STOPS`) si CUALQUIER parada pendiente está `partially_staged` — sólo abre la puerta para paradas 100% `planned` (nadie las tocó nunca). Esto deja **fuera de alcance intencionalmente** el caso de una orden partida con un bulto cargado y otro no; ese caso sigue exigiendo un manager. Si el negocio necesita fuerza sobre órdenes mixtas, es una decisión de producto aparte, no una inferida aquí.
   - **Qué pasa con lo que nunca se tocó:** la parada `planned` liberada se **soft-elimina** de `dispatches` (mismo mecanismo que la remoción de manager, alcanzado desde dentro de `sealRoute` mismo — nunca a través de `DELETE /packages/[pkgId]`, que sigue siendo la puerta que se le negó a la cuadrilla) con `removal_reason` = el código (+ nota opcional). Esto hace reaparecer la orden en el cohorte no-ruteado de Pre-ruta (`get_pre_route_snapshot` excluye una orden sólo mientras un `dispatches` no eliminado la ata a una ruta en estado activo) — los bultos quedan disponibles para otra ruta, y la fila nunca se elimina físicamente: el rastro es el `removal_reason` más el `audit_logs`.
   - **Auditoría:** una fila en `audit_logs` (`action: 'force_seal_route'`) con `operator_id`, `user_id` (autor), `timestamp` (hora, default de la tabla) y `changes_json: {reason_code, note, released_count, released_order_ids}` (cifra) — mismo mecanismo que usa la remoción de manager, distinguido por `action`.
   - **Sin migración.** No hizo falta: `removal_reason` y `audit_logs` ya existen desde spec-70; reutilizarlos evita una migración de una sola fila de trabajo y mantiene "no new tables" del espíritu de spec-70.
   - **spec-70 decisión 2 deja de ser absoluta** — ver la nota añadida en ese spec. Un lector futuro de spec-70 no debe asumir que ningún `dispatches.stage='planned'` puede sobrevivir a un `loaded`; sí puede, con motivo y auditoría.

## Fase 0 — Verificación previa: hecha `[done]`

Se leyó `api/dispatch/routes/[id]/dispatch/route.ts`. Resultado: **el copy es correcto para el caso común y falso para un caso de borde real.** Tres hallazgos, todos con consecuencia sobre el diseño:

### H1 — El estado que habilita el despacho es `loaded`, no `closed`

El endpoint responde 409 `INVALID_STATE` si `route.status !== 'loaded'`, y el mensaje que la UI muestra verbatim es *«La ruta debe estar cerrada para despachar (estado: X)»*. `loaded` es lo que escribe `/seal` cuando el manifiesto está sellado — toda parada staged o adoptada, ninguna sólo planificada (`spec-70` decisión 2). El copy en español dice «cerrada» pero el estado se llama `loaded`: **las pantallas deben razonar sobre `loaded`**, no sobre `closed`. Confundirlos deja el botón de despachar habilitado sobre una ruta que el servidor va a rechazar.

### H2 — La atomicidad se cumple **antes** de DispatchTrack, y no después

El orden del handler es el correcto: `createDTRoute` se llama **primero** y sólo cuando DT confirma se toca el estado local. Si DT falla, se lanza, el `catch` registra `dispatch_failed` en `audit_logs` con el detalle, y **nada local cambió**. Para ese camino, el copy de `2j` («si el envío falla, nada cambia») y de `2k` («la ruta sigue… no se creó nada a medias») es **verdadero**.

**Pero existe una ventana después de que DT confirma.** `transition_route_status` corre *después* de `createDTRoute`; si ese RPC falla, el error cae en el mismo `catch`, que devuelve `502 DT_API_ERROR` y registra `dispatch_failed` — **cuando DT ya tiene la ruta creada**. En esa ventana:

- El usuario ve `2k`, que le dice que no se creó nada a medias. **Es falso**: DT sí la creó.
- *Reintentar* es la acción primaria, y `createDTRoute` no lleva clave de idempotencia. Reintentar **duplica la ruta en DispatchTrack**.

Es estrecha pero es exactamente el modo de falla que `2k` promete que no existe, sobre la única acción irreversible del módulo.

> **Corrección (verificación de `spec-79` fase 0, 2026-09-04):** el párrafo anterior decía que un fallo posterior a DT «cae en el mismo `catch`» que un rechazo de DT. **Es falso, y el código es peor de lo que describe.** El `UPDATE` de `routes` (que persiste `external_route_id`) y el de `packages` corren en un `Promise.all` sin desestructurar `error`; supabase-js resuelve `{data, error}` en un fallo de base en vez de rechazar. Así que hoy, si ese `UPDATE` de `routes` falla, el handler no se entera: responde `200 {ok:true}` con `external_route_id` **descartado en silencio**, y nada llega a ningún `catch`. La única escritura post-DT que hoy lanza de verdad es `transition_route_status` — así que la ventana real de duplicado es exactamente *DT aceptó Y `transition_route_status` falló*; si la transición tuvo éxito, el guard `route.status !== 'loaded'` ya devuelve 409 sobre cualquier reintento. También se confirmó (leyendo la documentación oficial de DT, `scripts/dt-api-docs.md`) que DT **no ofrece ninguna clave de idempotencia** — cero ocurrencias de `idempoten` en 5.089 líneas — así que la única cobertura adicional posible es una comprobación previa por `GET`, y sólo en reintentos. Detalle completo, con los matices y desconocidos verificados, en [spec-79](spec-79-dispatch-handoff-integrity.md) *Fase 0*.

### H3 — `en_ruta` se escribe por orden, no por paquete cargado

```ts
supabase.from('packages').update({ status: 'en_ruta' })
  .eq('operator_id', operatorId).in('order_id', orderIds)
```

Marca **todos** los paquetes de las órdenes despachadas, no sólo los que se cargaron. Con una orden partida — y el mock de `2l` muestra `ÓRDENES PARTIDAS 2` — un paquete que se quedó en el andén pasa igualmente a `en_ruta`.

Esto **contradice directamente el copy de `2l`**, que afirma que «los 24 paquetes que quedaron en el andén A3 siguen en estado `asignado` y necesitan otra ruta hoy». Si el paquete quedó en `en_ruta`, no está disponible para otra ruta y el acta miente sobre el estado de la nave.

### Qué implica para este spec

H1 se arregla aquí: es UI razonando sobre el estado correcto. **H2 y H3 son defectos de servidor, no de diseño**, y no se resuelven en este spec — dibujar `2k` y `2l` sobre ellos sería escribir en pantalla dos afirmaciones que el backend no sostiene. Las opciones son las mismas para los dos: corregir el backend en su propio spec, o cambiar el copy para describir lo que realmente pasa. **Decidido: se corrige el backend**, en [spec-79](spec-79-dispatch-handoff-integrity.md). El copy honesto de H3 sería «algunos paquetes del andén pueden quedar marcados como en ruta», que no es algo que se le pueda pedir a una cuadrilla que interprete. `2k` y `2l` se implementan **después** de spec-79 y con el copy tal como está diseñado.

### Fase 0 (resto) `[done]`
1. Confirmar si el endpoint expone número de intentos para el `intento 1 de 3` de `2k` — hoy no lo hace: el contador tendría que ser de cliente, y hay que decidir si eso es aceptable. **Respondido:** no lo expone, y `2k` ya no razona sobre «intento N de 3» sino sobre los tres estados de la decisión 6 — el contador de cliente queda como detalle de UI dentro de la Fase 3, no como algo que bloquee esta fase.

Esta verificación quedaba pendiente sobre si DT ofrece una clave de idempotencia o un `GET` previo — la pregunta que abría la *Fase 0 (bloqueante para H2)* de [spec-79](spec-79-dispatch-handoff-integrity.md). Esa fase 0 ya corrió y está `[done]`: DT no ofrece idempotencia, sí existe un `GET` previo utilizable sólo en reintentos, y el código tiene un defecto más grave de lo que este spec había registrado (ver la corrección de H2 arriba). Con eso, **`2k` y `2l` siguen `[blocked]`** — bloqueadas en la *implementación* de `spec-79`, no en su verificación, que es lo que este documento y H2/H3 arriba ya reflejan.

### Fase 1 (backend) — `sealRoute` fuerza el cierre corto `[done]`

La mitad de servidor de `2i`, separada de su UI a propósito (tarea propia, propio PR) porque cambia
el estado del sistema — la máquina de spec-70 — y eso merece revisión aparte de la pantalla que lo
va a invocar. Ver decisión 9 arriba para el diseño completo.

1. Test: una llamada sin `force` (o `force: false`) es byte-por-byte idéntica a hoy — `409
   UNSEALED_STOPS`, nada escrito. Fijado en `seal-route.test.ts` y en
   `routes/[id]/seal/route.test.ts`, cada uno con un caso rotulado `PINNED`.
2. Test: `force: true` sin `reason_code` se rechaza (`400 FORCE_REASON_REQUIRED`), sin escribir nada.
3. Test: `reason_code` fuera del vocabulario cerrado se rechaza (`400`, zod en el endpoint;
   `FORCE_REASON_REQUIRED` en `sealRoute` como defensa en profundidad).
4. Test: `reason_code: 'otro'` sin `note` no vacía se rechaza.
5. Test: `force` con motivo válido libera (soft-delete) la(s) parada(s) `planned`, revierte el
   paquete a `sectorizado` si hiciera falta (simetría defensiva con `DELETE /packages/[pkgId]`),
   sella la ruta, y devuelve `forced: {reason_code, note?, released_count}`.
6. Test: `audit_logs` recibe una fila `action: 'force_seal_route'` con `operator_id`, `user_id`,
   `resource_id` (la ruta), y `changes_json.{reason_code, note, released_count,
   released_order_ids}`.
7. Test: una parada `partially_staged` entre las pendientes bloquea el force igual que el camino sin
   forzar — no libera nada, no sella. **Corregido en la fase 1b:** este comportamiento resultó
   bloquear el caso canónico (multi-bulto medio-escaneado) y la decisión del usuario fue que el
   force debía dividir la parada en vez de rechazar. El test que fijaba este punto fue reemplazado
   en `seal-route.test.ts`/`route.test.ts` por los casos de división de la fase 1b; no queda un
   test activo que rechace el force sólo por una parada `partially_staged`.
8. Test: un fallo en la liberación (`UPDATE dispatches`) se propaga (lanza), no se traga.

Archivos: `apps/frontend/src/lib/dispatch/force-seal-reasons.ts` (nuevo, vocabulario),
`apps/frontend/src/lib/dispatch/force-seal-release.ts` (nuevo — la liberación + auditoría en sí,
extraída para que `seal-route.ts` no creciera más de lo estrictamente necesario dentro del límite de
300 líneas del repo; ya estaba en 303 antes de esta tarea), `apps/frontend/src/lib/dispatch/seal-route.ts`
(el modo `force`), `apps/frontend/src/app/api/dispatch/routes/[id]/seal/route.ts` (body `{force,
reason_code, note}`, zod). Sin migración — reutiliza `dispatches.removal_reason` y `audit_logs`,
ambos ya existentes desde spec-70. `apps/frontend/src/lib/dispatch/seal-load-position.ts` no expone
`force` (la posición nunca fuerza); su unión de tipos sólo se amplió para que siga compilando contra
el resultado
compartido de `sealRoute`.

### Fase 1b (backend) — el force divide una parada `partially_staged` `[done]`

Corrección de alcance sobre decisión 9 tal como se fusionó en el PR anterior: esa versión
liberaba únicamente paradas `planned` (nunca tocadas) y seguía rechazando el force entero
(`409 UNSEALED_STOPS`) si CUALQUIER parada pendiente era `partially_staged`. Eso bloquea el
caso canónico — con órdenes multi-bulto, "24 bultos sin cargar" incluye rutinariamente
órdenes medio-escaneadas. Decisión del usuario: **el force parte la orden** — los bultos
escaneados viajan, los no escaneados vuelven al andén, disponibles para otra ruta.

- El discriminador por bulto es `loaded_at IS NOT NULL AND load_inferred = false` (spec-79),
  nunca `packages.status` — `listo_para_despacho` es también un estado legacy de "en el andén,
  nunca cargado", y el backfill de spec-74 marcó `loaded_at` con `load_inferred = true` en
  paquetes jamás escaneados.
- `dispatches.stage` gana un valor nuevo, `force_split` (`dispatches_stage_check`, migración
  nueva — a diferencia del resto de la decisión 9, esto SÍ necesita migración: es una
  funcionalidad nueva, no una reutilización de columnas existentes). La fila de `dispatches`
  de la orden partida **no se elimina** — parte de la orden sigue viajando en esta ruta — pero
  su `stage` deja de contar como "todavía miembro del plan" para `get_move_task_snapshot` (que
  sólo mira `planned`/`staged`) y sí cuenta para el paso final de `sealRoute` que avanza los
  paquetes cargados a `listo_para_despacho` (ese `IN` se amplía a incluir `force_split`).
- `get_pre_route_snapshot` deja de excluir la orden completa por tener una fila `dispatches`
  activa cuando esa fila es `force_split`: sin este cambio los bultos liberados al andén
  quedarían invisibles para Pre-Ruta (la orden entera seguiría "reservada" por esta ruta ya
  cerrada). Se añade además un filtro a `ready_pkgs`: un paquete genuinamente cargado
  (`loaded_at IS NOT NULL AND load_inferred = false`) nunca cuenta como disponible, sin importar
  la orden — así el resto que ya viajó no reaparece como si estuviera libre.
- `removal_reason` NO se usa para la mitad partida: ese campo está documentado (spec-70,
  20260825000002) como "soft-delete plus removal_reason, not a stage". Nada se elimina aquí.
  El rastro autorizado es el mismo `audit_logs` de decisión 9, con `split_count`/
  `split_order_ids` añadidos a `changes_json` junto a `released_count`/`released_order_ids`.
- **Hallazgo propio, no reportado por nadie más:** dejar la fila `dispatches` viva (necesario
  para que la ruta que se acaba de sellar siga listando la orden en su acta) tiene un efecto
  secundario que casi se cuela — `scan-validator.ts`'s `ownsTheOrder` bloquea un escaneo en
  OTRA ruta mientras exista CUALQUIER fila `dispatches` no eliminada en una ruta con estado
  activo, y `loaded` es un estado activo. Sin el ajuste, la mitad liberada quedaría "disponible
  para otra ruta" sólo en el papel de Pre-Ruta — cualquier intento real de escanearla en una
  ruta nueva se habría rechazado con `ALREADY_IN_ROUTE` para siempre, porque la ruta vieja
  nunca suelta esa fila. `ownsTheOrder` ahora trata `stage = 'force_split'` como que ya no
  reclama la orden. Cubierto en `scan-validator.test.ts` ("lets a force_split order be
  re-routed").
- Test: `force: true` sobre una parada `partially_staged` (sin `planned` alguna) libera los
  paquetes no cargados, sella la ruta, y devuelve `forced.split_count`/`split_order_ids`.
- Test: mezcla de `planned` + `partially_staged` en la misma llamada — ambas rutas de
  liberación corren, un solo `audit_logs`.
- Test: los paquetes genuinamente cargados de la orden partida avanzan a
  `listo_para_despacho` (el paso final de `sealRoute`, con el `IN` ampliado).
- Test SQL (pgTAP, local): `get_pre_route_snapshot` muestra la orden partida con
  `package_count` igual sólo a los paquetes liberados, nunca a los que ya viajaron.

Archivos: `apps/frontend/src/lib/dispatch/force-seal-split.ts` (nuevo, la división en sí),
`force-seal-audit.ts` (nuevo — el `audit_logs` único, extraído de `force-seal-release.ts` para
que un force mixto deje una sola fila, no dos), `force-seal-release.ts` (deja de escribir el
audit, sólo libera), `seal-pending-stops.ts` (nuevo — la resolución de paradas pendientes
extraída de `seal-route.ts` para que ese archivo no creciera más allá del límite de 300 líneas
tras añadir la división: ya estaba en 391 antes de esta fase, ahora en 287),
`seal-adopted-completeness.ts` (nuevo — el chequeo de completitud `adopted`, extraído por la
misma razón de tamaño), `seal-route.ts` (orquesta ambos, sin lógica propia de force),
`apps/frontend/src/lib/dispatch/types.ts` y `apps/frontend/src/lib/types.ts` (`DispatchStage`/
`dispatch_stage` ganan `force_split`). Migración
`packages/database/supabase/migrations/20260908000001_spec77_force_split.sql`
(`dispatches_stage_check`, `route_stop_counts`, `get_pre_route_snapshot` — sí necesitó
migración, a diferencia del resto de la decisión 9, porque `force_split` es una faceta nueva sin
columna existente que la cargue). Test SQL nuevo:
`packages/database/supabase/tests/spec77_force_split.test.sql`.
`apps/frontend/src/lib/dispatch/scan-validator.ts` (`ownsTheOrder` deja de tratar una fila
`force_split` como reclamo activo — ver el hallazgo de arriba).

### Fase 1c (backend) — corrección de revisión: bloqueo de `retorno_hub`, tests de mutación faltantes, escaneo del bulto ya viajado `[done]`

Tres hallazgos de la revisión de fase 1b, cada uno con su propio fix y test:

1. **BLOQUEANTE — `ready_pkgs`' nuevo predicado escondía `retorno_hub` para siempre.**
   `20260908000001` agregó `NOT (loaded_at IS NOT NULL AND load_inferred = false)` a
   `ready_pkgs`, correcto en sí mismo (evita que la mitad ya despachada de una orden
   partida reaparezca como "disponible"), pero **nada en el camino de retorno lo
   limpiaba**: `process_failed_delivery` sólo escribe `status`, `complete_return_reception_scan`
   sólo escribía `status`, y el trigger de dock-scan sólo escribe `status`/`dock_zone_id`. Un
   bulto que salió, falló la entrega, volvió, fue re-recibido y re-escaneado al andén llega a
   `sectorizado` con un `loaded_at` viejo de la ruta ya `completed` — y el predicado nuevo lo
   excluye **para siempre**. Si era el único paquete vivo de la orden, la orden entera
   desaparecía de Pre-Ruta: el flujo de reingreso de spec-43 quedaba muerto.

   **La corrección NO angosta el filtro** — la razón por la que debe ser global (una vez que
   `routed_ids` deja de excluir la orden completa) sigue siendo válida. La pieza que faltaba es
   que el camino de retorno limpie `loaded_at`/`loaded_by`/`load_inferred`, igual que ya hacen
   los dos endpoints de remoción del plan (`routes/[id]/packages/[pkgId]/route.ts`,
   `routes/[id]/route.ts`). Se eligió **un solo punto**: `complete_return_reception_scan`
   (`retorno_hub` → `en_bodega`). Es el único punto de paso garantizado — `SCANNABLE_STATUSES`
   en `dock-scan-validator.ts` es `['en_bodega', 'sectorizado']`, así que un paquete
   `retorno_hub` sólo puede volver a `sectorizado` pasando primero por este RPC.
   `process_failed_delivery` y el trigger de dock-scan quedan sin tocar a propósito: `ready_pkgs`
   ya excluye `retorno_hub`/`en_bodega` por `status`, así que un `loaded_at` viejo es inerte
   hasta que este RPC corre. Migración:
   `packages/database/supabase/migrations/20260908000002_spec77_retorno_hub_clears_load_fact.sql`
   (`CREATE OR REPLACE`, plantilla `20260512000006` — su única definición previa). Test pgTAP
   nuevo: `packages/database/supabase/tests/spec77_retorno_hub_load_fact.test.sql` (reproduce el
   fixture completo — falla contra la definición sin el fix, pasa con él).

2. **ALTO — al test 3 de la fase 1b ("los paquetes cargados avanzan a
   `listo_para_despacho`") le faltaba la aserción real**, y el mock de `seal-route.test.ts`
   no distinguía la consulta final de `seal-route.ts` (`.in('stage', ['staged', 'adopted',
   'force_split'])`) de la consulta de `resolvePendingStops` (`.in('stage', ['planned',
   'partially_staged'])`) — ambas respondían con el mismo array canned. Un mutante que
   angostara el `.in(...)` a `['staged', 'adopted']` dejaba 40/40 tests en verde. Corregido:
   el mock ahora distingue por el contenido del filtro `stage` (`sealedRows`, nuevo, sólo
   responde a la consulta que incluye `force_split`), y se agregaron aserciones sobre el
   `UPDATE packages` real, `orders_closed`, y el filtro exacto — probado matando el mutante
   a mano antes de cerrar la tarea.

3. **MEDIO — escanear el bulto YA viajado de una orden partida en otra ruta dejaba un
   `dispatches` huérfano y un 500.** `ownsTheOrder` trata una fila `force_split` como
   "ya no reclama la orden" — correcto para la mitad liberada, pero se aplica a CUALQUIER
   paquete de la orden, incluida la mitad que sí viajó. El chequeo por-paquete
   (`ALREADY_STAGED`) sólo corría en la rama `onThisRoute`; escanear el bulto viajado en una
   ruta nueva caía en `adopt`, `routes/[id]/scan/route.ts` insertaba la fila `dispatches`
   primero, y `advancePackagesToEnCarga` no encontraba nada que actualizar (el `loaded_at`/
   `load_inferred` del bulto no satisfacen `.or('loaded_at.is.null,load_inferred.eq.true')`) →
   lanza → 500, dejando una fila `adopted` viva que ningún seal puede completar. Corregido:
   el mismo chequeo por-paquete (`found.loaded_at && !found.load_inferred`) ahora también
   corre en la rama `adopt`, devolviendo el mismo `ALREADY_IN_ROUTE` limpio de antes de
   `force_split`.

Archivos: `packages/database/supabase/migrations/20260908000002_spec77_retorno_hub_clears_load_fact.sql`
(nuevo), `packages/database/supabase/tests/spec77_retorno_hub_load_fact.test.sql` (nuevo),
`apps/frontend/src/lib/dispatch/seal-route.test.ts` (mock corregido + tests nuevos),
`apps/frontend/src/lib/dispatch/scan-validator.ts` (chequeo por-paquete en la rama `adopt`,
comentarios recortados para volver a bajar de 300 líneas tras el fix), `scan-validator.test.ts`
(dos tests nuevos), `apps/frontend/src/lib/dispatch/force-seal-split.ts` y
`20260908000001_spec77_force_split.sql` (corrección de cita: el filtro de
`get_move_task_snapshot` es `stage IN ('planned', 'partially_staged', 'staged')`, no
`('planned', 'staged')`), `apps/frontend/src/lib/types.ts` (`route_stop_counts.force_split_stops`,
faltaba en el tipo hecho a mano).

### Fase 1d (backend) — corrección de revisión adversarial de PR #616: B1/B4, orden de escritura antes de la refutación `[done]`

Hallazgo bloqueante de una revisión adversarial del PR #616 (post-fase 1c): **el force liberaba/dividía la(s) parada(s) pendiente(s) — escritura ya comprometida — y sólo DESPUÉS corría `checkAdoptedCompleteness`, que puede rechazar.** Con una ruta `loading` que tiene a la vez una parada `planned` (ORD-A) forzable y una parada `adopted` incompleta (ORD-B, un bulto sin escanear), la secuencia era:

1. `resolvePendingStops` libera (soft-delete) ORD-A, escribe `audit_logs` — ambos comprometidos.
2. `checkAdoptedCompleteness` rechaza (`409 UNSEALED_STOPS`, por ORD-B).
3. La cuadrilla ve "faltan 1 parada(s)"; la ruta sigue `loading`.
4. **ORD-A ya no existe en el plan de esta ruta** (fila `dispatches` con `deleted_at`) y `pendingCount` en cualquier reintento (forzado o no) ya no la ve — el force nunca vuelve a encontrarla para liberarla "de nuevo" porque ya está liberada. La orden queda fuera del plan para siempre, y la ruta queda sin poder sellarse hasta que alguien complete ORD-B — momento en el cual la cuenta de bultos de la ruta ya no cuadra con lo que salió: ORD-A desapareció sin ningún acta.

Dos comentarios en el código afirmaban que esto no podía pasar, y ambos eran falsos:
`seal-pending-stops.ts:31` ("nunca ambas cosas — rechazar Y escribir") y `force-seal-audit.ts`
("el seal mismo ya tuvo éxito para cuando esto corre"). Corregidos como parte de este fix (ver
"Archivos" abajo) — ahora describen lo que el código realmente hace.

**Fix: separar "decidir" de "escribir".** `seal-pending-stops.ts` se dividió en dos funciones:

- `planPendingStopsResolution` — sólo lectura. Corre las mismas refutaciones de siempre
  (sin `force`, o `force` sin motivo válido → rechaza igual que antes) pero, si el force
  procede, devuelve un **plan** (`{ kind: 'apply', reasonCode, plannedRows,
  partiallyStagedRows }`) en vez de escribir nada.
- `applyPendingStopsPlan` — sólo escritura (`releasePendingForForce` +
  `splitPartiallyStagedForForce` + `writeForceSealAudit`, en ese orden, un solo `audit_logs`).
  Nunca decide si debe correr — eso ya lo decidió el plan.

`seal-route.ts` ahora ordena así: `planPendingStopsResolution` (puede rechazar, no escribe) →
`checkAdoptedCompleteness` (puede rechazar, no escribe) → `applyPendingStopsPlan` (escribe,
nunca rechaza) → avance de `packages` a `listo_para_despacho` → `transition_route_status`
(el único paso que puede lanzar después de escrituras ya comprometidas — invariante que ya
existía y que este fix no toca: el guard del handler de `/dispatch` sigue siendo lo que
protege una ruta que dejó `loaded`).

**Por qué esto también cierra B4 (rows `force_split` huérfanas) por construcción:** el mismo
reordenamiento hace que un `force_split` sólo se escriba después de que `checkAdoptedCompleteness`
ya pasó — la única refutación alcanzable después de decidir el plan queda eliminada. Lo que
puede fallar después de `applyPendingStopsPlan` (el `UPDATE packages` final y
`transition_route_status`) ya no son refutaciones sino errores genuinos (`throw`), y son
auto-recuperables: un reintento (forzado o no) recalcula `pendingCount` en 0 para la fila ya
liberada/dividida (el force_split ya no cuenta como `planned`/`partially_staged`), así que
`planPendingStopsResolution` devuelve `noop` y la ejecución llega directo a la consulta final
(`stage IN ('staged','adopted','force_split')`, ya ampliada desde la fase 1b) — el mismo camino
que sella una ruta sin nada pendiente. No queda ningún camino donde una fila `force_split`
sobreviva a una refutación real; sólo puede sobrevivir a un error de escritura genuino, y ese
caso converge solo en el reintento siguiente.

Tests (TDD, rojo antes del fix): `seal-route.test.ts` — "B1: refuses on an incomplete adopted
stop WITHOUT releasing a planned stop force already resolved to proceed" y "B4: ... WITHOUT
splitting a partially_staged stop ...", ambos con las mismas aserciones cero-escritura que
"PINNED" ya usaba (`dispatches` update ausente, `audit_logs` ausente, `packages` update
ausente). **Verificado por mutación**: se clonó `seal-route.ts` a un archivo de scratch con el
orden viejo (aplicar el plan ANTES del chequeo adopted) y se corrió `seal-route.test.ts` contra
él vía un `vitest.config` de scratch con un alias que sólo sustituye ese import — el resto de la
suite (mocks compartidos incluidos) corrió sin tocar. Resultado: exactamente los dos tests
nuevos (B1, B4) fallan contra la mutación; los 17 restantes siguen en verde — confirma que estos
dos tests, y sólo ellos, pinan el orden correcto. Ningún archivo del repo se tocó para esta
verificación.

**MEDIO, mismo hallazgo de revisión — `useRoutePackages.ts` contaba "cargado" con el discriminador
equivocado.** `if (p.loaded_at)` sin mirar `load_inferred` cuenta un bulto backfillado por
spec-74 (`loaded_at` seteado, `load_inferred: true`, status real `sectorizado`) como "cargado" en
pantalla — no lo es: el `UPDATE packages ... WHERE status = 'en_carga'` final del seal lo deja en
el andén. Corregido: la consulta ahora trae `load_inferred` y el conteo usa
`loaded_at IS NOT NULL AND load_inferred = false`, el mismo discriminador que
`force-seal-split.ts`/`seal-adopted-completeness.ts` ya usaban — nunca `packages.status` solo.
Test: "does not count a load_inferred (backfilled) package as loaded"
(`useRoutePackages.test.ts`).

Archivos: `apps/frontend/src/lib/dispatch/seal-pending-stops.ts` (dividido en
`planPendingStopsResolution`/`applyPendingStopsPlan`, comentario falso corregido),
`apps/frontend/src/lib/dispatch/seal-route.ts` (reordena las tres etapas; comentario de la
`adopted`-completeness explica ahora por qué su posición es load-bearing),
`apps/frontend/src/lib/dispatch/force-seal-audit.ts` (comentario falso corregido — ya no afirma
que el seal "ya tuvo éxito" para cuando el audit corre), `apps/frontend/src/lib/dispatch/seal-route.test.ts`
(tests B1/B4), `apps/frontend/src/hooks/dispatch/useRoutePackages.ts` +
`useRoutePackages.test.ts` (discriminador `load_inferred`). Sin migración — mismo cambio de
orden de lectura/escritura sobre las tablas y columnas ya existentes.

### Fase 1 (UI) — `2i` Cerrar `[done]`

**Nota pendiente de la fase 1b, para quien construya esta pantalla:** una vez sellada una orden
partida, su fila en `RouteBuilder`/`PackageRow.tsx` (`boxesTotal`/`boxesLoaded`, vía
`useRoutePackages.ts`) sigue leyendo TODOS los paquetes vivos de la orden — incluidos los ya
liberados a otra ruta — porque la fila `dispatches` (`stage: 'force_split'`) nunca se elimina.
Eso es correcto para el conteo (de hecho refleja "1 de 2" con precisión), pero
`unstaged`/`isPartial` en `PackageRow.tsx` no reconocen `force_split` como un tercer caso: la fila
no se ve "unstaged" (`planned`/`partially_staged`/adopted-incompleto) ni tampoco "completa" — se
renderiza como si estuviera completa aunque `boxesLoaded < boxesTotal`. Esto no se toca aquí (es
UI, fuera de alcance de esta fase de backend) pero `2i`/esta pantalla necesita decidir cómo
mostrar una orden partida ya sellada, no asumir que el componente actual ya lo hace bien.

**Verificado y NO tocado a propósito:** `2i` (`DispatchRouteCloseSheet.tsx`) nunca renderiza una
fila `force_split` — su lista de "sin cargar" viene de `useRouteScanSession`/`useRoutePackages` del
mismo modo que el contador del propio 2e, y esos rows sólo existen mientras la orden sigue
`planned`/`partially_staged`/`adopted` en una ruta AÚN sin sellar; `force_split` sólo aparece
DESPUÉS de un seal exitoso, cuando 2i ya se cerró. La fila que el gap describe sólo se ve en el
escritorio (`RouteBuilder`/`PackageRow.tsx`, `1c`, para una ruta ya `loaded`) — otra pantalla, otro
spec de UI (no `2i`). Queda documentado aquí, no arreglado en silencio.

3. Test: con faltantes → pantalla de confirmación; sin faltantes → cierre directo. ✅
   `DispatchRouteScanSession.test.tsx` ("con nada faltante sella directo" / "con faltantes abre la
   hoja").
4. Test: las tres consecuencias aparecen (decisión 2). ✅ `DispatchRouteCloseSheet.test.tsx`.
5. Test: *Seguir escaneando* es primaria; el botón de cerrar nombra la cifra exacta. ✅ ídem.
6. Test: lista paginada con *Ver los N restantes* (decisión 3). ✅
   `route-close.test.ts` (`paginateMissing`) + `DispatchRouteCloseSheet.test.tsx`.
7. Test: nota por fila se persiste; su ausencia no bloquea el cierre (decisión 4). ✅ con una
   desviación honesta, documentada en el riesgo 4 (abajo): el endpoint (fase 1) sólo acepta UN
   `note` por llamada de force, no uno por paquete — no hay columna de nota por orden y esta fase
   no lleva migración (no-goals). Cada nota de fila que se escribe se pliega en ese único string,
   con el número de orden como etiqueta (`buildForceSealNote`, `route-close.ts`), así que sí llega
   a `audit_logs.changes_json.note` — "persiste", aunque no como un hecho por-paquete separado. Una
   fila sin nota nunca bloquea el cierre. El riesgo 4 sigue abierto para quien le dé a las notas un
   hogar real por paquete.
8. Test: al cerrar, los cargados pasan a `listo_para_despacho` y la ruta a `loaded`. ✅ cubierto en
   el backend (`seal-route.test.ts`, fases 1/1b/1c); esta fase verifica que la UI invoca `POST
   /seal` (directo o forzado) y reacciona a `ok`/refusal — no reimplementa la aserción de estado en
   un test de UI que no toca la base.

Archivos: `apps/frontend/src/lib/dispatch/mobile/route-close.ts` (nuevo — `missingOrders`,
`closeButtonLabel`, `paginateMissing`, `buildForceSealNote`),
`apps/frontend/src/lib/dispatch/mobile/force-seal-reason-copy.ts` (nuevo — labels ES sobre el MISMO
vocabulario cerrado de `force-seal-reasons.ts`), `apps/frontend/src/hooks/dispatch/mobile/useSealRoute.ts`
(nuevo — cliente de `POST /seal`, con/sin force), `apps/frontend/src/hooks/dispatch/mobile/useRouteScanSession.ts`
(expone `packages`, ya fetched, sin query nueva), `apps/frontend/src/components/dispatch/mobile/DispatchRouteCloseSheet.tsx`
(nuevo — la hoja `2i`), `apps/frontend/src/components/dispatch/mobile/DispatchRouteScanSession.tsx`
(el botón "Cerrar ruta" deja de estar deshabilitado: cierra directo sin faltantes, abre la hoja con
ellos), `apps/frontend/src/lib/dispatch/mobile/close-route-copy.ts` (comentario actualizado — el
teléfono ya no usa `CLOSE_ROUTE_DISABLED_REASON`; el tablet `3a`, spec-78, sigue pendiente y fuera
de alcance de este spec).

### Fase 2 — `2j` Despachar `[done]`
9. Test: la revisión muestra camión, conductor, fecha, paradas · paquetes. ✅
   `DispatchRouteDispatchReview.test.tsx`.
10. Test: sin camión asignado → no se puede despachar y se dice por qué (DispatchTrack exige el
    identificador). ✅ ídem — `canDispatch`/`NO_VEHICLE_REASON` en `dispatch-review.ts`.
11. Test: el bloque *Qué pasa al despachar* enumera los cuatro efectos. ✅ ídem — `DISPATCH_EFFECTS`.
12. Test: doble toque no envía dos veces. ✅ dos guardas independientes, ninguna en el servidor:
    `useDispatchRouteToDT.ts` rechaza sincrónicamente una segunda llamada mientras la primera sigue
    en vuelo (`inFlight` ref), y `DispatchRouteDispatchReview.tsx` deshabilita el botón con estado
    (`sending`) apenas se dispara el primer toque — un `dblClick` de `userEvent` no reprodujo el
    caso real (su demora interna deja resolver el mock antes del segundo evento); el test usa dos
    `fireEvent.click` sin esperar entre medio, que sí deja el segundo toque llegar mientras el
    primero está pendiente. **Ninguna de las dos cierra la ventana del servidor** (spec-79 review
    finding 4, citado también en `dispatch/route.ts`): dos pestañas o dispositivos distintos pueden
    seguir creando dos rutas en DispatchTrack; ese arreglo es spec-79 Fase 4.

Además de los cuatro ítems: los códigos de respuesta del endpoint (`EMPTY_ROUTE`, `EMPTY_MANIFEST`,
`VEHICLE_NOT_FOUND`, `MISSING_ORDER_NUMBER`, `QUERY_FAILED`, `DT_API_ERROR`,
`DT_ACCEPTED_LOCAL_FAILED`) se mapean a copy distinto en `dispatchErrorCopy` (`dispatch-review.ts`),
nunca a un mensaje genérico — decisión 6 exige que `DT_ACCEPTED_LOCAL_FAILED` no ofrezca nunca
"Reintentar"; ese código no muestra un botón de reintento aquí (`retryable: false`), sólo el mensaje
que dirige al jefe de turno — completar el registro local (`2k`'s *Completar*) sigue siendo trabajo
de Fase 3, bloqueada.

**Desviación documentada — sin `2l` (bloqueado), un despacho exitoso no tiene a dónde ir.**
`DispatchRouteDispatchReview`'s `onDispatched` hoy sólo devuelve a la cuadrilla a `/app/dispatch`
(mismo criterio interino que `2i` usó antes de que esta fase existiera). Cuando Fase 4 deje de estar
bloqueada, ese callback debe apuntar al acta real.

Archivos: `apps/frontend/src/lib/dispatch/mobile/dispatch-review.ts` (nuevo — `DISPATCH_EFFECTS`,
`NO_VEHICLE_REASON`, `canDispatch`, `dispatchErrorCopy`), `apps/frontend/src/hooks/dispatch/mobile/useDispatchRouteToDT.ts`
(nuevo — cliente de `POST /dispatch`; deliberadamente NO el mismo hook que `RouteBuilder`/`3a`
comparten (`useDispatchRouteToDispatchTrack.ts`), que aplana todo error a un solo `message` y
descarta `code`/`external_route_id` — exactamente lo que esta fase no puede hacer),
`apps/frontend/src/components/dispatch/mobile/DispatchRouteDispatchReview.tsx` (nuevo — la pantalla
`2j`), `apps/frontend/src/components/dispatch/mobile/DispatchRouteScanSession.tsx` (un seal exitoso,
directo o forzado, abre `2j` en el mismo estado en vez de navegar — mismo patrón que
`scanning`/`viewingPackages`), `apps/frontend/src/components/dispatch/DispatchRouteSurface.tsx`
(pasa `routeDate`/`stopsCount` hacia abajo), `apps/frontend/src/hooks/dispatch/mobile/useRouteLoadBrief.ts`
(gana `routeDate` — mismo fetch, sin query nueva).

### Fase 3 — `2k` Error `[done]`

Desbloqueada por `spec-79` Fase 4 (`[done]`, PR #622): `DT_ACCEPTED_LOCAL_FAILED`,
`EMPTY_MANIFEST`, y los códigos nuevos `DISPATCH_IN_PROGRESS`/`RECONCILIATION_REQUIRED` ya
existen y están probados del lado del servidor. `dispatchErrorCopy` (`dispatch-review.ts`,
`2j`) se **extendió** en vez de crear una segunda tabla de mapeo — cada `DispatchErrorInfo`
ahora lleva `whatChanged` (item 13), `primaryAction`/`primaryLabel` (`'retry' | 'complete' |
'verify' | 'wait' | null`, decisión 6) y `showChecklist` (item 15, sólo `DT_API_ERROR`).

13. Test: fallo → estado de error que nombra qué no cambió; la ruta sigue `loaded` y los
    paquetes en `listo_para_despacho`. ✅ `dispatch-review.test.ts` (`whatChanged` por código) +
    `DispatchRouteError.test.tsx`. `QUERY_FAILED` recibe el mismo `whatChanged` que
    `DT_API_ERROR` pero **nunca** el texto "rechazó" — es un fallo de base antes de contactar a
    DT, no un rechazo (instrucción explícita de la tarea). `DT_ACCEPTED_LOCAL_FAILED` es la
    única excepción real: su `whatChanged` dice qué SÍ cambió (DT ya tiene la ruta), nunca "nada
    cambió" — decisión 6 lo exige.
14. Test: contador de intentos; al tercero, el copy deriva al jefe de turno. ✅
    `dispatch-attempt-copy.test.ts` (`attemptEscalationCopy`, umbral `3`, exportado — no un
    número mágico duplicado) + `DispatchRouteDispatchReview.test.tsx` (el contador vive en el
    componente, se incrementa en cada fallo, se pierde al recargar — la Fase 0 ya resolvió que
    el servidor no expone ningún conteo).
15. Test: checklist *Antes de reintentar* separa verificado de advertencia. ✅
    `dispatch-retry-checklist.test.ts` (`buildRetryChecklist`, puro) +
    `useDispatchRetryChecklist.ts` (nuevo — `dispatches(orders(delivery_address,
    customer_phone))`, mismo shape que `useRouteDispatches.ts` del escritorio, `operator_id` +
    `deleted_at is null`), fetcheado sólo cuando `showChecklist` es verdadero (decisión 6: sólo
    `DT_API_ERROR`).

**Diseño de `2k` — un estado, no una pantalla nueva.** Decisión 6 lo llama "estado de error de
`2j`": `DispatchRouteDispatchReview` renderiza `DispatchRouteError` (nuevo,
`components/dispatch/mobile/`) en el lugar de su propio contenido en cuanto `dispatch()` falla —
para CUALQUIER código, no sólo los tres estados de DT. Los rechazos de validación
(`EMPTY_ROUTE`/`EMPTY_MANIFEST`/`VEHICLE_NOT_FOUND`/`MISSING_ORDER_NUMBER`) también abren esta
pantalla (decisión 6 es sobre nombrar qué no cambió, y eso es cierto de un rechazo de validación
también) pero con `primaryAction: null` — sólo *Volver*, ningún botón de acción porque no hay
nada que reintentar hasta que la cuadrilla arregle lo que falta. *Reintentar*/*Completar*/
*Verificar* son, deliberadamente, el mismo botón subyacente (`onRetry` → vuelve a llamar
`handleDispatch`): el propio endpoint (`spec-79` Fase 4) ya decide del lado del servidor si un
reintento reusa `external_route_id` persistido, dispara la comprobación previa por `GET`, o
reclama un intento fresco — este cliente no necesita tres caminos de red distintos, sólo tres
etiquetas honestas sobre el mismo POST.

**`DISPATCH_IN_PROGRESS`/`RECONCILIATION_REQUIRED` (nuevos desde que se escribió decisión 6).**
Añadidos a `dispatchErrorCopy` con la misma disciplina: `DISPATCH_IN_PROGRESS` dice que se
autolibera solo en minutos, nunca "falló" (instrucción explícita de la tarea);
`RECONCILIATION_REQUIRED` es, en la práctica, el tercer estado de la decisión 6 con una señal
real de servidor detrás en vez de sólo un timeout de cliente — mismo `primaryAction: 'verify'`
que el fallo de red sin código.

**Verificación por mutación** (item de Definition of Done): tres mutaciones a mano sobre
`dispatch-review.ts` (texto de `whatChanged` sin `listo_para_despacho`, `showChecklist` de
`DT_API_ERROR` invertido, `primaryAction` de `DT_ACCEPTED_LOCAL_FAILED` cambiado a `retry`) y una
sobre `dispatch-retry-checklist.ts` (el conteo "verificado" deja de exigir teléfono) — las cuatro
murieron contra tests específicos; revertidas antes de cerrar la tarea, `git status` limpio.

Archivos: `apps/frontend/src/lib/dispatch/mobile/dispatch-review.ts` (extendido, no
reemplazado), `dispatch-attempt-copy.ts` (nuevo), `dispatch-retry-checklist.ts` (nuevo),
`apps/frontend/src/hooks/dispatch/mobile/useDispatchRetryChecklist.ts` (nuevo),
`apps/frontend/src/components/dispatch/mobile/DispatchRouteError.tsx` (nuevo — la pantalla/
estado `2k`), `DispatchRouteDispatchReview.tsx` (gana `operatorId`, renderiza `DispatchRouteError`
en vez de un párrafo inline en cualquier fallo, cuenta intentos).

### Fase 4 — `2l` Acta `[done]`

16. Test: acta con el id de DispatchTrack, las 4 cifras y lo que queda en el andén. ✅
    `dispatch-acta.test.ts` (`buildActaFigures`/`dockLeftLine`, puro) +
    `DispatchRouteAcceptance.test.tsx`. Las 4 cifras: paradas despachadas y paquetes despachados
    (ambas de la respuesta del propio endpoint de despacho, `spec-79`) · paquetes que quedan en
    el andén y órdenes partidas (ambas del **outcome del seal/force**,
    `forced.released_count`/`forced.split_count`/`forced.split_order_ids.length` — nunca
    re-derivadas de `packages` del lado del cliente, siguiendo la instrucción explícita de la
    tarea). **Corrección sobre el copy original de H3/decisión 7:** los bultos liberados por un
    force vuelven a `sectorizado` (`force-seal-release.ts`/`force-seal-split.ts`), no a
    `asignado` como decía el mock viejo — `dockLeftLine` lo dice así, y un test pin fija que
    nunca aparece la palabra "asignado".
17. Test: ofrece la siguiente carga concreta si existe; si no, no inventa una. ✅
    `dispatch-acta.test.ts` (`nextLoadLine`, `null` in → `null` out) +
    `useDispatchNextLoad.test.ts`/`DispatchRouteAcceptance.test.tsx`. Reutiliza la cola de
    `useCrewLoadingBoard` (`2a`/`2b`, spec-76) en vez de una query nueva — la ruta recién
    despachada ya cae fuera de `OPEN_ROUTE_STATUSES` así que se excluye sola; el filtro
    `excludeRouteId` es defensivo para la ventana antes del refetch. El id del usuario se
    resuelve con `auth.getUser()` dentro del hook (mismo patrón que `useCurrentUserName.ts`) en
    vez de enhebrarlo por `DispatchRouteSurface` -> ... -> esta pantalla, cadena que hoy no lo
    lleva y que no vale la pena tocar por una sola línea del acta.
18. Test: la ruta queda `dispatched` y los paquetes en `en_ruta`. Cubierto del lado del servidor
    por la propia suite de `spec-79` (`dispatch-local-completion.test.ts`, `route-dispatch.test.ts`,
    `route-dispatch-phase4.test.ts`) — mismo criterio que la Fase 1 (UI) de `2i` (item 8): esta
    pantalla no reimplementa esa aserción contra la base, sólo se muestra **después** de que el
    propio POST devuelve `ok: true`, y consume literalmente lo que la respuesta trae
    (`external_route_id`, `packages_dispatched`) — nunca un número derivado en el cliente.

**Sin pantalla vacía.** `DispatchRouteScanSession` ya no navega a `/app/dispatch` al despachar
con éxito (desviación documentada en Fase 2, ahora resuelta): un nuevo componente
`DispatchRouteHandoff` (extraído de `DispatchRouteScanSession`, que iba a cruzar el límite de
300 líneas al añadir el estado del acta) posee el `dispatchOutcome` y decide entre `2j`
(`DispatchRouteDispatchReview`) y `2l` (`DispatchRouteAcceptance`).

Archivos: `apps/frontend/src/lib/dispatch/mobile/dispatch-acta.ts` (nuevo —
`buildActaFigures`/`dockLeftLine`/`nextLoadLine`), `apps/frontend/src/hooks/dispatch/mobile/useDispatchNextLoad.ts`
(nuevo), `apps/frontend/src/components/dispatch/mobile/DispatchRouteAcceptance.tsx` (nuevo — la
pantalla `2l`), `DispatchRouteHandoff.tsx` (nuevo — `2j`→`2l` extraído de
`DispatchRouteScanSession.tsx`), `DispatchRouteCloseSheet.tsx` (`onSealed` gana
`packagesLeftAtDock`/`splitOrdersCount`, calculados del `forced` real del seal — nuevo tipo
exportado `DispatchRouteSealedOutcome`), `DispatchRouteScanSession.tsx` (guarda el outcome del
seal, lo pasa a `DispatchRouteHandoff`).

**Verificación por mutación:** dos mutaciones a mano sobre `dispatch-acta.ts`
(`buildActaFigures` — la cifra "en el andén" apuntada a `packagesDispatched` en vez de
`packagesLeftAtDock`, dos veces con distintas aserciones) — ambas murieron contra
`dispatch-acta.test.ts`/`DispatchRouteAcceptance.test.tsx`; revertidas, `git status` limpio.

### Fase 5 — Cierre y E2E `[pending]`

El E2E de Despacho se concentra en `spec-76` y aquí (decisión del usuario). Este spec es el objetivo de mayor valor de los cuatro: es la única acción irreversible del módulo, y un fallo suyo manda un camión a la calle con una ruta mal despachada.

19. `npm run test -- --pool=forks` + mutation-test antes de push.
20. E2E del camino completo cargar → cerrar → despachar, sobre `e2e/support/despacho-fixture.ts` (lo construye `spec-76` fase 7, con namespace propio).
21. **DispatchTrack se mockea a nivel de red**, como ya hace `e2e/dispatch-route.spec.ts` interceptando `**/activationcode.dispatchtrack.com/**`. Nunca se despacha de verdad contra DT desde un test.
22. Tres caminos, no uno: DT rechaza · DT acepta · **DT acepta y la escritura local falla** (H2). El tercero es el que hoy no se distingue y el que `spec-79` arregla; el E2E debe cubrirlo para que no vuelva a colarse.
23. E2E de que cerrar con faltantes **no** deja bultos del andén en `en_ruta` (H3), con una orden partida a propósito en el fixture.
24. Ejecutar en el runner del VPS (`e2e:qa`) y **leer el reporte**, no el check verde: `e2e-qa` es `continue-on-error: true`.
25. Verificación en QA.

## Lecciones aplicadas

Reglas que **ya costaron caro** en otro spec de esta serie. No son teoría: cada una nombra dónde se aprendió. Léelas antes de escribir la primera línea de este spec.

1. Confirmá qué pantalla es un archivo por sus **imports y su ruta**, nunca por su número de artboard.

   *Dónde se aprendió:* `spec-75` decisión 2 afirmaba que `RouteBuilder.tsx` era la pre-ruta (`1a`) y había que partirlo. Es la pantalla de **una ruta** (`/app/dispatch/[routeId]`, `1c`), y las tres columnas de `1a` ya existían. La renumeración entre el handoff viejo y el canvas nuevo lo provocó. De haberse implementado, un agente habría desarmado una pantalla que funciona.

2. El canvas dibuja la **página completa**: separá el chrome de la plataforma y de la app del chrome del módulo.

   *Dónde se aprendió:* `spec-75` mandó redibujar el breadcrumb `Operación / Despacho` que `TopBar` ya renderiza — habría salido dos veces en pantalla. Un elemento presente en un artboard no implica que haya que construirlo: puede pintarlo el sistema operativo o existir un nivel más arriba.

3. Verificá que los campos que el spec da por existentes **estén realmente en el payload**.

   *Dónde se aprendió:* `spec-75` decía que el chevron expandía `sku_items` «que el RPC ya devuelve». No los devuelve. Se resolvió con una consulta perezosa al expandir, sin migración. Antes de prometer «sólo es aplanar la respuesta», leé la definición de la función más reciente.

4. **ARIA anidado se rompe en silencio.** Un rol interactivo con descendientes enfocables los borra del árbol de accesibilidad.

   *Dónde se aprendió:* `spec-75` produjo dos defectos de este tipo en dos tareas. (1) Dos raíces `Tabs` de Radix separadas: cada `aria-controls` apuntaba a un id inexistente — cuatro pestañas huérfanas y cuatro paneles sin etiqueta. (2) Un `div role="checkbox"` con un `<button>` de chevron adentro: `checkbox` es un rol de *presentational children*, así que el chevron desaparecía del árbol, y el nombre accesible de la fila absorbía la etiqueta del botón. **Ninguno de los dos lo detectaron los tests, ni `tsc`, ni la revisión de spec.**

5. **Un `onKeyDown` en un contenedor sin guard de `target` secuestra a sus hijos.**

   *Dónde se aprendió:* En `spec-75`, Enter sobre el chevron enfocado **deseleccionaba la orden** y no expandía nada: el evento burbujeaba al `div`, `preventDefault()` cancelaba la activación del botón y corría el handler del padre. Usá `<button>` nativos como hermanos en vez de manejo de teclado propio; si hace falta un handler en el contenedor, cortá con `if (e.target !== e.currentTarget) return`. **Escribí un test de teclado**: no había ninguno, y por eso se fue a revisión.

6. Un `<button>` dentro de un `<div onClick>` dispara **los dos** handlers.

   *Dónde se aprendió:* Detectado al reestructurar la fila de `spec-75`. Si el patrón «toda la fila es el hit target» convive con un control propio adentro, hace falta `stopPropagation` y un test que fije que la acción ocurre **una** vez.

7. Nada de fechas calculadas **al cargar el módulo**.

   *Dónde se aprendió:* En `spec-75`, `sevenDaysAgo` se evaluaba una vez por carga: en una PWA abierta todo el turno, «últimos 7 días» pasaba a significar 8 después de medianoche, y el test se recalculaba en el momento de la aserción, así que habría *flakeado* en vez de detectarlo. Calculá dentro del componente y testeá con *fake timers* cruzando medianoche.


### Añadido tras la tarea 3 de `spec-75` (monitor de carga)

### Campos del canvas que **no existen en el schema**

Verificado durante `spec-75` tarea 3 recorriendo migraciones y tipos. El canvas los dibuja; la base no los tiene. **No los inventes y no agregues migración para tenerlos** — si el diseño los pide, se renderiza nada y se anota.

| Figura del mock | Realidad |
|---|---|
| `Turno A` / `Turno B` (turno de cuadrilla) | **No existe tabla de turnos.** `pickup_route_crew` es otro dominio (viajes de recogida, no carga en andén). |
| `furgón 12,4 m³` (volumen del vehículo) | `fleet_vehicles` tiene `vehicle_type` (texto) y `capacity_packages` (conteo). No hay columna de volumen. `drivers.max_volume_m3` es un tope de planificación por conductor, otra tabla, no el volumen del camión. |
| `A3 Sur Oriente` — la parte «sector» | Sólo existe `load_positions.code`/`label` (el andén). No hay columna de sector por ruta. |
| `Cerró 08:41` (hora de cierre) | No hay `sealed_at`/`closed_at`. Ver la regla sobre proxies abajo. |

1. **Un proxy no se muestra bajo una etiqueta que afirma un hecho.**

   *Dónde se aprendió:* `spec-75` tarea 3 renderizó `Cerró 08:41` desde `routes.updated_at`, razonando que nada más muta una ruta `loaded`. **Es falso:** `sweep_load_position_assignments` incluye `loaded` y llama a `assign_load_position`, que hace `updated_at = now()` — y ese barrido corre después del despacho exitoso de **cualquier otra ruta**. Una ruta sellada a las 08:41 sin andén libre pasa a mostrar «Cerró 11:20» cuando otro despacho libera una posición. Si el dato real hace falta, sale de `audit_logs` (el trigger guarda `{before, after}`, así que la transición a `loaded` está registrada), no de una columna que se mueve por otros motivos.

2. **Un test que pasa sobre datos imposibles no prueba nada.**

   *Dónde se aprendió:* En `spec-75` tarea 3 la línea de conductor + vehículo **no podía renderizarse nunca** en esa pestaña: `routes.vehicle_id` y `driver_name` los escribe sólo `/dispatch`, *después* de la transición a `dispatched`, así que toda ruta de ese conjunto los tiene en `NULL` — y el join a `fleet_vehicles` se pedía cada 30 s para nada. Los tests pasaban porque el fixture inyectaba a mano `driverName: 'Mario González'`. **Los fixtures sólo deben contener datos que el hook realmente pueda producir.**

3. **Las fechas «de hoy» se calculan en la zona horaria de Chile, no en UTC.**

   *Dónde se aprendió:* `spec-75` tarea 3 usó `new Date().toISOString().slice(0,10)` en la cabecera de una pantalla de turno de tarde: desde las ~20:00 de Santiago imprimía la fecha de mañana. El repo ya tiene `todayISOInTimezone()` en `lib/utils/dateFormat.ts`, y su comentario describe exactamente este fallo. Usalo, y pasá `timeZone: TIMEZONE` a todo `toLocale*`.

4. **Un tick por segundo re-renderiza todo lo que lo consume: bajalo al componente que muestra el tiempo.**

   *Dónde se aprendió:* En `spec-75` tarea 3 el tick de 1 s vivía en la pestaña, así que cada segundo se re-renderizaban todas las tarjetas — incluidas las que no muestran ningún texto dependiente del tiempo — y sus subárboles de `AlertDialog`. Se extrajo un componente mínimo que posee su propio tick; el resto pasó a un tick lento alineado con el refetch, y recién ahí `memo` sirve para algo.

5. **Una consulta sin cota temporal crece para siempre.**

   *Dónde se aprendió:* En `spec-75` tarea 3 la consulta de rutas no tenía límite de fecha: toda ruta jamás dejada abierta seguía en alcance, abriéndose a sus despachos y de ahí a todos los paquetes de esas órdenes, en `await` secuencial por lote, cada 30 s. En producción son ~112k despachos y ~61k paquetes. Acotá por fecha y paralelizá los lotes con `Promise.all`.

6. **Dos señales distintas no se colapsan en una.**

   *Dónde se aprendió:* `spec-75` tarea 3 quitó el borde de «atrasada» (`route_date` en el pasado) argumentando que el borde de «detenida» lo reemplazaba. No lo reemplaza: una cuadrilla escaneando a buen ritmo en la ruta de ayer está *atrasada* pero no *detenida*, y como la consulta ordenaba por fecha descendente, esa ruta quedaba **al final**. La señal no fue superada, fue invertida.


## Riesgos

1. **~~El copy promete atomicidad~~ — resuelto en fase 0, con matiz.** Verdadero antes de DT, falso en la ventana posterior a su confirmación. Ver H2. Bloquea `2k` hasta que [spec-79](spec-79-dispatch-handoff-integrity.md) lo corrija.
2. **`2l` afirma algo que el backend contradice.** Ver H3. Bloquea `2l` hasta [spec-79](spec-79-dispatch-handoff-integrity.md).
3. **Reintento sin idempotencia — confirmado dos veces.** `createDTRoute` no lleva clave de idempotencia, y la verificación de `spec-79` fase 0 confirmó (leyendo la documentación oficial de DT) que **la API tampoco la ofrece** — no hay nada que agregar del lado del cliente. La única cobertura posible es persistir `external_route_id` (cierra el caso dominante) más una comprobación previa por `GET`, sólo en reintentos, que **no elimina** la ventana — sólo la vuelve rara y detectable. `2k` no puede presentar *Reintentar* como acción segura y primaria salvo en el estado `DT_API_ERROR` de la decisión 6.
4. **Notas de cierre: falta confirmar dónde viven.** Recepción usa `discrepancy_notes` ligada a `manifest_id`, que es de Recogida y no sirve para una `route` de Despacho. Si no hay tabla equivalente para faltantes de carga, la nota de `2i` necesita destino — posible migración. Sigue abierto.
5. **El contador de intentos no existe en el servidor.** El `intento 1 de 3` de `2k` tendría que ser estado de cliente, que se pierde al recargar. Decidir si se acepta o si el endpoint debe exponerlo.
6. **Es la pantalla que rompe la operación si sale mal.** Un camión que sale con la ruta mal despachada no se arregla desde Aureon. Revisión en Opus/Fable, no en Sonnet.

## Correcciones — revisión adversarial de `2i` (fix/spec-77-2i-ui-blockers)

Revisión posterior a `2i`/`2j` (PRs #616, #618) encontró dos bloqueantes, uno alto y varios medios/bajos en `DispatchRouteScanSession.tsx`/`DispatchRouteCloseSheet.tsx`. Todos corregidos en esta rama, TDD, sin tocar `useRoutePackages.ts`/`seal-route.ts`/`seal-pending-stops.ts`/`force-seal-release.ts`/`force-seal-audit.ts` (propiedad de otra rama concurrente).

- **B2 (bloqueante) — el cierre directo descartaba toda negativa del servidor.** `handleCloseRoute` en el camino "nada falta" hacía `await seal(routeId)` sin `else`: `409 UNSEALED_STOPS`, `422 EMPTY_ROUTE`, `409 ROUTE_NOT_OPEN`, `500` y el mensaje offline de `useSealRoute` se perdían — un botón muerto en wifi de andén. Corregido: nuevo `lib/dispatch/mobile/seal-error-copy.ts` (mismo patrón que `dispatchErrorCopy`, códigos distintos nunca aplanados) y un `closeError` visible en `DispatchRouteScanSession`. `DispatchRouteCloseSheet` también usa `sealErrorCopy` en vez de `outcome.message` crudo.
- **B3 (bloqueante) — la pantalla y el servidor no coincidían en qué es "falta".** `missingOrders` (`route-close.ts`) decidía por `boxesLoaded < boxesTotal`; el servidor decide por `dispatches.stage IN ('planned', 'partially_staged')` (`route_stop_counts.pending_stops + partially_staged_stops`). Corregido leyendo `RoutePackage.stage` (ya presente, escrito por `recompute_dispatch_stage`) en vez de reimplementar la regla — sin tocar `useRoutePackages.ts`. Esto arregla las dos divergencias que encontró la revisión: un hermano `en_bodega` ya no hace que el cierre directo pase quedando el servidor en `409`, y una fila `adopted`/`force_split` con el conteo de cajas flotado a 1 (piso de `useRoutePackages`) ya no aparece como "faltante" fantasma.
- **H1 (alto) — los tests de las tres consecuencias no probaban nada.** Verificado por mutación (config vitest desechable, alias sobre el import relativo del componente, sin tocar archivos del repo) contra las tres mutaciones que la revisión reportó como SURVIVED: las tres mueren ahora (`DispatchRouteCloseSheet.test.tsx`, aserciones por `<li>` individual con cifras deliberadamente distintas — 24 vs. 60).
- **MEDIUM** — singular ("Los 1 paquetes" → "El paquete"), `el andén el andén` cuando no hay posición de carga (`missingBoxesLine`/`loadedBoxesLine` en `route-close.ts`), razón visible (`aria-describedby` + texto, nunca sólo `title=`) en el botón de cierre deshabilitado, y doble-tap (`useSealRoute` ahora usa un `inFlight` ref, mismo patrón que `useDispatchRouteToDT`).
- **LOW** — el selector de motivo es ahora un `radiogroup` con tabindex itinerante y navegación por flechas/Home/End (patrón WAI-ARIA). La doble instanciación de `useSealRoute` (sesión + hoja) queda como riesgo abierto — no se tocó por alcance/tiempo; ambas instancias comparten el mismo endpoint y el mismo guard `inFlight` a nivel de módulo no existe entre ellas, así que un doble-tap que alterne exactamente entre los dos botones en el mismo tick no está cubierto (sí lo está el caso común: doble-tap sobre el mismo botón).
