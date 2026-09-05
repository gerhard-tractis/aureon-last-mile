# Spec-79: Integridad del handoff a DispatchTrack — reintento seguro y `en_ruta` por bulto

> **Related:** [spec-77](spec-77-despacho-movil-cierre.md) (las pantallas que dependen de estos dos arreglos; ver su *Fase 0*, hallazgos H2 y H3), [spec-70](spec-70-dispatch-state-machine.md) (`transition_route_status`), [spec-71](spec-71-load-positions-staging-pass.md) (posiciones de carga), [spec-74](spec-74-per-bulto-staging.md) (`en_carga`, staging por bulto)

**Status:** in progress
**Verify:** unit, sql, e2e-qa

_Date: 2026-09-03_

---

## Goal

Cuatro defectos de servidor del lado del despacho. Ninguno es de diseño: los cuatro hacen que el sistema afirme algo que no es cierto, o descarte algo que la operación necesita.

1. **H2 — un fallo posterior a la confirmación de DispatchTrack es indistinguible de un fallo de DispatchTrack**, y reintentarlo duplica la ruta.
2. **H3 — `en_ruta` se escribe por orden y no por bulto cargado**, así que un paquete que se quedó en el andén queda marcado como si viajara.

3. **H4 — los rechazos de escaneo no se guardan en ninguna parte**, así que nadie puede saber después por qué una ruta salió corta.
4. **H5 — la asignación de camión y conductor se pierde al despachar**, y un camión se puede reservar dos veces el mismo día.

H3 y H4 **no son problemas del rediseño**: afectan a la operación de hoy. Cualquier orden partida que se despache parcialmente deja bultos de andén en `en_ruta`, invisibles para la ruta siguiente. Vale arreglarlo aunque `spec-77` no existiera.

## Fuente de verdad

| Fuente | Qué aporta |
|---|---|
| `apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts` | El código con ambos defectos |
| `spec-77` *Fase 0* | El análisis completo de H1, H2 y H3 |
| `apps/frontend/src/lib/dispatchtrack-api.ts` (`createDTRoute`) | Dónde va la comprobación previa (no hay clave de idempotencia que agregar — ver *Fase 0*) |
| `scripts/dt-api-docs.md` | Scrape de 5.089 líneas de la documentación oficial de DT (`ba74c4c`), ya tratado como autoritativo por specs 58 y 60 |
| `spec-74` | `en_carga` como estado del bulto efectivamente cargado |
| Este spec | Los arreglos y su plan |

## Scope

### H2 — Reintento seguro

Hoy el orden es correcto en lo esencial: `createDTRoute` primero, estado local después. Si DT falla, nada local cambió y el `catch` registra `dispatch_failed`. **Pero** `transition_route_status`, `release_load_position`, el `UPDATE` de `routes` y el de `packages` corren *después* de que DT confirmó.

> **Corrección tras *Fase 0* (verificada en el repo):** este párrafo decía que las cuatro escrituras posteriores a DT «caen en el mismo `catch`». **Es falso.** El `UPDATE` de `routes` (que persiste `external_route_id`) y el `UPDATE` de `packages` corren dentro de un `Promise.all` **sin desestructurar `error`**, y supabase-js resuelve `{data, error}` en un fallo de base en vez de rechazar. Así que hoy, si ese `UPDATE` de `routes` falla, el handler no se entera: sigue, responde `200 {ok:true}` con el `external_route_id` **descartado en silencio**, y nada cae en ningún `catch`. La única escritura post-DT que sí lanza — y por lo tanto sí puede producir `502 DT_API_ERROR` en esta ventana — es `transition_route_status`. Ver *Fase 0* más abajo para el detalle completo y sus consecuencias.

Consecuencias:

- La UI no puede distinguir «DT rechazó» de «DT aceptó y lo local falló». `spec-77` `2k` afirma que no se creó nada a medias; en el segundo caso es falso.
- `createDTRoute` no lleva clave de idempotencia — **confirmado en *Fase 0*: la API de DT no ofrece ninguna** — así que *Reintentar* crea una **segunda** ruta en DispatchTrack.
- `external_route_id` — lo que DT devolvió — se pierde si el `UPDATE` de `routes` no llega a correr, así que la ruta queda sin rastro local de una ruta que sí existe en DT. Y, por el defecto de arriba, hoy se pierde **en silencio**, sin siquiera un `dispatch_failed`.

Lo que este spec cambia (orden recomendado, ver *Fase 0* para el detalle de cada punto):

1. **Persistir `external_route_id` inmediatamente después de la confirmación de DT, y comprobar el `error` de esa escritura.** Es el dato que hace recuperable el resto: con él, un reintento sabe que DT ya aceptó. Hoy no alcanza con moverlo antes en el código — el error también hay que dejar de descartarlo, o el arreglo no cierra nada.
2. **Código de error propio para el fallo posterior a DT.** Nuevo código — `DT_ACCEPTED_LOCAL_FAILED` — distinto de `DT_API_ERROR`, con su propia acción de `audit_logs` cargando `external_route_id`. Es lo que le permite a `2k` decir la verdad en ambos casos y ofrecer *completar* en vez de *reintentar*.
3. **Las escrituras locales post-DT se agrupan y se hacen reintentables.** Reintentar tras un `DT_ACCEPTED_LOCAL_FAILED` **no** debe volver a llamar a DT: debe completar sólo lo local.
4. **Comprobación previa por `GET`, sólo en reintentos.** No hay clave de idempotencia que agregar (*Fase 0*), así que la única cobertura adicional es preguntarle a DT si la ruta ya existe antes de un reintento — nunca en el primer envío (límite de tasa). Cierra el margen que el punto 1 no cubre, no lo reemplaza: ver *Fase 0*, hallazgo 4.

### H3 — `en_ruta` por bulto cargado

```ts
// hoy
supabase.from('packages').update({ status: 'en_ruta' })
  .eq('operator_id', operatorId).in('order_id', orderIds)
```

`orderIds` viene de `dispatches.order_id`, así que la escritura alcanza **todos** los bultos de cada orden despachada, cargados o no. El estado del bulto efectivamente cargado es `en_carga`, que es lo que escribe `/scan` (`spec-74`).

El arreglo es acotar la escritura a los bultos que realmente van en el camión — los de esas órdenes que están en `en_carga` — en vez de a todos los de la orden. Un bulto en `asignado` (nunca escaneado) o `retenido` (consolidación) **no** debe pasar a `en_ruta`.

### H4 — Los rechazos de escaneo no se guardan en ninguna parte

Encontrado al preparar `spec-75` fase 4. Cuando una lectura se rechaza — *ya está en otra ruta*, *`en_bodega`*, *código no encontrado*, *retenido en consolidación* — el endpoint valida, devuelve el mensaje al dispositivo y **no escribe nada**. El `insert` en `dock_scans` lleva `scan_result: 'accepted'` fijo y sólo corre tras validar. No queda fila, ni `audit_logs`, ni rastro. Al refrescar la pantalla, el evento nunca existió.

**Por qué importa más allá de la UI:**

- **El jefe de turno no puede ver por qué una ruta va corta.** Ve `148 de 172` y 24 sin escanear, pero no que 6 de esos 24 se levantaron físicamente y rebotaron, ni por qué. Los 24 se ven iguales a 24 que nadie tocó.
- **«¿Por qué esta orden salió incompleta?» no tiene respuesta después del hecho.** Un paquete retenido rebota el lunes, rebota el martes y sale el miércoles en una segunda visita, sin nada que conecte los tres eventos.
- **Los dos patrones de falla más caros son invisibles.** Un paquete que rebota repetidamente como *ya está en otra ruta* significa que se cerró una ruta con paquetes todavía en el andén — un error operativo real que hoy no deja evidencia. Y las retenciones de consolidación son la causa de las entregas en dos visitas que `2c` nombra («el cliente recibe en dos visitas»); sin persistencia no se puede saber si mejoran.

**Alcance.** Registrar cada lectura rechazada con lo mínimo para que sirva: código leído, motivo, quién, cuándo, y contra qué ruta o posición se intentó. Requiere migración, y por eso vive acá y no en `spec-75`, que no agrega ninguna.

**Consumidores que se desbloquean:** `1c` (lista de rechazos intercalada, `spec-75` fase 4) y `2f` (pantalla de rechazo del móvil, `spec-76`) — que además pasa a poder mostrar el histórico del turno y no sólo el rechazo en curso.

### H5 — La asignación de camión y conductor se pierde al despachar

Encontrada al implementar `2d` (`spec-76` tarea 2), que es la pantalla que por fin persiste `routes.vehicle_id` y `routes.driver_name` **en el momento de asignar**, y no recién al despachar. Tres defectos del lado del despacho la anulan:

**H5a — `/dispatch` pisa el conductor que escribió la cuadrilla.** `apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts` escribe `driver_name: parsed.data.driver_identifier ?? null` sin condición. Así que despachar desde el escritorio reemplaza el nombre que la cuadrilla tipeó en `2d` por un **identificador** de DispatchTrack, o lo deja en `null`. La asignación que `2d` existe para persistir es, hoy, advisoria: se pierde en el último paso. Arreglo: caer al `driver_name` ya guardado cuando no viene `driver_identifier`.

