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
   forzar — no libera nada, no sella.
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

### Fase 1 (UI) — `2i` Cerrar `[pending]`
3. Test: con faltantes → pantalla de confirmación; sin faltantes → cierre directo.
4. Test: las tres consecuencias aparecen (decisión 2).
5. Test: *Seguir escaneando* es primaria; el botón de cerrar nombra la cifra exacta.
6. Test: lista paginada con *Ver los N restantes* (decisión 3).
7. Test: nota por fila se persiste; su ausencia no bloquea el cierre (decisión 4).
8. Test: al cerrar, los cargados pasan a `listo_para_despacho` y la ruta a `loaded`.

### Fase 2 — `2j` Despachar `[pending]`
9. Test: la revisión muestra camión, conductor, fecha, paradas · paquetes.
10. Test: sin camión asignado → no se puede despachar y se dice por qué (DispatchTrack exige el identificador).
11. Test: el bloque *Qué pasa al despachar* enumera los cuatro efectos.
12. Test: doble toque no envía dos veces.

### Fase 3 — `2k` Error `[blocked]`
13. Test: fallo → estado de error que nombra qué no cambió; la ruta sigue `loaded` y los paquetes en `listo_para_despacho`.
14. Test: contador de intentos; al tercero, el copy deriva al jefe de turno.
15. Test: checklist *Antes de reintentar* separa verificado de advertencia.

### Fase 4 — `2l` Acta `[blocked]`
16. Test: acta con el id de DispatchTrack, las 4 cifras y lo que queda en el andén.
17. Test: ofrece la siguiente carga concreta si existe; si no, no inventa una.
18. Test: la ruta queda `dispatched` y los paquetes en `en_ruta`.

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
