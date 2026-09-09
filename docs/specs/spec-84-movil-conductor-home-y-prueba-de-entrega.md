# Spec-84: Móvil del conductor — home del operario y prueba de entrega

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**de donde vienen estas dos pantallas; se cerró moviéndolas aquí**), [spec-68](spec-68-distribution-mobile.md) (móvil de distribución, ya entregado), [spec-62](spec-62-reception-mobile.md) (móvil de andén), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (precedente inmediato: fotos como respaldo, con almacenamiento resuelto)

**Status:** in progress
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

### Fase 1 — `drivers.user_id` usable `[in_progress]`

> **Corrección (2026-09-08):** esta fase estaba `[blocked]` por una decisión de
> modelo que resulta que ya tomó el esquema hace cinco meses
> (`20260318000004_agent_suite_tables.sql:253-254`, `drivers.user_id`). Pasa a
> `[pending]`. El alcance real es hacer usable esa columna, no elegirla.

**Archivos:** migración nueva en `packages/database/supabase/migrations/` (índice único parcial sobre `drivers.user_id`), test pgTAP en `packages/database/supabase/tests/`, `packages/database/supabase/seed-qa.sql`, `apps/frontend/src/app/admin/drivers/page.tsx` (nuevo)

- [x] Índice único parcial sobre `drivers.user_id` — implementado en
      `20260917000001_spec84_fase1_drivers_user_id_usable.sql` como **global**
      (`UNIQUE (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL`),
      no por `(operator_id, user_id)` como sugería este checklist — el
      comentario de esa migración argumenta por qué (`public.users.operator_id`
      es `NOT NULL`, así que `user_id` ya trae un tenant consigo; permitir el
      mismo `user_id` en dos operadores sólo reintroduciría la ambigüedad que
      la fase existe para cerrar). Sigue el patrón h5c
      (`20260911000002_spec79_h5c_vehicle_per_day_index.sql`) — un pre-check
      `COUNT(*) ... HAVING > 1` decide si crea el índice o avisa por `NOTICE`
      y sigue, en vez de reventar el deploy con un `unique_violation` crudo
      (`scripts/check-migration-safety.mjs` marcó la primera versión sin este
      guard como advertencia en CI; corregido antes de mergear). No hace falta
      backfill: la columna está 100% `NULL` hoy (nadie la escribe todavía),
      así que el guard es defensivo, no una corrección de datos reales. Test
      pgTAP en `spec84_fase1_drivers_user_id.test.sql` cubre same-operator
      (TEST 2), cross-operator (TEST 3) y soft-delete liberando el `user_id`
      (TEST 4). **No ejecutado** — Docker Desktop estaba caído (500 en todo
      comando) durante esta implementación; `scripts/pgtap-local.sh` no pudo
      construir/aplicar/correr nada. Pendiente de correr antes de confiar en
      este archivo.
- [x] `drivers.user_id` se puebla vía admin, no por backfill masivo — decisión
      documentada en el comentario de la migración y en
      `infra/supabase-qa/create-qa-users.sh`: no hay heurística de
      teléfono/RUT/nombre segura para emparejar automáticamente conductores
      con cuentas de usuario (el mismo tipo de ambigüedad que
      `20260903000006_spec72_phase4_territory_history.sql:24-29` ya documenta
      para `driver_name`), y la tabla no tiene ningún lector/escritor vivo
      hoy, así que no hay urgencia que justifique adivinar. Para QA, el
      vínculo se crea en `create-qa-users.sh` (después de que existan
      `public.users`, ya que `seed-qa.sql` corre antes) — un conductor
      (`QA Driver Uno`) vinculado a `qa-pickup-crew@qa.test`, el otro
      (`QA Driver Dos`) deliberadamente sin vincular, para que la superficie
      de admin siempre tenga ambos estados que ejercitar.
- [x] Superficie de admin mínima en `/admin/drivers`
      (`apps/frontend/src/app/admin/drivers/page.tsx` +
      `components/admin/DriverManagementPage.tsx` +
      `hooks/useDrivers.ts` + `lib/api/drivers.ts` +
      `app/api/admin/drivers/[route.ts, [id]/route.ts]`), gateada a
      `admin`/`operations_manager` (mismo criterio que `/api/users` y
      `/api/pickup-points`; no incluye `super_admin` — ver comentario en
      `route.ts` para el porqué).
- [x] Inventario de "quién es este conductor" (`users` vs `drivers`) — ver
      abajo.

**Inventario: "quién es este conductor" hoy tiene TRES respuestas distintas, no una.**

1. **`public.drivers`** (agent suite, `20260318000004`) — el modelo "completo":
   `pay_config`, `score`, WhatsApp, y ahora `user_id`. **Cero lectores y cero
   escritores vivos en `apps/frontend` o en SQL** (`git grep "from('drivers')"`
   sólo encuentra `apps/agents/src/dev/test-orders.ts`, un script de
   desarrollo; `git grep "FROM public.drivers\|JOIN public.drivers"` sobre
   todas las migraciones no encuentra nada). Es la tabla que esta fase hace
   usable, pero hoy no la usa nada en producción.
2. **`pickup_routes.driver_id`** (`20260625000001_spec47_...:32`) —
   `UUID NOT NULL REFERENCES public.users(id)`, **no** a `drivers`. El
   conductor de una ruta de Recogida es literalmente un login de la
   plataforma (rol `pickup_crew`/`pickup_leader`), comparado directo contra
   `auth.uid()` en frontend
   (`apps/frontend/src/app/app/pickup/route/active/page.tsx:278`:
   `route.driver_id === userId`). Este es el único de los tres que ya
   resuelve "soy yo" de punta a punta hoy.
3. **`routes.driver_name` / `fleet_vehicles.driver_name`**
   (`20260306000001_add_routes_dispatches_fleet_tables.sql:62,84`) — texto
   libre `VARCHAR(255)` poblado desde el webhook de DispatchTrack
   (`truck_driver`), sin FK a nada. Es cómo Reparto/Distribución identifica
   "quién manejó esta ruta" — un tercer vocabulario, sin login ni fila propia.

Ninguna consulta elige *entre* `users` y `drivers` hoy — cada módulo ya decidió
por su cuenta y nunca se cruzan. `drivers.user_id` (ahora usable) es la
**cuarta** pieza, todavía sin consumidor: la fase 2 (`1g`, home del operario,
bloqueada por diseño) sería la primera en leerla. No se toca aquí qué hace
`pickup_routes.driver_id` apuntar a `users` en vez de `drivers` — es una
inconsistencia real, pero resolverla es una decisión de producto (¿migrar
Recogida a `drivers`? ¿dejar que cada módulo tenga su propio conductor?) fuera
del alcance de esta fase, que sólo tenía que dejar `drivers.user_id` usable.

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
