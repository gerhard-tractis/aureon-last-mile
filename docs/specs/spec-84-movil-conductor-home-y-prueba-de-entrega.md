# Spec-84: Móvil del conductor — home del operario y prueba de entrega

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**de donde vienen estas dos pantallas; se cerró moviéndolas aquí**), [spec-68](spec-68-distribution-mobile.md) (móvil de distribución, ya entregado), [spec-62](spec-62-reception-mobile.md) (móvil de andén), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (precedente inmediato: fotos como respaldo, con almacenamiento resuelto)

**Status:** backlog
**Bloqueado por:** un rediseño que no se ha hecho (fase 2, fase 4) y, para `1j`, un módulo de Reparto que no existe todavía (fase 4). Fase 1 y fase 3 sí las puede tomar un agente — ver *Corrección (2026-09-08)*.
**Verify:** unit, e2e-qa

_Date: 2026-09-07_

> **Corrección (2026-09-08).** Este spec afirmaba en dos sitios que no existía
> vínculo entre `public.users` y `public.drivers`. Es falso desde el
> **2026-03-18**: `20260318000004_agent_suite_tables.sql:253-254` declara
> `drivers.user_id UUID REFERENCES public.users(id) ON DELETE SET NULL`, con
> índice parcial en `:278` (`CREATE INDEX ... WHERE user_id IS NOT NULL`). Cinco
> meses antes de que este spec se escribiera. La decisión de modelo que la
> sección 1 de *Bloqueos* pedía como pendiente **ya la tomó el esquema**: es
> `drivers.user_id`, no `users.driver_id` ni una fusión de tablas. Ver la fase 1
> reescrita más abajo — desbloqueada, con lo que de verdad falta (no es el
> vínculo: es que el índice no es único, que nadie lo puebla, y que no hay
> superficie de admin).
>
> Fase 3 también estaba bloqueada por una lectura incorrecta de su dependencia
> (ver esa fase, más abajo): no es un bloqueo de producto, es orden — depende de
> que aterrice spec-80 fase 3, que está `[pending]`.

---

## Goal

Dar un hogar a las dos únicas pantallas que quedaron abiertas de spec-54, para poder cerrar aquel spec sin fingir que están hechas ni fingir que se descartaron.

**Corrección (2026-09-08):** este párrafo decía «este spec no está listo para implementarse» sobre las cuatro fases en bloque. Ya no es cierto: fase 1 (`drivers.user_id` usable) y fase 3 (almacenamiento de prueba de entrega) están `[pending]` — el dato que faltaba resultó existir en ambos casos. Lo que sigue sin estar listo son las dos *pantallas* (fase 2 y fase 4), porque ninguna tiene diseño en la convención por módulo, y `1j` además es la punta de un módulo de Reparto que no existe. Léase la sección de bloqueos.

## Las dos pantallas

| Mock | Pantalla | Por qué se quedó fuera |
|---|---|---|
| `1g` | Móvil — home del operario («Hola, Cristian… TU TAREA AHORA») | Falta diseño en la convención por módulo (el vínculo usuario↔conductor ya existe, ver fase 1) |
| `1j` | Móvil — parada y prueba de entrega (parada 19 de 24, promesa 11:00) | No existe el módulo de Reparto (el almacenamiento de la prueba ya tiene patrón, ver fase 3) |

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

### 1. `1g` — el vínculo existe; lo que falta es que sea usable (corregido 2026-09-08)

**Esto decía que `public.users` y `public.drivers` «son tablas distintas y nada las liga», y que hacía falta decidir entre `users.driver_id`, `drivers.user_id` o fusionar. Era falso.** `drivers.user_id UUID REFERENCES public.users(id) ON DELETE SET NULL` existe desde `20260318000004_agent_suite_tables.sql:253-254`, con índice parcial en `:278`. La decisión de modelo ya está tomada por el esquema, y lleva cinco meses tomada.

