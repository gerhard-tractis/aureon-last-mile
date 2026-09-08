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

### Fase 1 — Cuarentena del gate `[in_progress]`

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
- **El veto del step, no sólo del job.** `check-deploy-gating.mjs` ahora exige que `e2e-qa` tenga exactamente un step cuyo `run:` sea, como línea lógica (uniendo continuaciones con `\`), exactamente `bash scripts/check-quarantine.sh <quarantine.json> <report.json>` — con la única excepción de líneas que empiecen por `#` (comentario) en el mismo `run:`. Es una **lista blanca de forma**, no una lista negra de casos: cualquier otra línea lógica —`set` en cualquier variante, `trap`, `if`, `while`, `echo`, lo que sea— hace fallar el guard por no estar en la lista permitida, sin que nadie tenga que haberla previsto antes. Un fix round 3 mostró ocho vectores que la lista negra original (`|| true`, `|| :`, comentarlo, `echo`) dejaba pasar con exit 0, entre ellos `--validate-only` —un flag real que esta misma fase introdujo— y un step señuelo anterior que `steps.find` tomaba como el real; un re-review round 4 encontró tres más (`trap 'exit 0' EXIT`, `set +ex`, `set +e -u`) que esa lista negra tampoco conocía, más un cuarto vector (`defaults.run.shell` a nivel de job o de workflow, invisible para el chequeo que sólo miraba `step.shell`). Round 4 había admitido también `echo` como línea tolerada, pero `logicalLines()` sólo une continuaciones con `\` y nunca parte una línea por `;`/`&&`/`||`/backticks/`$(` — así que sólo se inspeccionaba el primer token, y `echo pre; trap 'exit 0' EXIT`, `echo hi; set +e`, o un `echo ... > results.json` que falsifica el reporte pasaban con exit 0 (round 5, H1). `echo` ya no está en la lista blanca; sólo lo están las líneas `#`, que por construcción no pueden ejecutar nada más allá de ellas mismas. El guard también exige que exista un step cuyo `run:` invoque de verdad `npm run e2e:qa` (una mención en comentario no cuenta) y que el step del veto corra **después** de ese step, no antes; si no existe ningún step así, el guard falla explícitamente en vez de aprobar por falta de ancla contra la que comparar (round 5, H2). La lista negra crecía un caso a la vez; la lista blanca cierra la clase. (Un `working-directory: .` distinto en el step del veto se descartó como vector: no existe ninguna ruta que resuelva a la vez el script, `apps/frontend/e2e/quarantine.json` y `apps/frontend/playwright-report-qa/results.json`, así que un valor distinto falla ruidosamente en el propio step, no en silencio — pero eso depende de que `apps/frontend/scripts/check-quarantine.sh` no exista; si algún día aparece un script con ese mismo nombre relativo dentro de un monorepo, el argumento caduca sin avisar.)

- [x] Tests del parser y de la caducidad primero.
- [x] Cablear en `e2e-qa` y comprobar que `scripts/check-deploy-gating.mjs` sigue verde: **falla CI si alguien desconecta el gate**, y esta fase lo toca. Extendido en fix rounds 1 y 2 para exigir el propio step `check-quarantine.sh` dentro de `e2e-qa`, su `if:` y que su `run:` no esté neutralizado — antes sólo miraba `needs:`/`continue-on-error` a nivel de job y no veía el veto que vive en un step.

**Deuda conocida, preexistente de spec-57, NO arreglada aquí (fuera de alcance de fase 1):** cada step de `e2e-qa` — incluido `Check quarantine` — cuelga de `if: steps.qa.outputs.provisioned == 'true'`. Un runner sin `/home/aureon/.env.qa` deja el job entero en verde sin ejecutar ni un test, y `approve-production` lo acepta igual. Es el mismo agujero que H2 (informe vacío = verde) mostraba dentro del propio reporte, pero por una puerta distinta: aquí no llega a generarse ningún reporte. Necesita su propia fase o su propio spec — no es un fix de una línea dentro de fase 1. En `origin/main` el `Run E2E against QA` que *era* el veto ya colgaba de la misma condición: el agujero tiene el mismo diámetro antes y después de esta fase — no es una regresión introducida aquí. Matiz para quien lo arregle: `check-deploy-gating.mjs` ya cementa `steps.qa.outputs.provisioned == 'true'` como el único `if:` permitido en el step `Check quarantine` — el fix futuro tendrá que ser un step separado tipo "fail si no está provisionado", no endurecer ese `if:`.

### Fase 2 — Arreglar la aserción de Despacho `[pending]`

**Archivos:** `apps/frontend/e2e/despacho-tablet-dock.spec.ts`, `despacho-crew-mobile.spec.ts`, `despacho-close-dispatch.spec.ts`

Las tres referencian `«Asignar camión y conductor»`. O el test navega con `?dock=1` (y entonces el árbol de cuadrilla es el correcto), o maneja el selector de `RouteBuilder`, que es como el escritorio asigna camión. **Decidir cuál según lo que cada test dice estar probando**, no por lo que haga pasar el test.

- [ ] Correr los tres contra QA antes y después: `npx playwright test --config=playwright.qa.config.ts`.
- [ ] Al pasar, retirar su entrada de la cuarentena en el mismo PR.

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
