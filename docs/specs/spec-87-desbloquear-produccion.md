# Spec-87: Desbloquear producción — cuarentena del gate, inventario de migraciones y despliegue por lotes

> **Related:** [spec-57](spec-57-qa-gate-before-production.md) (hizo de QA la precondición de producción), [spec-56](spec-56-pickup-contract-phase.md) (**el precedente: un índice único que pasa CI y muere con datos de producción**), [spec-79](spec-79-dispatch-handoff-integrity.md) (dueña de 5 de las 12 migraciones pendientes, y de una de las dos entradas de cuarentena), [spec-78](spec-78-despacho-tablet-anden.md) (dueña de la otra entrada de cuarentena — ver `apps/frontend/e2e/quarantine.json`), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) y [spec-85](spec-85-discrepancias.md) (dueñas de las tres migraciones del 2026-09-13, sumadas al listado tras la corrección de fase 3 abajo)

**Status:** awaiting_user_test — fases 1, 2, 3 y 5 están `[done]`; fase 4 es la única que
queda, y está `[awaiting_user_test]`: el mecanismo de backfill por lotes está construido y
probado localmente (round 2 de review, PR #705), pero nadie lo ha disparado contra producción.
Sólo lo puede cerrar el usuario, disparando `prod-backfill-loaded-route-id.yml` (`dry_run`
primero) y aprobando `environment: production`. Corregido 2026-09-09: esta línea decía `in
progress`, que ya no era cierto — ningún agente tiene trabajo pendiente que tomar en este spec.
**Verify:** unit, sql, e2e-qa

_Date: 2026-09-07_

---

## Goal

Volver a poder desplegar a producción, sin convertir el primer despliegue en un big-bang de 61 commits contra una base de datos donde los backfills se caen por timeout.

## El estado real, medido

**Último despliegue exitoso a producción: `0482806`, 2026-09-02T21:39:51Z.** Cinco días. Ninguno de los últimos 100 runs de `deploy.yml` terminó en éxito.

Producción está detrás por **61 commits y, a la fecha de esta corrección (2026-09-08, run `34196179672` de `verify-prod-migrations`), 12 migraciones** — no 9. La cifra de 9 quedó vieja porque este spec se escribió antes de que aterrizaran las tres migraciones del 2026-09-13 (`close_manifest` de spec-80 y el esquema/RPCs de discrepancias de spec-85). El job sigue siendo la fuente: no hace falta ninguna credencial para leerlo, se lee del log del run.

```
Production is BEHIND the repo — these migrations exist in the repo
but are not applied to production:
  20260907000001  20260908000001  20260908000002
  20260909000001  20260910000001  20260911000001
  20260911000002  20260911000003  20260912000001
  20260913000001  20260913000002  20260913000003
```

**Ese job es la herramienta de inventario y no hace falta ninguna credencial para leerlo** — se lee del log del run. No hay que pedirle a nadie el acceso a producción para saber qué falta.

## Tres problemas distintos que se confunden en uno

**1. El gate no distingue «el test está mal» de «el producto está roto».**
`approve-production` exige `needs.e2e-qa.result == 'success'`, y `e2e-qa` lleva días en rojo. El run real `34167425466` muestra `2 failed, 18 passed` — no tres, como afirmaba una versión anterior de este párrafo — y los dos fallos son exactamente las dos entradas de `quarantine.json`: **`despacho-tablet-dock.spec.ts`** (carga `/app/dispatch/<id>` a 1024×768 **sin `?dock=1`**, afirma que renderiza el árbol de escritorio, y pulsa `«Asignar camión y conductor»`, que sólo existe en el componente **móvil** — verificado leyendo `DispatchRouteSurface.tsx`: `isCrewTree = isBelowLg || isTabletDock`, y sin el flag a exactamente 1024 ambas son falsas; el producto está bien, la aserción miente) y **`despacho-close-dispatch.spec.ts`** (Route L — un contador que sube de run en run por artefacto de fixture del mock DispatchTrack, no por un bug de producto ni por el mismo afordance móvil; ver `quarantine.json` para el detalle).

**2. El backlog es el riesgo real, y el gate en rojo lo estaba tapando.**
61 commits van a aterrizar de una vez. Producción tiene ~112k dispatches y ~61k packages, y **los backfills se caen por timeout ahí y en ningún otro sitio**. Desbloquear el gate sin dimensionar esto primero es lo más arriesgado que se puede hacer hoy.

**3. Hay un bucle: `verify-prod-migrations` falla PORQUE producción está detrás.** Estar atrasado dificulta ponerse al día.

## Inventario de las 12 migraciones pendientes (fase 3, medido leyendo el SQL real)

**Corrección de partida, la más importante de esta fase:** la tabla que este spec tenía escrita antes describía `20260909000001` y `20260910000001` como backfills reales que corren **dentro del deploy** y son "candidatos a timeout". **Es falso, leyendo el SQL tal como está en el repo hoy.** Ambas migraciones envuelven su `UPDATE` en una función (`spec79_backfill_loaded_route_id()`) que la migración **crea pero deliberadamente NO invoca** — el propio autor lo dice en el comentario de cabecera de `20260909000001`, citando el mismo riesgo de timeout que este spec documenta en "Riesgos". El backfill de packages/dispatches, a escala de producción, **no está en el camino crítico del deploy en absoluto hoy**: es una llamada manual (`SELECT public.spec79_backfill_loaded_route_id();`) que alguien con acceso a producción tiene que ejecutar aparte, después de medir. Eso no significa que no haya trabajo que hacer en esta fase — sigue habiendo que decidir *cuándo* y *en cuántos lotes* correr esa función a mano — pero cambia la naturaleza del riesgo: no es "el deploy puede caerse", es "el deploy no deja el dato completo, y alguien tiene que terminarlo aparte, a propósito".

**Segunda corrección, casi tan importante:** `20260911000003` **retira** el índice `routes_one_vehicle_per_day` que `20260911000002` (h5c) crea — incondicionalmente, con un `DROP INDEX IF EXISTS`, sin volver a comprobar conflictos. Las dos migraciones son consecutivas y se aplican en el mismo pase de deploy. **El estado final después de las 12, si todas se aplican, es que ese índice NO existe** — fue creado (quizás) por h5c y desmontado por b1 en la migración inmediatamente siguiente, dentro de la misma operación de despliegue. `docs/specs/spec-79-dispatch-handoff-integrity.md`'s propio comentario en `20260911000003` explica por qué: el índice prohibía un caso legítimo (un camión con dos rutas el mismo día) y el guardrail real se movió a la capa de aplicación (`busyRoutes` en `PATCH /api/dispatch/routes/[id]`, scopeado a `OPEN_ROUTE_STATUSES`). **La fase 4 de este spec, tal como está escrita hoy, pide comprobar que `routes_one_vehicle_per_day` existe después del deploy — eso es exactamente lo contrario de lo que debe pasar.** Corregido abajo, en la sección de verificación manual.

| Migración | Qué hace | Toca datos / sólo esquema | Backfill (¿sobre cuántas filas?) | Bloqueos | Índices / `CONCURRENTLY` | Riesgo | Por qué |
|---|---|---|---|---|---|---|---|
| `20260907000001_spec76_en_bodega_not_dock_ready` | `CREATE OR REPLACE` de `recompute_dispatch_stage` y `get_pre_route_snapshot` — quita `en_bodega` de las listas de estado "listo". | Sólo esquema (funciones). | Ninguno. | Ninguno propio de la migración — reemplazar una función no toma lock sobre las tablas que lee. | No crea índices. | **bajo** | Sin `UPDATE` fuera de una función parametrizada por PK; sin backfill. |
| `20260908000001_spec77_force_split` | Añade `'force_split'` al CHECK de `dispatches.stage`; `CREATE OR REPLACE` de una vista y una función. | Esquema — un `DROP CONSTRAINT`/`ADD CONSTRAINT` sobre una columna `TEXT`, no un `ALTER COLUMN TYPE`. | Ninguno — el valor nuevo sólo lo escribe código futuro. | El `ADD CONSTRAINT CHECK` en Postgres 12+ toma `ACCESS EXCLUSIVE` brevemente para validar, pero sin `NOT VALID` recorre la tabla; sobre `dispatches` (~112k filas) es una validación de CHECK, no una reescritura de fila — rápida, sin I/O de payload. | No crea índices. | **bajo** | Confirmado leyendo el SQL: no hay `UPDATE`, no hay columna nueva, no hay índice. |
| `20260908000002_spec77_retorno_hub_clears_load_fact` | `CREATE OR REPLACE` de `complete_return_reception_scan`. | Sólo esquema (función). | Ninguno. | Ninguno. | No crea índices. | **bajo** | Ídem al patrón anterior — sólo redefine una función. |
| `20260909000001_spec79_loaded_route_id` | `ADD COLUMN packages.loaded_route_id` (nullable, `REFERENCES routes(id)`), `CREATE INDEX` parcial, y **crea** (sin invocar) la función `spec79_backfill_loaded_route_id()`. | Esquema dentro de la migración; el backfill de datos existe como función **no auto-invocada**. | **La migración en sí: 0 filas.** La función, si alguien la corre a mano después: acota a órdenes con exactamente un `dispatch` vivo — un subconjunto de ~61k packages, no todos. Sin acceso a producción no se puede dar la cifra exacta; en QA (fracción del volumen de producción, ver aviso abajo) es trivial de medir pero no representativa del orden de magnitud. | `ADD COLUMN` nullable sin `DEFAULT` es metadata-only en Postgres (no reescribe la tabla). `CREATE INDEX` **sin** `CONCURRENTLY` sí toma un lock que bloquea escrituras en `packages` mientras construye — sobre ~61k filas, del orden de segundos, no minutos, pero es un lock real, no cero. | Crea 1 índice parcial (`WHERE loaded_route_id IS NOT NULL AND deleted_at IS NULL`); **no usa `CONCURRENTLY`**; no es un índice que se auto-proteja como h5c. | **medio** | Baja el riesgo respecto a lo que este spec creía: el backfill real está desacoplado del deploy. Queda medio, no bajo, por el `CREATE INDEX` sin `CONCURRENTLY` sobre `packages`. |
| `20260910000001_spec79_backfill_route_scope_fix` | `CREATE OR REPLACE FUNCTION spec79_backfill_loaded_route_id()` — corrige el alcance de la función anterior (cuenta rutas distintas vivas, no filas de dispatch). | Sólo esquema (función). | **La migración en sí: 0 filas.** Sigue siendo una función no invocada — mismo trato que la anterior. | Ninguno — `CREATE OR REPLACE FUNCTION` no toca las tablas que la función lee. | No crea índices. | **bajo** | Es un `CREATE OR REPLACE` de la definición de una función; el `UPDATE` real sigue fuera del camino del deploy. |
| `20260911000001_spec79_dispatch_attempt_claim` | `ADD COLUMN routes.dispatch_attempt_at` (nullable timestamptz, sin default). | Esquema. | Ninguno. | Metadata-only — `routes` es una tabla pequeña (una fila por ruta, no por parada/paquete) y la columna es nullable sin default. | No crea índices. | **bajo** | El propio comentario de la migración lo dice explícitamente: metadata-only sobre una tabla órdenes de magnitud más chica que `dispatches`/`packages`. |
| `20260911000002_spec79_h5c_vehicle_per_day_index` | Cuenta conflictos de `(operator_id, vehicle_id, route_date)` sobre rutas activas; si hay 0, crea `routes_one_vehicle_per_day` (`CREATE UNIQUE INDEX`) — si hay ≥1, sólo emite `RAISE NOTICE` y NO crea el índice. | Esquema condicional — ningún `UPDATE`. | Ninguno — es un `SELECT COUNT` de verificación, no una escritura. | `CREATE UNIQUE INDEX` (sin `CONCURRENTLY`) sobre `routes` toma lock de escritura mientras construye — tabla pequeña, lock corto pero real. | Crea 1 índice único condicional; **no usa `CONCURRENTLY`**; **sí se auto-protege en silencio** — ver el párrafo dedicado abajo. | **medio — silencioso, y efímero** | Ver el análisis dedicado abajo: el resultado de esta migración se deshace, sin excepción, en la siguiente. |
| `20260911000003_spec79_b1_withdraw_vehicle_per_day_index` | `DROP INDEX IF EXISTS routes_one_vehicle_per_day` — incondicional. | Esquema. | Ninguno. | `DROP INDEX` sin `CONCURRENTLY` toma lock breve sobre `routes`; tabla pequeña. | Retira el índice de la migración anterior. | **bajo** | Deshace h5c sin condición — el índice no debe existir después de este par. |
| `20260912000001_recogida_visible_when_carga_verified` | `CREATE OR REPLACE FUNCTION get_ops_control_snapshot`. | Sólo esquema (función). | Ninguno. | Ninguno. | No crea índices. | **bajo** | Sólo redefine la función que arma el snapshot de Ops Control. |
| `20260913000001_spec85_discrepancies_schema` | 3 `CREATE TYPE` (enums), `CREATE TABLE discrepancies` (vacía), 6 índices normales + 2 `UNIQUE`, RLS + GRANTs, y **SÍ invoca inline** `spec85_backfill_discrepancy_notes()` (copia `discrepancy_notes` → `discrepancies`). | Esquema + **backfill real que sí corre dentro del deploy**, pero sobre una tabla distinta y mucho más chica que `packages`/`dispatches`. | Copia de `discrepancy_notes` (filas vivas, `deleted_at IS NULL`) a la tabla nueva `discrepancies`. El propio comentario de la migración dice: *"nadie sabe cuántas notas hay en prod (las 5 conocidas son de QA)"* — cifra dada por el autor de la migración, no medida por mí; **no tengo acceso a producción para confirmarla ni refutarla**, y la marco explícitamente como estimación de orden de magnitud, no un conteo. | Los `CREATE UNIQUE INDEX`/`CREATE INDEX` corren sobre `discrepancies`, una tabla **recién creada y vacía** en el mismo `BEGIN`/`COMMIT` — construir un índice sobre una tabla vacía es instantáneo, no compite con nada. El `INSERT ... SELECT` del backfill toma locks de fila normales sobre `discrepancy_notes` mientras dura, proporcional a su tamaño (bajo, según la cifra de arriba). | Crea 8 índices sobre una tabla vacía (ninguno `CONCURRENTLY`, pero irrelevante a esa escala); el backfill usa `ON CONFLICT DO NOTHING` sin target — traga cualquier colisión de cualquiera de los dos índices únicos **en silencio**, con un `RAISE NOTICE` si el conteo insertado es menor que el conteo de origen. | **bajo — con una salvedad declarada** | Tabla origen pequeña por lo que dice el propio autor de la migración; el patrón "traga en silencio" es el mismo espíritu que h5c pero sobre datos de mucho menor volumen y consecuencia (notas de discrepancia duplicadas, no un índice de negocio ausente). Si production tuviera órdenes de magnitud más notas que QA — cosa que no puedo confirmar sin acceso — esta fila debería revisarse antes de aprobar. |
| `20260913000002_spec80_close_manifest` | `CREATE OR REPLACE FUNCTION close_manifest`. | Sólo esquema (función). | Ninguno. | Ninguno. | No crea índices. | **bajo** | Sólo función nueva/redefinida, sin tocar filas existentes. |
| `20260913000003_spec85_discrepancies_rpcs` | `CREATE OR REPLACE FUNCTION` de `record_discrepancies`, `resolve_discrepancy`, `get_discrepancies`. | Sólo esquema (funciones). | Ninguno. | Ninguno. | No crea índices. | **bajo** | Consume los tipos/tabla creados en `20260913000001`; no escribe nada por sí misma. |

### El caso `h5c` merece leerse entero — y termina siendo distinto de lo que el spec asumía

Es el patrón que mató a spec-56: un `CREATE UNIQUE INDEX` sobre filas vivas revienta si producción ya viola la restricción, y **pasa CI porque los datos de QA no la violan**.

Aquí alguien ya aprendió esa lección: la migración **cuenta los conflictos primero** y, si hay, **salta la creación del índice** con un `RAISE NOTICE` en vez de fallar. Eso evita tumbar el deploy — pero introduce el fallo opuesto: **en producción el índice puede no crearse nunca, en silencio**, y una garantía que dependiera de él no existiría. Hasta aquí, exactamente lo que este spec ya decía.

**Lo que el spec no decía, porque se escribió antes de leer `20260911000003` con este detalle: el índice de h5c fue retirado por diseño, tres migraciones después de crearse, dentro del mismo lote de despliegue.** `spec-79` decidió que "un camión con dos rutas el mismo día" es una operación legítima (turno de mañana + turno de tarde), no un defecto — el índice de h5c prohibía exactamente ese caso porque su `WHERE` incluía `dispatched`/`in_transit`/`in_progress`. `20260911000003` lo retira sin condición (`DROP INDEX IF EXISTS`, sin volver a contar nada) y documenta que el guardrail real vive ahora en la capa de aplicación (`busyRoutes`, scopeado a `OPEN_ROUTE_STATUSES`). **Verificar que `routes_one_vehicle_per_day` existe después del deploy completo es verificar lo contrario de lo que debe ser cierto.** El único momento en que el comportamiento silencioso de h5c importa de verdad es si el despliegue se detiene **entre** `20260911000002` y `20260911000003` — un lote parcial que aplicó la primera y no la segunda. Ver la sección de verificación manual, más abajo, para qué hacer en ese caso concreto.

**De las 12, sólo dos migraciones crean índices sobre tablas con volumen real de producción y ninguna usa `CONCURRENTLY`:** `20260909000001` (`packages`, ~61k filas) y `20260911000002` (`routes`, mucho más chica). Las demás, o no crean índices, o los crean sobre una tabla recién creada y vacía (`20260913000001`).

---

## Fases

| Fase | Qué entrega | Quién puede |
|---|---|---|
| **1 — Cuarentena del gate** | El rojo ajeno deja de vetar; el veto se conserva | agente |
| **2 — Arreglar la aserción de Despacho** | El gate vuelve a verde de verdad | agente |
| **3 — Dimensionar los dos backfills** | Saber si caben en un deploy antes de intentarlo | agente |
| **4 — Desplegar el backlog por lotes** | Producción al día | agente (aprobación incluida) |
| **5 — Guardarraíles** | Que no vuelva a acumularse | agente |

### Fase 1 — Cuarentena del gate `[done]`

> Implementado por: implementer — rama `feat/spec-87-fase1-cuarentena`, PR #658, squash SHA `18833b9` sobre `main`.
> Review: reviewer (Opus) — seis rondas adversariales, cada una encontrando y verificando en bash real un bypass ejecutable que la ronda anterior no cubría (denylist inicial de round 1 perdía 2/4 vectores; H2 encontró que un reporte vacío pasaba en verde; round 3 mostró ocho vectores más que tumbaron el denylist entero, sustituido por la whitelist de forma; round 4 encontró tres vectores más y el agujero de `defaults.run.shell`; round 5 (H1/H2) encontró que `logicalLines()` sólo partía por `\`, nunca por `;`/`&&`/`||`, y que el ancla de orden podía quedar vacía; round 6 (B1/B2/M4) encontró que la regla de empalme de continuaciones era más laxa que bash, que `${{ }}` se sustituye antes de que bash lea nada, y que `working-directory` no tenía cadena de resolución). La ronda final aprobó **sin reservas**: 25 vectores a mano + 427 cuerpos de fuzz, cero bypasses, con un arnés diferencial propio (`bash --noprofile --norc -e -o pipefail` contra un stub de `check-quarantine.sh`) que confirmó las dos únicas divergencias restantes como fail-closed, no bugs. Una ronda 7, de pulido y no bloqueante, cerró lo que quedaba: mensaje propio para el rechazo de `${{` (antes cayía en el genérico "no step whose run: is exactly..."), la cadena `working-directory` testeada a los tres niveles (`step → job → workflow`; round 6 sólo probó el nivel de job), y mutation-testing explícito y confirmado a mano (mutar → correr la suite → ver el flip esperado → revertir) de los cuatro mutantes que sobrevivían: el fallback a `defaults.run.working-directory` a nivel de workflow, el chequeo de `working-directory` a nivel de step, el flush final de `logicalLines()` (el patrón `run: |-` que entrega js-yaml sin salto final), y el ancla `^` de `ALLOWED_EXTRA_LINE`. Se añadió además un arnés diferencial (`check-deploy-gating-quarantine-differential.test.sh`) como estrategia de aquí en adelante, en vez de seguir sumando un fichero `-rN.test.sh` de vectores sueltos por ronda.
> QA: esta fase es infraestructura de CI, no una pantalla — se verifica con sus propias 126 pruebas en 11 ficheros de `scripts/*.test.sh` (todas verdes) y contra el `deploy.yml` real, no con QA end-to-end. PR #658 mergeado `2026-09-08T03:27:24Z` (squash `18833b9`) sobre `main`; `gh pr checks 658` verde: `Lint, Type-Check, Test, Build` (dos runs, uno por push+pull_request) en verde, incluida la nueva suite del arnés diferencial cableada en `ci.yml`. El job `e2e-qa` de `deploy.yml` no corre sobre un PR — corre post-merge contra QA en la VPS — así que no hay reporte de e2e-qa que leer para esta fase; lo que el veto de esta fase protege (que un fallo real vete el deploy) se ejerce la próxima vez que `deploy.yml` corra con esta cuarentena activa.
> Downstream: `docs/specs/spec-85-discrepancias.md:263` es la única mención de spec-87 en `docs/specs/` fuera de este propio archivo — es una referencia informativa a que esta fase existe, no asume ninguna forma de RPC ni comportamiento de esta fase. Sin cambios. Deuda dejada explícitamente para quien tome la deuda de spec-57 (no de esta fase): un `deploy-hotfix.yml` nuevo con su propio job de despliegue (p. ej. `deploy-vercel`) es invisible para los cinco checks de spec-57 y para este veto — `check-deploy-gating.mjs:41` fija el objetivo en `.github/workflows/deploy.yml` y `ci.yml` lo invoca sin argumento; no existe ningún guard que inventaríe workflows. La lista blanca de esta fase cierra la clase de bypass **a nivel de fichero**, no de repositorio.
>
> **Corrección (seguimiento post-fase-2, B1 — bloqueante):** la cuarentena descrita arriba **nunca absorbió un solo fallo**. `matches()` en `check-quarantine.mjs` comparaba `entry.spec === spec.file` de forma exacta. `quarantine.json` se escribe a mano con el prefijo `e2e/` (`"spec": "e2e/despacho-tablet-dock.spec.ts"`), pero el reportero JSON de Playwright escribe `spec.file` **relativo a `testDir`** (`./e2e` en `playwright.qa.config.ts`), así que un informe real nunca lleva ese prefijo — confirmado de forma empírica contra una corrida real de `npx playwright test` con `@playwright/test 1.58.2`, no leyendo el reportero en abstracto (una ronda de review anterior concluyó lo contrario leyendo el código fuente del reportero; esa conclusión era falsa, desmentida por el log real). El log del run de `deploy.yml` `34196179672`, step `Check quarantine`, muestra el síntoma exacto: para las dos entradas activas de esa fecha, **"entry does not match any test"** y **"undeclared failure"** a la vez, para el mismo spec. El veto seguía funcionando (nada de esto es `continue-on-error`), pero la cuarentena — el mecanismo pensado para comprar tiempo declarando fallos conocidos — era un no-op desde el primer commit. No se detectó en seis rondas de review porque los propios fixtures de `check-quarantine.test.sh`/`check-quarantine-report.test.sh` fabricaban el informe **con** el prefijo `e2e/`, así que la suite verde probaba el matcher contra una forma de informe que Playwright nunca produce — el caso de libro de un test que pasaría igual con el código roto. Arreglado en rama `fix/spec-87-matcher-cuarentena`: `matches()` ahora normaliza ambos lados quitando un prefijo literal `e2e/` (no un `endsWith`/basename — `otro/foo.spec.ts` nunca matchea `e2e/foo.spec.ts`), los fixtures de ambos ficheros de test se corrigieron a la forma real (sin el prefijo en `file`), y se añadieron pruebas para ambas direcciones del prefijo más un caso negativo de substring, fijadas por mutación (cada mutante probado y revertido a mano).

**Archivos:** `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `apps/frontend/e2e/quarantine.json` (nuevo), `apps/frontend/playwright.qa.config.ts`, `scripts/check-quarantine.mjs`/`.sh` + su test, `scripts/check-deploy-gating.mjs` + su test

Un fichero declara los tests que se sabe que fallan, cada uno con **dueño y fecha de caducidad**:

```json
[
  { "spec": "e2e/despacho-tablet-dock.spec.ts", "test": "2d — assigns the seeded truck…",
    "reason": "aserción usa el afordance móvil sobre el árbol de escritorio (spec-87 fase 2)",
    "owner": "spec-78", "expires": "2026-09-21" }
]
```

El gate falla ante **cualquier fallo fuera de la lista**, y ante **cualquier entrada caducada**. Eso es lo que impide que la cuarentena se convierta en un basurero permanente.

**Esto NO es `continue-on-error`**, que `deploy.yml` prohíbe explícitamente y con razón: *«una suite que no puede vetar es telemetría, no un gate»*. Aquí la suite conserva el veto para todo lo que no esté declarado.

Reglas añadidas durante los fix rounds, no cubiertas por el texto original de esta fase:

- **Horizonte de 30 días.** `expires` no se puede renovar más allá de `--today + 30 días` — sin tope, la fecha se convierte en decoración y la cuarentena vuelve a ser permanente.
- **Fechas deben existir en el calendario.** `"2026-99-99"` matchea el regex `YYYY-MM-DD` pero no es una fecha real; se rechaza haciendo round-trip por `Date`.
- **`--validate-only` en CI (`ci.yml`).** Un `quarantine.json` mal formado antes sólo fallaba al correr `e2e-qa` en la VPS — momento en el que ya había vuelto a bloquear producción. Ahora se valida en cada PR sin necesitar un reporte. No falla sobre una entrada ya caducada (no tiene reporte con el que comprobar si el test sigue rojo); imprime un `::warning::` en su lugar.
- **Entradas ambiguas se rechazan.** Una entrada cuyo `test` matchea más de un spec real (p. ej. `"test": "Route"` sobre `Route H`/`Route R`) falla el gate — podría absorber en silencio una regresión no relacionada.
- **`report.errors` y `report.stats.unexpected`/`stats.expected+unexpected+flaky`.** Un fichero que falla al cargar no produce ningún spec fallido — sólo aparece en `report.errors`. Un reporte vacío (`suites: []`, o `{}`, o con todo en `skipped`) tampoco produce specs fallidos. Ambos casos se detectan explícitamente; antes de esto, ambos pasaban el gate en verde.
- **Ventana de gracia UTC en `--today`.** `parseArgs` (`check-quarantine-validate.mjs`) usa `toISOString()`, que lee UTC, no el reloj local del runner; ni la llamada `--validate-only` de `ci.yml` ni la invocación de `deploy.yml` pasan `--today`, así que ambas dependen de este default. En Madrid (UTC+2) eso da hasta dos horas de gracia tras la fecha de `expires` antes de que una entrada se lea como caducada. Es una decisión deliberada, no un bug — cambiar el default a hora local haría que este chequeo y `isRealCalendarDate` (que ya usa UTC para parsear) discreparan entre sí según el huso del runner, un fallo peor que una ventana fija y documentada de dos horas.
- **El veto del step, no sólo del job.** `check-deploy-gating.mjs` ahora exige que `e2e-qa` tenga exactamente un step cuyo `run:` sea, como línea lógica (uniendo continuaciones con `\`), exactamente `bash scripts/check-quarantine.sh <quarantine.json> <report.json>` — con la única excepción de líneas que empiecen por `#` (comentario) en el mismo `run:`. Es una **lista blanca de forma**, no una lista negra de casos: cualquier otra línea lógica —`set` en cualquier variante, `trap`, `if`, `while`, `echo`, lo que sea— hace fallar el guard por no estar en la lista permitida, sin que nadie tenga que haberla previsto antes.

  - **Round 3** mostró ocho vectores que la lista negra original (`|| true`, `|| :`, comentarlo, `echo`) dejaba pasar con exit 0, entre ellos `--validate-only` —un flag real que esta misma fase introdujo— y un step señuelo anterior que `steps.find` tomaba como el real.
  - **Round 4** encontró tres más (`trap 'exit 0' EXIT`, `set +ex`, `set +e -u`) que esa lista negra tampoco conocía, más un cuarto vector (`defaults.run.shell` a nivel de job o de workflow, invisible para el chequeo que sólo miraba `step.shell`). Round 4 había admitido también `echo` como línea tolerada.
  - **Round 5 (H1)** encontró que `logicalLines()` sólo une continuaciones con `\` y nunca parte una línea por `;`/`&&`/`||`/backticks/`$(` — así que sólo se inspeccionaba el primer token, y `echo pre; trap 'exit 0' EXIT`, `echo hi; set +e`, o un `echo ... > results.json` que falsifica el reporte pasaban con exit 0. `echo` ya no está en la lista blanca; sólo lo están las líneas `#`.
  - **Round 5 (H2)** exigió que exista un step cuyo `run:` invoque de verdad `npm run e2e:qa` (una mención en comentario no cuenta) y que el step del veto corra **después** de ese step, no antes; si no existe ningún step así, el guard falla explícitamente en vez de aprobar por falta de ancla contra la que comparar.
  - **Round 6 (B1)** encontró que `logicalLines()` unía continuaciones con una regla más laxa que bash — recortaba (`trim()`) la línea antes de mirar si terminaba en `\`, así que no distinguía un número par de un número impar de barras pegadas al salto de línea, ni una barra seguida de un espacio final (invisible en el diff de GitHub) de una barra pegada de verdad. Verificado en vivo con `bash --noprofile --norc -e -o pipefail`: `# nota \\` (dos barras) y `# nota \ ` (barra + espacio) NO empalman con la línea siguiente en bash real, pero el guard viejo sí las unía, dejando que un `#` tolerado se tragara un `trap` o un `npm run e2e:qa` señuelo que movía el ancla de H2. `logicalLines()` ahora replica la regla de continuación de bash carácter a carácter (empalma sólo cuando la línea, sin recortar, termina en un número **impar** de `\` pegados al salto de línea) y trata además cualquier línea que empiece por `#` como terminal en sí misma, inmune a continuación a cualquier número de barras — verificado en vivo que ni siquiera una barra impar (`# note \`) empalma cuando la línea es un comentario. Con eso, una línea `#` no puede absorber la línea siguiente: **por construcción de la regla de empalme**, no porque el contenido posterior a un comentario sea inerte en abstracto.
  - **Round 6 (B2)** cerró que el guard analiza la plantilla YAML, no lo que GitHub ejecuta: un `${{ ... }}` dentro de la línea `#` tolerada es sustituido por GitHub *antes* de que bash lea nada, y un valor multilínea (un mensaje de commit) puede convertir esa línea de comentario en comentario + sentencia en tiempo de ejecución sin que el guard lo vea. El guard ahora rechaza cualquier `run:` del step del veto que contenga `${{` en cualquier posición, lista blanca o no.
  - **Round 6 (M4)** cerró el `working-directory`: hasta ahora `effectiveShell()` resolvía `step → job → workflow`, pero `working-directory` no tenía cadena equivalente pese a que el propio step real lo fija explícitamente (`deploy.yml:655: working-directory: .`) — el guard ahora resuelve `working-directory` con la misma cadena de tres niveles y exige que resuelva a `.`; un `defaults.run.working-directory` a nivel de job o de workflow que lo mueva ya no es invisible.
  - **Round 7** (re-review sin reservas, pero con pulido): el rechazo de `${{` ahora tiene su propio mensaje de error en vez de caer en el genérico "no step whose run: is exactly ..." (que cita, byte a byte, la invocación que sí está ahí — el mensaje viejo no decía por qué se rechazaba). El chequeo de `working-directory` quedó testeado a los tres niveles de la cadena (`step → job → workflow`; round 6 sólo probó el nivel de job). El flush final de `logicalLines()` (que empuja el `buf` pendiente si el `run:` termina en una línea sin `\n` final con una continuación colgando — el patrón real que entrega `run: |-`) y el ancla `^` de `ALLOWED_EXTRA_LINE` (sin ella, `trap 'exit 0' EXIT # x` pasaría la lista blanca por tener un `#` en cualquier posición, no al principio) quedaron cubiertos por mutation-testing explícito. La lista negra crecía un caso a la vez; la lista blanca cierra la clase — **a nivel de fichero**, no de repositorio: `check-deploy-gating.mjs` sólo mira `.github/workflows/deploy.yml` (fijo en el propio guard) y `ci.yml` lo invoca sin argumento; un `deploy-hotfix.yml` nuevo con su propio job de despliegue es invisible para los cinco checks de spec-57 y para este veto, y no existe ningún guard que inventaríe workflows. Es deuda de spec-57, no de esta fase — queda documentada para quien la tome.

  **Dos divergencias frente a bash, ambas fail-closed (round 7, confirmadas por re-review con `cat -A` sobre bytes y un arnés diferencial que ejecuta el `run:` bajo `bash --noprofile --norc -e -o pipefail` contra un stub de `check-quarantine.sh`):**

  - `logicalLines()` empalma continuaciones con **un espacio** (`` `${buf} ${content.trim()}` ``); bash empalma **sin nada**. El guard replica *dónde* bash empalma (misma regla de paridad de barras, mismo trato especial de los comentarios) — no *cómo* reconstruye el texto exacto. Partir la invocación por la mitad con una barra hace que el guard acepte (porque las dos mitades sí se unen lógicamente) y bash, en cambio, pase **un solo argumento** concatenado sin el espacio del guard — `exit 2` (usageError) o `127`. El deploy se bloquea en ambos casos; sólo cambia el motivo.
  - El detector de comentario usa `/^\s*#/` — el `\s` de JavaScript es más ancho que el "blank" que bash reconoce antes de un `#`. Un NBSP o un BOM justo antes del `#` hace que el guard lo lea como comentario inerte y acepte, mientras bash lee ese mismo carácter como parte de un nombre de comando y falla con `127`. De nuevo: el deploy se bloquea igual, por una vía distinta a la que el guard cree estar tomando.

  **Estrategia a partir de round 7:** en vez de seguir añadiendo un fichero `-rN.test.sh` por ronda con un test por vector (el patrón de las rondas 3-6), los vectores que son bypasses reales y ejecutables en bash real se prueban con un **arnés diferencial** (`check-deploy-gating-quarantine-differential.test.sh`): ejecuta el `run:` candidato bajo `bash --noprofile --norc -e -o pipefail` contra un stub de `check-quarantine.sh` que siempre sale 1, exige que bash silencie ese fallo (exit 0 real = bypass confirmado), y sólo entonces comprueba que el guard lo rechaza. Un vector que no sea un bypass real en bash no pertenece a ese arnés — pertenece, si acaso, a un test de forma normal sobre la cadena de resolución YAML (`step → job → workflow`), que no tiene nada que ver con lo que bash ejecuta.

- [x] Tests del parser y de la caducidad primero.
- [x] Cablear en `e2e-qa` y comprobar que `scripts/check-deploy-gating.mjs` sigue verde: **falla CI si alguien desconecta el gate**, y esta fase lo toca. Extendido en fix rounds 1 y 2 para exigir el propio step `check-quarantine.sh` dentro de `e2e-qa`, su `if:` y que su `run:` no esté neutralizado — antes sólo miraba `needs:`/`continue-on-error` a nivel de job y no veía el veto que vive en un step.

**Deuda conocida, preexistente de spec-57, NO arreglada aquí (fuera de alcance de fase 1):** cada step de `e2e-qa` — incluido `Check quarantine` — cuelga de `if: steps.qa.outputs.provisioned == 'true'`. Un runner sin `/home/aureon/.env.qa` deja el job entero en verde sin ejecutar ni un test, y `approve-production` lo acepta igual. Es el mismo agujero que H2 (informe vacío = verde) mostraba dentro del propio reporte, pero por una puerta distinta: aquí no llega a generarse ningún reporte. Necesita su propia fase o su propio spec — no es un fix de una línea dentro de fase 1. En `origin/main` el `Run E2E against QA` que *era* el veto ya colgaba de la misma condición: el agujero tiene el mismo diámetro antes y después de esta fase — no es una regresión introducida aquí. Matiz para quien lo arregle: `check-deploy-gating.mjs` ya cementa `steps.qa.outputs.provisioned == 'true'` como el único `if:` permitido en el step `Check quarantine` — el fix futuro tendrá que ser un step separado tipo "fail si no está provisionado", no endurecer ese `if:`.

### Fase 2 — Arreglar la aserción de Despacho `[done]`

> Implementado por: `implementer`. PR #665 (`fc1ffd6`), más los seguimientos del review en
> PR #666 (`3ceb3fe`).
> Review: `reviewer` adversarial. Dictaminó que los arreglos **no son cosméticos** y verificó
> el diagnóstico por su cuenta (`useViewport.ts` 1023/700, `isCrewTree`, y que
> `RoutePanel.tsx:123` es el único `<select>` del árbol de despacho). Sacó además el hallazgo
> que invalidaba la premisa de la fase 1 — ver la nota de esa fase sobre el matcher.
> Seguimientos aplicados: `baselineCount` movido a `beforeAll` (dentro del test, una
> contaminación de manifiesto de H o R habría quedado *dentro* del baseline), el test 2d
> renombrado a lo que realmente hace, y el locator scopado con `data-testid`.
> QA: verificado contra la QA viva **antes** del merge, con `npm ci` en la VPS — el mismo
> mecanismo del job `e2e-qa`. RED reales (`2d` con timeout esperando el botón del sheet
> móvil; Route L `expect(count).toBe(1) / Received: 19`) y GREEN tras el fix.
> **Y confirmado post-merge donde importa**: run `34198461161`,
> `Run E2E against QA → success` y `Check quarantine → success` con `quarantine.json` en `[]`.
> Es el primer `e2e-qa` verde desde el 2 de septiembre.
> Downstream: sin cambios en otros specs. La deuda del mock de DispatchTrack (crecimiento sin
> límite del contador, que romperá el E2E del camino `wasStale: true` cuando alguien lo
> escriba) queda anotada más abajo.

**Archivos:** `apps/frontend/e2e/despacho-tablet-dock.spec.ts`, `despacho-crew-mobile.spec.ts`, `despacho-close-dispatch.spec.ts`

Las tres referencian `«Asignar camión y conductor»`. O el test navega con `?dock=1` (y entonces el árbol de cuadrilla es el correcto), o maneja el selector de `RouteBuilder`, que es como el escritorio asigna camión. **Decidir cuál según lo que cada test dice estar probando**, no por lo que haga pasar el test.

- [x] Correr los tres contra QA antes y después: `npx playwright test --config=playwright.qa.config.ts`.
- [x] Al pasar, retirar su entrada de la cuarentena en el mismo PR.

**Trabajo hecho (rama `feat/spec-87-fase-2-asercion-despacho`, PR #665, squash
`fc1ffd6` mergeado `2026-09-08T07:08:43Z` sobre `main` — el token sigue
`[in_progress]` a propósito: el review encontró B1, bloqueante, sobre la
premisa de la fase 1; el orquestador cierra la fase a `[done]` tras el review
del seguimiento y QA, no antes):**

- **`despacho-tablet-dock.spec.ts` (test `2d`)** — diagnóstico del spec confirmado
  leyendo `DispatchRouteSurface.tsx`: a 1024×768 sin `?dock=1`, `isTabletDock` e
  `isBelowLg` son ambos `false`, así que renderiza `RouteBuilder` (el árbol de
  escritorio), que **no tiene** el botón «Asignar camión y conductor» ni el
  `radiogroup` — esos viven sólo en `DispatchVehicleAssignmentSheet` (mobile/
  tablet, detrás de `isCrewTree`). Confirmado también que `RoutePanel.tsx` no
  tiene ningún otro `<select>` en el árbol de despacho, así que
  `page.locator('select')` no es ambiguo. El producto está bien: la propia
  docstring del test dice que la finalidad es probar que el viewport NO activa
  `isTabletDock` por accidente antes del flag — eso es exactamente lo que sigue
  pinneado. Arreglo: el test ahora asigna el camión a través del `<select>` de
  `RoutePanel.tsx` (como el escritorio realmente asigna camión — opción "b" del
  texto de la fase), no del sheet móvil.
- **`despacho-close-dispatch.spec.ts` (Route L)** — diagnóstico del spec
  confirmado leyendo `infra/supabase-qa/dispatchtrack-mock/server.mjs`:
  `createdRoutes` es un array en memoria de un proceso systemd de vida larga,
  nunca se limpia (nadie llama `/__test__/reset` — `grep` en todo el repo no
  encuentra ningún caller), y `handleCreateCallCount` cuenta TODAS las rutas
  históricas que llevan ese identificador. Confirmado en vivo contra la QA real:
  el contador para `E2E77-L-ORD` estaba en **18** antes de tocar nada (no 1), y
  cada ejecución de Route L lo sube en **+1 exacto**, nunca +2 — el reintento no
  duplica la ruta, es la aserción absoluta la que está mal. Se descartó
  deliberadamente llamar a `/__test__/reset`: ese mock es un fixture QA vivo y
  compartido (project memory: un poll de n8n también lo lee), y resetear
  `createdRoutes`/`nextRouteId` bajo un proceso ajeno es exactamente el tipo de
  "no destruyas datos" que este trabajo tiene prohibido arriesgar. Arreglo: el
  test ahora captura un `baselineCount` justo antes del primer intento de
  despacho y afirma `count - baselineCount === 1` — la misma garantía de
  producto (item 22: el reintento no crea una segunda ruta), sin tocar estado
  compartido.
- **`despacho-crew-mobile.spec.ts`** — sin cambios. No está en cuarentena, sigue
  a 390×844 donde `isBelowLg` es verdadero y el sheet/radiogroup sí existen; se
  corrió igual (los 4 tests, ver evidencia abajo) para confirmar que nada de lo
  anterior lo rompió.
- **`quarantine.json` → `[]`.**

**Verificación real contra QA (VPS, self-hosted runner, mismo mecanismo que
`e2e-qa`; ver reporte completo en la respuesta del agente — no reproducido aquí
por espacio):**
  - RED confirmado por la razón correcta antes del fix: `despacho-tablet-dock`
    2d falló en `locator.click` esperando el botón inexistente (timeout de
    300s); `despacho-close-dispatch` Route L falló `expect(count).toBe(1)` con
    `Received: 19` (no una duplicación de ruta).
  - GREEN después del fix: `despacho-tablet-dock.spec.ts` 4/4 passed (17.0s);
    `despacho-close-dispatch.spec.ts` 3/3 passed (H, R, L — 29.4s), reconfirmado
    con una segunda corrida aislada de sólo Route L (delta +1 limpio, 21→22);
    `despacho-crew-mobile.spec.ts` 4/4 passed, sin cambios.
  - `apps/frontend/e2e/quarantine.json` en `[]` valida limpio con
    `check-quarantine.mjs --validate-only`, y los 126 tests de guard
    (`check-quarantine*.test.sh`, `check-deploy-gating*.test.sh`, 11 ficheros)
    siguen en verde localmente.
  - **No verificado por este agente:** el job `e2e-qa` real de `deploy.yml`
    corriendo sobre el PR mergeado — eso lo confirma `qa-e2e` leyendo el
    reporte post-merge, como manda el flujo delegado.

**Seguimiento post-review (rama `fix/spec-87-matcher-cuarentena`), B2-B4 — no
bloqueantes, cierran huecos que el review de fase 2 encontró:**

- **B2 — `baselineCount` se capturaba demasiado tarde.** Vivía dentro del
  propio test de Route L, es decir **después** de que Route H y Route R ya
  hubieran despachado en la misma corrida (`mode: 'serial'`). Una regresión
  que hiciera que el despacho de H o R incluyera `E2E77-L-ORD` en su propio
  payload de `dispatches[]` (contaminación de manifiesto — la clase de bug
  que `force_split`/`loadedPackageIds` puede producir) habría quedado
  **dentro** del baseline en vez de aparecer como delta — justo lo único que
  el viejo `toBe(1)` absoluto sí detectaba y el delta, tal como estaba escrito,
  ya no. Movido a `test.beforeAll`, justo después de `seed()` y antes de que
  cualquier ruta despache.
- **B3 — el test `2d` de `despacho-tablet-dock.spec.ts` ya no asigna nada.**
  `RouteBuilder.tsx` guarda `selectedVehicle` en `useState` de React y sólo lo
  envía en `handleDispatch`, que este test nunca alcanza: no hay PATCH, no hay
  escritura de `routes.vehicle_id`. El título `2d — assigns the seeded
  truck…` y la cabecera del fichero (`Covers 2a/2d/3a`) mentían desde que fase
  2 cambió la aserción al `<select>` de escritorio. Renombrado a `'2d viewport
  — at 1024x768 without ?dock=1 renders the desktop tree, not the mobile
  sheet'`, que es lo que de verdad pinnea, y corregida la cabecera para
  apuntar al `2d` real: el test homónimo de `despacho-crew-mobile.spec.ts`, a
  390×844, que sí prueba persistencia (PATCH + refetch, no sólo estado local
  del sheet). No se perdió cobertura — sólo estaba mal etiquetada, y el
  nombre viejo invitaba a que alguien borrara el test tablet por "redundante"
  sin ver que era el único pin de esa decisión de viewport.
- **B4 — `page.locator('select')` sin ámbito.** Correcto hoy
  (`RoutePanel.tsx` es el único `<select>` nativo del árbol de despacho,
  verificado), pero global a la página. Añadido
  `data-testid="route-panel-vehicle-select"` en `RoutePanel.tsx` (TDD: rojo
  primero en `RoutePanel.test.tsx`) y el E2E ahora escopa por ese testid, para
  que un futuro `<select>` en `TopBar` u `OrderInspector` (que `AppLayout`
  monta en toda `/app`) falle con un mensaje que señale la causa, no con una
  violación de strict-mode opaca.

**Anotado, no implementado — crecimiento sin límite del mock de DispatchTrack
de QA.** No es de esta fase ni de spec-79 tal como están escritos hoy; se deja
aquí en vez de en spec-79 para no arrastrar la deuda preexistente de campos de
evidencia que ese spec tiene en fases anteriores (`Fase 0`…`Fase 1g`, todas
`[done]` sin `> Implementado por:`/`> Review:`/`> QA:` — tocar ese archivo
dispara `check-spec-fields.sh` sobre las 13, no sólo sobre la línea añadida).
`infra/supabase-qa/dispatchtrack-mock/` no resetea nunca — la decisión de no
resetearlo en esta misma fase (Route L, arriba) fue correcta y esto no la
contradice. `handleListRoutes` filtra por `isoDate`, y
`despacho-close-fixture.ts:116` siembra con `CURRENT_DATE`: dos corridas de
`e2e-qa` **el mismo día** dejan ≥2 rutas con el conjunto de identificadores
exactamente igual (`{E2E77-L-ORD}`) para la misma fecha. `dt-list-routes.ts`
(spec-79, Fase 4i) define `ambiguous` como "más de una ruta con conjunto
exactamente igual", y `dispatch-retry-precheck.ts` traduce `ambiguous` →
`refuse`. Hoy Route L no llega a esa rama — el reintento va por
`isConfirmedExternalRouteId`, no por el precheck — así que no es un bug activo.
Pero **el día que alguien escriba el E2E del camino `wasStale: true`, que es
exactamente el que spec-79 (B-2/B-3, Fase 4h/4i) más necesita cubrir de punta
a punta, ese test fallará por acumulación del fixture, no por el producto**.
La limpieza correcta no es un `/__test__/reset` global sino uno **con filtro
por prefijo** (`POST /__test__/reset?prefix=E2E77`) llamado desde el
`teardown()` de `despacho-close-fixture.ts`, junto al `DELETE … LIKE
'E2E77-%'` que ese fichero ya hace — no toca Musan ni el poll de n8n que
también lee este mock. Queda para quien tome el E2E de `wasStale: true`,
en spec-79 o en una fase futura de spec-87.

**No verificado por este agente (seguimiento):** ninguno de B2-B4 se corrió
contra QA real (no hay runner self-hosted disponible en esta sesión) — sólo
`tsc --noEmit`, `eslint` y el nuevo test unitario de `RoutePanel.test.tsx`
(rojo→verde). `qa-e2e` lo confirma post-merge leyendo el reporte, igual que el
resto de esta fase.

### Fase 3 — Dimensionar los dos backfills `[done]`

> Implementado por: `implementer`. PR #667 (`5428c50`). Sin código: es inventario.
> Review: **no hubo review adversarial**, y queda declarado como hueco, no como aprobado.
> Lo que sí hubo: el orquestador verificó a mano los **dos hallazgos que sostenían la
> decisión de producción**, porque iba a aprobar un despliegue con ellos. Ambos confirmados
> leyendo el SQL en `origin/main`:
> (1) los «backfills» de spec-79 no ejecutan nada en el deploy — `CREATE FUNCTION` en
> `20260909000001:84` y el `UPDATE` en `:91`, dentro del cuerpo, sin ninguna llamada a nivel
> superior; (2) `20260911000003` se llama `b1_withdraw_vehicle_per_day_index` y hace
> `DROP INDEX IF EXISTS routes_one_vehicle_per_day` sin condición, así que el estado correcto
> tras el deploy es que el índice **no exista**.
> **Los dos corrigen creencias que este spec y las notas del proyecto daban por ciertas** y
> que bloquearon la aprobación del deploy durante días.
> QA: n/a por capa — es un documento de análisis, no hay nada que ejercitar.
> Downstream: corregida la cifra de 9 a 12 migraciones en todo el documento, y corregida la
> fase 4, que pedía verificar que el índice **existiera** tras el deploy: es exactamente al
> revés.
> **Hueco declarado:** el agente no tuvo credenciales de producción, así que las cifras de
> escala (~112k dispatches, ~61k packages) están citadas de los comentarios que los propios
> autores de las migraciones dejaron en el SQL, no medidas. Marcado así en cada fila.

**Archivos:** ninguno de producción — es medición

**Hallazgo que reencuadra toda la fase, ya explicado arriba: los dos `UPDATE … FROM (SELECT …)` no son candidatos a timeout DENTRO del deploy, porque ninguna de las dos migraciones los invoca.** `20260909000001` crea la función `spec79_backfill_loaded_route_id()`; `20260910000001` la redefine (`CREATE OR REPLACE`) para corregir su alcance. Ninguna migración contiene un `SELECT spec79_backfill_loaded_route_id();` — ambas dicen explícitamente en su propio comentario que es intencional, citando el mismo riesgo de timeout que motivó este spec. Esto no vuelve trivial la fase: sigue faltando decidir **cuándo y en cuántos lotes** correr esa función a mano contra producción, y eso sigue siendo lo que decide si la fase 4 puede cerrarse. Lo que cambia es que **el deploy en sí no puede caerse por esto** — el riesgo de timeout se traslada por completo a un paso posterior, manual, fuera del pipeline de CI/CD.

- [x] **Sobre QA, con volumen de producción simulado o al menos el `EXPLAIN` del plan: estimar filas tocadas y tiempo.** No hecho contra producción — no tengo credenciales de producción en este entorno, y las reglas de esta fase prohíben pedirlas o inferirlas. Intenté conectar por SSH al VPS (`connect-to-vps`, el único servidor listado: `Hostinger-aureon_LM`, 187.77.48.107) para al menos leer conteos de QA por `docker exec supabase-qa-db psql`, y la sesión lo bloqueó a nivel de sandbox ("Blocked by classifier") antes de llegar a ejecutar nada — no hay una cifra de QA medida en vivo por este agente para packages/dispatches. Lo que sí tengo, leído directamente del SQL: el `UPDATE` de `20260910000001` hace un único `GROUP BY order_id` sobre la tabla completa `dispatches` (~112k filas documentadas en el propio comentario de la migración, con un `JOIN` a `routes` por PK más un filtro de `status`), seguido de un `UPDATE` acotado a `packages` cuyo `WHERE` exige `loaded_at IS NOT NULL AND load_inferred = false AND loaded_route_id IS NULL` — un subconjunto de los ~61k packages, no el total. El propio autor de la migración documenta **dos incidentes previos de `statement_timeout` en esta misma serie contra este mismo par de tablas** (citado en el comentario de `20260910000001`), que es la evidencia de que el shape de esta consulta sí es realista como candidato a timeout — de ahí la decisión de no invocarla automáticamente. Sin acceso a producción no puedo dar una cifra de filas ni de tiempo; lo que sí puedo afirmar con el SQL delante es la forma del plan (un `GROUP BY` de la tabla completa domina el costo, no el `UPDATE` final) y que el propio autor ya trató esto como de riesgo real, no hipotético.
- [x] **Comprobar si son reanudables e idempotentes.** **Idempotente sí — reanudable (por lotes) NO, tal como está escrita hoy.** El `WHERE` final del `UPDATE` incluye `p.loaded_route_id IS NULL`: una fila ya escrita por una corrida anterior deja de matchear el `UPDATE`, así que llamar a la función una segunda vez sobre el mismo estado no reescribe nada ni duplica trabajo — es seguro reintentarla completa. Pero es **una única sentencia `UPDATE`** sin `LIMIT`/lotes internos: si el `statement_timeout` de producción la corta a mitad de camino, Postgres revierte la transacción entera (no hay commit parcial de un solo `UPDATE`), así que un timeout dejaría exactamente 0 filas escritas y el reintento se enfrentaría al mismo timeout, no a un residuo menor. Para que sea reanudable de verdad hace falta envolver la llamada en un driver externo que la corra por lotes (p. ej. `WHERE order_id = ANY(...)` con un `IN` acotado por rango de fecha o de id, repetido N veces) — esa envoltura no existe en el repo hoy; es trabajo nuevo, no algo que ya esté ahí y sólo haya que invocar.
- [x] **Si no caben: separarlos del deploy y ejecutarlos como job aparte, por lotes, después del cambio de esquema.** Ya lo están — no es un "si", es el estado real del código: la función existe, el `ADD COLUMN`/`CREATE INDEX` de `20260909000001` es rápido y transaccional, y el backfill queda fuera del deploy por diseño de quien escribió la migración. Lo único que falta construir es el driver de lotes del punto anterior, para poder correrlo con seguridad contra ~61k filas sin volver a golpear el `statement_timeout` documentado. Eso queda fuera del alcance de esta fase (es medición, no implementación) — se deja escrito aquí como el trabajo concreto que la fase 4 necesita antes de su paso 3.
- [x] **Escribir el resultado aquí. Es lo que decide la fase 4.** Ver la sección "Orden de despliegue por lotes" más abajo, y la fase 4 corregida.

**Lo que NO pude medir, y por qué queda declarado en vez de estimado:**

- **Filas reales en producción para `packages`/`dispatches`/`discrepancy_notes`.** Sin acceso a producción en este entorno (ninguna credencial en el repo, según las reglas de esta tarea) y sin acceso funcional a QA en esta sesión (SSH bloqueado por el clasificador del sandbox antes de ejecutar ningún comando). Las únicas cifras de escala que uso arriba (~112k dispatches, ~61k packages, "5 notas conocidas, todas de QA") están **citadas textualmente de los comentarios que los propios autores de las migraciones dejaron en el SQL**, no medidas por mí — se marcan como tales en cada fila de la tabla, no como una medición propia.
- **Tiempo de ejecución real del backfill de `loaded_route_id`.** No hay manera honesta de estimarlo sin correr `EXPLAIN ANALYZE` contra un volumen real, que exige exactamente el acceso que no tengo. Lo que sí es medible sin esa credencial —la forma del plan, que domina un `GROUP BY` de tabla completa— está arriba.

### Orden de despliegue por lotes — propuesta de fase 3 para que fase 4 la ejecute

**Con las 12 migraciones re-clasificadas, el cuadro cambia respecto a lo que este spec asumía: 10 de 12 son bajo riesgo y ninguna de las 12 ejecuta un backfill de escala de producción DENTRO del propio deploy.** El único trabajo verdaderamente lento y arriesgado —el backfill de `loaded_route_id` sobre packages/dispatches— ya está separado del deploy por quien escribió las migraciones; no hay que separarlo, hay que ejecutarlo bien después.

**Lote 1 — las 10 de bajo/medio riesgo, todas juntas.** Nueve son puro esquema/funciones sin tocar una fila existente (`20260907000001`, `20260908000001`, `20260908000002`, `20260910000001`, `20260911000001`, `20260912000001`, `20260913000002`, `20260913000003`, y el `DROP INDEX` de `20260911000003`). La décima, `20260913000001`, sí ejecuta un `INSERT ... SELECT` dentro del deploy, pero sobre una tabla de origen que el propio autor documenta en decenas, no miles, de filas — orden de magnitud incomparable con `packages`/`dispatches`. Van todas en el mismo lote porque ninguna individualmente justifica un lote propio, y agruparlas reduce el número de aprobaciones manuales sin subir el riesgo real. **`20260909000001` va en este mismo lote también** — a pesar de crear un índice sobre `packages` sin `CONCURRENTLY` — porque su parte de esquema (la única que corre en el deploy) es barata; lo que NO va en este lote es la llamada a `spec79_backfill_loaded_route_id()`, que es una sentencia SQL manual aparte, no parte de ninguna migración.

**Lote 2 — `20260911000002` (h5c) en su propio paso, aislado por ser la única con comportamiento condicional/silencioso.** No porque su costo sea alto (es un índice sobre `routes`, tabla chica) sino porque es la única de las 12 cuyo resultado no se puede leer del código de la migración — depende de datos vivos en producción que nadie ha contado. Aislarla en su propio paso, con `20260911000003` inmediatamente después (ver abajo), es lo que permite comprobar el estado intermedio sin que quede enterrado entre otras nueve migraciones.

**Verificar entre lote 2, paso a) y paso b):** aplicar `20260911000002`, comprobar manualmente el resultado (ver más abajo — el índice puede o no haberse creado), aplicar `20260911000003` inmediatamente después. Las dos migraciones son consecutivas por diseño y el estado final esperado tras ambas es **el índice ausente**; comprobar entre medias no es para decidir si seguir, es para saber si producción tenía filas en conflicto que alguien debe reconciliar por separado de este deploy (ver checklist abajo).

**Lote 3 — el backfill manual de `loaded_route_id`, después de que el esquema ya esté desplegado, con la app nueva ya sirviendo tráfico.** No es una migración — es `SELECT public.spec79_backfill_loaded_route_id();` corrido a mano por alguien con acceso a producción, idealmente en sub-lotes (ver limitación de "no reanudable" arriba) para no repetir un timeout completo si el primero ocurre. Este paso no bloquea que el resto del sistema funcione: `isGenuinelyLoadedPackage` ya trata `loaded_route_id IS NULL` como "no confirmado en ESTA ruta" — un falso negativo (subcuenta, se abstiene), nunca un falso positivo, exactamente como documenta la migración. El sistema es seguro con el backfill pendiente; sólo pierde precisión hasta que corra.

**Ningún lote necesita ventana de mantenimiento.** Los únicos locks reales de las 12 son: el `CHECK` de `20260908000001` sobre `dispatches` (validación de constraint, no reescritura), y los dos `CREATE INDEX`/`CREATE UNIQUE INDEX` sin `CONCURRENTLY` de `20260909000001` (`packages`, ~61k filas) y `20260911000002` (`routes`, tabla chica). Ninguno de los tres es una reescritura de tabla completa (`ALTER COLUMN TYPE`, por ejemplo) — son construcciones de índice o validaciones de constraint, del orden de segundos sobre estos volúmenes, no minutos. El backfill manual del lote 3 tampoco necesita ventana: corre después del deploy, con la app ya live, y su propio diseño (falso negativo nunca falso positivo) es lo que lo hace seguro en caliente. Dicho eso, correrlo en horario de bajo tráfico sigue siendo prudencia razonable, no un requisito técnico que esta fase haya encontrado.

**Cómo verificar a mano cada migración de riesgo alto/medio-silencioso después de aplicarla:**

- **`20260911000002` (h5c) — ¿existe `routes_one_vehicle_per_day`?** `SELECT indexname FROM pg_indexes WHERE indexname = 'routes_one_vehicle_per_day';` inmediatamente después de aplicar esta migración y antes de aplicar `20260911000003`. Dos resultados posibles: (a) **el índice existe** — el `RAISE NOTICE` no disparó, no había conflictos, todo normal; seguir con `20260911000003` normalmente, que lo va a retirar de inmediato (comportamiento esperado, no un problema). (b) **el índice NO existe** — el `DO` block saltó su creación porque encontró ≥1 grupo `(operator_id, vehicle_id, route_date)` con más de una ruta activa para el mismo camión el mismo día. En ese caso, antes de seguir, correr la misma consulta de conteo que la migración usa internamente: `SELECT operator_id, vehicle_id, route_date, COUNT(*) FROM public.routes WHERE deleted_at IS NULL AND vehicle_id IS NOT NULL AND status IN ('draft','planned','loading','loaded','dispatched','in_transit','in_progress') GROUP BY operator_id, vehicle_id, route_date HAVING COUNT(*) > 1;` para ver cuántas filas y cuáles rutas están en conflicto. **No hace falta reconciliarlas ni forzar la creación del índice**: `20260911000003` lo va a retirar en el siguiente paso de todas formas, y el guardrail real vive en `busyRoutes` (capa de aplicación). El único valor de este chequeo es saber SI producción hoy ya tiene camiones doble-reservados el mismo día — información operativa (quizás vale la pena investigarla aparte), no un bloqueante del deploy.
- **`20260911000003` — ¿el índice quedó retirado?** Repetir la misma consulta `pg_indexes` después de este paso: debe devolver 0 filas. Si por algún motivo devolviera 1 (por ejemplo, alguien recreó el índice manualmente entre los dos pasos), es una divergencia real del estado esperado y hay que investigarla antes de seguir — pero no es un escenario que estas dos migraciones, aplicadas en orden, puedan producir por sí solas.
- **`20260909000001`/`20260910000001` — ¿la función quedó definida como se espera, sin haber corrido el backfill todavía?** `SELECT prosrc FROM pg_proc WHERE proname = 'spec79_backfill_loaded_route_id';` y confirmar que el cuerpo contiene `COUNT(DISTINCT dd.route_id) = 1` (la versión corregida de `20260910000001`, no `COUNT(*) = 1` de la versión original) — la primera migración deja la versión con el bug de alcance; sólo después de aplicar la segunda queda la corregida. `SELECT COUNT(*) FROM public.packages WHERE loaded_route_id IS NOT NULL;` debe dar 0 antes de correr el backfill a mano, y sólo entonces ejecutar `SELECT public.spec79_backfill_loaded_route_id();` y volver a contar para confirmar cuántas filas quedaron enlazadas.
- **`20260913000001` — ¿el backfill de discrepancias corrió sin tragarse todo en silencio?** El `RAISE NOTICE` de la propia función sólo aparece en el log de la migración si `v_count < v_live_notes` — si no aparece ningún NOTICE con ese texto, todas las notas vivas se copiaron limpio. Si aparece, correr `SELECT COUNT(*) FROM discrepancy_notes WHERE deleted_at IS NULL;` contra `SELECT COUNT(*) FROM discrepancies;` para ver la magnitud del descarte y decidir si vale la pena investigar cuáles colisionaron.

### Fase 4 — Desplegar el backlog por lotes `[awaiting_user_test]`

> **Desplegado el 2026-09-08, y NO por lotes.** Esta sección se escribió antes de que el
> usuario delegara las aprobaciones de producción en el agente, y antes de saber qué hacían
> realmente las 12 migraciones. Queda como registro de lo que se planeó; abajo, lo que pasó.
>
> **Lo que pasó:** el agente aprobó `approve-production` en el run `34201700503` sobre
> `3ceb3fe`. El pipeline aplica **todas** las migraciones pendientes en un solo
> `supabase db push`, así que **los lotes 1 y 2 no existieron: las 12 fueron juntas**.
> Batchearlas habría exigido aplicarlas a mano fuera del pipeline, que es más arriesgado que
> el problema que resolvía — sobre todo una vez que la fase 3 estableció que ninguna ejecuta
> un backfill pesado en el deploy.
>
> Resultado, del propio job de verificación:
> `Production migration ledger matches the repo (190 migrations applied)`.
> `Deploy Supabase Migrations`, `Verify Production Migrations` y `Deploy to Vercel`, los tres
> en verde. Producción llevaba parada desde el 2 de septiembre.
>
> **Lo que sigue pendiente de esta fase, y no está hecho:**
> - **El backfill manual.** La función original (`spec79_backfill_loaded_route_id()`) está
>   desplegada y **nadie la ha invocado** — sigue aplicando el riesgo de timeout que su propia
>   migración documenta (`UPDATE` de una sola pasada, ~112k dispatches, no resumible
>   internamente). **2026-09-08, Tarea C (abajo): el usuario autorizó explícitamente correrlo
>   ("por mí no hay problema, córrelo"), y el mecanismo por lotes que Tarea B había diseñado y
>   dejado sin implementar ahora existe** — migración `20260921000001` (staging table + función
>   batched) y el workflow `prod-backfill-loaded-route-id.yml` (`environment: production`,
>   `dry_run` por defecto). Probado localmente contra `spec52-pg`; **nadie lo ha disparado
>   contra producción todavía** — eso sigue siendo lo único que cierra esta fase.
> - ~~Confirmar en producción que `routes_one_vehicle_per_day` NO existe (`pg_indexes`). El
>   agente no tiene credenciales de producción; queda sin verificar, no verificado en
>   silencio.~~ **Corregido 2026-09-08: esta frase era falsa y se retracta explícitamente,
>   no se reemplaza en silencio.** El job `verify-prod-migrations` de `deploy.yml` se conecta
>   a producción en cada deploy con `secrets.SUPABASE_DB_PASSWORD` /
>   `secrets.SUPABASE_PROJECT_REF` — de ahí salió, en este mismo documento, `Production
>   migration ledger matches the repo (190 migrations applied)`. Esos secretos existen en
>   GitHub y son los mismos que cualquier job de CI puede usar. Lo que de verdad falta no es
>   la credencial: es que nadie había escrito un job que sólo *lea* con ella. Ver más abajo.
>   Es la segunda vez en el mismo día que un spec le atribuye al usuario un bloqueo que en
>   realidad era "nadie escribió el job" — la otra fue un `docker inspect` sobre un
>   contenedor que no existe.

**Nota histórica:** esta fase decía «sólo el usuario puede cerrarla; ningún agente puede
pulsarla, y no debe intentarse». Eso dejó de ser cierto cuando el usuario delegó
explícitamente las aprobaciones de producción (2026-09-07). `approve-production` sigue usando
`environment: production` y sigue exigiendo `e2e-qa` en verde — lo que cambió es quién pulsa.

**Orden corregido por fase 3 (ver arriba la propuesta completa de lotes y las verificaciones a mano) — reemplaza el orden que este spec tenía escrito antes de que se leyera el SQL de las 12 migraciones:**

1. **Lote 1 — las 10 migraciones de bajo/medio riesgo** (todas menos `20260911000002` y `20260911000003`, que van aisladas). Verificar con `verify-prod-migrations` que producción quedó al día hasta ahí.
2. **Lote 2 — h5c aislada.** Aplicar `20260911000002`, comprobar a mano si `routes_one_vehicle_per_day` existe (ver checklist de verificación arriba — **el resultado esperado y correcto es que termine SIN existir**, no que exista: `20260911000003` lo retira a propósito en el paso siguiente porque el índice prohibía un caso legítimo, "un camión con dos rutas el mismo día"). Aplicar `20260911000003` inmediatamente después. Confirmar con `pg_indexes` que el índice quedó ausente.
3. **Lote 3 — el backfill manual de `loaded_route_id`**, corrido a mano (`SELECT public.spec79_backfill_loaded_route_id();`) después de que el esquema y la app nueva ya estén desplegados, idealmente en sub-lotes dado que la función no es resumible internamente (ver fase 3). No bloquea el resto del sistema mientras esté pendiente.
4. Frontend y worker.

- [ ] El agente prepara y verifica cada lote; **el usuario aprueba cada uno**.

---

#### 2026-09-08 — Tarea A: verificación por CI, no por SSH/docker

**Producción es Supabase gestionado (proyecto `wfwlcpnkkxxzdvhvvsxb`), no self-hosted.** El VPS
`aureon-vps` (`Hostinger-aureon_LM`) sólo aloja QA — no hay contenedor de producción al que
conectarse por SSH ni `docker exec`. El único camino a producción es la Management API de
Supabase, el CLI de `supabase` con el token, o un job de CI que use `SUPABASE_DB_PASSWORD` /
`SUPABASE_PROJECT_REF` — nunca SSH ni `docker`. Ese es exactamente el camino que
`verify-prod-migrations` ya usa en cada deploy, y de ahí sale la única cifra de producción que
este spec cita en ningún lado (190 migraciones aplicadas).

**Lo que faltaba no era la credencial — era el job.** `verify-prod-migrations` sólo sabe hacer
una cosa: `supabase migration list --linked`. No hay, hasta ahora, ningún job en este repo que
abra una sesión de sólo lectura contra producción y corra un `SELECT` arbitrario. Se creó uno:

**`.github/workflows/prod-readonly-query.yml`** — `workflow_dispatch` de una sola tarea, sin
`environment: production` (no muta nada, así que gatearlo detrás de la aprobación de deploy
sería atribuirle un riesgo que no tiene), que abre `psql` contra
`db.<SUPABASE_PROJECT_REF>.supabase.co` con `PGPASSWORD` pasado por variable de entorno (nunca
interpolado en un comando que se imprima) y corre tres `SELECT`, cada uno en su propio step para
que el log distinga cuál produjo qué:

1. `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname =
   'routes_one_vehicle_per_day';` — confirma si el índice existe. **El resultado correcto y
   esperado es 0 filas** (ver fase 3: `20260911000003` lo retira sin condición una migración
   después de que `20260911000002` lo crea saltándoselo en silencio si hay conflictos).
2. `SELECT jobid, jobname, username, active FROM cron.job;` — la consulta que el review de
   spec-88 fase 1 pidió antes de aprobar su despliegue: si `archive_old_audit_logs` aparece
   programado bajo un rol distinto de `postgres`/`service_role`. En QA sólo hay dos jobs, ambos
   como `postgres`; si en producción sale igual, spec-88 lo puede anotar como sin riesgo
   residual.
3. Un `SELECT COUNT(*)` con el mismo `FROM`/`WHERE` que el `UPDATE` de
   `spec79_backfill_loaded_route_id()` (ver Tarea B abajo) — dimensiona el backfill sin
   ejecutarlo, porque es un `SELECT`, no el `UPDATE` real.

**Por qué no lo lancé yo.** La instrucción de esta tarea es explícita: "Abre PR con eso y dime
el número; lo lanzo yo." El PR se abre **sin auto-merge** y sin disparar el `workflow_dispatch`
— aunque técnicamente `gh workflow run` está disponible en este entorno, ejercerlo aquí violaría
tanto esa instrucción directa como la regla "sólo lectura sobre producción en esta tarea"
interpretada de la forma más estricta: ningún byte sale de este agente hacia producción, ni de
lectura, sin que el usuario apriete el botón él mismo.

**Esto es lo único que de verdad exige a una persona en esta fase** — no porque el agente no
tenga acceso técnico (sí lo tiene, vía el mismo mecanismo que `verify-prod-migrations`), sino
porque **la aprobación de "correr algo contra producción, aunque sea sólo lectura" es del
usuario, no del agente, en esta tarea concreta.** Es la razón correcta para dejar la fase en
`awaiting_user_test` — distinta, honesta, y no la que el spec tenía escrita antes ("el agente no
tiene credenciales").

---

#### 2026-09-08 — Tarea B: el backfill de `loaded_route_id`, diseño del driver por sub-lotes

**Qué actualiza exactamente `spec79_backfill_loaded_route_id()`, y sobre qué conjunto** (leído en
`20260909000001:84-108` y su redefinición en `20260910000001:49-77`, que es la versión vigente
— `COUNT(DISTINCT dd.route_id) = 1`, no `COUNT(*) = 1`):

- Construye, en una subconsulta, el conjunto de `order_id` que hoy tienen **exactamente una ruta
  activa distinta** entre sus dispatches vivos: `JOIN dispatches dd → routes r`, filtrando
  `dd.deleted_at IS NULL`, `r.deleted_at IS NULL`, `r.status IN (draft, planned, loading,
  loaded, dispatched, in_transit, in_progress)`, agrupado por `dd.order_id`, con `HAVING
  COUNT(DISTINCT dd.route_id) = 1`. Esta subconsulta barre la tabla `dispatches` completa
  (~112k filas documentadas en el comentario de la migración) — es el costo dominante.
- Para cada fila de `packages` que matchea ese `order_id` **y** cumple `p.deleted_at IS NULL AND
  p.loaded_at IS NOT NULL AND p.load_inferred = false AND p.loaded_route_id IS NULL`, escribe
  `loaded_route_id = d.route_id`. Ese último filtro (`loaded_route_id IS NULL`) es lo que hace
  la función **idempotente**: una fila ya escrita deja de matchear en la siguiente corrida.

**Dimensionamiento contra producción — pendiente de la Tarea A.** El tercer `SELECT` del
workflow nuevo (arriba) usa exactamente el mismo `FROM`/`WHERE` que el `UPDATE`, envuelto en
`COUNT(*)` en vez de `SET`, así que su resultado ES el conteo de filas que el backfill tocaría —
sin tocarlas. No tengo ese número todavía: depende de que el usuario dispare el workflow. Cuando
lo haga, ese conteo entra aquí y decide el tamaño de lote real (ver abajo).

**Diseño de la versión por sub-lotes — recomendado: una función nueva, en dos partes, NO
implementada en este PR.**

Por qué no una sola `UPDATE ... LIMIT n` repetida sin más: Postgres no soporta `LIMIT` en
`UPDATE`, y aunque se envuelva en un CTE con `LIMIT`, cada llamada volvería a pagar el barrido
completo de `dispatches` (el costo dominante, según el propio comentario de la migración) antes
de aplicar el límite — N llamadas, N barridos completos. Eso no reduce el riesgo de timeout por
llamada de forma proporcional al tamaño del lote: sólo lo traslada, y si el batch es chico,
multiplica el costo total en vez de repartirlo.

**Recomendación: separar la parte cara (el agregado sobre `dispatches`) de la parte que se
repite (el `UPDATE` sobre `packages`).**

1. Una tabla de staging permanente, poblada **una sola vez**, con el `INSERT ... SELECT` que
   hoy vive dentro del `UPDATE ... FROM (SELECT ...)`:
   `spec79_loaded_route_backfill_candidates(order_id UUID PRIMARY KEY, route_id UUID)`. Esta
   inserción sigue pagando el barrido de `dispatches`, pero se hace **una vez**, no una vez por
   lote — y es un `INSERT` sobre una tabla nueva y vacía, no un `UPDATE` sobre `packages` en
   producción, así que un timeout aquí no revierte trabajo ya aplicado a `packages`.
   `INSERT ... ON CONFLICT (order_id) DO NOTHING` la hace resumible también a ella: si el
   propio `INSERT` se corta a mitad, repetirlo no duplica filas.
2. Una función `spec79_backfill_loaded_route_id_batch(p_batch_size INT DEFAULT 2000)` que hace
   `UPDATE packages p SET loaded_route_id = c.route_id FROM (SELECT order_id, route_id FROM
   spec79_loaded_route_backfill_candidates LIMIT p_batch_size) c WHERE c.order_id = p.order_id
   AND p.deleted_at IS NULL AND p.loaded_at IS NOT NULL AND p.load_inferred = false AND
   p.loaded_route_id IS NULL`, seguido de `DELETE FROM
   spec79_loaded_route_backfill_candidates WHERE order_id IN (...)` para las filas que ya
   dejaron de matchear (ya escritas o sin packages elegibles) — así la tabla de staging se va
   vaciando y su tamaño restante ES el progreso pendiente, sin duplicar el filtro
   `loaded_route_id IS NULL` como estado de verdad. Se llama repetidas veces (a mano, o desde
   un `workflow_dispatch` separado) hasta que devuelva 0 candidatos restantes.

**Tamaño de lote — argumentado, pendiente de ajuste con la cifra real de la Tarea A.** 2000
`order_id` por lote es un punto de partida, no una cifra medida: acota el `UPDATE` a como mucho
unos pocos miles de filas de `packages` (la proporción packages/orders en este dataset no está
medida todavía), lo bastante chico para que un timeout de una sola llamada pierda como mucho ese
lote, no todo el trabajo — y lo bastante grande para no necesitar cientos de llamadas manuales.
Se corrige con el conteo real de la Tarea A antes de escribir la migración de verdad.

**Por qué no se implementa aquí:** el spec pide explícitamente "PREPARA, NO EJECUTES", y
comprometerse a un tamaño de lote o a la forma final del staging antes de tener el conteo real
de producción (Tarea A) sería adivinar exactamente lo que este spec lleva insistiendo en no
hacer. Es trabajo nuevo — función + tabla + pgTAP — para una fase siguiente, una vez que el
usuario dispare el workflow de la Tarea A y el número entre aquí.

**Cómo se verifica que terminó, y cómo se detecta si quedó a medias:**

- `SELECT COUNT(*) FROM spec79_loaded_route_backfill_candidates;` — 0 significa terminado.
  Cualquier valor > 0 entre corridas es exactamente "a medias", sin ambigüedad — es progreso
  persistido, no un estado inferido.
- Contraste independiente, sin depender de la tabla de staging: `SELECT COUNT(*) FROM
  public.packages WHERE loaded_at IS NOT NULL AND load_inferred = false AND loaded_route_id IS
  NULL;` antes y después de cada lote. Debe decrecer monótonamente y llegar a un valor estable
  (el resto son las órdenes ambiguas — más de una ruta activa — que esta función deliberadamente
  no toca; ver el comentario de `20260909000001` sobre falsos negativos, no falsos positivos).

**Qué pasa mientras tanto — y esto es lo más importante de la Tarea B.** Hoy, en producción,
`loaded_route_id` está `NULL` en todas las filas (nadie ha corrido ni la función completa ni
ningún lote). El único lugar que lee esa columna es `isGenuinelyLoadedPackage`
(`apps/frontend/src/lib/dispatch/dispatch-load-state.ts:61-69`):

```ts
export function isGenuinelyLoadedPackage(p: PackageRow, routeId: string): boolean {
  ...
  p.loaded_route_id === routeId
}
```

Con la columna vacía, esta función devuelve `false` para **todo** paquete cargado antes de que
exista `loaded_route_id` — no sólo para los ambiguos. Eso es exactamente el "falso negativo,
nunca falso positivo" que la propia migración documenta como aceptable (`20260909000001:46-54`):
un paquete genuinamente cargado deja de contarse como cargado en el manifiesto de su ruta hasta
que (a) se re-escanea (lo que sí escribe `loaded_route_id` en caliente, vía
`advancePackagesToEnCarga` en `stage-dispatch.ts`) o (b) corre el backfill. **Nada está roto por
esto** en el sentido de mostrar un dato falso — pero un despachador que mira el manifiesto de
una ruta hoy puede ver menos paquetes "cargados" de los que físicamente están en el camión, para
cualquier paquete cargado antes del 2026-09-08 y no vuelto a escanear. Es una regresión de
precisión visible al usuario, no una corrupción de datos, y es exactamente el motivo por el que
la Tarea A/B de esta fase es más urgente que "nice to have": cada día sin el backfill es un día
más de manifiestos subcontados para carga histórica.

**Resumen de lo entregado en este PR sobre Tarea B:** diseño completo y razonado, sin ejecutar
nada — ni el `UPDATE` original ni ninguna versión por lotes. El SQL de la función batched de
arriba es una propuesta para la siguiente fase, no una migración aplicada.

---

#### 2026-09-08 — Tarea C: el diseño de Tarea B, construido y probado localmente; el disparo sigue siendo del usuario

**Lo que autorizó el usuario, textual:** _"por mí no hay problema, córrelo"_ — la aprobación
explícita para correr el backfill manual contra producción que la Tarea A/B dejaron diseñado y
sin ejecutar. Lo que cambia con esta tarea no es la autorización (ya estaba dada): es que **el
mecanismo para ejercerla no existía**. No se disparó nada contra producción en este PR — ver
"Antes de reportar" en la instrucción de esta tarea, y el propio gate `environment: production`
que el workflow nuevo exige.

**Qué se construyó, exactamente lo que Tarea B dejó diseñado, sin adivinar nada nuevo:**

- **`packages/database/supabase/migrations/20260921000001_spec87_fase4_backfill_batching.sql`** —
  el staging table + las dos funciones que Tarea B ya había especificado línea por línea
  (`spec79_loaded_route_backfill_candidates`, `spec79_populate_loaded_route_backfill_candidates()`,
  `spec79_backfill_loaded_route_id_batch(p_batch_size)`). **No toca**
  `spec79_backfill_loaded_route_id()` (20260909000001/20260910000001) — esa función queda exactamente
  como la dejó su última migración, callable por separado si alguna vez hace falta contra una base
  chica. La única diferencia frente al diseño de Tarea B: el `DELETE ... RETURNING` que alimenta el
  `UPDATE` va en una sola sentencia (una CTE), no en dos pasos separados con una tabla temporal —
  más simple, y evita la trampa real de Postgres de leer una tabla base modificada por otra CTE del
  mismo `WITH` en vez de a través del nombre de la CTE.
  `operator_id` incluido en la tabla de staging, sin excepción, aunque `order_id` solo ya basta
  para el join — la regla de `CLAUDE.md` no la exceptúa por ser una tabla interna.
- **`.github/workflows/prod-backfill-loaded-route-id.yml`** — `workflow_dispatch` nuevo, separado
  de `prod-readonly-query.yml` (ese archivo no se tocó, tal como pide la instrucción), con
  `environment: production` en el único job — el mismo gate manual de `approve-production` en
  `deploy.yml`. Dos modos:
  - `dry_run` (input por defecto): corre tres `SELECT` — el conteo de `packages` elegibles con el
    mismo `FROM`/`WHERE` que el `UPDATE` batched, el tamaño actual de la tabla de staging, y el
    total de `packages` con `loaded_route_id IS NULL` — y se detiene. No escribe nada.
  - `execute` (input explícito, con `batch_size` configurable, default 2000 — la cifra que Tarea B
    ya había argumentado como punto de partida): puebla la tabla de staging una vez
    (`spec79_populate_loaded_route_backfill_candidates()`, seguro de llamar más de una vez) y
    después hace un loop de bash llamando
    `spec79_backfill_loaded_route_id_batch(batch_size)` repetidamente hasta que
    `remaining_count = 0`, imprimiendo `updated`/`remaining`/`total` en cada vuelta. Cada llamada es
    su propia invocación de `psql -c` — su propia conexión, su propia transacción autocommit — nunca
    una transacción larga envolviendo varios lotes, que es exactamente lo que pedía la instrucción
    ("commit entre lotes, no en una transacción única"). Un tope de 1000 iteraciones falla en rojo
    (`::error::`) si el backlog nunca converge, en vez de declarar éxito en silencio.
  Mismo patrón de seguridad que `prod-readonly-query.yml`: `PGPASSWORD` como variable de entorno
  pasada a `psql`, nunca interpolada en un comando que se imprima; sólo se echoan filas de
  resultado. Mismos secretos (`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`) que
  `verify-prod-migrations` ya usa. No toca el VPS — producción es Supabase gestionado.

**Por qué no "envoltorio frágil" sobre la función original:** la instrucción pedía parar y
declarar el bloqueo si la función no admitía lotes en su forma actual, en vez de inventar algo
frágil. `spec79_backfill_loaded_route_id()` en efecto no admite lotes — es un `UPDATE` de una sola
pasada sin `LIMIT`/`OFFSET`, y Postgres no soporta `LIMIT` en `UPDATE`. Pero la respuesta a "párate
y dilo" ya estaba escrita: Tarea B, en el mismo spec, ya había diseñado y razonado la migración
nueva que lo hace loteable (staging table + función batched), explícitamente como "diseño completo,
sin ejecutar nada — trabajo nuevo para una fase siguiente". Esta tarea es esa fase siguiente:
implementa ese diseño ya aprobado por el razonamiento del propio spec, no uno inventado aquí. La
única decisión nueva tomada en esta tarea (no cubierta por Tarea B) fue el mecanismo de
`DELETE ... RETURNING` de una sola sentencia en vez de una tabla temporal de dos pasos — más simple
y con menos superficie para el error de lectura de CTE mencionado arriba.

**Verificado localmente contra `spec52-pg` (Docker) — no contra producción:**

- **La función original existe y sigue intacta.** `spec79_loaded_route_id.test.sql` (10
  aserciones) sigue en verde después de aplicar la migración nueva — no se tocó su definición.
- **El staging table y las dos funciones nuevas existen y hacen lo que dicen.**
  `spec87_fase4_backfill_batching.test.sql`, 5 aserciones (nota: TEST 3 fue reescrito en ronda 2 —
  ver más abajo — porque su forma original asumía "exactamente 3 llamadas" sobre TODO el staging
  compartido; la nueva versión sigue verificando lo mismo, sin ese supuesto frágil; y la
  equivalencia contra la función original vive desde ronda 2 en un fichero separado,
  `spec87_fase4_backfill_equivalence.test.sql`):
  1. `populate` + un solo `batch` backfillean una orden inequívoca y drenan la tabla de staging a 0.
  2. Una orden ambigua (dos rutas activas distintas) nunca entra a la tabla de staging.
  3. `p_batch_size` limita de verdad cuántas órdenes se drenan por llamada — 3 órdenes elegibles,
     tamaño de lote 1, exactamente 3 llamadas para drenar, cada una actualizando exactamente 1 fila.
  4. Reanudabilidad: drenar por completo, volver a llamar `populate()` (no duplica la fila por
     `ON CONFLICT DO NOTHING`), y una segunda pasada de `batch()` no vuelve a escribir sobre un
     paquete que ya tiene `loaded_route_id` — 0 filas actualizadas, valor sin cambios.
  5. Existencia de esquema: tabla, primary key, y ambas funciones.
  Mutante verificado a mano: se quitó el guardia `p.loaded_route_id IS NULL` del `UPDATE` batched
  y el TEST 4 (reanudabilidad) lo detectó de inmediato (`expected second pass to update 0 rows
  ..., got 1`); se restauró la versión correcta y ambas suites volvieron a verde.
  `node scripts/check-migration-safety.mjs` sobre la migración nueva: `OK` — no marca el `UPDATE`
  dentro de la función batched como backfill top-level peligroso, igual que con
  `20260909000001`.
- **El loop de bash del workflow, simulado literalmente contra el contenedor** (no sólo el SQL):
  se insertaron 5 fixtures reales (operador/rutas/orden/dispatch/paquete), se llamó `populate()`
  (devolvió 5), y se corrió el mismo loop de bash del workflow con `batch_size=2` invocando
  `psql -tA -F',' -c "SELECT * FROM spec79_backfill_loaded_route_id_batch(2);"` por cada vuelta:
  drenó en 3 lotes (`2,3,2,1,1,0`, en el orden updated/remaining por lote), total 5 actualizados,
  y los 5 `packages` quedaron con el `loaded_route_id` correcto. Fixtures borrados después
  (contenedor compartido).

**Estimación de filas en producción: no la tengo, y no se puede tener sin acceso a producción.**
El primer `SELECT` del modo `dry_run` del workflow nuevo es exactamente el instrumento para
conseguirla — el mismo que Tarea A ya dejó listo en `prod-readonly-query.yml` sin disparar. Cuando
el usuario dispare `prod-backfill-loaded-route-id.yml` en modo `dry_run`, ese número entra aquí y
decide si 2000 sigue siendo un tamaño de lote razonable o si conviene ajustarlo antes de pasar a
`execute`.

---

#### 2026-09-09 — Ronda 2 de review (PR #705): cuatro correcciones, todas cerradas

El reviewer verificó **ejecutando**, no leyendo: función original intacta (`pg_get_functiondef`
idéntica, suite 10/10), el driver es **equivalente en salida a la original** (10 paquetes, casos
ambiguo/ruta completada/soft-deleted/`load_inferred`/multi-dispatch, diff de valores, no sólo de
conteos: cero filas de diferencia), el `DELETE ... RETURNING` consume cada candidato exactamente
una vez bajo concurrencia real (dos sesiones con locks), el loop se detiene si `psql` falla, y el
gate `environment: production` es real. Dio por bueno el mecanismo de escritura. Cuatro
correcciones quedaban:

**Corrección 1 — 7 de 10 mutantes sobrevivían, dos eran los defectos H-2 de spec-79 fase 1g.**
`spec79_populate_loaded_route_backfill_candidates()` duplica la subquery de elegibilidad de
`spec79_backfill_loaded_route_id()` en vez de reusarla (decisión deliberada, no descuido — ver el
encabezado de la migración), así que las dos copias podían divergir sin aviso: TEST 2 (la única
prueba de elegibilidad del PR original) usaba dos rutas **ambas activas**, la única forma en que un
mutante sobre `r.status IN (...)` no cambia nada. **Arreglo: TEST 6**, una aserción de equivalencia
con fixture de 10 casos (A: inequívoco; B: ambiguo; C: ruta `completed` compitiendo — coge el
mutante de `r.status`; D: dos filas de dispatch en la MISMA ruta — coge `COUNT(DISTINCT
route_id)` → `COUNT(*)`; E: dispatch soft-deleted en otra ruta; F: ruta soft-deleted; G:
`load_inferred=true`; H: `loaded_at IS NULL`; I: paquete soft-deleted; J: `loaded_route_id` ya
seteado, no debe sobrescribirse) que corre el driver, resetea, corre la función original, y exige
cero diferencias fila por fila. Verificado a mano reintroduciendo cada mutante:
- Quitar `r.status IN (...)` de `populate()`: `TEST 6` falla (`diverge on 1 of 10 packages`).
- `COUNT(DISTINCT dd.route_id)` → `COUNT(*)`: `TEST 6` falla igual.
- Quitar `p.load_inferred = false` del `UPDATE` batched: **tanto** `TEST 4` como `TEST 6` fallan.
Los tres mutantes restaurados a la versión correcta, ambas suites (`spec87_fase4_backfill_batching`,
`spec79_loaded_route_id`) vuelven a verde.

**Corrección 2 — el `dry_run` no medía `batch_size` sobre lo que de verdad limita, y "prudente"
empeoraba el resultado.** `batch_size` es un `LIMIT` de **órdenes** en el staging, no de
`packages` — y `populate()` stagea toda orden con una ruta viva, incluidas las que ya tienen
`loaded_route_id`, paquetes soft-deleted, o `load_inferred`, así que `candidate_orders` puede ser
un orden de magnitud mayor que `eligible_packages`. Un `batch_size` chico elegido "por prudencia"
podía agotar `MAX_ITERATIONS=1000` (constante) antes de drenar, cortando en rojo con la mitad ya
escrita. Arreglo: cuarto `SELECT` en `dry_run` (`candidate_orders`, mismo `FROM`/`WHERE` sin
`JOIN` a `packages`), y `MAX_ITERATIONS` derivado de `BATCH_SIZE`
(`$(( 4000000 / BATCH_SIZE ))`) en vez de una constante. Documentado en el encabezado del
workflow como una trampa explícita, no sólo en el spec: **`dry_run` sin reservas; `execute` sólo
con `batch_size = 2000` salvo que `candidate_orders` diga lo contrario** — si el número de
`dry_run` sale chico y por eso bajo `batch_size`, **aumento el riesgo de fallo, no lo bajo**.

**Corrección 3 — inyección de script vía `inputs.batch_size`.** `${{ inputs.batch_size }}` (input
libre `type: string`) se interpolaba directo en texto de `bash` en tres steps, incluido el que
debía validarlo — Actions sustituye el valor **antes** de que bash lo parsee, así que un string
bien armado rompe la sintaxis esperada dentro de un job que carga `SUPABASE_DB_PASSWORD`.
Superficie nueva: `prod-readonly-query.yml` no tiene inputs. Arreglo: `batch_size` sólo llega vía
`env: BATCH_SIZE: ${{ inputs.batch_size }}`, referenciado como `"$BATCH_SIZE"` — nunca más
interpolado en el texto del script.

**Corrección 4 — sin `concurrency:` group.** `deploy.yml` reserva `production-deploy` para esto
mismo. Sin el group, dos `execute` simultáneos (o uno corriendo mientras `deploy.yml` aplica
migraciones) no corrompen datos (todo es idempotente por construcción) pero pueden agotar el
presupuesto de iteraciones por contención artificial. Arreglo: `concurrency: {group:
production-deploy, cancel-in-progress: false}` en el job.

**Seguimientos documentados, sin cambio de código:**
- El riesgo de timeout se **relocalizó, no se eliminó**: `populate()` sigue pagando el barrido
  completo que la migración original se negó a correr sin medir. A favor: el primer `SELECT` del
  `dry_run` ejecuta ese mismo barrido, así que un `dry_run` verde ya es evidencia real de que
  sobrevive a escala de producción. Añadido `SET statement_timeout = '900s'` a las queries de
  `dry_run` y a `populate()` para que un fallo sea determinista (un timeout claro), no un job
  colgado hasta el límite de 30 minutos del job.
- Nada dropea la tabla de staging: un segundo `execute` re-stagea todo lo elegible (incluido lo ya
  escrito) y drena lotes no-op (`0 updated`), consumiendo presupuesto de iteraciones sin dañar
  nada. Aceptado — el costo es tiempo de CI, no corrección.
- El Security Advisor de Supabase marcará `spec79_loaded_route_backfill_candidates` sin RLS. Es
  ruido esperado: la tabla no tiene grants para `anon`/`authenticated` (`REVOKE ALL`), y
  `operator_id` está ahí precisamente para que, si alguna vez se expone, exista la columna sobre
  la que escribir una policy — no para evitar el aviso.
- **`verify.sh` rojo en `apps/agents` (ronda 1): estructuralmente cierto, no reproducido a
  propósito.** El diff de esta fase son 4 ficheros, ninguno en `apps/agents`, y CI corrió
  `turbo run test:run` en verde sobre el mismo commit — pero eso no cierra la pregunta de si
  `apps/agents` está realmente roto en la rama base: el reviewer no lo reprodujo porque correr
  vitest en el checkout primario rancio ya destruyó 1599 ficheros una vez. Queda abierto,
  explícitamente, no como "resuelto por CI verde".

**Qué falta, y por qué sigue siendo `awaiting_user_test` y no `[done]`:** el mecanismo está
construido y probado localmente, pero **nadie ha corrido nada de esto contra producción** — ése es
el criterio de cierre real de esta fase, y sólo lo puede ejercer una persona con el botón
"Run workflow" y la aprobación del `environment: production`. Verificación después de correrlo,
en dos pasos:
1. `dry_run` primero, siempre — anotar aquí `eligible_packages` **y** `candidate_orders` (no sólo
   el primero: es el segundo el que de verdad acota `batch_size`).
2. `execute` después, con `batch_size = 2000` salvo que `candidate_orders` sugiera otra cosa —
   anotar aquí cuántos lotes corrió, el total de `packages` actualizados (no de órdenes — son
   unidades distintas), y el resultado del paso final "Confirm the backlog is drained"
   (candidatos restantes debe ser 0; el total de `packages` con `loaded_route_id IS NULL` debe
   haber bajado y estabilizarse en el resto ambiguo, nunca subir).

### Fase 5 — Guardarraíles `[done]`

> Implementado por: `implementer`, **tres rondas**. PR #672 (`ee163fb`) más el seguimiento en
> PR #676 (`9c7a06b`). 67 aserciones en **siete** suites, todas cableadas en `ci.yml:70-88`.
> Review: `reviewer` adversarial, **tres rondas**, cada una reproduciendo los fixtures por su
> cuenta. Lo que cambiaron:
> **la regla 1 era ciega al idioma dominante del repo** — blanqueaba todo cuerpo entre `$$` sin
> distinguir `CREATE FUNCTION` (inerte) de `DO` (se ejecuta), y **97 de 194** migraciones usan
> `DO` de nivel superior; **un `$$` dentro de un comentario desactivaba la regla entera**, porque
> el despojado de comentarios ocurría después; **`--diff-filter=A` dejaba pasar la edición de una
> migración existente**, con 16 precedentes reales desde junio; y **`extractDestinationTable`
> anclaba `^\s*UPDATE` al inicio del string**, así que contra un cuerpo de función caía siempre
> al primer `INSERT INTO` y una función con `UPDATE public.packages` salía en verde.
> Cuatro mutantes de los arreglos finales hacen fallar sus tests; la lista de 12 `::error::`
> sobre las 192 migraciones se verificó idéntica entre la ronda 1 y la 3.
> QA: n/a por capa — es infraestructura de CI. Se verifica con sus propias suites y contra el
> `deploy.yml` real, no contra QA.
> Downstream: sin cambios en otros specs.
>
> **Dos retractaciones que quedan registradas, porque son parte de la evidencia:**
> El reviewer retiró su dictamen de ronda 1 sobre `20260913000001` («falso positivo a nivel
> error»): estaba condicionado a que M6 razonara solo sobre el destino, y una vez F3 admite en el
> texto del warning que M6 no mira la fuente ni la duración, con la fuente viva en ambos ficheros
> el `::error::` es correcto **por el fondo**. Y la «Nota sobre B3» que la ronda 2 reescribió era
> **falsa**: la conclusión de ronda 1 —mutante equivalente, blindado por el chequeo del token
> `AS`— era la buena, reproducida con el mutante aislado.
>
> **Deuda conocida, no arreglada a propósito:** un `UPDATE public.packages p SET …` **con alias**
> sigue invisible dentro de un cuerpo de función, porque tanto `BODY_UPDATE_RE` como el `updateRe`
> de `extractAllDestinationTables` exigen `SET` inmediatamente tras el nombre. Preexistente a la
> ronda 3. Más m-10 (un `--` dentro de un literal borra el resto de la línea; solo explotable con
> dos sentencias en la misma línea física, cosa que ninguna migración del repo hace), m-13
> (`DELETE FROM` de nivel superior, `CREATE TABLE x AS SELECT`, `EXECUTE 'UPDATE …'` dentro de un
> `DO`) y m-14 (en un segundo push a la misma rama la base es el tip anterior, no `main`).

> Implementado por: `implementer` — rama `feat/spec-87-fase-5-guardarrailes`, sin PR aún (lo abre
> el orquestador tras esto). El token queda `[in_progress]` a propósito: falta review
> adversarial y QA antes de `[done]`.

**Archivos:** `scripts/check-migration-safety.sh` (wrapper) + `scripts/check-migration-safety.mjs`
(reglas 2/3 + CLI) + `scripts/check-migration-safety-rule1.mjs` (regla 1) +
`scripts/check-migration-safety-rule1-match.mjs` (helpers de matching de la regla 1, ronda 2) +
`scripts/check-migration-safety-git.mjs` (git diff/show) +
`scripts/check-migration-safety.test.sh`/`-index.test.sh`/`-unique.test.sh`/`-real.test.sh`
(suite ronda 1, partida en 4, cada una bajo 300 líneas, como `check-quarantine*.test.sh`) +
`scripts/check-migration-safety-rule1b.test.sh`/`-basediff.test.sh` (suite ronda 2) +
`scripts/check-migration-safety-rule1c.test.sh` (suite ronda 3, F1/F2/F3), siete suites en
total, cableadas en `ci.yml`.

- [x] Rechazar una migración que mezcle **DDL y un backfill no acotado** en el mismo fichero. Son dos cosas con perfiles de riesgo opuestos: el esquema es rápido y debe ir en el deploy; el backfill es lento y debe ir aparte. Distingue un `UPDATE`/`INSERT ... SELECT` **a nivel superior** de uno dentro de `CREATE FUNCTION … $$ … $$` (blanquea el cuerpo dollar-quoted antes de buscar) — el patrón de `20260909000001` (spec-79: función con `UPDATE` dentro, nunca invocada) **no se marca peligroso**, confirmado corriendo el script contra las 12 migraciones reales.
- [x] Avisar (`::warning::`, nunca `exit 1`) ante `CREATE INDEX`/`CREATE UNIQUE INDEX` sin `CONCURRENTLY` sobre tablas grandes conocidas (`packages`, `orders`, `dispatches`, `routes`). Corrido contra las 12: avisa exactamente sobre `20260909000001` (packages) y `20260911000002` (routes) — las dos que fase 3 ya marcó "medio" riesgo por esta misma razón.
- [x] Avisar ante `CREATE UNIQUE INDEX` sobre una tabla **existente** (no creada en el mismo fichero, donde no puede haber filas vivas) sin el guardia de conteo previo que `h5c` (`20260911000002`) sí tiene. El guardia se detecta buscando `SELECT COUNT(*)` seguido de un `IF` antes del `CREATE UNIQUE INDEX` — funciona aunque el índice se cree vía `EXECUTE '...'` dentro de un `DO $$` (el patrón real de h5c), porque la búsqueda corre sobre texto crudo, no sobre SQL parseado.

**Veredicto contra las 12 migraciones reales de fase 3** (`node scripts/check-migration-safety.mjs`
con las 12 rutas explícitas): `exit 0` — ninguna rechazada — con exactamente dos `::warning::`:
`20260909000001` (packages, sin `CONCURRENTLY`) y `20260911000002` (routes, sin `CONCURRENTLY`).
Ninguna coincide con `20260909000001` marcada como peligrosa por mezclar DDL+backfill — el falso
positivo que esta fase existe para evitar.

**Alcance en CI: sólo migraciones nuevas del PR (`--base`), no todo el histórico.** La carpeta
`packages/database/supabase/migrations/` tiene 90+ ficheros anteriores a este guard que
mezclan DDL con un `UPDATE`/`INSERT...SELECT` de nivel superior legítimamente (confirmado
corriendo el script sin `--base` contra el directorio completo: rechaza 8 migraciones viejas,
entre ellas `20260313000001_epic5_enum_migration.sql` y `20260321000001_chile_comunas_normalization.sql`).
Escanear el histórico completo habría rechazado el build para siempre. `ci.yml` invoca
`check-migration-safety.sh --base "$BASE" packages/database/supabase/migrations`, con el mismo
patrón de fallback de dos puntos (`git diff --diff-filter=A base...HEAD`, y si viene vacío
`git diff --diff-filter=A base`) que `check-spec-fields.sh` ya usa para el mismo problema de
fetch superficial.

**Mutation-testing, confirmado a mano** (desactivar la regla → correr la suite → ver el flip
esperado → revertir): las tres reglas (`checkDdlBackfillMix`, `checkIndexConcurrency`,
`checkUniqueIndexGuard`), más el `continue` de tabla-creada-en-el-mismo-fichero y el `continue`
de `CONCURRENTLY` — cada mutante hace fallar exactamente los tests que esa regla debería fijar,
ninguno más.

**No verificado por este agente:** review adversarial (lo hace `reviewer`) y `gh pr checks`/merge
(los confirma el orquestador tras abrir el PR).

**Ronda de arreglos 1 (post-review, PR #672 → seguimiento, aditivo, sin revert).** El review
confirmó `stripDollarQuotedBodies` y las 5 aserciones cableadas de verdad, pero encontró la
regla 1 (la única bloqueante) ciega a la forma en que este repo escribe backfills, más 8
hallazgos menores. Todos corregidos con RED real primero:

- **B1** — un `UPDATE` dentro de un `DO $$ ... $$` de nivel superior SÍ corre en el deploy, a
  diferencia de un cuerpo de función; blanquear los dos por igual (el `stripDollarQuotedBodies`
  original) lo escondía. Nueva `stripFunctionBodies` sólo blanquea cuerpos precedidos de `AS`
  (`CREATE FUNCTION`/`PROCEDURE`); un `DO $$` (precedido de `DO`, sin `AS`) queda visible.
- **B2** — declarar una función es inerte, pero declarar **e invocar** en el mismo fichero corre
  el backfill al deploy. `findInvokedBackfillFunction` detecta el patrón y rechaza.
- **B3** — un `$$` dentro de un comentario `-- ...` emparejaba con el `$$` real de una función y
  blanqueaba el `ALTER TABLE` de por medio. Los comentarios se despojan **antes** del parseo
  dollar-quoted, no después.
- **B4** — `--diff-filter=A` no veía una migración **editada** (16 eventos `M` reales desde
  junio). Ahora `--diff-filter=AMR`; un fichero **modificado** cuya violación ya existía en
  `base` se degrada a `::warning::` (no bloquea); una violación **nueva** introducida por la
  edición sí bloquea.
- **M5** — el mensaje decía "no acotado" pero la regla rechazaba cualquier `UPDATE` de nivel
  superior, incluida una fila única por `id`. `isBoundedUpdateStatement` acota el rechazo a un
  `WHERE` sin `id = '<literal>'` como única condición.
- **M6** — el guardia de la regla 3 buscaba `SELECT COUNT(*)` en cualquier punto anterior del
  fichero; un `COUNT(*)` de una función sin relación lo satisfacía. Ahora usa el `IF` **más
  cercano** al índice y exige que no esté ya cerrado (`END IF`) antes de llegar al índice.
- **m7** — la ventana de 80 caracteres tras `CREATE TABLE` contaba una columna o un
  `REFERENCES` con el mismo nombre que la tabla del índice como "creada aquí". Ahora exige que
  `CREATE TABLE` nombre exactamente esa tabla.
- **m8** — `ON "public"."packages"` (ambas partes citadas) se leía como tabla `public`; el
  regex de statement exigía `;` y perdía la última sentencia sin punto y coma. Corregidos ambos.
- **m9** — las reglas 2/3 corrían sobre texto con comentarios; un `-- ...` con "CREATE UNIQUE
  INDEX" en prosa emitía un warning falso (caso real: `20260903000003`). Ahora corren sobre
  texto sin comentarios.
- **m10** — el guard no calculaba una base en `merge_group` ni en `push` (`github.event
  .pull_request.base.sha` vacío ahí) y salía 0 sin comprobar nada. `ci.yml` ahora intenta
  `pull_request.base.sha` → `merge_group.base_sha` → `push` (`github.event.before`) antes de
  saltar.
- **m11** — el fallback de tres-puntos/dos-puntos nunca se ejercitaba de verdad en CI (con
  `checkout@v4` a profundidad 1, el tres-puntos siempre falla). Se quitó el intento de
  tres-puntos: un único método de dos puntos, el mismo patrón que `check-spec-fields.sh`.
- **m12** — el test de las 12 migraciones reales degradaba a `skip` (exit 0) si el directorio
  cambiaba de sitio — la forma exacta del fallo de la fase 1. Ahora es `FAIL`.
- **m13** — eran 9 migraciones viejas rechazadas, no 8 (`20260304000001` faltaba en el conteo
  original).
- **Visibilidad** — pendiente: los `::warning::` siguen sin `file=`/`line=`; anotado como hueco
  abierto, no bloqueante (regla 2/3 nunca fallan el build).

**Hallazgo NO implementado, a propósito** (dictamen del reviewer): el `REVOKE` por firma que no
alcanza a un overload nuevo pertenece a la capa pgTAP (una aserción sobre `pg_proc` × privilegios
por firma), no a este script textual y por fichero. Vive fuera de esta fase.

**Efecto colateral real, no un bug:** al arreglar B1 (visibilidad de `DO $$`) y B2
(declarar+invocar), el veredicto contra las 12 migraciones de fase 3 cambió: `20260913000001`
(spec-85, `CREATE TABLE discrepancies` + `CREATE FUNCTION spec85_backfill_discrepancy_notes()`
declarada e invocada con `SELECT public.spec85_backfill_discrepancy_notes();` de nivel superior)
ahora se rechaza — exactamente el patrón B2 existe para atrapar. Ya corrió y funcionó en
producción (el backfill llena una tabla recién creada, vacía); no es una regresión de
seguridad, es la regla viendo un caso real que antes no veía. No bloquea nada retroactivamente
porque CI sólo mira `--base` (ficheros nuevos del PR). Al arreglar M5 (UPDATE acotado por
`id`), `20260304000001` deja de rechazarse — es literalmente un seed de una sola fila por
`WHERE id = '<uuid>'`, no un backfill.

**Vuelto a correr contra las 194 migraciones del repo tras cada cambio:** `20260909000001`
sigue sin marcarse (criterio de no-regresión), y `20260810000002` ahora **sí** se marca — tenía
un `CREATE TEMP TABLE` de staging + un `UPDATE` no acotado dentro del mismo `DO $$` de nivel
superior (`DDL_RE` no reconocía `CREATE TEMP TABLE`, sólo `CREATE TABLE`; corregido). **Corrección
(ronda 2, M7): el conteo de esta sección estaba mal.** Eran **12** migraciones viejas rechazadas
tras ronda 1, no 11, y el desglose es **9 originales − 1 por M5 + 3 por B1 (`CREATE TEMP TABLE`/
`DO $$` visibles: `20260625000001`, `20260810000002`, `20260825000002`) + 1 por B2
(`20260913000001`)** — la aritmética original («+2 por B1») contaba mal, no «+3».

**Mutation-testing, ronda 1** (desactivar cada regla/exclusión nueva → correr la suite → ver el
flip esperado y **sólo** en los tests que le tocan → revertir): B1, B2, B3 (parcial — ver nota
corregida abajo), B4 (`--diff-filter` y `rejectedAtBase`), M5, M6 (mutante equivalente: la
búsqueda del "último `IF` sin cerrar" ya blinda el resultado incluso con la primera coincidencia
de `COUNT(*)` en vez de la más cercana — documentado, no un hueco), m7, m8, m9, DDL_RE
(`CREATE TEMP TABLE`) — cada mutante murió exactamente en los tests de su hallazgo, ninguno más.

**Nota sobre B3 — la conclusión de ronda 1 era la buena; el error de dirección de ronda 2 es
del orquestador, no de quien implementó (corregido en ronda 3).** La nota original de ronda 1
afirmaba que el mutante de "orden invertido" (`stripFunctionBodies` antes de
`stripLineComments`) era **equivalente**, protegido incidentalmente por el chequeo `AS`-token
de B1. Ronda 2 pidió reescribir esa nota como falsa, con este fixture — cuyo comentario
contiene un `$$` literal:
```sql
-- this migration uses a $$-quoted body below
BEGIN;
ALTER TABLE public.orders ADD COLUMN bar TEXT;
CREATE FUNCTION public.f() RETURNS VOID LANGUAGE plpgsql AS $$ BEGIN RETURN; END; $$;
UPDATE public.orders SET bar = 'x';
COMMIT;
```
Ronda 3 lo reprodujo **de las dos formas** contra el código real. Con **B1 intacto** (el
chequeo `AS`-token de `stripFunctionBodies` sin tocar) y sólo el orden de
`stripLineComments`/`stripFunctionBodies` invertido para calcular `topLevel`: el fixture de
arriba sigue dando `::error::` exit 1, y las siete suites (57/57 en las seis originales de
ronda 2, antes de que ronda 3 añadiera F1-F4) pasan igual — **el mutante sobrevive, protegido
por el chequeo `AS`**. Sólo produce `PASS` si, ADEMÁS del orden, se revierte también
`stripFunctionBodies` (B1) — es decir, revirtiendo dos arreglos a la vez, no uno. La
"reproducción aislada" que ronda 2 reportó revertía B1 sin decirlo. **La nota de ronda 1 era
correcta**: con B1 en su sitio, el orden invertido es un mutante equivalente. El fixture se
queda — documenta el comportamiento real y por qué el chequeo `AS` de B1 lo blinda — pero la
afirmación de "no era un mutante equivalente" (ronda 2) queda retirada. El test `"a $$ inside a
line comment does not blank out the DDL that follows it"` en `check-migration-safety.test.sh`
sigue siendo útil: fija el comportamiento correcto por su propio derecho, no porque el mutante
de orden fuera detectable sin él.

**Reorganización de ficheros (regla del repo: <300 líneas):** `check-migration-safety.mjs`
creció a 504 líneas tras estos cambios. Partido en tres: `check-migration-safety-rule1.mjs`
(regla 1 completa), `check-migration-safety-git.mjs` (listado de ficheros + diff/show de git),
`check-migration-safety.mjs` (reglas 2/3 + CLI/orquestación, 239 líneas). Mismo patrón que
`check-quarantine*.test.sh`.

**No verificado por este agente (ronda 1):** review adversarial de esta ronda y `gh pr
checks`/merge (los confirma el orquestador tras abrir el PR, sin auto-merge).

---

**Ronda de arreglos 2 (post-review, PR #676 → seguimiento, aditivo, sin revert).** El review
confirmó B1, B4, M5, M6, m7, m8, m9, m12 y el `TEMP` de `DDL_RE` de ronda 1 sólidos con mutación
propia, pero encontró cuatro bloqueantes nuevos en la costura entre B1/B2 (atribución de la
función invocada) y B3/B4 (exención por base), más ajustes en M5/M6/M7 y varios menores. Todos
corregidos con RED real primero (fixtures literales del review):

- **B1** — `findInvokedBackfillFunction` atribuía el cuerpo `$$` a la **primera** declaración de
  función en la ventana de 400 caracteres, no a la más cercana. Declarar una función corta e
  inocua justo antes del backfill real dejaba pasar el backfill como `PASS`.
  `nearestFuncDeclName` (en el nuevo `check-migration-safety-rule1-match.mjs`) usa el **último**
  match dentro de la ventana, el mismo patrón `lastMatchIndex` que M6 (ronda 1) ya usaba para la
  regla 3.
- **B2** — el regex de invocación (`callRe`) corría sobre el texto **completo** tras el cuerpo,
  cuerpos de OTRAS funciones incluidos — un `PERFORM public.bf()` dentro del cuerpo declarado
  (pero nunca invocado) de una función ajena contaba como invocación de nivel superior. Como
  `PERFORM` sólo es válido dentro de un cuerpo plpgsql, esa mitad del detector nunca podía ser
  "de nivel superior" salvo dentro de un `DO`. Ahora la búsqueda corre sobre `topLevel` (cuerpos
  `AS $$` de otras funciones blanqueados, bloques `DO $$` visibles), no sobre el texto crudo.
- **B3** — `rejectedAtBase` era un booleano («¿violaba algo en base?»), así que un fichero con
  **cualquier** violación en base quedaba exento **para siempre**, incluso si el PR añadía una
  violación nueva y distinta junto a la vieja. Reemplazado por `findRule1Violations`/
  `newViolationsSinceBase`: cada violación lleva un `statement` (el texto de la sentencia
  ofensora, o `INVOKE:<nombre>` para el caso B2), y sólo se exime lo que coincide **por
  identidad de sentencia** con algo que ya existía en base — cualquier sentencia nueva rechaza,
  aunque el fichero ya tuviera otra violación distinta.
- **B4 (el "mutante equivalente" de B3, ronda 1) — corregido de vuelta en ronda 3.** Ronda 2
  afirmó que no era equivalente, "aislado, dejando intactos `stripFunctionBodies` de B1". Ronda
  3 reprodujo la aislación de verdad (sólo el orden invertido, `stripFunctionBodies` de B1 sin
  tocar) contra el código real: el mutante sigue dando `::error::` en el fixture y las suites
  siguen en verde — sobrevive, protegido por el chequeo `AS`-token de B1. La reproducción de
  ronda 2 que decía lo contrario tenía que haber tocado B1 también para producir `PASS`, aunque
  la nota dijera que no. Ver "Nota sobre B3" arriba.
- **M5** — `findInvokedBackfillFunction` sólo reconocía `SELECT|PERFORM name(`. Una función
  `RETURNS TABLE(...)` se invoca idiomáticamente como `SELECT * FROM name()` o
  `SELECT count(*) FROM name()`, que no matcheaban — bypass trivial. `invokesFunction` añade un
  tercer patrón, `SELECT ... FROM name(`, acotado a una sola sentencia (`[^;]*`) para no cruzar
  a un `SELECT` posterior no relacionado.
- **M6** — `20260913000001` es falso positivo a nivel `::error::` y verdadero positivo a nivel
  `::warning::`: escribir en una tabla `CREATE TABLE`'d vacía en el mismo fichero no puede
  bloquear a nadie (ningún backend tiene el OID, no hay lectores), que es justo el daño que la
  regla existe para prevenir — pero forzar dos migraciones separadas para ese caso es ceremonia
  sin riesgo evitado. La exclusión es **por tabla de destino**, no por fichero: cada violación
  (`findRule1Violations`) extrae la tabla destino (`extractDestinationTable`, de `UPDATE
  <tabla>`/`INSERT INTO <tabla>`, incluida la del cuerpo en el caso B2) y comprueba si un
  `CREATE TABLE` la nombra **antes** en el mismo fichero (`isTableCreatedBefore`). Sólo esa
  violación concreta degrada a `::warning::` (`findRule1Warnings`); si el mismo fichero tiene
  OTRA violación cuyo destino no fue creado ahí, esa otra sigue rechazando — verificado con
  `20260321000001` y `20260625000001`, que tienen ambos casos a la vez y siguen en `::error::`
  por su segunda violación aunque la primera degrade.
- **M7** — corregido arriba (era 9−1+3+1=12, no 9−1+2+1=11).
- **m8** — `changedFilesSince` devolvía la ruta **nueva** también como "ruta en base" para un
  rename puro, así que `git show base:<ruta-nueva>` fallaba siempre (`fatal: path '...' exists
  on disk, but not in <sha>`) y la `R` de `--diff-filter=AMR` nunca degradaba de verdad — sólo
  fail-safeaba a "no exento" sin comparar nunca. Ahora cada fichero cambiado lleva `oldPath`
  (`parts[1]` cuando `status === 'R'`), usado por `violationsAtBase`/`newViolationsSinceBase`.
- **m9** — `(?<!END\s)` en la regla 3 sólo excluía **un** espacio; `END  IF` (dos espacios) o
  `END\nIF` seguían leyéndose como el `IF` de apertura. `(?<!END\s+)` (lookbehind de ancho
  variable, válido en V8).
- **m11** — se añadió el fixture que faltaba (última sentencia sin `;`, fin de fichero real) a
  las reglas 2 y 3; revertir `[\s\S]*?(?:;|$)` a `[\s\S]*?;` ahora sí falla la suite (verificado
  con mutación manual: sólo los dos tests `m11` fallan, revertido).
- **m12** — `process.exit(main(...))` corría a nivel de módulo incondicionalmente, así que
  **importar** `check-migration-safety.mjs` (no sólo ejecutarlo) abortaba el proceso —
  `checkIndexConcurrency`/`checkUniqueIndexGuard` eran inimportables. Ahora sólo se ejecuta
  cuando el módulo es el entrypoint CLI (`import.meta.url === pathToFileURL(process.argv[1]).href`).
- **m13, m14 — anotados, NO implementados esta ronda** (instrucción explícita del review): un
  `DELETE FROM packages WHERE ...` de nivel superior, un `CREATE TABLE x AS SELECT * FROM
  packages`, o un `EXECUTE '...'` dentro de un `DO` que corre un `UPDATE` no se detectan como
  backfill de deploy-time — mismo perfil de riesgo que `UPDATE`/`INSERT...SELECT`, pero la fase
  sólo nombra esos dos. `github.event.before` en un segundo push a la misma rama es el tip
  anterior de la rama, no `main`, así que migraciones añadidas en pushes previos de la misma
  rama quedan fuera de `--base` en ese run — `pull_request`/`merge_group` sí usan la base
  correcta. Ninguno de los dos es un bloqueante de esta ronda.
- **m10 — anotado, NO implementado esta ronda** (sin arreglo concreto propuesto por el review, a
  diferencia de m8/m9/m12): `stripLineComments` borra desde el primer `--` sin conocer comillas,
  así que `VALUES ('a--b'); UPDATE orders SET bar='x';` hace desaparecer el `UPDATE` que le
  sigue en la misma línea → `PASS`. Requiere un parser consciente de literales de cadena, que es
  una pieza de trabajo mayor que un `Arreglo:` de una línea — se deja fuera a propósito, igual
  que m13/m14, hasta que alguien lo priorice explícitamente.

**Verdicto final contra las 194 migraciones (ronda 2):** `10` ficheros con `::error::` (los 12
de ronda 1 menos `20260306000001` y `20260913000001`, ambos degradados a `::warning::` por M6 —
sus únicas violaciones escriben en una tabla creada en el mismo fichero). `20260321000001` y
`20260625000001` siguen en `::error::` porque, además de una violación M6-degradable, tienen
otra hacia una tabla existente que M6 no toca. `20260909000001` sigue sin marcarse (no
regresión) y `20260810000002` sigue marcado (no regresión).

**Mutation-testing, ronda 2** (desactivar cada arreglo → correr la suite completa → ver el flip
esperado y **sólo** en los tests que le tocan → revertir): B1 (`nearestFuncDeclName` a primer
match), B2 (`afterBody` sin acotar a `topLevel`), M5 (quitar el patrón `SELECT ... FROM`), M6
(`isTableCreatedBefore` siempre `false`), B3 (`newViolationsSinceBase` de vuelta a booleano),
m8 (`oldPath` de vuelta a la ruta nueva), m9 (lookbehind de un espacio), m11 (`(?:;|$)` de
vuelta a `;` en reglas 2 y 3), m12 (quitar el guard `import.meta.url`) — cada mutante murió
exactamente en los tests de su hallazgo, ninguno más, en las seis suites completas.

**m6 (ronda 3) — corrección del conteo.** El reporte de esta ronda dijo "65 aserciones"; las
seis suites reportaban `13/11/9/9/10/5` = **57**, no 65. Al cierre de ronda 3 (F1-F4 más la
séptima suite, ver abajo) el conteo real es `13/11/10/9/10/8/6` = **67** en las siete.

**Reorganización de ficheros (regla del repo: <300 líneas), ronda 2:**
`check-migration-safety-rule1.mjs` creció de nuevo tras B1/B2/M6. Partido en dos:
`check-migration-safety-rule1.mjs` (274 líneas: constantes, blanqueo de cuerpos, las tres formas
de violación, `findRule1Violations`/`findRule1Warnings`/`checkDdlBackfillMix`) y el nuevo
`check-migration-safety-rule1-match.mjs` (112 líneas: helpers de matching puros —
`stripDollarQuotedBodies`, `lastMatchIndex`, `nearestFuncDeclName`, `extractDestinationTable`,
`isTableCreatedBefore`, `splitStatementsWithIndex`, `invokesFunction`). Nuevos ficheros de test:
`check-migration-safety-rule1b.test.sh` (B1/B2/M5/M6, 204 líneas) y
`check-migration-safety-basediff.test.sh` (B3/m8, 168 líneas) — cableados en `ci.yml`.

**No verificado por este agente (ronda 2):** review adversarial de esta ronda y `gh pr
checks`/merge (los confirma el orquestador tras abrir el PR, sin auto-merge).

---

**Ronda de arreglos 3 — final, alcance congelado (post-review, PR #676 → seguimiento, aditivo,
sin revert).** El review declaró el análisis estático en su límite útil tras esta ronda:
m-10, m-13, m-14 quedan anotados y sin implementar a propósito (instrucción explícita). Cuatro
arreglos obligatorios, con RED real primero:

- **F1** — `extractDestinationTable` anclaba la búsqueda de un `UPDATE` al **inicio del
  string** (`^\s*UPDATE`). Llamada contra un cuerpo de función (que empieza en el `$$`, no en
  el `UPDATE`), esa ancla nunca podía matchear, así que la función caía siempre al primer
  `INSERT INTO` del cuerpo — cualquier OTRA escritura en el mismo cuerpo (un `UPDATE` real
  contra una tabla existente y viva) desaparecía sin más. Fixture del reviewer, `exit 0` antes
  del arreglo: `UPDATE packages` (tabla viva) + `INSERT INTO foo_cache` (creada en el mismo
  fichero) dentro del mismo cuerpo — degradaba a warning citando sólo `foo_cache`, ignorando el
  `UPDATE` sobre `packages`. `extractAllDestinationTables` (nuevo, en `rule1-match.mjs`) recoge
  TODAS las escrituras del cuerpo (todos los `UPDATE ... SET`, todos los `INSERT INTO`);
  `findRule1Violations` degrada sólo si TODAS apuntan a algo creado antes en el fichero.
- **F2** — `CREATE TABLE IF NOT EXISTS` no debe eximir del guardia M6/m7: es precisamente la
  sintaxis cuyo contrato es "puede que la tabla ya exista, con filas y con lectores" — lo
  opuesto a la premisa de M6 ("ningún OID que otro backend tenga abierto, ningún lector
  todavía"). `isTableCreatedBefore` (M6) y el `createdHere` de la regla 3 ahora sólo reconocen
  un `CREATE TABLE` desnudo. Efecto real, no teórico: dos migraciones dependían de esa rama —
  `20260306000001` (`CREATE TABLE IF NOT EXISTS dispatches`) y `20260913000001` (`CREATE TABLE
  IF NOT EXISTS discrepancies`) — ambas vuelven de `::warning::` a `::error::`.
- **F3** — el texto del warning de M6 afirmaba "nothing can be locked out" sin matices. M6 sólo
  razona sobre la tabla de DESTINO — no mira la FUENTE de un `INSERT ... SELECT` (una tabla
  existente y viva recibe un scan completo, `AccessShareLock` sostenido mientras dura la
  lectura, dentro de la misma transacción del deploy) ni cuánto tiempo esa transacción queda
  abierta. `20260306000001:316` es exactamente esa forma: `INSERT INTO dispatches ... SELECT
  ... FROM delivery_attempts`, un scan completo de una tabla preexistente — el daño que dejó
  producción caída seis días no es sólo el lock del destino. El mensaje ahora dice
  explícitamente que la afirmación es sólo sobre el destino, y que la fuente + la duración de
  la transacción quedan fuera del alcance de M6.
- **F4** — `newViolationsSinceBase` (B3) compara `v.statement` por igualdad EXACTA de string
  dentro de un `Set`. `.trim()` sólo absorbe espacio al principio/final, no el espaciado
  INTERNO — reformatear un backfill existente (indentarlo en varias líneas, sin cambiar su
  semántica) cambia el string byte a byte, así que la comparación falla y el reformateo puro se
  ve como una violación NUEVA. Precedente real que esto protege: `20260901000001`, "lift
  statement_timeout on the two migration-time backfills" — envolver un backfill existente en un
  `SET LOCAL` mientras se reformatea no debe rechazar. `normalizeStatementWhitespace`
  (`\s+ → ' '`, luego `trim()`) se aplica a ambos lados de la comparación.
- **F5** — corregido arriba, en la "Nota sobre B3" y en el punto B4: la conclusión de ronda 1
  (mutante equivalente, protegido por el chequeo `AS` de B1) era la correcta. Ronda 3 reprodujo
  el mutante de orden invertido **de verdad aislado** (sólo el orden, `stripFunctionBodies` de
  B1 intacto) contra el código real: el fixture de ronda 2 sigue dando `::error::` y las siete
  suites siguen en verde — el mutante sobrevive, protegido incidentalmente. La "reproducción
  aislada" que ronda 2 reportó tenía que haber revertido B1 también para producir el `PASS` que
  afirmaba, aunque la nota dijera lo contrario. El error de dirección es del orquestador que
  pidió la reescritura, no de quien implementó ronda 2.
- **m6** — corregido arriba: "65 aserciones" → 57 (13/11/9/9/10/5 en las seis suites de esa
  ronda).

**NO implementado, instrucción explícita:** m-10 (el `--` dentro de un literal de cadena
oculta lo que le sigue en la misma línea física — el reviewer construyó el exploit y confirmó
que sólo dispara si dos sentencias comparten línea física, cosa que ninguna de las 194
migraciones hace, y falla hacia el lado seguro en las demás variantes probadas), m-13 (`DELETE`/
`CREATE TABLE AS SELECT`/`EXECUTE` dentro de un `DO` no detectados como backfill), m-14
(`github.event.before` en un segundo push a la misma rama no es la base correcta). Los tres
quedan anotados, sin arreglo esta ronda.

**Veredicto final contra las 194 migraciones (ronda 3):** `12` ficheros con `::error::` — F1 y
F2 revierten `20260306000001` y `20260913000001` de vuelta a `::error::` (las dos degradaciones
de M6 en ronda 2 dependían de la rama `IF NOT EXISTS` que F2 cierra), volviendo al conteo de
ronda 1. `65` líneas `::warning::` en total, sobre `27` ficheros distintos. `20260909000001`
sigue sin marcarse (no regresión) y `20260810000002` sigue marcado (no regresión) — los dos
criterios de aceptación de la ronda, verificados corriendo `node scripts/check-migration-
safety.mjs packages/database/supabase/migrations` contra el árbol completo tras cada cambio.

**Mutation-testing, ronda 3** (desactivar cada arreglo → correr las suites que le tocan → ver
el flip esperado y **sólo** ahí → revertir): F1 (`extractAllDestinationTables` de vuelta a
`extractDestinationTable(body)`, anclado), F2 (`isTableCreatedBefore` de vuelta a aceptar `IF
NOT EXISTS`), F3 (mensaje de vuelta al texto sin matizar), F4 (`normalizeStatementWhitespace`
quitado, comparación exacta) — cada mutante murió exactamente en los tests de su hallazgo,
ninguno más. F5 se re-verificó de forma independiente (no es un fix de código, es una
corrección de una nota): el mutante de orden invertido, aislado de verdad con B1 intacto, sigue
sobreviviendo — confirma la nota corregida, no la de ronda 2.

**Reorganización de ficheros (regla del repo: <300 líneas), ronda 3:**
`check-migration-safety-rule1b.test.sh` volvió a crecer (204 líneas de ronda 2 + fixtures de
F1/F2/F3) por encima de 300. Partido en `check-migration-safety-rule1b.test.sh` (ronda 2,
B1/B2/M5/M6, 204 líneas, sin cambios de contenido) y el nuevo
`check-migration-safety-rule1c.test.sh` (ronda 3, F1/F2/F3, 168 líneas) — cableado en `ci.yml`
como una **séptima** suite, no sexta: la instrucción de la ronda pedía verificar "las seis
suites", pero el límite de líneas del repo obliga a partir un fichero que las supera; ninguna
suite existente cambió de alcance, sólo se dividió en dos ficheros.

### Conclusión estratégica — por qué el alcance se congela aquí

Tres rondas, y el patrón es estable: cada una cierra los agujeros que la anterior nombró y abre
uno o dos nuevos **en la costura entre los arreglos**, no dentro de ellos. B1 arregla la
atribución y su chequeo de `AS` invalida sin querer la evidencia de B3; M6 arregla un falso
positivo y abre un falso negativo en el caso de B2 (F1). Es lo que pasa cuando un regex
persigue la semántica de un parser: el estado que le falta —qué tablas existen, cuántas filas
tienen, si esto es un literal o código— **no se recupera con más regex**.

Este guard vale como red de captura del 80% de los casos obvios, y ese valor ya está entregado.
**El alcance se congela aquí.** Si algún día hace falta más precisión, la pieza correcta no es
más regex: es parsear con `pg_query`/`libpg_query`, o —más barato y más honesto— **mover la
pregunta a runtime**: `EXPLAIN` o `pg_class.reltuples` sobre la tabla de destino durante el
deploy, que es donde el dato de verdad vive. Un `::warning::` que diga "esta migración toca una
tabla de 112k filas" vale más que cualquier heurística sintáctica y cuesta menos que lo ya
escrito.

**No verificado por este agente (ronda 3):** review adversarial de esta ronda y `gh pr
checks`/merge (los confirma el orquestador tras abrir el PR, sin auto-merge).

---

## Lo que deliberadamente NO se hace

- **La regla «frontend → E2E, backend → tests funcionales».** Es verificación condicionada a los paths tocados, y `docs/specs/CLAUDE.md` ya documenta por qué no: *«un cambio en una RPC de Supabase rompe una pantalla sin tocar `apps/frontend/`»*.
- **Despliegue por módulo.** `deploy-vercel` publica el frontend entero y `deploy-supabase` empuja el ledger completo: **siempre se despliega todo**. Una regla que diga «sólo los tests de mi área» reclama un alcance que el despliegue no tiene. Cambiarlo es arquitectura, no una regla.
- **Restaurar `continue-on-error`.** Ver fase 1.

## Riesgos

- **La cuarentena se vuelve permanente.** Por eso caduca, y por eso la fase 2 existe: la cuarentena compra tiempo, no perdón.
- **El tamaño del lote es el factor de seguridad, no la severidad del gate.** Un deploy diario de 3 commits es mucho más seguro que uno mensual de 200. Una vez desbloqueado, desplegar seguido es la mitad del arreglo.
- **El índice silencioso de `h5c`.** Es el único de las doce que puede quedar «aplicado» sin estarlo. Se comprueba a mano en la fase 4 o no se comprueba nunca — pero, corregido en fase 3: el resultado correcto de esa comprobación al final del lote 2 es que el índice **no** exista (`20260911000003` lo retira a propósito, tres migraciones después de crearse). El riesgo real no es "que no se cree" — es que alguien, viendo el `RAISE NOTICE` de conflictos, intente reconciliar rutas y forzar su creación cuando la decisión de producto ya fue retirarlo.
- **El backfill manual de `loaded_route_id` se olvida.** Al no ser parte de ninguna migración, no hay ningún gate automático que recuerde que sigue pendiente después de que `verify-prod-migrations` reporte producción al día. `isGenuinelyLoadedPackage` degrada con seguridad (falso negativo, nunca falso positivo) mientras esté pendiente, pero degradado indefinidamente no es el estado objetivo — alguien tiene que correrlo a propósito, no asumir que "las 12 migraciones aplicadas" significa "el dato está completo".
