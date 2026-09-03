# Spec-77: Despacho en móvil — cerrar la ruta y despachar a DispatchTrack

> **Related:** [spec-76](spec-76-despacho-movil-carga.md) (el bucle de carga que precede a estas pantallas), [spec-75](spec-75-despacho-desktop-reshape.md) (escritorio), [spec-78](spec-78-despacho-tablet-anden.md) (tablet del andén), [spec-70](spec-70-dispatch-state-machine.md) (máquina de estados de ruta)

**Status:** backlog

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
| `spec-70` | Transiciones `loading → closed → dispatched` / `planned` |
| Este spec | Decisiones del lado del repo, desviaciones y plan |

## Scope

| Mock | Ruta | Estado hoy |
|---|---|---|
| `2i` Cerrar con faltantes | Hoja/pantalla dentro de la sesión móvil | El endpoint de cierre existe; la confirmación con faltantes no tiene UI móvil |
| `2j` Despachar | Pantalla de confirmación | El endpoint existe; hoy se dispara sin esta revisión |
| `2k` Rechazo de DispatchTrack | Estado de error de `2j` | `dispatch_failed` se registra; no hay pantalla de recuperación |
| `2l` Acta de despacho | Pantalla terminal | No existe: hoy el despacho deja un toast |

### No-goals

- **No se cambia el contrato con DispatchTrack.** Este spec dibuja la confirmación, el error y el acta sobre el endpoint que ya existe. Si el endpoint no es atómico hoy, eso se **verifica y se reporta**, no se reescribe aquí a mitad de camino — ver riesgo 1.
- **No se implementa cancelación.** El mock lo dice explícitamente: después de despachar «hay que pedirle a DispatchTrack que la cancele». No hay acción de cancelar en Aureon.
- **No se implementa reapertura de ruta.** `2i` rotula que la ruta no se puede volver a abrir. Corregir un cierre equivocado es intervención de hub, no de andén.
- **No se toca `2a`–`2h`.** Son `spec-76`.
- **No hay migraciones previstas** — sujeto a la verificación del riesgo 2.

## Decisiones

1. **La acción primaria de `2i` es *Seguir escaneando*, no cerrar.** Cerrar con faltantes es la secundaria y **nombra la cifra** (*Cerrar con 24 sin cargar*) para que nadie lo haga por inercia. Es el mismo criterio que Recepción aplicó en su nota de discrepancia: la salida cómoda no puede ser la destructiva.

2. **El cierre nombra las tres consecuencias, no una.** El copy del mock enumera: los 24 paquetes se quedan en el andén A3 y hay que meterlos en otra ruta · los 148 cargados pasan a `listo_para_despacho` · la ruta no se puede volver a abrir. Las tres se muestran; resumirlas a «¿Confirmar cierre?» es lo que hace que se cierre con faltantes sin querer.

3. **La lista de sin-cargar es paginada, no completa.** El mock muestra 4 con *Ver los 20 restantes*. Con 24 filas la pantalla de confirmación se vuelve scroll infinito y el botón queda fuera de vista, que es exactamente cuando la gente toca a ciegas.

4. **Nota por paquete, opcional en UI y sin regla de servidor inventada.** `2i` ofrece *Nota* por fila. **No** se implementa obligatoriedad: hoy nada en el servidor la exige, y meter la regla sólo en el cliente da la falsa impresión de que está garantizada. Si el negocio la quiere obligatoria, es una regla de servidor y un spec aparte. Esto se anota, no se resuelve por cuenta propia.

5. **`2j` es una revisión, no un botón.** Muestra camión, conductor, fecha de reparto, paradas · paquetes, y un bloque *Qué pasa al despachar* con los cuatro efectos: se crean las paradas en DispatchTrack · los paquetes pasan a `en_ruta` y la ruta a `planned` · después no se edita desde Aureon · **si el envío falla, nada cambia**. Esa última línea es la que hace que reintentar sea seguro, y es la que hay que verificar contra el endpoint antes de escribirla en pantalla (riesgo 1).

6. **`2k` dice qué NO cambió.** El valor de la pantalla de error no es el código HTTP: es «la ruta sigue cerrada y los 148 paquetes siguen en `listo_para_despacho`. No se creó nada a medias: el envío es todo o nada.» Más el checklist *Antes de reintentar*, que distingue lo verificado (camión y conductor asignados, 24 paradas con dirección y teléfono) de la advertencia (2 paradas sin teléfono del receptor). *Reintentar* es la acción primaria; el contador de intentos (`intento 1 de 3`) es visible y a los tres intentos el copy deriva al jefe de turno.

