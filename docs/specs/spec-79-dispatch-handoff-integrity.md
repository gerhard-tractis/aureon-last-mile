# Spec-79: Integridad del handoff a DispatchTrack — reintento seguro y `en_ruta` por bulto

> **Related:** [spec-77](spec-77-despacho-movil-cierre.md) (las pantallas que dependen de estos dos arreglos; ver su *Fase 0*, hallazgos H2 y H3), [spec-70](spec-70-dispatch-state-machine.md) (`transition_route_status`), [spec-71](spec-71-load-positions-staging-pass.md) (posiciones de carga), [spec-74](spec-74-per-bulto-staging.md) (`en_carga`, staging por bulto)

**Status:** backlog

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
| `apps/frontend/src/lib/dispatchtrack-api.ts` (`createDTRoute`) | Dónde va la clave de idempotencia |
| `spec-74` | `en_carga` como estado del bulto efectivamente cargado |
| Este spec | Los arreglos y su plan |

## Scope

### H2 — Reintento seguro

Hoy el orden es correcto en lo esencial: `createDTRoute` primero, estado local después. Si DT falla, nada local cambió y el `catch` registra `dispatch_failed`. **Pero** `transition_route_status`, `release_load_position`, el `UPDATE` de `routes` y el de `packages` corren *después* de que DT confirmó, y todos caen en el mismo `catch`, que responde `502 DT_API_ERROR`. Consecuencias:

- La UI no puede distinguir «DT rechazó» de «DT aceptó y lo local falló». `spec-77` `2k` afirma que no se creó nada a medias; en el segundo caso es falso.
- `createDTRoute` no lleva clave de idempotencia, así que *Reintentar* crea una **segunda** ruta en DispatchTrack.
- `external_route_id` — lo que DT devolvió — se pierde si el `UPDATE` de `routes` no llega a correr, así que la ruta queda sin rastro local de una ruta que sí existe en DT.

Lo que este spec cambia:

1. **Clave de idempotencia en `createDTRoute`.** Derivada del `route_id`, estable entre reintentos, para que un segundo envío de la misma ruta no cree una segunda en DT. Verificar primero qué soporta la API de DT: si no soporta idempotencia, la alternativa es consultar por la ruta antes de crearla (`GET` por `truck_identifier` + fecha, o el mecanismo que exista) y **no** crear si ya está. La decisión sale de esa verificación; lo que no es aceptable es dejar *Reintentar* creando duplicados.
2. **Persistir `external_route_id` inmediatamente después de la confirmación de DT**, antes de cualquier otra escritura. Es el dato que hace recuperable el resto: con él, un reintento sabe que DT ya aceptó.
3. **Código de error propio para el fallo posterior a DT.** Nuevo código — `DT_ACCEPTED_LOCAL_FAILED` — distinto de `DT_API_ERROR`, con su propia acción de `audit_logs`. Es lo que le permite a `2k` decir la verdad en ambos casos y ofrecer *reconciliar* en vez de *reintentar*.
4. **Las escrituras locales post-DT se agrupan y se hacen reintentables.** Reintentar tras un `DT_ACCEPTED_LOCAL_FAILED` **no** debe volver a llamar a DT: debe completar sólo lo local.

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

### Fase 0 — Verificación de la API de DispatchTrack (bloqueante para H2)
1. Leer `lib/dispatchtrack-api.ts` y la documentación de DT: ¿soporta clave de idempotencia en la creación de rutas? ¿Hay un `GET` que permita comprobar si una ruta ya existe?
2. Según el resultado, elegir entre clave de idempotencia y comprobación previa (decisión del scope H2, punto 1). **No** se implementa un reintento seguro sin una de las dos.

### Fase 1 — H3, el arreglo acotado
3. Test: orden partida con bultos en `en_carga` y en `asignado` → sólo los `en_carga` pasan a `en_ruta`.
4. Test: bulto `retenido` en consolidación no pasa a `en_ruta`.
5. Test: orden completa (todos los bultos cargados) sigue comportándose igual que hoy — no hay regresión.
6. Implementar el filtro acotado.
7. Medir en producción cuántos bultos están hoy en `en_ruta` sin haber estado en `en_carga` (consulta de sólo lectura, acotada). Reportar la cifra **antes** de proponer backfill.

### Fase 2 — H2, persistir la prueba
8. Test: DT confirma y el `UPDATE` de `routes` posterior falla → `external_route_id` **ya está** persistido.
9. Reordenar para escribir `external_route_id` inmediatamente tras la confirmación de DT.

### Fase 3 — H2, distinguir los fallos
10. Test: DT lanza → `502 DT_API_ERROR`, `dispatch_failed` en `audit_logs`, ruta intacta en `loaded`, ningún paquete movido.
11. Test: DT confirma y `transition_route_status` falla → código **`DT_ACCEPTED_LOCAL_FAILED`**, no `DT_API_ERROR`, con su propia acción de auditoría y el `external_route_id` en el registro.
12. Test: los fallos best-effort que hoy ya se tragan (`release_load_position`, el sweep, los `audit_logs`) siguen sin hacer fallar el despacho — no se endurecen por accidente.

### Fase 4 — H2, reintento seguro
13. Test: reintentar tras `DT_API_ERROR` llama a DT (no pasó nada la primera vez).
14. Test: reintentar tras `DT_ACCEPTED_LOCAL_FAILED` **no** llama a DT y sólo completa lo local.
15. Test: dos envíos concurrentes de la misma ruta no crean dos rutas en DT.
16. Test: la ruta acaba en `dispatched` con su `external_route_id` en ambos caminos de recuperación.

### Fase 5 — Cierre
17. `npm run test -- --pool=forks` + mutation-test antes de push.
18. Tests SQL locales con `scripts/pgtap-local.sh` si se toca alguna función — el contenedor es compartido entre worktrees, no correr en paralelo con otra rama.
19. Verificación en QA con DT mockeado en los tres caminos: rechazo, aceptación, y aceptación con fallo local.

## Riesgos

- **La API de DT puede no ofrecer idempotencia.** Es lo que la fase 0 debe establecer. Si no la ofrece y tampoco hay consulta previa fiable, el reintento seguro no se puede garantizar y `2k` tendrá que advertir del duplicado — que es exactamente la opción que este spec existe para evitar. Ese resultado hay que reportarlo, no rodearlo.
- **Backfill en producción.** Cualquier corrección de datos por H3 corre sobre ~112k dispatches / ~61k packages, donde los backfills de migración ya han excedido el timeout dos veces. Medir antes, lotear después, y nunca dentro de una migración sin acotar.
- **`CREATE OR REPLACE` sobre funciones existentes.** Si el arreglo toca una función SQL, usar como plantilla la definición de la migración **más reciente**, nunca la original — regla de `CLAUDE.md`.
- **Checks verdes ≠ migración aplicada.** El filtro de rutas de `deploy.yml` se salta el job de base de datos; un PR verde no prueba que la migración corrió.
