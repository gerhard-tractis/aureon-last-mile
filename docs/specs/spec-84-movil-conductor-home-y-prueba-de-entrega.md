# Spec-84: Móvil del conductor — home del operario y prueba de entrega

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**de donde vienen estas dos pantallas; se cerró moviéndolas aquí**), [spec-68](spec-68-distribution-mobile.md) (móvil de distribución, ya entregado), [spec-62](spec-62-reception-mobile.md) (móvil de andén), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (precedente inmediato: fotos como respaldo, con almacenamiento resuelto)

**Status:** backlog
**Bloqueado por:** dos datos que no existen (abajo) y un rediseño que no se ha hecho. Ninguna fase la puede tomar un agente hasta que el usuario decida.
**Verify:** unit, e2e-qa

_Date: 2026-09-07_

---

## Goal

Dar un hogar a las dos únicas pantallas que quedaron abiertas de spec-54, para poder cerrar aquel spec sin fingir que están hechas ni fingir que se descartaron.

**Este spec no está listo para implementarse.** Existe para que el trabajo sea visible y esté nombrado, no para que alguien lo tome mañana. Léase la sección de bloqueos antes que nada.

## Las dos pantallas

| Mock | Pantalla | Por qué se quedó fuera |
|---|---|---|
| `1g` | Móvil — home del operario («Hola, Cristian… TU TAREA AHORA») | No hay vínculo usuario ↔ conductor |
| `1j` | Móvil — parada y prueba de entrega (parada 19 de 24, promesa 11:00) | No hay dónde guardar la prueba |

Son pantallas de **reparto**, no de recogida. `1j` es una parada de una ruta de entrega; `1g` es la pantalla de entrada del operario, transversal a los módulos. Por eso no cabían en spec-80–83, que son Recogida.

## La numeración es vieja, y eso importa

`1g` y `1j` pertenecen a la numeración plana `1a`–`1l` del **handoff original** (`design_handoff_aureon_rebrand/Aureon Rebrand.dc.html`). Esa numeración está muerta: las rondas posteriores renumeran **por módulo**.

| Módulo | Archivo | Numeración |
|---|---|---|
| Torre de control, Pedidos, Recepción | `Aureon Rebrand.dc.html` | turnos 1–3, `3r`/`3s`… |
| Despacho | `Despacho.dc.html` | turnos `D`/`D2`/`M`/`T` |
| Recogida | `Recogida.dc.html` | turno `R`, `5a`–`5i` |

La misma pantalla puede tener dos números: el escaneo de recogida es `1h` en el handoff y `5d` en la ronda nueva. **Al citar un mock, usar siempre la numeración del archivo por módulo.** `1g` y `1j` se citan con la vieja aquí porque es la única que existe para ellas — **no se ha hecho una ronda nueva de reparto móvil**.

Esa es la tercera razón por la que este spec no se puede tomar: construir `1j` hoy es construir contra un mock superado por convención, sin su reemplazo dibujado.

---

## Bloqueos

### 1. `1g` — falta el vínculo usuario ↔ conductor

La home saluda al operario y le muestra «tu tarea ahora». Para eso hay que saber qué conductor es el usuario que inició sesión.

`public.users` y `public.drivers` son tablas distintas y **nada las liga**. Varias tablas apuntan a `users` donde conceptualmente quieren un conductor (`pickup_routes.driver_id`, `dock_scans.scanned_by`), y otras apuntan a `drivers`. Sin el vínculo, la home no puede resolver «tu ruta».

**Decisión de producto pendiente:** ¿un `users.driver_id` opcional, un `drivers.user_id`, o se fusionan los conceptos? Afecta a RLS y a cada consulta que hoy elige una de las dos tablas.

### 2. `1j` — falta dónde guardar la prueba de entrega

La pantalla captura la prueba: foto, firma, o ambas.

`assignments.pod_photo_url` existe — una sola columna, una sola URL, y nada que diga en qué bucket vive ni que soporte varias tomas.

**Lo que cambió desde que spec-54 declaró este bloqueo:** spec-80 resuelve el mismo problema para el manifiesto firmado, con bucket privado ya existente y tabla `manifest_documents`. **Cuando se abra este spec, copiar ese patrón en vez de inventar otro** — dos módulos guardando pruebas de formas distintas es exactamente la divergencia que spec-83 señala para la capacidad de vehículo.

### 3. No hay diseño en la convención nueva

Ver arriba. Reparto móvil no tiene ronda propia.

---

## Fases

| Fase | Qué entrega | Bloqueada por |
|---|---|---|
| **1 — Vínculo usuario ↔ conductor** | La home puede resolver «tu ruta» | decisión de modelo |
| **2 — `1g` home del operario** | Pantalla de entrada del operario | fase 1 + rediseño |
| **3 — Prueba de entrega multi-archivo** | Dónde y cómo se guarda la prueba | patrón de spec-80 + decisión |
| **4 — `1j` parada y prueba de entrega** | La parada | fase 3 + rediseño |

### Fase 1 — Vínculo usuario ↔ conductor `[blocked]`

- [ ] Decidir el modelo con el usuario. No empezar por la migración.
- [ ] Migración + test pgTAP de aislamiento por operador.
- [ ] Revisar cada consulta que hoy elige entre `users` y `drivers`.

### Fase 2 — `1g` home del operario `[blocked]`

- [ ] Requiere una ronda de diseño en la convención por módulo. Sin ella, no se construye.

### Fase 3 — Prueba de entrega multi-archivo `[blocked]`

- [ ] Reusar el patrón de `manifest_documents` (spec-80 fase 3), no inventar uno nuevo.
- [ ] Decidir qué pasa con `assignments.pod_photo_url`: se migra o convive.

### Fase 4 — `1j` parada y prueba de entrega `[blocked]`

- [ ] Igual que la fase 2: necesita diseño nuevo antes que código.

---

## Riesgos

- **Tomar este spec porque «sólo son dos pantallas».** Las dos están bloqueadas por datos que no existen, y su diseño está superado por convención. Es el spec menos listo del repo, a propósito.
- **Divergir de spec-80 en el almacenamiento de pruebas.** Si este spec se abre antes de que spec-80 fase 3 aterrice, se inventará otro esquema. Esperar.