**H5b — la búsqueda del vehículo se traga su error y asume una unicidad que no existe.** El mismo handler resuelve `fleet_vehicles` con `.maybeSingle()` sin desestructurar `error`, filtrando sólo por `operator_id`. Pero la unicidad real es `UNIQUE (operator_id, provider, external_vehicle_id)` (`20260306000001`), no `(operator_id, external_vehicle_id)`: dos proveedores pueden tener el mismo identificador para un operador. Con dos filas, `maybeSingle()` da error, `data` queda `null`, y el endpoint responde 422 «camión no encontrado» sobre un camión que sí existe. Y cualquier fallo transitorio de base produce el mismo 422. Arreglo: desestructurar `error`, 500 en lo que no sea `PGRST116`, y acotar por el `provider` de la ruta.

**H5c — un camión se puede reservar dos veces el mismo día.** `PATCH /api/dispatch/routes/[id]` (nuevo en `spec-76`) chequea conflicto leyendo y después escribe, sin nada en el medio: dos cuadrillas en dos teléfonos asignan el mismo camión a dos rutas y ambas escrituras pasan. No hay respaldo en la base — revisadas todas las migraciones, no existe restricción sobre `routes(vehicle_id, route_date)`. El chequeo de aplicación es advisorio, no exigido.

Arreglo, con migración (por eso vive acá y no en `spec-76`, que no agrega ninguna):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS routes_one_vehicle_per_day
  ON public.routes (operator_id, vehicle_id, route_date)
  WHERE deleted_at IS NULL
    AND vehicle_id IS NOT NULL
    AND status IN ('draft','planned','loading','loaded','dispatched','in_transit','in_progress');
