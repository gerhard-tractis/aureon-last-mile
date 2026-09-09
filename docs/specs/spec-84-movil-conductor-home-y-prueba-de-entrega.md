# Spec-84: Móvil del conductor — home del operario y prueba de entrega

> **Related:** [spec-54](spec-54-ui-rebrand.md) (**de donde vienen estas dos pantallas; se cerró moviéndolas aquí**), [spec-68](spec-68-distribution-mobile.md) (móvil de distribución, ya entregado), [spec-62](spec-62-reception-mobile.md) (móvil de andén), [spec-43](spec-43-failed-delivery-return-flow.md) (entrega fallida y retorno), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) (precedente inmediato: fotos como respaldo, con almacenamiento resuelto)

**Status:** closed — fase 1 entregada; fases 2, 3 y 4 `[parked]`: Reparto no es
nuestro. Decisión del usuario (2026-09-09): «Con respecto a Reparto, déjalo,
todo reparto usará la app DispatchTrack por parte del tenant. Ese webhook ya le
pega a nuestra base de datos y actualiza estados de pedidos.» Y sobre la
prueba de entrega: «La prueba de entrega la genera DispatchTrack y la envía vía
webhook a nuestra DB.» Lo que faltaba de este spec no se construye aquí: la
pantalla de home del operario (`1g`) y la parada/prueba de entrega (`1j`) son
pantallas de un módulo de Reparto que el tenant opera con DispatchTrack, no con
esta plataforma. Ver fases 2/3/4.
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

**Corrección (2026-09-08), superada a su vez el 2026-09-09:** este párrafo
decía «este spec no está listo para implementarse» sobre las cuatro fases en
bloque, y luego se corrigió a «fase 1 y fase 3 sí se pueden construir, fase 2 y
4 faltan de diseño». **Ninguna de las dos lecturas es la vigente.** El usuario
decidió (2026-09-09) que Reparto entero lo opera el tenant con DispatchTrack:
no hay pantalla que construir, con o sin diseño. Fase 1 sigue `[done]` — no
tiene nada que ver con Reparto, es infraestructura de `drivers.user_id` que
otros módulos también pueden usar. Fases 2, 3 y 4 quedan `[parked]` con la
razón, no `[blocked]` esperando un mock o un módulo. Léase la sección de
bloqueos y las fases.

## Las dos pantallas

| Mock | Pantalla | Por qué no se construyen |
|---|---|---|
| `1g` | Móvil — home del operario («Hola, Cristian… TU TAREA AHORA») | **Decisión del usuario (2026-09-09):** Reparto no es nuestro — lo opera el tenant con DispatchTrack. No se construye una home de operario para un módulo que no vamos a tener. |
| `1j` | Móvil — parada y prueba de entrega (parada 19 de 24, promesa 11:00) | **Decisión del usuario (2026-09-09):** misma razón — la parada y la prueba de entrega las genera DispatchTrack, no esta plataforma. |

Son pantallas de **reparto**, no de recogida. `1j` es una parada de una ruta de entrega; `1g` es la pantalla de entrada del operario, transversal a los módulos. Por eso no cabían en spec-80–83, que son Recogida — y por la misma razón de módulo, tampoco caben aquí: el usuario decidió que Reparto entero lo cubre DispatchTrack, con su webhook ya escribiendo en nuestra base y actualizando estados de pedidos.

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

**Corrección (2026-09-09) — esta sección quedó superada por la decisión del usuario, se deja como historia.** ~~Lo que cambió desde que spec-54 declaró este bloqueo: spec-80 resuelve el mismo problema para el manifiesto firmado, con bucket privado ya existente y tabla `manifest_documents`, diseñada íntegra en spec-80 fase 3 (`spec-80-recogida-movil-cierre-de-carga.md:439-455`), que está `[pending]`, no `[blocked]`. Cuando se abra este spec, copiar ese patrón en vez de inventar otro — dos módulos guardando pruebas de formas distintas es exactamente la divergencia que spec-83 señala para la capacidad de vehículo. Esto ya no es una decisión de producto pendiente: es una dependencia de orden.~~ El usuario decidió (2026-09-09) que la prueba de entrega la genera DispatchTrack y llega por webhook — no se construye ningún almacenamiento propio, y por tanto no hay patrón de `manifest_documents` que copiar aquí. Ver fase 3.

