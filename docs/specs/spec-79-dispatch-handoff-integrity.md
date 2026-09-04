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

13. Test: reintentar tras `DT_API_ERROR` llama a DT (no pasó nada la primera vez) — sin comprobación previa, porque no hay nada que confirmar.
14. Test: reintentar tras `DT_ACCEPTED_LOCAL_FAILED` **no** llama a DT y sólo completa lo local.
15. Test: reintentar sin `external_route_id` persistido (ventana no cubierta por la Fase 2) dispara la comprobación previa por `GET`, emparejando por identificadores de guía, no por camión+fecha.
16. Test: la comprobación previa fallida o ambigua **no** crea la ruta — deriva a reconciliación en vez de fallar abierto.
17. Test: la ruta acaba en `dispatched` con su `external_route_id` en ambos caminos de recuperación.

### Fase 5 — Cierre `[pending]`
18. `npm run test -- --pool=forks` + mutation-test antes de push.
19. Tests SQL locales con `scripts/pgtap-local.sh` si se toca alguna función — el contenedor es compartido entre worktrees, no correr en paralelo con otra rama.
20. Verificación en QA con DT mockeado en los tres caminos: rechazo, aceptación, y aceptación con fallo local.

## Riesgos

- **La API de DT no ofrece idempotencia (confirmado en *Fase 0*).** El reintento seguro no se puede garantizar de forma absoluta: la comprobación previa por `GET` cierra el margen que `external_route_id` no cubre, pero no lo elimina (hallazgo 4 de *Fase 0*) — quedan sin cubrir la respuesta que nunca llega, el proceso que muere entre la confirmación de DT y la primera escritura, y el fallo de la propia escritura de `external_route_id`. `2k` debe decir esto, no «no se creó nada a medias» sin condición: ver el cambio de copy en `spec-77`.
- **La comprobación previa por `GET` no está probada contra el tenant real** (hallazgo 3) y sus límites de tasa (1/seg, 1.000/día) la restringen a reintentos únicamente. No se resuelve escribiendo una ruta de prueba en DT — es una integración de producción para un operador logístico real.
- **El body del `208 "already reported"` es desconocido** (hallazgo 5). Hasta que alguien observe uno real, `createDTRoute` sigue lanzando ante cualquier respuesta sin `route_id`, así que un 208 real hoy saldría como `DT_API_ERROR` — la señal equivocada.
- **Backfill en producción.** Cualquier corrección de datos por H3 corre sobre ~112k dispatches / ~61k packages, donde los backfills de migración ya han excedido el timeout dos veces. Medir antes, lotear después, y nunca dentro de una migración sin acotar.
- **`CREATE OR REPLACE` sobre funciones existentes.** Si el arreglo toca una función SQL, usar como plantilla la definición de la migración **más reciente**, nunca la original — regla de `CLAUDE.md`.
- **Checks verdes ≠ migración aplicada.** El filtro de rutas de `deploy.yml` se salta el job de base de datos; un PR verde no prueba que la migración corrió.