```

y mapear `23505` al mismo 409 que ya devuelve el chequeo de aplicación. Ojo con el backfill: en producción puede haber filas que ya violan el índice, así que **medir primero** — a escala de producción (~112k despachos) crear el índice sin medir es cómo se agotan los timeouts (ver riesgos).

**Por qué importa.** `2a`, `2c` y el monitor `1b` de `spec-75` mostraban «Sin conductor» / «Sin asignar» para toda ruta que podían mostrar, porque esas columnas sólo se escribían **después** del despacho. `2d` lo corrige aguas arriba; H5a lo vuelve a romper aguas abajo. Los tres arreglos van juntos o la cadena no cierra.

### No-goals

- **No se rediseña la máquina de estados.** `transition_route_status` sigue siendo el único dueño de las aristas de `routes.status`.
- **No se implementa reapertura ni cancelación de rutas.** Fuera de alcance igual que en `spec-77`.
- **No se toca UI.** Este spec es servidor y tests. `spec-77` consume el resultado; si se implementa antes, `2k` se dibuja contra los códigos nuevos.
- **No se cambia el contrato de items/guías.** `buildItems`, el formato de `identifier` y la resolución de `truck_identifier` quedan como están.


## Decisiones

1. **El orden actual — DT primero, local después — se conserva.** Es el correcto para la falla más probable (DT caído o rechazando): garantiza que un rechazo no deje estado local inventado. El problema no es el orden, es que la mitad posterior no es recuperable ni distinguible. Se arregla eso, no el orden.

2. **`external_route_id` se persiste antes que cualquier otra escritura local.** Es la única prueba de que DT aceptó. Escribirlo primero convierte un fallo posterior en un problema de reconciliación (sabemos qué pasó) en vez de un estado ambiguo.

3. **Distinguir los dos fallos es el requisito, no un lujo.** Una cuadrilla que reintenta un despacho ya aceptado manda un camión con una ruta duplicada en DT. El código de error nuevo es lo que evita que la UI tenga que adivinar.

4. **H3 se acota por estado del bulto, no por posición de carga.** `en_carga` es lo que `/scan` escribe por bulto y es el hecho más directo de «este bulto está en el camión». Filtrar por posición de carga sería indirecto y rompería con las rutas sin posición asignada.

5. **H3 necesita decidir qué pasa con los bultos ya corrompidos.** Si en producción hay bultos en `en_ruta` que se quedaron en el andén, el arreglo del código no los recupera. Antes de escribir el backfill hay que **medir cuántos son** — y en producción (~112k dispatches / ~61k packages) un backfill sin acotar excede el `statement_timeout`, como ya pasó en `spec-70` y `spec-74`. Medir primero, luego decidir si hace falta backfill y con qué lotes.

## Plan de implementación (TDD)

### Fase 0 — Verificación de la API de DispatchTrack (bloqueante para H2) `[done]`

_Resultado, 2026-09-04. Cada afirmación va etiquetada: **verificado en el repo**, **leído en la documentación de DT**, o **desconocido**._

**Hallazgo 1 — DT no ofrece clave de idempotencia. Verificado (leído en la documentación de DT).**

`scripts/dt-api-docs.md` es un scrape de 5.089 líneas de la documentación oficial de DT (`ba74c4c`), ya tratado como autoritativo por `spec-58` y `spec-60`. Se confirmó: **cero ocurrencias de `idempoten` en todo el archivo.** Los únicos headers documentados son `X-AUTH-TOKEN` y `Content-Type`.

El set completo de campos de nivel superior de Create Route es `truck_identifier`, `date`, `dispatch_date`, `driver_identifier`, `enable_estimations`, `started_at`, `started`, `start_latitude`, `start_longitude`, `dispatches[]` — **no hay ninguna referencia externa a nivel de ruta que nosotros controlemos**, así que no hay nada sobre lo que DT pueda desduplicar. (`tags` existe sólo por despacho, y ningún lookup documentado lo lee.)

**Hallazgo 2 — el código es peor de lo que `spec-77` H2 describe. Verificado en el repo.**

`spec-77` *Fase 0* H2 decía que las escrituras posteriores a DT «caen en el mismo `catch`». **Es falso.** En `apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts`:

```ts
await Promise.all([
  supabase.from('routes').update({ external_route_id, vehicle_id, driver_name })...,
  supabase.from('packages').update({ status: 'en_ruta' })...,
]);
```

No se desestructura `error`, y supabase-js **resuelve** `{data, error}` en un fallo de base en vez de rechazar. Así que un `UPDATE` de `routes` fallido hoy devuelve **`HTTP 200 {ok:true}` con `external_route_id` descartado en silencio** — la operación ve éxito mientras la ruta no guarda ningún rastro local de una ruta que DT ya tiene.

Consecuencias para el plan:

- La única escritura post-DT que hoy realmente lanza es `transition_route_status`.
- **La ventana real de duplicado es exactamente: DT aceptó Y `transition_route_status` falló.** Si la transición tuvo éxito, el guard `route.status !== 'loaded'` del propio handler ya devuelve 409 sobre un reintento, así que no hay duplicado posible.
- El arreglo que `spec-77` H2 propuso — «persistir `external_route_id` primero» — **es inútil por sí solo** mientras ese error se siga descartando. Se agrega «revisar esos errores» como ítem explícito del plan (ver Scope H2, punto 1 arriba).

**Hallazgo 3 — existe una comprobación previa real. Leído en la documentación de DT, con matices verificados.**

`GET /api/external/v1/routes?date=:date&truck_identifier=:truck` devuelve `routes[].dispatches[].identifier` — que es `orders.order_number` verbatim (verificado: es el mismo campo que el handler de despacho envía como `identifier` en `dtDispatches`). Así que un reintento puede preguntar «¿ya existe una ruta con estas guías?» sin tocar ningún endpoint de escritura.

Matices, todos verificados en la documentación:

- **Hay que emparejar por identificador de guía, no por camión+fecha.** Un camión puede legítimamente correr dos rutas el mismo día.
- **Trampa de formato de fecha:** List Routes documenta `yyyy-mm-dd`; Create Route documenta `dd-mm-yyyy`. Invertirlos da un conjunto vacío que se lee como «no hay duplicado» — fallando abierto justo en el único chequeo que no puede fallar así.
- **Límites de tasa: 1 request/segundo, 1.000/día.** La comprobación previa va **sólo en reintentos**, nunca en el primer intento.
- **No probado contra el tenant real.** `GET /routes/:id` sí se usa en producción, por la edge function `dispatchtrack-route-poll` (verificado en el repo: `packages/database/supabase/functions/dispatchtrack-route-poll`, línea que llama `/api/external/v1/routes/${route.external_route_id}`). `GET /routes?date=` está documentado pero no se usa en ningún lugar de este repo. El permiso del token para ese endpoint es **inferido, no verificado**.
- **`DELETE /api/external/v1/routes/:route_id` existe** (leído en la documentación), así que un duplicado es detectable y removible — un flujo de reconciliación tiene un remedio real.

**Hallazgo 4 — `external_route_id` acota pero no cierra la ventana. Razonamiento sobre lo verificado arriba.**

Condicionar los reintentos a un `external_route_id` persistido cierra el caso dominante. No cubre ninguna falla entre que DT confirma y que nosotros escribimos algo:

1. DT confirma, la respuesta nunca llega (reset TCP, timeout de función, 504 de gateway).
2. El proceso muere entre la respuesta de DT y nuestra primera escritura.
3. La propia escritura de `external_route_id` falla.

Sólo la comprobación previa por `GET` cubre esos casos. **La duplicación pasa a ser rara y detectable, no imposible**, y `DELETE /routes/:id` es el remedio.

**Orden recomendado** (ya reflejado en Scope H2 y en las Fases 2–4 de este plan):

1. Persistir `external_route_id` inmediatamente tras la confirmación de DT **y comprobar su error** — lo más barato, cierra el caso dominante.
2. `DT_ACCEPTED_LOCAL_FAILED` como código propio con su propia acción de auditoría cargando `external_route_id`, más un camino de reintento que completa sólo lo local y **nunca vuelve a llamar a DT**.
3. `GET` previo **sólo en reintentos**, emparejando por identificadores de guía, tratando un `GET` fallido o ambiguo como «no se puede confirmar que sea seguro» — negarse a crear automáticamente y derivar a reconciliación. Una comprobación previa que falla abierto es peor que ninguna.
4. Tratar `208 "already reported"` como éxito-con-ruta-existente **sólo una vez que alguien haya observado un `208` real**. Hasta entonces, dejar el `throw` actual (hallazgo 5).

**Hallazgo 5 — desconocidos explícitos. Se registran como desconocidos, no se resuelven acá.**

- **El body del `208`** — si trae `route_id`, y qué lo dispara. El scrape sólo capturó la pestaña activa de la documentación, y la 208 aparece como pestaña sin cuerpo capturado (línea ~566 de `scripts/dt-api-docs.md`: la pestaña «208 OK:» existe pero el bloque de código mostrado es el de la pestaña «200 OK:»). `apidoc.beetrack.com` sirve un certificado que sólo cubre `*.dispatchtrack.com`, y `apidoc.dispatchtrack.com` no resuelve. El manejo actual del repo es un **fixture de test escrito a mano, no una respuesta capturada**, y `createDTRoute` (verificado: `apps/frontend/src/lib/dispatchtrack-api.ts`) lanza ante cualquier respuesta sin `route_id` — así que si DT sí responde 208 en un duplicado, hoy un reintento saldría como `DT_API_ERROR`, exactamente la señal equivocada.
- Si el token de Musan puede llamar `GET /routes?date=` (list) y `DELETE /routes/:id`. Sólo Show Route está probado. La documentación registra fallos de permiso acotados por endpoint en otras partes, así que el scoping por endpoint es real en esta API.
- Si DT permite dos rutas para el mismo camión+fecha.

Las tres son respondibles sin escribir en DT. **Nota explícita: resolverlas no debe hacerse con un despacho de prueba** — esta es una integración de producción para un operador logístico real.

### Fase 1 — H3, el arreglo acotado `[done]`
3. Test: orden partida con bultos en `en_carga` y en `asignado` → sólo los `en_carga` pasan a `en_ruta`.
4. Test: bulto `retenido` en consolidación no pasa a `en_ruta`.
5. Test: orden completa (todos los bultos cargados) sigue comportándose igual que hoy — no hay regresión.
6. Implementar el filtro acotado.
7. Medir en producción cuántos bultos están hoy en `en_ruta` sin haber estado en `en_carga` (consulta de sólo lectura, acotada). Reportar la cifra **antes** de proponer backfill.

   **No ejecutado.** La implementación (3-6) está hecha y probada; el ítem 7 requiere correr una consulta contra producción, algo que esta tarea tenía instrucción explícita de no hacer. Alguien con acceso a producción debe correr esa medición de sólo lectura y decidir, con la cifra en mano, si hace falta backfill — ver la sección de cierre del reporte de implementación para el razonamiento completo.

   **Corrección post-revisión (2026-09-04) — lección reutilizable.** La implementación original acotó la escritura a `p.status === 'en_carga'` únicamente. Es un bug: la única forma en que una ruta llega a `loaded` es `/seal` (`seal-route.ts`), y `/seal` mueve cada bulto staged de `en_carga` a `listo_para_despacho` **antes** de flipear `routes.status` — ver `seal-route.ts:284-288`. Así que en el momento del despacho el filtro `en_carga` no calzaba con nada: `loadedPackageIds` devolvía `[]`, la escritura se saltaba, y `en_ruta` — la única escritura de ese estado en todo el repo — nunca corría. Ningún test lo detectó porque ninguno usaba un fixture post-seal (paquetes en `listo_para_despacho`); todos dejaban los paquetes en `en_carga`, que es el estado correcto *antes* de sellar pero ya viejo *después*.

   **La lección:** *"el bulto cargado es `en_carga`"* es verdad en el momento en que `/scan` lo escribe (`spec-74`) y queda **obsoleta** para cualquier lector que corra después de `/seal`. Cualquier código que decida "¿este bulto va en el camión?" después del sellado debe acotar por `['en_carga', 'listo_para_despacho']`, no por `en_carga` solo — el mismo patrón que `route.ts` (DELETE) ya tuvo que aplicar (ver su comentario en `apps/frontend/src/app/api/dispatch/routes/[id]/route.ts:78-81`). Fijado: `loadedPackageIds` ahora vive en `dispatch-local-completion.ts` y acota por ambos estados; se agregó el test post-seal que faltaba y un `console.warn` con el `routeId` cuando una ruta `loaded` no produce ningún bulto cargado (antes se saltaba en silencio).

   **Corrección post-revisión #2 (2026-09-04) — la lección de arriba se pasó de largo.** La corrección anterior dijo *"acotar por `['en_carga', 'listo_para_despacho']`"* y la trató como suficiente. No lo es: `listo_para_despacho` no es exclusivamente un marcador post-sello. Es también el estado legado de **dock-ready, sin cargar** — está en `DISPATCHABLE_STATUSES` de `scan-validator.ts` (un estado desde el que SE escanea, no sólo hacia el que se llega), y en la cohorte dock-ready sin ruta del snapshot de Pre-Ruta (`20260907000001_spec76_en_bodega_not_dock_ready.sql:181`, cuyo propio `COMMENT` lo llama dock-ready). Acotar por status solo no distingue "acabo de salir de `/seal`" de "nunca salió del andén".

   El vector de corrupción concreto: `20260901000001_spec74_package_load_state.sql:199-212` (la migración de spec-74) backfillea `loaded_at = staged_at, load_inferred = true` sobre **todo bulto vivo** de **toda orden** con un despacho `staged`/`adopted` — sin filtrar por el `status` del bulto. Un bulto que en ese momento estaba en `listo_para_despacho` genuinamente sin cargar (dock-ready, legado, nunca escaneado) recibe el mismo `loaded_at` que su hermano sí cargado. Antes de este pase, `recompute_dispatch_stage` y el chequeo de completitud adoptado del sello (`seal-route.ts:218-225`) ya leían sólo `loaded_at IS NULL` como "pendiente" — así que ese bulto backfillado es invisible para ambos, el sello abre, `/seal` mueve sólo los `en_carga` reales (`seal-route.ts:288`) dejando el backfillado indistinguible en `listo_para_despacho`, y `loadedPackageIds` (antes de este pase) lo marcaba `en_ruta` junto con los genuinos: un bulto que nunca salió del andén, reportado como en camino, de forma permanente.

   **La decisión — `status` no es la señal, `loaded_at`/`load_inferred` sí.** Spec-74 ya cargó el hecho por-bulto que hace falta: `loaded_at IS NOT NULL AND load_inferred = false` es exactamente "un escaneo real puso esta caja en este camión" — el mismo discriminador que `scan-validator.ts` ya usa para `ALREADY_STAGED`. `loadedPackageIds` ahora exige status **y** ese par, no status solo.

   **La tensión que esto no resuelve gratis, y por qué se eligió el lado seguro.** Toda ruta legada anterior a spec-74 tiene `load_inferred = true` en sus bultos — no hay forma de distinguir, dentro de una orden ya sellada antes de spec-74 y nunca reescaneada, cuál bulto estaba genuinamente cargado y cuál seguía en el andén; la migración no guardó esa distinción porque no existía que guardar. Exigir `load_inferred = false` produce dos resultados posibles para una ruta así:
   - **Falso negativo:** una ruta `loaded` legada, jamás reescaneada, produce cero bultos genuinamente cargados para siempre — `packages_dispatched` da 0 sobre una ruta que sí llevaba bultos, y ningún bulto se marca `en_ruta`.
   - **Falso positivo:** tratar `load_inferred = true` como evidencia de carga marca `en_ruta` un bulto que nunca salió del andén — el mismo defecto que este pase existe para matar, sólo que una migración más tarde.

   Entre los dos, sólo el falso positivo corrompe un dato que la operación usa para decidir cosas (¿salió este bulto? ¿por qué la ruta llegó corta?). El falso negativo es ruidoso pero honesto: no afirma nada falso, y el `console.warn` (ahora condicionado a que **no** sea el reintento saneado — ver hallazgo F3 abajo) lo hace visible en vez de silencioso. Se elige el falso negativo. **Esto es una decisión de ingeniería tomada dentro del alcance de este pase** (no delegada), documentada aquí en vez de preguntada, porque cae directamente bajo el principio explícito de Fase 1: *"medir antes, decidir con la cifra en mano"* — y aquí la cifra que falta (cuántas rutas `loaded` pre-spec-74 siguen sin despachar y sin reescanear en producción) es exactamente la misma medición ya pendiente del punto 7 de arriba, no una nueva. Si esa cifra resulta ser mayor que cero, la reconciliación operativa de esas rutas específicas (repasarlas a mano, reescanear o descartar) es un trabajo de operación puntual, no un cambio de código adicional — el código ya se niega a mentir sobre ellas.

   **Consecuencias del mismo hallazgo en otros dos puntos:**
   - **F2 (la escritura de `en_ruta` no tenía guarda de estado propio).** Entre el `SELECT` que arma `loadedPackageIds` y el `UPDATE` a `en_ruta` media un viaje de red a DispatchTrack (y, en el camino de reintento, el tiempo que tarde el operador en volver a apretar el botón). Si un bulto pasa a `dañado`/`retenido` en esa ventana (p. ej. por consolidación), la escritura debe rehusarse a pisarlo, no sólo filtrar en el `SELECT`. Arreglado: el `UPDATE` ahora repite el filtro de status (`en_carga`/`listo_para_despacho`) y compara cuántas filas tocó contra cuántas esperaba — un desacuerdo se registra con `console.error`, no se descarta en silencio.
   - **F4 (el mismo vencimiento de status en la eliminación de una parada).** `packages/[pkgId]/route.ts` (DELETE, quitar una parada) revertía sólo `en_carga` a `sectorizado`. Una ruta puede desellarse legalmente `loaded -> loading` (`20260825000002_spec70_dispatch_stage.sql:255`), y para entonces sus bultos ya están en `listo_para_despacho` sin haber vuelto a `en_carga`; quitar la parada no revertía nada y el bulto quedaba varado en `listo_para_despacho` sin ruta. Arreglado: el mismo conjunto ampliado (`en_carga`/`listo_para_despacho`) se usa aquí — sin el requisito `loaded_at`/`load_inferred`, porque esta escritura libera el bulto de vuelta a disponible, no lo marca en camino.

### Fase 2 — H2, persistir la prueba `[done]`
8. Test: DT confirma y el `UPDATE` de `routes` posterior falla → `external_route_id` **ya está** persistido y el error **no** se descarta en silencio (hallazgo 2 de *Fase 0*: hoy el `Promise.all` no desestructura `error`, así que este caso responde `200 {ok:true}`).
9. Reordenar para escribir `external_route_id` inmediatamente tras la confirmación de DT, en su propia escritura desestructurando `error` — no dentro del `Promise.all` combinado con `packages`.

### Fase 3 — H2, distinguir los fallos `[done]`
10. Test: DT lanza → `502 DT_API_ERROR`, `dispatch_failed` en `audit_logs`, ruta intacta en `loaded`, ningún paquete movido.
11. Test: DT confirma y `transition_route_status` falla → código **`DT_ACCEPTED_LOCAL_FAILED`**, no `DT_API_ERROR`, con su propia acción de auditoría y el `external_route_id` en el registro.
12. Test: los fallos best-effort que hoy ya se tragan (`release_load_position`, el sweep, los `audit_logs`) siguen sin hacer fallar el despacho — no se endurecen por accidente.

**Nota de implementación — orden de escrituras dentro de `completeLocalDispatch`.** El orden final no es persist → transition → packages sino **persist → packages (`en_ruta`) → transition → release**. Razón: `transition_route_status` es la escritura que saca a la ruta de `loaded`, y el guard `route.status !== 'loaded'` del propio handler 409ea cualquier intento posterior sobre esa ruta. Si el `UPDATE` de `packages` corriera *después* de `transition_route_status` (como en el orden original de arriba), un fallo ahí dejaría la ruta ya en `dispatched` mientras las cajas siguen en `en_carga` — atrapado detrás de un 409 que ningún reintento puede atravesar. Escribiendo `packages` antes de la transición, un fallo ahí deja la ruta en `loaded`, así que el camino de reintento (ver más abajo) puede completarla sin tropezar con el guard. `transition_route_status` queda como la última escritura que debe tener éxito — el verdadero punto sin retorno — consistente con el hallazgo 2 de *Fase 0*.

**Nota de implementación — camino de reintento (parte del punto 3 del Scope, no de la Fase 4).** Se implementó el reintento que **nunca vuelve a llamar a DT**: si `routes.external_route_id` ya está persistido cuando llega la petición (y `status` sigue en `loaded`, que es la única forma en que puede estarlo tras el reordenamiento de arriba), el handler salta `createDTRoute` y `MISSING_ORDER_NUMBER` por completo y va directo a `completeLocalDispatch` con el `external_route_id` ya conocido. Esto es distinto de la comprobación previa por `GET` de la Fase 4 (que sigue `[pending]`, sin implementar): no consulta a DT, sólo confía en el propio registro persistido. Cierra exactamente la ventana que *Fase 0* describe como "DT aceptó Y `transition_route_status` falló" — no las ventanas más amplias del hallazgo 4 (respuesta de DT que nunca llega, proceso que muere antes de persistir, la propia escritura de `external_route_id` fallando), que siguen abiertas y requieren la Fase 4.

### Fase 4 — H2, reintento seguro `[pending]`

_Fase 0 confirmó que DT no ofrece clave de idempotencia (hallazgo 1); esta fase implementa la comprobación previa por `GET`, sólo en reintentos, en su lugar (hallazgo 3 y orden recomendado)._

**Nota de revisión (2026-09-04) — hallazgo 4, el hueco de concurrencia que esta fase NO cierra.** El guard `route.external_route_id` (`route.ts` ~línea 100-140) es una **lectura** que se actúa varias líneas después, sin nada que reclame la ruta en el medio. Un reintento **secuencial** es seguro: si DT ya confirmó, la segunda petición lee `external_route_id` ya persistido y salta `createDTRoute`. Pero dos POST **concurrentes** — doble tap en la tablet de la cuadrilla, o un reintento del cliente que compite con una llamada a DT que está tardando — pueden ambos leer `external_route_id` como `null` y ambos crear una ruta en DT. La comprobación previa por `GET` de esta fase (ítems 15-17) tampoco lo cierra: sigue siendo lectura-luego-actúa, sólo que contra DT en vez de contra la fila local; la misma ventana de carrera existe entre el `GET` y la creación.

El arreglo propuesto (no implementado en esta revisión — es una decisión de Fase 4, no un cambio de máquina de estados) es una reclamación condicional antes de llamar a DT:

```sql
UPDATE routes SET dispatch_attempt_at = now()
WHERE id = ? AND operator_id = ? AND dispatch_attempt_at IS NULL
```

Si la fila no vuelve (0 rows), el handler se niega a llamar a DT — otra petición ya está en curso o ya terminó. Esto no cambia ninguna arista de `transition_route_status`; es una columna nueva (`dispatch_attempt_at`) usada sólo como candado de un solo uso, exactamente lo que la sección "No-goals" de este spec permite sin tocar la máquina de estados.

13. Test: reintentar tras `DT_API_ERROR` llama a DT (no pasó nada la primera vez) — sin comprobación previa, porque no hay nada que confirmar.
14. Test: reintentar tras `DT_ACCEPTED_LOCAL_FAILED` **no** llama a DT y sólo completa lo local.
15. Test: reintentar sin `external_route_id` persistido (ventana no cubierta por la Fase 2) dispara la comprobación previa por `GET`, emparejando por identificadores de guía, no por camión+fecha.
16. Test: la comprobación previa fallida o ambigua **no** crea la ruta — deriva a reconciliación en vez de fallar abierto.
17. Test: la ruta acaba en `dispatched` con su `external_route_id` en ambos caminos de recuperación.

### Fase 5 — Cierre `[pending]`
18. `npm run test -- --pool=forks` + mutation-test antes de push.
19. Tests SQL locales con `scripts/pgtap-local.sh` si se toca alguna función — el contenedor es compartido entre worktrees, no correr en paralelo con otra rama.
20. Verificación en QA con DT mockeado en los tres caminos: rechazo, aceptación, y aceptación con fallo local.

### Fase 1c — Revisión #2, hallazgos restantes (F3, F5, F6) `[done]`

_2026-09-04, misma revisión que F1/F2/F4 (documentados en Fase 1 arriba)._

- **F3 — la alarma de "cero bultos cargados" sonaba también en el reintento saneado.** Tras un `DT_ACCEPTED_LOCAL_FAILED` cuya causa fue la escritura de `packages` (o cualquier paso posterior), el reintento vuelve a leer los bultos de la orden y los encuentra ya en `en_ruta` — `loadedPackageIds` da `[]` legítimamente, no por error. El `console.warn` no distinguía este caso del genuinamente anómalo (una ruta `loaded` con cero bultos en cualquier estado cargable), así que sonaba en cada reintento normal — exactamente el flujo que este spec existe para hacer seguro — además de en ~12 fixtures de test preexistentes cuyos paquetes nunca llegaban a `en_carga`. Arreglado: `completeLocalDispatch` recibe `isRetry` (calculado en `route.ts` a partir del mismo `Boolean(route.external_route_id)` que ya decide si se saltea `createDTRoute`) y el warn se omite cuando `isRetry` es verdadero.
- **F5 — ni `dispatch-dt-payload.ts` ni `dispatch-local-completion.ts` tenían archivo de test propio.** Toda la cobertura de `loadedPackageIds` pasaba por una cadena de `mockReturnValueOnce` de 6 niveles en `route-dispatch.test.ts`, que detecta una regresión aquí por accidente de orden de mocks, no por una aserción que nombre el comportamiento. Se agregaron `dispatch-local-completion.test.ts` (11 casos: escaneo genuino, `retenido`, `dañado`, soft-delete, backfill/`load_inferred`, split de orden, múltiples despachos, forma de embed en array) y `dispatch-dt-payload.test.ts` (11 casos sobre `buildItems`/`findMissingOrderNumbers`/`buildDtDispatches`). Se confirmó que los casos `load_inferred`/`listo_para_despacho`-sin-escanear fallan contra el predicado previo a este pase antes de implementar el arreglo.
- **F6 — límite de 300 líneas.** `dispatch/route.ts` estaba en 299. `logAcceptedLocalFailed` se movió a `dispatch-local-completion.ts` (encaja temáticamente: es sobre completar/registrar el estado local del despacho) y `releaseLoadPosition` + su sweep se extrajeron a `dispatch-local-release.ts` nuevo. Resultado: `route.ts` 262 líneas, `dispatch-local-completion.ts` 272, `dispatch-local-release.ts` 99 — los tres con margen.

## Riesgos

- **La API de DT no ofrece idempotencia (confirmado en *Fase 0*).** El reintento seguro no se puede garantizar de forma absoluta: la comprobación previa por `GET` cierra el margen que `external_route_id` no cubre, pero no lo elimina (hallazgo 4 de *Fase 0*) — quedan sin cubrir la respuesta que nunca llega, el proceso que muere entre la confirmación de DT y la primera escritura, y el fallo de la propia escritura de `external_route_id`. `2k` debe decir esto, no «no se creó nada a medias» sin condición: ver el cambio de copy en `spec-77`.
- **La comprobación previa por `GET` no está probada contra el tenant real** (hallazgo 3) y sus límites de tasa (1/seg, 1.000/día) la restringen a reintentos únicamente. No se resuelve escribiendo una ruta de prueba en DT — es una integración de producción para un operador logístico real.
- **El body del `208 "already reported"` es desconocido** (hallazgo 5). Hasta que alguien observe uno real, `createDTRoute` sigue lanzando ante cualquier respuesta sin `route_id`, así que un 208 real hoy saldría como `DT_API_ERROR` — la señal equivocada.
- **Backfill en producción.** Cualquier corrección de datos por H3 corre sobre ~112k dispatches / ~61k packages, donde los backfills de migración ya han excedido el timeout dos veces. Medir antes, lotear después, y nunca dentro de una migración sin acotar.
- **Rutas `loaded` legadas nunca reescaneadas (Fase 1c, F1 revisión #2) — corregido en Fase 1e tras B-1.** Esta nota decía que el requisito `load_inferred = false` produce, para siempre, un **falso negativo honesto**: `packages_dispatched: 0` sobre una ruta que sí llevaba bultos, sin afirmar nada falso. **Eso dejó de ser cierto en cuanto F-5 (Fase 1d) extendió el mismo predicado al payload de salida** — a partir de ahí, esa misma ruta legada no sólo reportaba `0`: se despachaba a DispatchTrack como una guía sin contenido y el handler igual respondía `200 {ok:true}` (el defecto B-1). Corregido en Fase 1e: ese caso ahora se **rehúsa** con `422 EMPTY_MANIFEST` antes de llamar a DT, en vez de reportar un falso negativo silencioso. El `packages_dispatched: 0` honesto sigue existiendo, pero acotado al camino de reintento (M-1, Fase 1e), donde ya no es una mentira sino un conteo que M-1 corrige a la cifra real. Si en producción existen rutas legadas así aún sin despachar, ahora se rehúsan explícitamente en vez de deslizarse; siguen necesitando reconciliación manual puntual (repasar, reescanear o descartar). Se desconoce cuántas son — la misma medición pendiente del punto 7 de Fase 1 lo cubre.
- **`CREATE OR REPLACE` sobre funciones existentes.** Si el arreglo toca una función SQL, usar como plantilla la definición de la migración **más reciente**, nunca la original — regla de `CLAUDE.md`.
- **Checks verdes ≠ migración aplicada.** El filtro de rutas de `deploy.yml` se salta el job de base de datos; un PR verde no prueba que la migración corrió.
- **pgTAP de Fase 1f no corrido contra el contenedor compartido.** `spec79_loaded_route_id.test.sql` se escribió y se leyó con cuidado, pero no se ejecutó vía `scripts/pgtap-local.sh` en esta tarea — el mismo contenedor Docker lo estaba usando en paralelo otro agente arreglando una regresión de `retorno_hub` en `seal-route.ts`/`force-seal-*.ts`, y `sync`/`apply` reescriben el estado del contenedor compartido. Queda pendiente para quien tenga la ventana de correrlo sin pisar ese trabajo.
- **Backfill de `loaded_route_id` no auto-invocado por la migración.** A diferencia de `spec74_backfill_package_load_state` (20260901000001, que sí se auto-invoca), `spec79_backfill_loaded_route_id` agrega sobre la tabla `dispatches` completa antes de unir con `packages` — el mismo par de tablas donde ya se documentaron dos timeouts de `statement_timeout` en esta serie de specs. La función queda definida por la migración pero **no se ejecuta sola**; alguien con acceso a producción debe medir y correrla a mano. Ver el comentario de la propia migración.

### Fase 1d — Revisión #3 adversarial (F-1 a F-9) `[done]`

_2026-09-05. El predicado `loaded_at IS NOT NULL AND load_inferred = false` (Fase 1c) se confirmó correcto — **no se tocó**. Esta revisión encontró que el guard TOCTOU de F2 (Fase 1c) nunca aseraba su propio argumento, y siete hallazgos más alrededor de la misma escritura._

- **F-1 (HIGH) — el argumento del guard TOCTOU no estaba aserido.** El mock de `route-dispatch.test.ts` sólo comprobaba que existiera *algún* `.in('status', …)` en la cadena, nunca su valor. Dos mutaciones realistas (ensanchar a `['en_carga','listo_para_despacho','retenido','dañado','asignado']`, angostar a `['en_carga']`) pasaban las 88 pruebas existentes. Arreglado con una aserción exacta del argumento (test `F1: the en_ruta write re-asserts status with exactly LOADED_ON_TRUCK_STATUSES...`); ambas mutaciones se probaron a mano contra `dispatch-en-ruta-write.ts` y las dos hicieron fallar esa prueba antes de revertir.
- **F-2 (MEDIUM) — `packages_dispatched` reportaba lo pedido, no lo escrito.** `completeLocalDispatch` (ahora delegando en `dispatch-en-ruta-write.ts`'s `writeEnRuta`) devuelve `{ dispatchedCount }` — el conteo real de filas tocadas por el `UPDATE` — y `route.ts` lo usa en la respuesta en vez de `loadedIds.length`. El desacuerdo ahora también escribe una fila `audit_logs` (`dispatch_en_ruta_count_mismatch`), no sólo `console.error`. El test de la Fase 1c se corrigió para inspeccionar el body de la respuesta y la nueva fila de auditoría.
- **F-3 (HIGH para QA) — el seed de QA nunca producía `loaded_at`.** `journeys.ts`'s `journeyDispatchClose` (QA-JRN-003) escribía `status` directamente sin tocar `loaded_at`/`load_inferred`, así que `loadedPackageIds` siempre daba `[]` en QA — un despacho ahí probaba HTTP 200 y nada más. Se agregó `markPackagesLoaded` en `factories.ts`, que estampa el mismo hecho por-bulto que un escaneo real (`loaded_at`/`loaded_by` seteados, `load_inferred = false`) sobre los bultos `en_carga`, llamado antes de la simulación cruda de `/close`. No se pudo "conducir la pantalla real" (este generador no tiene servidor HTTP contra el cual driblar) pero se replican exactamente las columnas que `advancePackagesToEnCarga` deja, no una lógica distinta.
- **F-4 (MEDIUM) — sin dedupe, una escritura sana disparaba la alarma.** `loadedPackageIds` pasó de `flatMap` a un `Set` — dos despachos vivos de la misma orden en una ruta (permitido explícitamente) ya no duplican el id del mismo bulto. Se corrigió también el comentario de `dispatch-local-completion.ts` que afirmaba de más: el predicado prueba "un escaneo real puso este bulto en *un* camión", no "en ESTA ruta" — `packages` no tiene columna de ruta.
- **F-5 (MEDIUM) — el payload de DT listaba bultos que la misma escritura se niega a marcar `en_ruta`.** `buildItems` (`dispatch-dt-payload.ts`) filtraba sólo `!deleted_at && label`. Decisión: el manifiesto de DT debe describir el mismo conjunto físico que `en_ruta`, así que ahora comparte `isGenuinelyLoadedPackage` (extraído a `dispatch-load-state.ts` para evitar un import circular de valores entre `dispatch-local-completion.ts` y `dispatch-dt-payload.ts`). Una orden con la caja A escaneada y B `retenido` ya no manda ambas al conductor.
- **F-6 (LOW) — el guard no reaseraba `deleted_at`.** `.is('deleted_at', null)` se agregó a las tres escrituras que revierten o avanzan el estado de un bulto: el `UPDATE` a `en_ruta` (`dispatch-en-ruta-write.ts`), el `DELETE` de una parada (`packages/[pkgId]/route.ts`) y el `DELETE` de una ruta completa (`routes/[id]/route.ts`).
- **F-7 (LOW) — un bulto liberado no podía volver a escanearse.** Las mismas dos escrituras que revierten un bulto a `sectorizado` (quitar una parada, borrar la ruta) dejaban `loaded_at`/`load_inferred` intactos, así que `scan-validator.ts`'s `ALREADY_STAGED` (`loaded_at && !load_inferred`) rechazaba para siempre un reescaneo tras replanificar el bulto a otra ruta. Ambas escrituras ahora también resetean `loaded_at: null, loaded_by: null, load_inferred: false`.
- **F-8 (LOW) — drift de null entre dos lectores del mismo discriminador.** `PackageRow.load_inferred` pasó de `boolean | null` a `boolean` — la columna es `NOT NULL DEFAULT false` y `lib/types.ts` ya lo tipaba así. `isGenuinelyLoadedPackage` compara `=== false`; `scan-validator.ts` compara `!load_inferred`; con el tipo estrecho un `null` ya no puede construirse en este flujo para que ambos disientan.
- **F-9 (LOW) — un test aseraba el argumento del filtro, no lo que su título afirmaba.** `packages/[pkgId]/route.test.ts`'s `reverts a package at listo_para_despacho...` no tenía ningún fixture de paquete (`buildClient()` es agnóstico de estado). Retitulado a lo que realmente prueba: que el filtro de status enviado incluye `listo_para_despacho`.

**Archivos nuevos de esta revisión:** `dispatch-load-state.ts` (el predicado compartido, para romper el ciclo de imports) y `dispatch-en-ruta-write.ts` (la escritura `en_ruta` en sí, extraída de `dispatch-local-completion.ts` para que ese archivo no volviera a cruzar 300 líneas al agregar F-1/F-2/F-6).

### Fase 1e — Revisión #4 adversarial, B-1 bloqueante (`[done]`)

_2026-09-05. Una revisión adversarial verificó de punta a punta contra el handler real que una ruta con cero bultos genuinamente cargados llegaba a DispatchTrack como guía sin contenido y se reportaba como éxito. Corregido. También se atendieron M-1 y M-2 de la misma revisión._

**B-1 (BLOCKER) — una ruta con cero bultos genuinamente cargados se despachaba a DT sin contenido y se reportaba `200 {ok:true}`.**

`buildItems` (F-5, Fase 1d) ya filtraba por `isGenuinelyLoadedPackage`, pero cuando ese filtro no dejaba nada para una parada, `createDTRoute` no mandaba `items: []` — **omitía la clave por completo** (`dispatchtrack-api.ts`: `if (d.items?.length) dispatch.items = d.items`). El único guard de vacío existente, `EMPTY_ROUTE`, comprueba **paradas**, no **bultos**. Tres estados de producción llegan ahí sin ser casos de borde de diseño: una ruta pre-spec-74 sellada y jamás reescaneada (`load_inferred = true` en todo), toda orden `retenido` tras staging (`retenido` está fuera de `DISPATCHABLE_STATUSES`, así que el sello pasa sin deadlock), y toda orden con sus bultos borrados-soft tras el sello.

**Arreglo.** `findDispatchesWithNoLoadedItems` (nueva, `dispatch-dt-payload.ts`) reutiliza `buildItems` para detectar, **por parada** (no una sola vez para toda la ruta), cualquier despacho con cero ítems. `route.ts` corre este guard antes de llamar a `createDTRoute` (sólo en el primer intento — un reintento ya saltea `createDTRoute` por completo) y responde `422 EMPTY_MANIFEST` con `count` y un mensaje en español-Chile, sin tocar DT.

**Por qué por parada y no una vez para toda la ruta.** Se evaluó la variante más simple — refusar sólo si NINGUNA parada tiene ítems — pero una ruta con nueve paradas buenas y una vacía igual le entrega al conductor una parada sin contenido en esa décima. El costo de la variante estricta es el mismo predicado ya compartido (`isGenuinelyLoadedPackage`) aplicado por despacho en vez de una vez; se implementó la variante estricta.

**Corrección del riesgo de Fase 1c (línea ~276 original).** Esa nota decía que el requisito `load_inferred = false` produce, para una ruta legada nunca reescaneada, un **falso negativo honesto**: `packages_dispatched: 0` sobre una ruta que sí llevaba bultos, sin afirmar nada falso. Esa nota se escribió **antes** de que F-5 extendiera el mismo predicado al payload de salida (`buildItems`) — en ese momento el falso negativo se quedaba contenido en la escritura local de `en_ruta`; DT igual recibía la guía completa (con ítems reales, porque `buildItems` todavía no filtraba por el predicado compartido en el primer pase de F-5... y una vez que sí lo hizo, quedó exactamente en la situación que B-1 encontró: guía vacía, `200` de éxito). **Ya no es cierto que el sistema "no afirma nada falso".** Con este guard, el balance cambia: una ruta legada nunca reescaneada ya no se despacha silenciosamente con una guía vacía — se **rehúsa** con `422 EMPTY_MANIFEST`, igual que cualquier otra ruta sin bultos genuinamente cargados. El falso negativo de `packages_dispatched: 0` sigue siendo posible sólo en el camino de reintento (ver M-1 abajo), nunca ya en el primer intento.

**M-1 (MEDIUM) — un reintento exitoso reportaba `packages_dispatched: 0`.** En el reintento saneado tras `DT_ACCEPTED_LOCAL_FAILED`, los bultos ya fueron escritos a `en_ruta` por el intento anterior; `writeEnRuta` de este intento no tiene nada que escribir y devuelve `0` legítimamente (F-3, Fase 1d). Pero `route.ts` reportaba ese `0` directamente como `packages_dispatched`, mintiendo sobre una ruta que sí lleva bultos. Arreglo: `alreadyDispatchedPackageCount` (nueva, `dispatch-local-completion.ts`) cuenta, del mismo `dispatchRows` ya obtenido, los bultos que son genuinamente cargados **por hecho** (`loaded_at`/`load_inferred`, sin filtrar por `status`) y que ya están en `en_ruta` — es decir, los que un intento anterior ya escribió. `route.ts` reporta `alreadyDispatchedPackageCount(dispatchRows) + writtenCount` (lo que esta llamada realmente escribió), no sólo lo segundo. Test: `route-dispatch.test.ts`'s *"does NOT warn about zero loaded packages on the sanctioned retry, and reports the true dispatched count (M-1)"*, con fixture confirmado en rojo antes del arreglo.

**M-2 (MEDIUM) — el revert de F-7 alcanzaba bultos cargados en OTRA ruta viva.** Ambos sitios que revierten el hecho de carga por bulto (`packages/[pkgId]/route.ts` al quitar una parada, `routes/[id]/route.ts` al borrar una ruta completa) filtraban sólo por `order_id`, alcanzando **todos** los bultos de la orden — incluido uno físicamente cargado en otra ruta viva para la misma orden (dos despachos vivos por orden están explícitamente permitidos: `20260901000001_spec74_package_load_state.sql:181-183`). Escenario: orden O planificada en rutas A y B; la cuadrilla escanea el bulto X sobre A; un responsable quita la parada de O de B → X, físicamente en el camión A, se revierte a `sectorizado` con su hecho de carga borrado. A ya no puede sellar (`recompute_dispatch_stage` y el chequeo de completitud del sello leen `loaded_at IS NULL` como pendiente).

Arreglo: `findOrderIdsWithLiveDispatchOnOtherRoutes` (nueva, `dispatch-cross-route-orders.ts`, compartida por los dos sitios) consulta si alguna de las órdenes en juego tiene un despacho vivo en una ruta distinta de la que se está quitando/borrando; esas órdenes se excluyen del revert. Falla ABIERTO ante un error de consulta (igual que `check_load_position_conflict`, el otro chequeo best-effort ya presente en ambos handlers) — no es un endurecimiento nuevo sobre un guard que ya era best-effort.

**Corrección posterior (Fase 1f, 2026-09-05): el fallo-abierto de arriba era, él mismo, el defecto M-2 movido un nivel más arriba. Ver Fase 1f.**

### Fase 1f — BLOCKER post-merge: un bulto cargado en la ruta B aparece en el acta de la ruta A (`[done]`)

_2026-09-05. Una revisión adversarial de #613/#614, ya en `main`, encontró que `force_split` (spec-77 fase 1b) reabrió exactamente el hueco que M-2 (Fase 1e) creía haber cerrado — no en el revert, sino en la lectura que alimenta el acta y el `en_ruta` del despacho mismo. Corregido, junto con un hallazgo del coordinador sobre el propio fallback de M-2._

**El escenario verificado (dos camiones cargando en paralelo — el caso canónico que `force_split` existe para servir):**

1. Orden O, 3 bultos. Ruta A `partially_staged`: bulto1 genuinamente cargado, bulto2/bulto3 no.
2. Se fuerza el sello de A → la fila pasa a `force_split`, bulto1 → `listo_para_despacho`, bulto2/bulto3 quedan `sectorizado` con `loaded_at IS NULL`.
3. bulto2 aparece en Pre-Ruta por diseño, se planifica en la ruta B y se escanea ahí → `status='en_carga'`, `loaded_at=now()`, `load_inferred=false`.
4. Ruta A despacha (sigue `loaded`). El acta de A (`buildItems`) y su escritura `en_ruta` (`loadedPackageIds`) leían `isGenuinelyLoadedPackage`, que sólo miraba `status`/`loaded_at`/`load_inferred` — **sin ninguna noción de qué ruta hizo el escaneo**. bulto2 pasaba esa prueba igual que bulto1, así que **entraba al acta de A y A lo marcaba `en_ruta`**.
5. Ruta B despacha: bulto2 ya está en `en_ruta` (no en `LOADED_ON_TRUCK_STATUSES`), así que desaparece del acta y de la escritura de B.

Resultado: bulto2 físicamente en el camión B, en el acta del camión A, en ninguno de los dos correctamente. La auditoría `dispatch_en_ruta_count_mismatch` no dispara — el conteo de A es internamente consistente con su propia selección inflada.

**Por qué era inalcanzable antes de `force_split`.** `ownsTheOrder` (`scan-validator.ts`) rechazaba cualquier escaneo de una orden con una fila `dispatches` viva en OTRA ruta activa. `force_split` (spec-77 fase 1b) trata deliberadamente su propia fila como que ya no reclama la orden — es lo que permite que la mitad liberada se replanifique — así que una orden puede ahora tener dos despachos vivos a la vez, uno por ruta, exactamente el caso que rompe la escritura descrita arriba.

**Causa raíz.** `packages` nunca llevó vinculación de ruta — el propio encabezado de `dispatch-load-state.ts` ya lo decía: `isGenuinelyLoadedPackage` sólo podía responder *"¿un escaneo real puso este bulto en UN camión?"*, nunca *"¿en ESTE camión?"*.

**Candidatos evaluados:**
- **`dock_scans`.** Sí lleva una ubicación de hecho, pero nada en `/routes/[id]/scan` (el escaneo de carga a camión) escribe una fila `dock_scans` — esa tabla es el rastro de la recepción/sorteo de andén (`dock-scan-validator.ts`, `quicksort-exception.ts`), un concepto de dominio distinto con su propia forma (`batch_id`, `dock_zone_id`). Reutilizarla acá habría sido un cambio más grande y más riesgoso sin ninguna ventaja sobre una columna propia.
- **Congelar el set de ítems de la fila `force_split` al sellar.** El lugar natural para eso es `seal-route.ts`/`force-seal-split.ts` — ambos explícitamente fuera de alcance de esta tarea (otro agente los edita en paralelo, arreglando una regresión de `retorno_hub` no relacionada).

**Arreglo elegido: `packages.loaded_route_id`.** Migración `20260909000001_spec79_loaded_route_id.sql` — columna nueva, `NULL` por defecto, FK a `routes(id)`. La escribe `advancePackagesToEnCarga` (`stage-dispatch.ts`), el único lugar que un escaneo real pone el hecho de carga por bulto, junto a `loaded_at`/`loaded_by`/`load_inferred`. `isGenuinelyLoadedPackage` (`dispatch-load-state.ts`) e `isGenuinelyLoadedByFact` ahora exigen `routeId` como parámetro obligatorio y comparan `loaded_route_id === routeId` — ningún llamador puede seguir usando el comportamiento viejo, ciego a la ruta, por omisión. `buildItems`/`findDispatchesWithNoLoadedItems`/`buildDtDispatches` (`dispatch-dt-payload.ts`) y `loadedPackageIds`/`alreadyDispatchedPackageCount` (`dispatch-local-completion.ts`) ahora reciben `routeId` y lo propagan al predicado compartido — el acta de DT y la escritura `en_ruta` siguen describiendo el mismo conjunto físico, ahora acotado a la ruta que pregunta.

**Backfill.** Sólo para el caso no ambiguo: una orden con exactamente un despacho vivo al momento de correrlo (`spec79_backfill_loaded_route_id`, agrupando por `order_id` con `HAVING COUNT(*) = 1`). Cualquier bulto genuinamente cargado por un escaneo real anterior a esta migración, sobre una orden que YA era ambigua en ese momento, queda con `loaded_route_id IS NULL` — mismo balance que spec-74 ya eligió para `load_inferred`: un falso negativo (esa ruta no reporta ese bulto como cargado hasta un reescaneo) es preferible a un falso positivo (adivinar la ruta y arriesgar volver a poner el bulto en el acta equivocada). **La función queda definida por la migración pero no se auto-invoca** — su consulta agrega sobre la tabla `dispatches` completa, el mismo par de tablas donde esta serie de specs ya documentó dos timeouts de migración; medir cuántas filas caen en el caso ambiguo (y correr la función a mano) es la misma medición pendiente de Fase 1, punto 7.

**Tests.** `dispatch-load-state.test.ts` (nuevo) fija el escenario de 5 pasos completo a nivel de unidad: bulto1 cuenta para A y no para B, bulto2 cuenta para B y no para A, bulto3 (nunca escaneado) no cuenta para ninguna. `route-dispatch.test.ts` agrega el mismo escenario a nivel de handler (`BLOCKER: a box genuinely loaded onto a DIFFERENT route is excluded from en_ruta and the DT guide`), confirmado en rojo contra el predicado sin `routeId` antes del arreglo. `stage-dispatch.test.ts` fija que `advancePackagesToEnCarga` escribe `loaded_route_id`. pgTAP nuevo: `spec79_loaded_route_id.test.sql` (columna + backfill acotado + caso ambiguo + caso soft-deleted) — **no ejecutado contra el contenedor compartido** en esta tarea (ver Riesgos): otro agente lo está usando en paralelo para una regresión de `retorno_hub`, y el archivo de test queda listo para quien tenga la ventana de correrlo.

**Adenda del coordinador — el propio fallback de M-2 fallaba abierto.** `findOrderIdsWithLiveDispatchOnOtherRoutes` devolvía un `Set` vacío ante un error de consulta — indistinguible de "no hay órdenes en otra ruta", exactamente el defecto que esa función existe para prevenir, sólo que un nivel más arriba. El precedente citado (`check_load_position_conflict`) no sostiene el fallo-abierto acá: ese chequeo es best-effort en la otra dirección (un fallo sólo puede perder la OBSERVABILIDAD de un conflicto ya existente; nada aguas abajo actúa sobre él). Acá un fallo controla si se borra un hecho de carga. **Corregido: falla CERRADO.** Ante un error, la función devuelve el conjunto COMPLETO de `orderIds` pedidos — "asumir que cada uno podría tener un despacho vivo en otra ruta, no revertir ninguno" — y además escribe una fila `audit_logs` (`cross_route_lookup_failed`), best-effort, además del `console.error` que ya existía. Los dos tests que antes se llamaban *"fails open..."* en `packages/[pkgId]/route.test.ts` y `routes/[id]/route.test.ts` se retitularon y invirtieron; se agregó `dispatch-cross-route-orders.test.ts` (nuevo, primera cobertura unitaria directa de esta función).

**Otros arreglos de la misma tarea (hallazgos L-1 a L-4 de la revisión anterior, pendientes desde antes de #614):**
- **L-1.** El seed de QA (`markPackagesLoaded`, `factories.ts`) estampaba el hecho de carga por bulto pero nunca dejaba la fila `dispatches` que un escaneo real siempre deja junto a él — sin ruta ni despacho, no había forma de llegar de ese estado sembrado a una ruta despachable (un escaneo de QA sobre esos bultos caía en la rama `adopt` y `advancePackagesToEnCarga` tiraba 500, con la fila adoptada insertada y no revertida). Arreglo: `createStagedRouteForOrder` (nueva, `factories.ts`) crea la ruta y la fila `dispatches` (`stage='staged'`) que un escaneo real habría dejado; `markPackagesLoaded` ahora recibe `routeId` y estampa también `loaded_route_id`. `journeys.ts`'s `journeyDispatchClose` (QA-JRN-003) llama a ambas antes de simular `/close`. La nota de Fase 1 que decía "Fase 5 punto 20 es inalcanzable" queda corregida: ahora es alcanzable.
- **L-2.** `markPackagesLoaded` no filtraba por `operator_id`, a diferencia de la simulación de `/close` once líneas más abajo en el mismo archivo. Corregido.
- **L-3.** `routes/[id]/route.ts` seguía hardcodeando `['en_carga', 'listo_para_despacho']` en vez de importar `LOADED_ON_TRUCK_STATUSES` — exactamente el drift que esa constante existe para evitar. Corregido.
- **L-4.** `factories.ts` seguía en 429 líneas. Se extrajo la maquinaria de usuarios de login de QA (`resolveUserId`, `QA_USERS`, `createLoginUser`, etc.) a `seed-users.ts` nuevo, re-exportada desde `factories.ts` para no tocar ningún sitio de importación existente. `factories.ts` queda en 288 líneas (con la función nueva de L-1 incluida), `seed-users.ts` en 210.

**Archivos nuevos de esta fase:** `20260909000001_spec79_loaded_route_id.sql` (migración), `spec79_loaded_route_id.test.sql` (pgTAP), `dispatch-load-state.test.ts`, `dispatch-cross-route-orders.test.ts`, `packages/database/seed-qa/lib/seed-users.ts`.

### Fase 1g — Revisión adversarial de #617: harness falso-verde, backfill parcial, mutantes sobrevivientes `[done]`

_2026-09-05. Revisión adversarial de #617, ya en `main`. Cuatro hallazgos: uno sobre `scripts/pgtap-local.sh` en sí (afecta a todo el repo, no sólo spec-79), dos sobre `spec79_backfill_loaded_route_id`, y documentación de un orden de despliegue sin el cual el frontend de esta serie tira 500 en cada escaneo de carga._

**M-2 (HIGH) — `pgtap-local.sh run` reportaba PASS para archivos inexistentes.** El bloque `run` buscaba `/supabase/tests/$t.sql` sin importar el nombre pasado, y detectaba fallo con `grep -q "ERROR"` — pero un archivo faltante hace que `psql` escriba `psql: error: could not open file...` en minúscula, que ese grep nunca ve. Cualquier suite corrida con el nombre corto (sin `.test`) "pasaba" sin ejecutar una sola línea de SQL. Arreglado: `run` ahora resuelve el nombre pedido contra los dos sufijos reales del repo (`$t.test.sql`, luego `$t.sql`) comprobando existencia dentro del contenedor antes de correr nada; si ninguno existe, es un FAIL explícito con el nombre que se buscó, no un PASS silencioso. Verificado por demostración (no por aserción): un nombre inexistente ahora falla con mensaje claro, y una prueba deliberadamente rota (un `RAISE EXCEPTION` insertado a mano en un archivo real) también falla — ver comandos y salida en el resumen de la tarea.

**H-2 (HIGH) — `spec79_backfill_loaded_route_id`'s `HAVING COUNT(*) = 1` contaba filas, no rutas, y no distinguía una ruta viva de una cerrada hace semanas.** Dos defectos en la misma subconsulta:
1. Un pedido con **dos despachos vivos en la MISMA ruta** (permitido explícitamente, sin constraint único — `20260901000001:181-183`, la misma razón por la que `loadedPackageIds` necesita su propio dedupe) da `COUNT(*) = 2` y se salta, aunque la vinculación de ruta sea inequívoca (`COUNT(DISTINCT route_id) = 1`).
2. La subconsulta sólo filtra `deleted_at IS NULL` en `dispatches`, sin mirar el estado de la ruta. Un pedido con un despacho en una ruta `completed` hace semanas más su despacho actual en una ruta viva da `COUNT(*) = 2` — dos rutas *distintas* — y se salta también, aunque el despacho antiguo ya no compita por nada: la ruta a la que apunta terminó.

Arreglo (nueva migración `20260910000001_spec79_backfill_route_scope_fix.sql`, `CREATE OR REPLACE` con plantilla `20260909000001`, la más reciente que define esta función — la original no se toca): la subconsulta ahora une contra `routes`, filtra `r.status IN ('draft','planned','loading','loaded','dispatched','in_transit','in_progress')` (el mismo conjunto de "ruta activa" que `get_pre_route_snapshot`, `20260908000001:165`, ya usa) además de `d.deleted_at IS NULL` y `r.deleted_at IS NULL`, y agrupa con `HAVING COUNT(DISTINCT d.route_id) = 1` en vez de `COUNT(*) = 1`.

**Costo a escala de producción (~112k dispatches / ~61k packages).** La consulta sigue siendo un único `GROUP BY order_id` sobre toda la tabla `dispatches`, ahora con un `JOIN` adicional a `routes` por `route_id` (indexado, PK) y un filtro adicional sobre `routes.status` (no indexado hoy, pero la tabla `routes` es varios órdenes de magnitud más chica que `dispatches`). El plan no cambia de forma — sigue siendo un seq scan + agregación sobre `dispatches`, el mismo costo dominante que ya tenía la versión original — así que esto no empeora el riesgo de `statement_timeout` ya documentado; no lo elimina tampoco. La función sigue **sin auto-invocarse**; medir y correrla en lotes, con la app vieja corriendo, sigue siendo trabajo manual — ver la Fase 1g de abajo y el runbook.

**M-1 (MEDIUM) — el pgTAP no habría detectado la regla mal escrita.** Matriz de mutación corrida por la revisión contra `spec79_backfill_loaded_route_id`: quitar `load_inferred = false`, quitar `loaded_at IS NOT NULL`, quitar `loaded_route_id IS NULL` (idempotencia), quitar `WHERE deleted_at IS NULL` en `dispatches`, y cambiar `COUNT(*)` por `COUNT(DISTINCT route_id)` sin más — todos **sobrevivían** contra los 3 tests existentes. Sólo quitar el `HAVING` entero o el filtro `deleted_at` de `packages` mataba algo. Se agregaron cuatro fixtures nuevos a `spec79_loaded_route_id.test.sql`:
- **TEST 4:** `load_inferred = true` (backfill óptimo de spec-74, sin evidencia de ruta) — debe quedar `NULL`.
- **TEST 5:** `loaded_at IS NULL` (nunca escaneado) — debe quedar `NULL`.
- **TEST 6:** idempotencia — un paquete que YA tiene `loaded_route_id` fijado a una ruta distinta de la única viva no se pisa (protege el filtro `loaded_route_id IS NULL`).
- **TEST 7:** un despacho vivo más un despacho `deleted_at IS NOT NULL` para el mismo pedido en otra ruta — sigue siendo inequívoco (una sola ruta viva) y debe backfillar, protegiendo el filtro `deleted_at IS NULL` en `dispatches`.
- **TEST 8 (dos filas, una ruta — H-2 defecto 1):** dos despachos vivos del mismo pedido en la MISMA ruta — `COUNT(*) = 2` pero `COUNT(DISTINCT route_id) = 1` — debe backfillar. Mata la mutación `COUNT(*)` en vez de `COUNT(DISTINCT route_id)`.
- **TEST 9 (ruta cerrada hace semanas — H-2 defecto 2):** un despacho en una ruta `completed` más el despacho actual en una ruta `loaded` — dos rutas, pero sólo una activa — debe backfillar contra la ruta activa, no quedar `NULL`. Mata el filtro de estado de ruta que falta.
- **TEST 10 (existencia de columna/índice/FK):** confirma `packages.loaded_route_id` existe, es FK a `routes(id)`, y `idx_packages_loaded_route_id` existe — el chequeo que la Fase 1f de arriba decía tener (línea ~346 original de esa fase) pero nunca escribió.

Cada mutación de la tabla de arriba se confirmó que ahora muere, usando el harness corregido de M-2 — ver salida en el resumen de la tarea.

**B-2/H-1 (documentación, BLOQUEANTES) — orden de despliegue y recuperación manual.** `dispatch/route.ts:104` y `stage-dispatch.ts:120` nombran `loaded_route_id` explícitamente; si el frontend se despliega antes de que `20260909000001` esté aplicada, cada despacho responde `500 QUERY_FAILED` y cada escaneo de carga a camión responde 500 también. No hay camino de recuperación en la app para una caja varada con `loaded_route_id IS NULL`: el re-escaneo choca con `ALREADY_STAGED`, el `stage-dispatch.ts` `.or(...)` no matchea nada, quitar la parada está vetado por `ROUTE_SEALED` una vez sellada, y no existe endpoint de re-apertura. El orden de despliegue y la reconciliación manual con el SQL exacto quedan documentados en `apps/frontend/docs/deployment-runbook.md`, sección "spec-79 — `loaded_route_id`: orden de despliegue y recuperación manual".

**Registrado, no arreglado (otros agentes son dueños de esos archivos):**
- **M-4.** `dispatch-route-delete-cleanup.ts:22-30` no desestructura `error` en su `SELECT`; ante un fallo de consulta, `data` es `null`, retorna temprano, y `routes/[id]/route.ts` borra la ruta de todos modos — despachos vivos quedan apuntando a una ruta borrada y cajas varadas en `en_carga`. Mismo patrón fail-open que esta serie ya encontró cuatro veces.
- **M-3.** El seed de QA sigue sin poder llegar a una ruta despachable: `createStagedRouteForOrder` fija `external_route_id = 'QA-<routeId>'`, la ruta queda `loading` así que `/dispatch` responde `409 INVALID_STATE`, y no hay filas `fleet_vehicles`, así que igual pararía en `422 VEHICLE_NOT_FOUND`.
- **L-1.** `20260908000002` limpia `loaded_at/loaded_by/load_inferred` en el camino de retorno pero no `loaded_route_id` — inerte hoy, el único de los cuatro sitios que limpian el hecho de carga que queda inconsistente.
- **L-2.** `dispatch-cross-route-orders.ts:52-58` no filtra por estado de ruta, a diferencia de `ownsTheOrder` — un despacho en una ruta `completed` hace semanas sigue bloqueando un revert para siempre.

**Archivos de esta fase:** `20260910000001_spec79_backfill_route_scope_fix.sql` (migración, `CREATE OR REPLACE` sobre `spec79_backfill_loaded_route_id`), `spec79_loaded_route_id.test.sql` (fixtures 4-10), `scripts/pgtap-local.sh` (harness), `apps/frontend/docs/deployment-runbook.md` (sección nueva).