### 3. No hay diseño en la convención nueva

Ver arriba. Reparto móvil no tiene ronda propia.

---

## Fases

| Fase | Qué entrega | Estado |
|---|---|---|
| **1 — `drivers.user_id` usable** | El índice único, el poblado y la superficie de admin que faltan | `[done]` |
| **2 — `1g` home del operario** | — | `[parked]`: Reparto no es nuestro, ver decisión del usuario |
| **3 — Prueba de entrega multi-archivo** | — | `[parked]`: la genera DispatchTrack, ver decisión del usuario |
| **4 — `1j` parada y prueba de entrega** | — | `[parked]`: Reparto no es nuestro, ver decisión del usuario |

### Fase 1 — `drivers.user_id` usable `[done]`

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
      pgTAP en `spec84_fase1_drivers_user_id.test.sql` (9 tests) cubre
      unicidad UNIQUE-a-nivel-de-esquema (TEST 1), same-operator (TEST 2),
      cross-operator (TEST 3), soft-delete liberando el `user_id` (TEST 4), y
      RLS de `drivers_admin_write` — admin puede (TEST 6), pickup_crew no
      puede (TEST 7), `USING` bloquea re-parentar un driver existente a otro
      operador vía `UPDATE` (TEST 8), `WITH CHECK` bloquea `INSERT`ar un
      driver directamente en otro operador (TEST 9). **Corrido de verdad
      contra `spec52-pg`** (rondas 2 y 3 de review; Docker había estado caído
      en la implementación original).
      Corrección de ronda 2: TESTs 6/7/8 apuntaban al driver `…0002`, el
      mismo id que TEST 2 espera que sea RECHAZADO por el índice — ese
      `INSERT` vive dentro de un `BEGIN/EXCEPTION` anidado (subtransacción
      que revierte), así que la fila nunca existía y esos tres tests no
      probaban nada (uno fallaba por la razón equivocada, uno pasaba
      vacuamente). Corregido con un quinto driver de fixture (`…0005`),
      ajeno a TESTs 2-4, más una aserción positiva en TEST 7 que exige el
      estado post-TEST-6 antes de aceptar el resultado.
      Corrección de ronda 3: TEST 8 se llamaba *"`WITH CHECK` stops
      re-parenting"*, pero un `UPDATE` cross-operador lo bloquea `USING`
      (la fila deja de ser visible para la sesión del admin en cuanto
      pertenece a otro operador), no `WITH CHECK` — verificado mutando la
      policy dos formas: `USING` scoped + `WITH CHECK (true)` sigue
      bloqueando (42501); `USING (true)` + `WITH CHECK (true)` deja pasar el
      mismo `UPDATE`. La cláusula `operator_id` de `WITH CHECK` sí es
      portante, pero para `INSERT` — donde no hay fila vieja y `USING` nunca
      se evalúa. TEST 8 renombrado a lo que de verdad prueba (`USING`);
      TEST 9 añadido para probar `WITH CHECK` directamente vía `INSERT`
      cross-tenant. Mutación de TEST 9 (vaciar la cláusula `operator_id` del
      `WITH CHECK`, dejando sólo el rol) confirmada: **levanta**
      (`TEST 9 FAILED: admin A INSERTed a driver directly into operator B`);
      revertida y vuelto a correr limpio antes de dejar el contenedor
      compartido como se encontró. Salida cruda del fichero completo (cero
      líneas `ERROR:`, los 9 `DO` completan, `ROLLBACK` limpio):
      ```
      BEGIN
      INSERT 0 2
      INSERT 0 4
      INSERT 0 1
      DO
      DO
      DO
      DO
      DO
      DO
      RESET
      DO
      RESET
      DO
      RESET
      DO
      RESET
      {}
      ROLLBACK
      ```
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
   usable, pero hoy no la usa nada en producción. **Matiz (ronda 2 review):**
   "cero consumidores" es cierto para lectores/escritores en código, pero no
   es una tabla aislada — cinco tablas más del agent suite tienen FK a ella
   (`assignments`, `conversations`, `driver_availabilities`, `exceptions`,
   `settlement_periods`), igual de dormidas, formando un clúster mayor del
   que sugiere el texto original. Relevante para dimensionar cuánto trae
   consigo activar `drivers` de verdad (fase 2 en adelante), no para el
   alcance de esta fase.
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