Lo que de verdad impide que la home resuelva «tu ruta» hoy no es la ausencia del vínculo, son tres huecos reales:

- **El índice no es único.** `:278` es `CREATE INDEX ... WHERE user_id IS NOT NULL`, sin `UNIQUE`. Hoy nada impide que dos filas de `drivers` apunten al mismo `user_id` — un `SELECT ... WHERE user_id = auth.uid()` podría devolver más de una fila. `20260903000006_spec72_phase4_territory_history.sql:24-29` ya documenta que este esquema no deduplica identidad de conductor por su cuenta («dos ortografías de la misma persona son dos conductores distintos» para `routes.driver_name`) — no es evidencia de un RUT mal tecleado específico, pero sí de que la ambigüedad de identidad de conductor ya es un problema conocido en este repo, y aquí sería peor: ambigua a nivel de fila, no de texto libre.
- **Nadie puebla la columna.** `seed-qa.sql:63-65` inserta los dos conductores de QA sin `user_id`. Hoy no hay ningún conductor de QA vinculado a un usuario.
- **No existe superficie de admin.** `apps/frontend/src/app/admin/` tiene `audit-logs`, `modules`, `tools` y `users` — no hay página de conductores desde donde vincular un `drivers.user_id`.

### 2. `1j` — falta dónde guardar la prueba de entrega

La pantalla captura la prueba: foto, firma, o ambas.

`assignments.pod_photo_url` existe — una sola columna, una sola URL, y nada que diga en qué bucket vive ni que soporte varias tomas. `git grep pod_photo_url` sobre todo el repo (2026-09-08) sólo la encuentra en `20260318000004_agent_suite_tables.sql:375` y su copia en `docs/architecture/agents-data-model.sql:598` — **cero lecturas y cero escrituras en código**. No hay nada vivo que migrar ni con lo que convivir.

**Lo que cambió desde que spec-54 declaró este bloqueo:** spec-80 resuelve el mismo problema para el manifiesto firmado, con bucket privado ya existente y tabla `manifest_documents`, diseñada íntegra en spec-80 fase 3 (`spec-80-recogida-movil-cierre-de-carga.md:439-455`), que está `[pending]`, no `[blocked]`. **Cuando se abra este spec, copiar ese patrón en vez de inventar otro** — dos módulos guardando pruebas de formas distintas es exactamente la divergencia que spec-83 señala para la capacidad de vehículo. Esto ya no es una decisión de producto pendiente: es una dependencia de orden. Ver fase 3 reescrita más abajo.

### 3. No hay diseño en la convención nueva

Ver arriba. Reparto móvil no tiene ronda propia.

---

## Fases

| Fase | Qué entrega | Bloqueada por |
|---|---|---|
| **1 — `drivers.user_id` usable** | El índice único, el poblado y la superficie de admin que faltan | — (esquema ya decidido; ver corrección 2026-09-08) |
| **2 — `1g` home del operario** | Pantalla de entrada del operario | fase 1 + rediseño |
| **3 — Prueba de entrega multi-archivo** | Dónde y cómo se guarda la prueba | spec-80 fase 3 (orden, no decisión humana) |
| **4 — `1j` parada y prueba de entrega** | La parada | fase 3 + rediseño |

### Fase 1 — `drivers.user_id` usable `[pending]`

> **Corrección (2026-09-08):** esta fase estaba `[blocked]` por una decisión de
> modelo que resulta que ya tomó el esquema hace cinco meses
> (`20260318000004_agent_suite_tables.sql:253-254`, `drivers.user_id`). Pasa a
> `[pending]`. El alcance real es hacer usable esa columna, no elegirla.

**Archivos:** migración nueva en `packages/database/supabase/migrations/` (índice único parcial sobre `drivers.user_id`), test pgTAP en `packages/database/supabase/tests/`, `packages/database/supabase/seed-qa.sql`, `apps/frontend/src/app/admin/drivers/page.tsx` (nuevo)

