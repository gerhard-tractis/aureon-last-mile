# Spec-83: Recogida en escritorio (`5a`) — ventana de retiro, ocupación y merma

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**su fase 4.4 construyó esta pantalla contra el mock `1l` y difirió estos tres datos con razón escrita**), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (el cierre que produce la merma que aquí se muestra), [spec-82](spec-82-recogida-movil-asignacion-y-ruta.md) (`5b`/`5c`; la asignación puede aterrizar aquí), [spec-61](spec-61-pickup-route-crew.md) (panel de armado de ruta), [spec-73](spec-73-capacity-ladder-truck-topup.md) (capacidad de vehículo en Despacho — precedente directo)

**Status:** backlog
**Verify:** unit, e2e-qa

_Date: 2026-09-07_

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

**Dónde vive.** La ventana es del **punto de recogida**, no del manifiesto: el local abre y cierra a la misma hora todos los días. `pickup_points.pickup_locations` es un JSONB `{name, address, comuna}` — el sitio natural es ampliarlo, o una tabla de horarios si se quiere variación por día de la semana.

Es una decisión de modelo, no de pantalla:

- **(a) Ventana fija por punto de recogida.** Simple, cubre el 90% (un local tiene horario estable).
- **(b) Ventana por punto y día de la semana.** Correcto para sábados, más tabla.
- **(c) Ventana por manifiesto.** Sólo si el retailer la manda en el ingreso, y hoy no la manda.

**Recomendación: (a)**, con (b) como evolución si aparece el caso. Empezar por (c) es modelar una excepción que nadie ha pedido.

Una vez exista, `get_pending_manifests` la devuelve y el borde de la fila deja de ser progreso de escaneo para ser proximidad al cierre — **ojo, es un cambio de significado en un elemento que ya se usa**, no una columna nueva. Hay que decidir cuál gana o dar dos señales distintas.

### 2. Ocupación estimada del vehículo

`5a`, panel de ruta en armado: «Furgón · 12,4 m³ · RTHK-72 · Ocupación estimada **68%**».

Necesita las dos mitades:

- **Capacidad del vehículo.** El mock ya la muestra («12,4 m³»), así que es un campo en `vehicles`. Barato.
- **Volumen del bulto.** Caro. `packages` tiene `declared_dimensions` y `verified_dimensions` (ambos existen en el esquema), pero están vacíos en la práctica: nada del ingreso los llena.

**Mirar spec-73 antes de diseñar nada aquí.** La escalera de capacidad y el top-up de camión en Despacho ya se enfrentaron a este problema; si allí se resolvió con un proxy (peso, conteo de bultos, o una capacidad en «bultos equivalentes»), Recogida debe usar **el mismo** proxy o los dos módulos darán números distintos para el mismo furgón, que es peor que no dar ninguno.

Si spec-73 no lo resolvió, la posición honesta sigue siendo la de spec-54: **omitir el porcentaje**. Un 68% inventado en la pantalla que decide si el furgón sale lleno es activamente dañino.

### 3. Merma en los cierres del día

`5a`, panel de cierres: `CARGA-99785 · Ripley · **2 faltantes de 44**` en paleta warning, junto a los cierres limpios `38/38 paquetes`.

**Este es el más fácil de los tres, y spec-80 lo habilita.** Hoy `get_completed_manifests` da totales pero no verificados, y derivar la merma exige una consulta por manifiesto. Cuando spec-80 fase 1 registre los faltantes al cerrar (`close_manifest`), la cifra queda escrita en el cierre y `TodayClosuresPanel` sólo tiene que leerla.

**Depende de la decisión del enum en spec-80** (`faltante_en_origen` vs `extraviado` vs sólo `discrepancy_notes`). Si se elige la tercera, la merma no es consultable como estado y esta parte no se puede hacer sin una consulta por manifiesto.

---

## Fases

| Fase | Qué entrega | Depende de |
|---|---|---|
| **1 — Merma en cierres** | «2 faltantes de 44» | spec-80 fase 1 + decisión del enum |
| **2 — Ventana de retiro** | Columna VENTANA y semáforo de cierre | decisión (a)/(b)/(c) |
| **3 — Ocupación** | El porcentaje, o su omisión razonada | spec-73 |
| **4 — Diff visual del resto** | Lo que difiera entre `1l` y `5a` sin datos nuevos | — |

### Fase 1 — Merma `[blocked]`

**Archivos:** migración (`get_completed_manifests`), `components/pickup/TodayClosuresPanel.tsx`, tests

Al reescribir el RPC con `CREATE OR REPLACE`, **usar como plantilla la definición de la migración más reciente**, nunca la original (regla de `CLAUDE.md`). La última es `20260428000001_sort_manifests_by_created_at.sql` salvo que algo posterior la haya tocado — comprobar antes de escribir.

- [ ] Test pgTAP del RPC con un manifiesto cerrado con faltantes y otro limpio.
- [ ] Test del panel: paleta warning sólo cuando hay merma.
- [ ] Implementar.

### Fase 2 — Ventana `[blocked]`

- [ ] Migración del modelo elegido + test de aislamiento por operador.
- [ ] `get_pending_manifests` devuelve la ventana.
- [ ] Columna y semáforo; resolver el conflicto del borde izquierdo (progreso vs proximidad) **explícitamente**, no por accidente.

### Fase 3 — Ocupación `[pending]`

- [ ] Leer spec-73 y decidir: mismo proxy, o omisión razonada escrita en este spec.
- [ ] Si se implementa: capacidad en `vehicles` primero, que es la mitad barata y ya se muestra en el mock.

### Fase 4 — Diff visual `[pending]`

- [ ] Screenshot diff `1l` contra `5a`. Se espera poco: `5a` es el mismo diseño con los datos que faltaban.
- [ ] **Conservar la séptima columna** (impresión de etiquetas, spec-53). El mock no la tiene y spec-54 la añadió a propósito: quitarla sería una regresión funcional disfrazada de fidelidad al diseño.

---

## Riesgos

- **Este spec puede cerrarse casi entero como «no se hace».** Es un resultado legítimo: spec-54 ya decidió una vez que estos datos no se inventan. Lo que no es legítimo es implementarlos con datos adivinados para que la pantalla se parezca al mock.
- **Divergencia con Despacho en capacidad.** Dos módulos calculando ocupación con proxies distintos es peor que uno solo sin ocupación.
- **El borde izquierdo ya significa algo.** Cambiarlo en silencio rompe una señal que la cuadrilla ya lee.