**Seguimiento post-review (ronda 2, sin resolver aquí):**

- **M-1 — el guard h5c de la migración degrada en silencio.** Si el pre-check
  `COUNT(*) ... HAVING > 1` encuentra conflictos, la migración termina en
  verde (sólo emite `RAISE NOTICE` y sigue) y `scripts/verify-prod-migrations.sh`
  no lo detecta — ese script sólo compara el ledger de versiones aplicadas
  contra el repo (`spec-51`), nunca el contenido real de un objeto. Es
  literalmente la configuración que dejó `routes_one_vehicle_per_day`
  inexistente en producción durante días tras `20260911000002`. Acción
  pendiente: quien despliegue esta migración a producción debe correr, después
  del deploy, y confirmar `t`:
  ```sql
  SELECT ix.indisunique FROM pg_index ix JOIN pg_class c ON c.oid = ix.indexrelid
   WHERE c.relname = 'idx_drivers_user_id';
  ```
  Atenuante real: `drivers.user_id` está 100% `NULL` y sin escritores hoy (ver
  inventario arriba), así que la rama de conflicto es hoy inalcanzable — pero
  eso es argumento para **borrar el pre-check** (ya no hace falta) en vez de
  dejarlo sin verificar indefinidamente. No se decide aquí cuál de las dos;
  fase 2 (o quien despliegue primero a producción) debe elegir.
- **M-2 — la unicidad global tiene un callejón sin salida de soporte.**
  Nada impide hoy que un `drivers` de operador B tenga el `user_id` de un
  usuario de operador A (no hay FK compuesta ni CHECK que lo impida — el
  propio TEST 4 del pgTAP lo hace a propósito para probar la liberación por
  soft-delete). Combinado con la unicidad global: un admin de A intenta
  vincular a su usuario X, un `drivers` de B ya lo tiene, el `PATCH` pasa el
  chequeo de `targetUser` (que sólo mira el operador del *driver* que se está
  editando) y revienta con `23505` — el admin ve «ya está vinculado a otro
  driver» sobre un driver que no puede ver, buscar ni desvincular. Probabilidad
  hoy baja (cero escritores), pero nadie lo cierra. Pendiente: un trigger que
  valide `NEW.user_id`'s `users.operator_id` = `NEW.operator_id` antes de
  aceptar el UPDATE/INSERT, o al menos documentar el camino de soporte para
  ese 23505.
- **M-3 — `drivers_admin_write` es `FOR ALL`, no sólo `UPDATE`.** Un
  admin/operations_manager puede hoy hacer `DELETE` duro de `drivers` vía
  PostgREST — choca con el no-negociable de soft deletes del repo, y esta
  fase sólo necesitaba `UPDATE` para vincular `user_id`. Hay precedente
  (`pickup_points_admin_write` también es `FOR ALL`), así que no es una
  invención de esta fase, pero es superficie que nadie pidió. Pendiente:
  reducir a `FOR SELECT, UPDATE` si nadie necesita que un admin cree/borre
  `drivers` desde esta policy.
