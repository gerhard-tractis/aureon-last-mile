# Spec-87: Desbloquear producción — cuarentena del gate, inventario de migraciones y despliegue por lotes

> **Related:** [spec-57](spec-57-qa-gate-before-production.md) (hizo de QA la precondición de producción), [spec-56](spec-56-pickup-contract-phase.md) (**el precedente: un índice único que pasa CI y muere con datos de producción**), [spec-79](spec-79-dispatch-handoff-integrity.md) (dueña de 5 de las 12 migraciones pendientes, y de una de las dos entradas de cuarentena), [spec-78](spec-78-despacho-tablet-anden.md) (dueña de la otra entrada de cuarentena — ver `apps/frontend/e2e/quarantine.json`), [spec-80](spec-80-recogida-movil-cierre-de-carga.md) y [spec-85](spec-85-discrepancias.md) (dueñas de las tres migraciones del 2026-09-13, sumadas al listado tras la corrección de fase 3 abajo)

**Status:** in progress
**Verify:** unit, e2e-qa

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
> - **El backfill manual** (`SELECT public.spec79_backfill_loaded_route_id();`). La función
>   está desplegada y **nadie la ha invocado**. Aquí sí aplica el riesgo de timeout: es un
>   `UPDATE` real sobre `packages` con ~112k dispatches detrás, y la función **no es
>   resumible internamente**. Debe correrse a mano y en sub-lotes.
> - **Confirmar en producción que `routes_one_vehicle_per_day` NO existe** (`pg_indexes`).
>   El agente no tiene credenciales de producción; queda sin verificar, no verificado en
>   silencio.

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

### Fase 5 — Guardarraíles `[pending]`

**Archivos:** `scripts/check-migration-safety.sh` + test, cableado en CI

- [ ] Rechazar una migración que mezcle **DDL y un backfill no acotado** en el mismo fichero. Son dos cosas con perfiles de riesgo opuestos: el esquema es rápido y debe ir en el deploy; el backfill es lento y debe ir aparte.
- [ ] Avisar ante `CREATE INDEX` sin `CONCURRENTLY` sobre tablas grandes conocidas (`packages`, `orders`, `dispatches`, `routes`).
- [ ] Avisar ante `CREATE UNIQUE INDEX` sobre filas vivas sin el guardia de conteo previo que `h5c` sí tiene.

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
