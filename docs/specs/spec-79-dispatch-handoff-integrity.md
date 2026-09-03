# Spec-79: Integridad del handoff a DispatchTrack — reintento seguro y `en_ruta` por bulto

> **Related:** [spec-77](spec-77-despacho-movil-cierre.md) (las pantallas que dependen de estos dos arreglos; ver su *Fase 0*, hallazgos H2 y H3), [spec-70](spec-70-dispatch-state-machine.md) (`transition_route_status`), [spec-71](spec-71-load-positions-staging-pass.md) (posiciones de carga), [spec-74](spec-74-per-bulto-staging.md) (`en_carga`, staging por bulto)

**Status:** backlog

_Date: 2026-09-03_

---

## Goal

Dos defectos de servidor en `POST /api/dispatch/routes/[id]/dispatch`, encontrados al verificar el copy de `spec-77` contra el endpoint. Ninguno es de diseño: los dos hacen que el sistema afirme algo que no es cierto sobre la única acción irreversible del módulo.

1. **H2 — un fallo posterior a la confirmación de DispatchTrack es indistinguible de un fallo de DispatchTrack**, y reintentarlo duplica la ruta.
2. **H3 — `en_ruta` se escribe por orden y no por bulto cargado**, así que un paquete que se quedó en el andén queda marcado como si viajara.

H3 **no es un problema del rediseño**: afecta a la operación de hoy. Cualquier orden partida que se despache parcialmente deja bultos de andén en `en_ruta`, invisibles para la ruta siguiente. Vale arreglarlo aunque `spec-77` no existiera.

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