7. **`2l` reincorpora al flujo, no a una pantalla vacía.** El acta nombra el id de DispatchTrack (`DT-164972`), las cifras de lo que salió, y **lo que queda pendiente en la nave**: los 24 paquetes que siguen en `asignado` y necesitan otra ruta hoy. Luego ofrece la siguiente carga concreta (`RUT-2026-0090 · Maipú`), no un «volver al inicio». Mismo criterio que el acta de Recogida.

8. **`2l` no dice «sincronizado» si no lo está.** A diferencia de Recogida, aquí sí hay red y el despacho es sincrónico: el acta se muestra **después** de la respuesta de DispatchTrack, así que puede afirmar que la ruta quedó registrada. Si el envío fue aceptado pero la confirmación se perdió, el estado es `2k` con reintento, no un acta optimista.

## Plan de implementación (TDD)

### Fase 0 — Verificación previa (bloqueante)
1. Leer `api/dispatch/routes/[id]/dispatch/route.ts` y determinar si el envío es realmente todo-o-nada y si un fallo deja la ruta intacta. **El copy de `2j` y `2k` afirma ambas cosas**; si el endpoint no lo garantiza, no se escribe esa promesa en pantalla — se reporta y se decide (ver riesgo 1).
2. Confirmar si el endpoint expone intentos y detalle técnico para `2k`.

### Fase 1 — `2i` Cerrar
3. Test: con faltantes → pantalla de confirmación; sin faltantes → cierre directo.
4. Test: las tres consecuencias aparecen (decisión 2).
5. Test: *Seguir escaneando* es primaria; el botón de cerrar nombra la cifra exacta.
6. Test: lista paginada con *Ver los N restantes* (decisión 3).
7. Test: nota por fila se persiste; su ausencia no bloquea el cierre (decisión 4).
8. Test: al cerrar, los cargados pasan a `listo_para_despacho` y la ruta a `closed`.

### Fase 2 — `2j` Despachar
9. Test: la revisión muestra camión, conductor, fecha, paradas · paquetes.
10. Test: sin camión asignado → no se puede despachar y se dice por qué (DispatchTrack exige el identificador).
11. Test: el bloque *Qué pasa al despachar* enumera los cuatro efectos.
12. Test: doble toque no envía dos veces.

### Fase 3 — `2k` Error
13. Test: fallo → estado de error que nombra qué no cambió; la ruta sigue `closed` y los paquetes en `listo_para_despacho`.
14. Test: contador de intentos; al tercero, el copy deriva al jefe de turno.
15. Test: checklist *Antes de reintentar* separa verificado de advertencia.

### Fase 4 — `2l` Acta
16. Test: acta con el id de DispatchTrack, las 4 cifras y lo que queda en el andén.
17. Test: ofrece la siguiente carga concreta si existe; si no, no inventa una.
18. Test: la ruta queda `dispatched` / `planned` y los paquetes en `en_ruta`.

### Fase 5 — Cierre
19. `npm run test -- --pool=forks` + mutation-test antes de push.
20. E2E del camino completo cargar → cerrar → despachar, con el envío mockeado en fallo y en éxito.
21. Verificación en QA.

## Riesgos

1. **El copy promete atomicidad.** `2j` y `2k` afirman «si el envío falla, nada cambia» y «no se creó nada a medias». Si el endpoint actual crea paradas incrementalmente, esa frase es falsa y la pantalla estaría mintiéndole a la cuadrilla sobre una operación irreversible. **La fase 0 es bloqueante por esto.** Si no se cumple, hay dos salidas: cambiar el copy para describir lo que realmente pasa, o hacer el endpoint atómico en un spec propio. La decisión es del usuario, no se toma aquí.
2. **Notas de cierre: falta confirmar dónde viven.** Recepción usa `discrepancy_notes` ligada a `manifest_id`, que es de Recogida y no sirve para una `route` de Despacho. Si no hay tabla equivalente para faltantes de carga, la nota de `2i` necesita destino — posible migración, a confirmar en fase 0 antes de prometer persistencia.
3. **Reintento y idempotencia.** Si DispatchTrack aceptó pero la respuesta se perdió, reintentar puede duplicar la ruta. Verificar si el envío lleva clave de idempotencia; si no, `2k` debe advertirlo en vez de invitar a reintentar a ciegas.
4. **Es la pantalla que rompe la operación si sale mal.** Un camión que sale con la ruta mal despachada no se arregla desde Aureon. Revisión en Opus/Fable, no en Sonnet.
