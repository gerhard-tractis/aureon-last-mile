# Spec-87: Desbloquear producción — cuarentena del gate, inventario de migraciones y despliegue por lotes

> **Related:** [spec-57](spec-57-qa-gate-before-production.md) (hizo de QA la precondición de producción), [spec-56](spec-56-pickup-contract-phase.md) (**el precedente: un índice único que pasa CI y muere con datos de producción**), [spec-79](spec-79-dispatch-handoff-integrity.md) (dueña de 5 de las 9 migraciones pendientes, y de una de las dos entradas de cuarentena), [spec-78](spec-78-despacho-tablet-anden.md) (dueña de la otra entrada de cuarentena — ver `apps/frontend/e2e/quarantine.json`)

**Status:** in progress
**Verify:** unit, e2e-qa

_Date: 2026-09-07_

---

## Goal

Volver a poder desplegar a producción, sin convertir el primer despliegue en un big-bang de 61 commits contra una base de datos donde los backfills se caen por timeout.

## El estado real, medido

**Último despliegue exitoso a producción: `0482806`, 2026-09-02T21:39:51Z.** Cinco días. Ninguno de los últimos 100 runs de `deploy.yml` terminó en éxito.

Producción está detrás por **61 commits y 9 migraciones**. Esto no es una estimación: el propio job `verify-prod-migrations` lo reporta, y coincide exactamente con el diff de git desde `0482806`.

```
Production is BEHIND the repo — these migrations exist in the repo
but are not applied to production:
  20260907000001  20260908000001  20260908000002
  20260909000001  20260910000001  20260911000001
  20260911000002  20260911000003  20260912000001
```

**Ese job es la herramienta de inventario y no hace falta ninguna credencial para leerlo** — se lee del log del run. No hay que pedirle a nadie el acceso a producción para saber qué falta.

## Tres problemas distintos que se confunden en uno

**1. El gate no distingue «el test está mal» de «el producto está roto».**
`approve-production` exige `needs.e2e-qa.result == 'success'`, y `e2e-qa` lleva días en rojo. El run real `34167425466` muestra `2 failed, 18 passed` — no tres, como afirmaba una versión anterior de este párrafo — y los dos fallos son exactamente las dos entradas de `quarantine.json`: **`despacho-tablet-dock.spec.ts`** (carga `/app/dispatch/<id>` a 1024×768 **sin `?dock=1`**, afirma que renderiza el árbol de escritorio, y pulsa `«Asignar camión y conductor»`, que sólo existe en el componente **móvil** — verificado leyendo `DispatchRouteSurface.tsx`: `isCrewTree = isBelowLg || isTabletDock`, y sin el flag a exactamente 1024 ambas son falsas; el producto está bien, la aserción miente) y **`despacho-close-dispatch.spec.ts`** (Route L — un contador que sube de run en run por artefacto de fixture del mock DispatchTrack, no por un bug de producto ni por el mismo afordance móvil; ver `quarantine.json` para el detalle).

**2. El backlog es el riesgo real, y el gate en rojo lo estaba tapando.**
61 commits van a aterrizar de una vez. Producción tiene ~112k dispatches y ~61k packages, y **los backfills se caen por timeout ahí y en ningún otro sitio**. Desbloquear el gate sin dimensionar esto primero es lo más arriesgado que se puede hacer hoy.

**3. Hay un bucle: `verify-prod-migrations` falla PORQUE producción está detrás.** Estar atrasado dificulta ponerse al día.

## Inventario de las 9 migraciones pendientes

| Migración | Riesgo | Por qué |
|---|---|---|
| `20260907000001_spec76_en_bodega_not_dock_ready` | **bajo** | Su único `UPDATE` está dentro de una función, acotado por `WHERE id = p_dispatch_id`. No es backfill. |
| `20260908000001_spec77_force_split` | **bajo** | Sin UPDATE, sin índices, sin columnas nuevas. |
| `20260908000002_spec77_retorno_hub_clears_load_fact` | **bajo** | Ídem. |
| `20260909000001_spec79_loaded_route_id` | **ALTO** | `ADD COLUMN` + **backfill real**: `UPDATE public.packages … FROM (SELECT … FROM public.dispatches …)`. Sobre ~61k packages y ~112k dispatches. Candidato a timeout. |
| `20260910000001_spec79_backfill_route_scope_fix` | **ALTO** | Segundo backfill sobre el mismo par de tablas, corrigiendo el alcance del primero. |
| `20260911000001_spec79_dispatch_attempt_claim` | **medio** | `ADD COLUMN` sin backfill. Barato salvo que lleve DEFAULT no volátil. |
| `20260911000002_spec79_h5c_vehicle_per_day_index` | **medio — silencioso** | Crea 4 índices, uno **UNIQUE sobre `routes` con datos vivos**. Ver abajo. |
| `20260911000003_spec79_b1_withdraw_vehicle_per_day_index` | **bajo** | Retira el anterior. |
| `20260912000001_recogida_visible_when_carga_verified` | **bajo** | Sólo funciones. |

### El caso `h5c` merece leerse entero

Es el patrón que mató a spec-56: un `CREATE UNIQUE INDEX` sobre filas vivas revienta si producción ya viola la restricción, y **pasa CI porque los datos de QA no la violan**.

Aquí alguien ya aprendió esa lección: la migración **cuenta los conflictos primero** y, si hay, **salta la creación del índice** con un `RAISE NOTICE` en vez de fallar. Eso evita tumbar el deploy — pero introduce el fallo opuesto: **en producción el índice puede no crearse nunca, en silencio**, y la garantía que spec-79 da por hecha no existiría. Un deploy verde no prueba que el índice esté.

**Ninguna de las 9 usa `CONCURRENTLY`.** En una tabla del tamaño de `routes` eso bloquea escrituras mientras dura el build.

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

### Fase 2 — Arreglar la aserción de Despacho `[in_progress]`

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

### Fase 3 — Dimensionar los dos backfills `[pending]`

**Archivos:** ninguno de producción — es medición

Los dos `UPDATE … FROM (SELECT …)` de `20260909000001` y `20260910000001` son los únicos candidatos serios a timeout.

- [ ] Sobre QA, con volumen de producción simulado o al menos el `EXPLAIN` del plan: estimar filas tocadas y tiempo.
- [ ] Comprobar si son **reanudables e idempotentes**. Si un backfill de 61k filas no se puede reintentar, no debe ir dentro del deploy.
- [ ] Si no caben: separarlos del deploy y ejecutarlos como job aparte, por lotes, **después** del cambio de esquema. El esquema es rápido y transaccional; el backfill no.
- [ ] Escribir el resultado aquí. Es lo que decide la fase 4.

### Fase 4 — Desplegar el backlog por lotes `[awaiting_user_test]`

**Sólo el usuario puede cerrarla:** `approve-production` usa `environment: production`, una aprobación manual de GitHub. Ningún agente puede pulsarla, y **no debe intentarse**.

Orden propuesto, no un big-bang:

1. Migraciones **sin** los dos backfills (7 de 9). Verificar con `verify-prod-migrations` que producción quedó al día hasta ahí.
2. **Comprobar a mano si `routes_one_vehicle_per_day` existe en producción.** Si la migración `h5c` saltó el índice por conflictos, hay que reconciliar esas rutas y crearlo. Un deploy verde no lo prueba.
3. Los dos backfills, según lo que decida la fase 3.
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
- **El índice silencioso de `h5c`.** Es el único de los nueve que puede quedar «aplicado» sin estarlo. Se comprueba a mano en la fase 4 o no se comprueba nunca.