- [ ] Índice único parcial sobre `drivers.user_id` (reemplaza el `CREATE INDEX
      IF NOT EXISTS idx_drivers_user_id ... WHERE user_id IS NOT NULL` de
      `:278`, que no es único) + test pgTAP que compruebe que un segundo
      `drivers` con el mismo `user_id` y el mismo `operator_id` falla.
- [ ] Decidir y documentar cómo se puebla `drivers.user_id` para conductores
      existentes — `seed-qa.sql:63-65` no lo hace hoy para ninguno de los dos
      conductores de QA.
- [ ] Superficie de admin mínima para vincular un `drivers.user_id` — hoy
      `apps/frontend/src/app/admin/` no tiene página de conductores.
- [ ] Revisar cada consulta que hoy elige entre `users` y `drivers` para «quién
      es este conductor».

### Fase 2 — `1g` home del operario `[blocked]`

- [ ] Requiere una ronda de diseño en la convención por módulo. Sin ella, no se construye.

### Fase 3 — Prueba de entrega multi-archivo `[pending]`

> **Corrección (2026-09-08):** esta fase estaba `[blocked]` por «patrón de
> spec-80 + decisión». No hay decisión de producto pendiente:
> `assignments.pod_photo_url` no tiene ningún lector ni escritor en el repo
> (`git grep pod_photo_url` sólo la encuentra en la migración que la declara y
> su copia de arquitectura), así que no hay nada que migrar ni con qué
> convivir — no aplica lo que el bloqueo original pedía decidir. Lo único que
> queda es orden: depende de que aterrice spec-80 fase 3
> (`manifest_documents`, `[pending]`), no de una persona.

**Depende de:** spec-80 fase 3

**Archivos:** migración nueva en `packages/database/supabase/migrations/` (tabla de documentos de prueba de entrega, patrón `manifest_documents`; deprecar/eliminar `assignments.pod_photo_url` en la misma migración), test pgTAP en `packages/database/supabase/tests/`

- [ ] Reusar el patrón de `manifest_documents` (spec-80 fase 3), no inventar uno nuevo.
- [ ] `assignments.pod_photo_url` no tiene datos vivos que migrar (0 lecturas, 0 escrituras) — dejarla sin usar o eliminarla en la misma migración, no hace falta decisión de convivencia.

### Fase 4 — `1j` parada y prueba de entrega `[blocked]`

> **Nota (2026-09-08), verificada de nuevo, no relajada:** este bloqueo es real
> y el spec original lo subestimaba llamándolo «necesita diseño nuevo antes que
> código», como si sólo faltara un mock. No existe el módulo de reparto:
> `ls apps/frontend/src/app/app/` da `dispatch`, `distribution`, `pickup`,
> `reception`, `orders`… — no hay `delivery`. `delivery_attempts` sólo aparece
> en `apps/frontend/src/lib/types.ts:1348` como tipo generado sin consumidor
> (`git grep delivery_attempts` no encuentra ningún lector real), y
> `assignments` sólo la tocan scripts de desarrollo de `apps/agents/src/dev/`.
> No hay secuencia de paradas, ni ETA, ni resultado de entrega en ningún punto
> del código. Esto es la punta de un módulo que no existe y necesita decisión
> de roadmap — no un mock.

- [ ] No se construye sin decisión de roadmap sobre el módulo de Reparto. Un rediseño de `1j` solo, sin el módulo detrás, es una pantalla que no puede funcionar.

---

## Riesgos

- **Tomar `1g` (fase 2) o `1j` (fase 4) porque «sólo son dos pantallas».** Siguen bloqueadas — no por datos inexistentes (fase 1 y fase 3, corregidas 2026-09-08, sí se pueden construir), sino porque su diseño está superado por convención y, en el caso de `1j`, porque el módulo de Reparto entero no existe todavía.
- **Divergir de spec-80 en el almacenamiento de pruebas.** Si este spec se abre antes de que spec-80 fase 3 aterrice, se inventará otro esquema. Esperar.