- **M-4 — `/admin/drivers` no es alcanzable desde ninguna parte de la UI.**
  Cero enlaces hacia ella hoy. Deuda preexistente — `/admin/users` y
  `/admin/audit-logs` están en la misma situación — pero una "superficie de
  admin" que sólo se llega tecleando la URL no cumple del todo el criterio de
  la fase. Pendiente: añadir un enlace desde `AdminPage`/`/admin`.

> Implementado por: `feat/spec-84-fase-1-drivers-user-id`, PR #698 (mergeado
> 2026-09-09, squash). Migración `20260917000001` — índice único parcial
> **global** sobre `drivers.user_id`, no por `(operator_id, user_id)` como
> sugería el checklist: `users.operator_id` es `NOT NULL` y `users.id` es PK
> con FK a `auth.users`, así que un `auth.uid()` no puede tener dos
> operadores; y aunque `unique_email_per_operator` permite el mismo string de
> email en dos tenants, GoTrue keyea email único globalmente, o sea que hacen
> falta dos logins reales. El checklist era el que estaba mal.
> Review: tres rondas. Ronda 1 — dos bloqueantes: el pgTAP no ejecutaba tres
> de sus ocho tests (TESTs 6/7/8 apuntaban a una fila creada dentro de un
> `BEGIN/EXCEPTION` que revierte, así que nunca existía; uno fallaba, tres no
> corrían, uno pasaba vacuamente) y la mutación que expulsa a
> `operations_manager` **sobrevivía en las dos rutas de API** con CI verde —
> un jefe de operaciones habría visto la pantalla y recibido 403 de la API.
> Ronda 2 — cerradas ambas, verificadas por el revisor mutando la policy
> contra el fichero de test. Ronda 3 — TEST 8 decía cubrir `WITH CHECK` y
> ejercitaba `USING`: al re-parentar por `UPDATE` bloquea `USING`, así que
> vaciar la cláusula `operator_id` del `WITH CHECK` sobrevivía. Esa cláusula
> es portante para el `INSERT`, donde no hay fila vieja — sin ella, un admin
> del operador A puede insertar un driver dentro del operador B (`INSERT 0 1`
> medido). Añadido TEST 9 y renombrado TEST 8.
> Review: además, hallazgo colateral que llevaba desde marzo sin nombrarse —
> `20260318000005:99-105` daba `GRANT UPDATE ... TO authenticated` sobre
> `drivers` mientras la única policy era `FOR SELECT`, así que bajo RLS toda
> escritura estaba denegada. La policy `drivers_admin_write` que añade esta
> fase es lo que convierte ese grant en efectivo.
> QA: pgTAP ejecutado contra `spec52-pg` — 9 bloques `DO`, cero líneas
> `ERROR:`, `ROLLBACK` limpio. El estilo de la casa (`RAISE EXCEPTION`, sin
> salida TAP) hace que «cero ERROR» sea indistinguible de «no assertó nada»,
> así que se mutation-testeó el producto contra el test: `DROP POLICY` mata
> TEST 6; añadir `pickup_crew` a los roles mata TEST 7; estrechar el
> `WITH CHECK` a sólo-rol mata TEST 9. Frontend 28/28 con `--pool=forks`, con
> la mutación del gate de rol muerta en `route.test.ts` y en
> `[id]/route.test.ts`. CI verde en `426de43`.
> Downstream: los cuatro seguimientos (M-1 a M-4) quedan escritos en esta
> misma sección sin resolver, con acción nombrada. El poblado de
> `drivers.user_id` es vía acción de admin, no backfill: la columna está 100%
> `NULL` y sin escritores, y no existe heurística segura para casar
> conductores con logins — la misma ambigüedad ya documentada para
> `driver_name` en spec-72.

### Fase 2 — `1g` home del operario `[parked]`

**Decisión del usuario (2026-09-09), textual:** «Con respecto a Reparto,
déjalo, todo reparto usará la app DispatchTrack por parte del tenant. Ese
webhook ya le pega a nuestra base de datos y actualiza estados de pedidos.»

No se aparca por falta de mock ni porque el módulo esté "sin construir todavía"
— eso subestimaría lo que pasó. **Reparto no es nuestro.** El tenant opera
reparto con la app DispatchTrack, y su webhook ya escribe en nuestra base y
actualiza estados de pedidos — es la prueba de que el camino alternativo está
vivo, no un plan a futuro. No hay razón para construir una home de operario de
reparto en esta plataforma.

### Fase 3 — Prueba de entrega multi-archivo `[parked]`

**Decisión del usuario (2026-09-09), textual:** «La prueba de entrega la
genera DispatchTrack y la envía vía webhook a nuestra DB.»

No la construimos porque **no la generamos nosotros**: llega desde
DispatchTrack por el mismo webhook que ya actualiza estados de pedidos. Ya no
depende de spec-80 fase 3 — no depende de nada, está aparcada.

**Distinción importante, porque los nombres se parecen y confundirlos es
caro:**

- **Prueba de entrega (reparto)** — foto/firma de que el cliente final recibió
  el pedido. La genera **DispatchTrack**, llega por webhook. **No es nuestra.**
- **Documentos del manifiesto de recogida** (`manifest_documents`, spec-80 fase
  3) — fotos del manifiesto **firmado en el punto de retiro**, al cerrar una
  carga de Recogida. **Sí es nuestra**, está en construcción ahora mismo, y
  **no tiene nada que ver** con la prueba de entrega de reparto.

Esta fase decía originalmente que iba a "reusar el patrón de
`manifest_documents` (spec-80 fase 3)". Esa frase queda **superada**: ya no
construimos nada aquí, así que no hay patrón que reusar — se deja tachada, no
borrada, para que quede constancia de que la intención cambió y por qué.

~~**Archivos:** migración nueva en `packages/database/supabase/migrations/`
(tabla de documentos de prueba de entrega, patrón `manifest_documents`;
deprecar/eliminar `assignments.pod_photo_url` en la misma migración), test
pgTAP en `packages/database/supabase/tests/`~~

~~- [ ] Reusar el patrón de `manifest_documents` (spec-80 fase 3), no inventar
      uno nuevo.~~
~~- [ ] `assignments.pod_photo_url` no tiene datos vivos que migrar (0
      lecturas, 0 escrituras) — dejarla sin usar o eliminarla en la misma
      migración, no hace falta decisión de convivencia.~~

**Nota fuera de alcance, sin abrir línea nueva:** en el repo existen
`assignments.pod_photo_url` y `assignments.signature_url` sin ningún escritor
en código, y la integración con DispatchTrack vive en n8n ("Paris
DispatchTrack Webhook Receiver"), fuera de este repo. Si esas columnas
persisten lo que el webhook envía, o si el webhook escribe en otro lado, lo
verifica el usuario por su cuenta — no es investigación de este spec.

### Fase 4 — `1j` parada y prueba de entrega `[parked]`

**Decisión del usuario (2026-09-09):** misma que fase 2 y 3 — Reparto no es
nuestro, lo opera el tenant con DispatchTrack.

No se aparca por falta de diseño nuevo, aunque la nota de abajo (verificada
antes de esta decisión) sigue siendo cierta como contexto: no existe el módulo
de reparto en este repo — `ls apps/frontend/src/app/app/` da `dispatch`,
`distribution`, `pickup`, `reception`, `orders`… no hay `delivery`;
`delivery_attempts` sólo aparece en `apps/frontend/src/lib/types.ts:1348` como
tipo generado sin consumidor. Esa ausencia ya no es una pregunta de roadmap
abierta — el roadmap la contestó: reparto lo cubre DispatchTrack, no esta
plataforma.

---

## Riesgos

- **Reabrir `1g` (fase 2), la prueba de entrega (fase 3) o `1j` (fase 4) creyendo que era deuda técnica.** No lo es: el usuario decidió (2026-09-09) que Reparto lo opera el tenant con DispatchTrack, no esta plataforma. Reabrirlas exigiría primero deshacer esa decisión, no "por fin encontrar tiempo".
