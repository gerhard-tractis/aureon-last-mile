# spec-96 — Distribución: corrección contra el mock

**Status:** in progress
**Verify:** unit, e2e-qa

> Written in English on the user's instruction (2026-09-11). Every UI string is
> quoted verbatim in Spanish — the product's language does not change.

> **For agentic workers:** this file is both the spec and the plan
> (`docs/specs/CLAUDE.md`: "One file per spec only"). Take exactly one
> `[pending]` phase, use `superpowers:test-driven-development`, and work in a
> worktree whose branch carries the phase number (`feat/spec-96-fase-N-…`).
> Steps use `- [ ]` so progress is trackable in the branch.

**Goal:** make every Distribución screen match the artboard that governs it in
`docs/design/Distribucion.dc.html`.

**Architecture:** no new data layer. Every phase is presentation plus wiring of
hooks that already exist (`useDockZones`, `usePendingSectorization`,
`useConsolidation`, `useDistributionOverview`) into components that already
exist. One new route (Fase 9) and one new panel component (Fase 4).

**Tech Stack:** Next.js App Router · React · Tailwind · TanStack Query ·
Supabase · Vitest + Testing Library · Playwright for `e2e-qa`.

## The benchmark is the file, not this document

**`docs/design/Distribucion.dc.html` is the acceptance criterion.** Thirteen
artboards, `4a`–`4m`, downloaded 2026-09-11 from project
`4656dcbc-00da-4548-a4da-b53e614264c1` and byte-identical to the remote
(136 989 B). Verify the count yourself:

```
grep -oE 'dv-opt" id="[^"]*"' docs/design/Distribucion.dc.html
```

Each phase names **the artboard it must reproduce and the files it may touch —
nothing else.** It does not describe what the artboard looks like. That is
deliberate, and it is the user's instruction of 2026-09-11: prose drifts from
the file it paraphrases, and when the two disagree there is no way to tell which
one is stale. Open the artboard, diff it against the screen, close the
difference.

Two things prose still carries, because the HTML cannot express them: **where
the data comes from**, and **constraints the drawing cannot show** (scanner
behaviour, the null-capacity contract, viewport limits). Those appear under
`Notas no visuales`.

To open an artboard: load the file in a browser and jump to its anchor (`#4k`),
or read the block that starts at `<div class="dv-opt" id="4k">`. `support.js` is
not copied into the repo — it is the generated runtime; render the file through
the design project when you need it laid out.

### What the unit tests may and may not assert

**This is the rule that keeps the benchmark where it belongs.** A test that
asserts a visual string makes the test the benchmark, and then the artboard can
change without anything going red — exactly the drift this method exists to
prevent.

- **Tests assert behaviour, wiring and contracts:** that a prop reaches a
  component, that a `null` capacity renders no bar, that a toggle changes which
  rows render, that a header region exists and is not `sr-only`, that two
  predicates stay separate.
- **Tests do not assert appearance:** not copy, not colour, not chip text, not
  order of decorative elements, not spacing. Those are closed by diffing the
  artboard and are verified by `e2e-qa` and by eye.
- **Existing tests that do assert copy stay as they are.** Do not go and delete
  them; they were written under the old method and removing them is churn. Just
  do not add more.

## How this spec came to be, in two rounds

**Round 1 (2026-09-11).** The module was walked in QA (`admin@musan.com`, light
theme, 1442 px and 402 px) against the ten artboards of the time. The user set
the tie-breaker: **the mock is the source of truth and the app is corrected
against it.** The diff split in two — roughly forty-five mechanical differences,
and nine points no spec could take, because the mock contradicted a written
decision, said nothing, or said something the data disproved. Those nine went
back to the designer as `docs/design/mock-feedback-distribucion.md`.

**Round 2 (same day).** The designer answered all nine. The mock went from ten
artboards to thirteen and this spec was rewritten against it. What the answers
were, so nobody re-litigates them:

| Round-1 question | How the mock answered |
|---|---|
| Which tab bar owns the bottom of a phone | The app's — `4c` now draws `Recogida · Recepción · Distribución · Despacho` |
| `turno` in the chrome | Dropped everywhere. `4a` loses `turno AM`, `4b` keeps only `BODEGA PUDAHUEL`, `4c` keeps `Nave Quilicura` with no shift |
| `URGENTES · HOY Y MAÑANA` | Dropped to bare `URGENTES` — the implementation's correction was right |
| `ESTIBAR` / «Mover a posición» | Kept, and drawn: `4k`, reachable from `4g`'s `SECT`/`ESTIB` control and from `4c`'s fourth row |
| `/andenes` | Drawn: `4l` |
| The pendientes list under `4b` | Moved out to its own desktop screen: `4m` |
| Where the `SECT`/`ESTIB` control lives | In the header row — `4g` on mobile, the breadcrumb row on `4b` |
| `ConsolidationPanel` on `4a` | Kept and drawn, full width, as a table |
| The colliding names | `EXCEPCIONES DE ANDÉN` → `COMUNAS NO RECONOCIDAS`; the panel → `Incidencias de sectorización`, with its three types defined |

One question is still open and is **not** in any phase below: the screen behind
`4a`'s `Cerrar lotes` button. `/batch` exists and ships; no artboard governs it.
It stays in `mock-feedback-distribucion.md`.

## Three corrections carried over, so nobody re-finds them

1. **Dock capacity is already wired** into the `4e` send sheet
   (`SendToDockSheet.tsx:194`), the scan step-2 screen
   (`QuickSortMobileDock.tsx:120-122`) and `/andenes` (`DockListMobile.tsx:67`).
   It rendered nothing until 2026-09-11 because **both** QA dock zones had
   `capacity = null`, and `lib/distribution/dock-capacity.ts` deliberately draws
   nothing rather than a bar pinned at 0 %. `QUIL-001` has a capacity now (see
   the prerequisite below); `CONSOL` still does not, and `4l` draws that
   unconfigured state as `A6` — so it is a requirement, not a fallback.
2. **`4b`'s comuna list and `ACTIVO` badge are already passed**
   (`quicksort/page.tsx:261,264`). The comuna array is empty in the QA fixture.
3. **The tab bar already matches `4c`.** Verified in QA 2026-09-11 with
   `bodega@musan.com`: the bar renders `Recogida · Recepción · Distribución ·
   Despacho`. It was absent under `admin@musan.com` only because
   `buildMobileTabs` returns nothing for admin/manager. Fase 6 has no tab-bar
   work.

## Componentes compartidos — leer antes de tocar ninguno

Auditadas las diez listas de `**Archivos:**` el 2026-09-12, después de que dos
de ellas salieran mal en las dos primeras fases. `check-phase-overlap.mjs`
decide si dos fases se pueden despachar en paralelo **leyendo estas listas**, así
que una lista equivocada no es un detalle de documentación: invalida el veredicto
de seguridad.

**`DistributionMobileHeader.tsx` lo importan ocho ficheros**, y uno de ellos está
fuera de Distribución:

| Consumidor | Fase |
|---|---|
| `QuickSortMobile.tsx` | 1 |
| `app/distribution/pendientes/page.tsx` | 2 |
| `ConsolidationPageContent.tsx` | 3 (cerrada) |
| `DistributionMobileView.tsx` | 6 |
| `app/distribution/mover-a-posicion/page.tsx` | 7 |
| `app/distribution/andenes/page.tsx` | 8 |
| `components/dispatch/mobile/DispatchCrewMobileHeader.tsx` | **ninguna — es Despacho** |

La fase 6 lo declara en su `**Archivos:**`, es decir, "posee" un componente que
renderizan cinco fases más y **otro módulo del producto**. Regla, entonces:

- Preferir conseguir la cabecera con los props que el componente ya acepta.
- Si hay que tocarlo, el cambio es **estrictamente aditivo y opt-in**: un prop
  nuevo con default igual al comportamiento de hoy, de forma que los ocho
  consumidores rendericen idéntico.
- Si hace falta cambiar su comportamiento actual, **parar y decirlo** en vez de
  hacerlo. Dos fases remodelando una cabecera transversal es exactamente lo que
  esta sección existe para evitar.

Por lo mismo, **las fases 6 y 7 van detrás de la 1**, y no en paralelo con ella.

`DockCapacityBar.tsx` tiene el mismo carácter (cuatro pantallas), y la fase 0 ya
sentó el precedente: le añadió `showLabel` con default `true`, así que `4e`,
`4j` y `4l` no cambiaron. Ese es el patrón a copiar.

## Prerequisite — done, with one limit left

**`QUIL-001` now has `capacity = 30` in QA** (set 2026-09-11 through
`DockZoneForm`, the app's only write path; no migration, no seed change).
Verified on `/app/distribution/andenes`, which was already wired: it renders
`0 / 30` with `Quedan 30 espacios` and its bar.

**`CONSOL` stays unconfigured, and that is deliberate.** The consolidation zone
has no `Editar` action in `Configuración de Andenes` — only `Imprimir` — so the
form cannot give it a capacity at all. That leaves QA with exactly the two
states `4l` needs, side by side: one zone with a bar, one without. `4l`'s `A6`
is the second one.

`capacity` counts **packages, not orders** — `dock_zones.capacity`'s column
comment says "in units of packages", the form's own label is `Capacidad
(paquetes)`, and the numerator (`useSectorizedByZone`) counts rows in `packages`
where `status = 'sectorizado'`, one per bulto. Do not confuse it with
`retailer_daily_capacities.daily_capacity`, which **is** order-level and belongs
to a different feature.

**The limit that remains: the `warning` and `error` tones still cannot be seen
in QA**, and no capacity value fixes that. Tone comes from the fill percentage,
and QA has **zero** sectorized packages — `getDockCapacityStatus(0, anything)`
returns `neutral` by construction. `30` was chosen so the tones become reachable
through the normal flow rather than by inventing data: of the 50 pendientes,
roughly 28 route to Quilicura, so sectorizing them lands near 93 % → `warning`,
and a few more → `error`.

So whoever takes **Fase 0** or **Fase 8**: to evidence the tones, sectorize the
Quilicura pendientes through `4g`/`4h` first, then read the screen. A phase that
skips that step has verified the bar and the `neutral` tone only, and must say so
in its evidence line rather than implying it saw all three.

## Test commands, once, for every phase

```
cd apps/frontend && ../../node_modules/.bin/vitest.cmd run --pool=forks <path>
cd apps/frontend && ../../node_modules/.bin/vitest.cmd run --pool=forks   # all
cd apps/frontend && npm run type-check
```

**Invoke the binary directly — never `npx vitest`.** `npx` pulls a stale copy
from its own cache and dies on `Cannot find module 'vitest/config'`.
`--pool=forks` is required or the run hangs. Pass **explicit relative file
paths**: substring and `--dir` filters silently match nothing in this vitest
version. No prettier in this repo — never `npx prettier`.

**Dependencies per worktree:** `npm ci --no-audit --no-fund` takes ~2-4 minutes
and is the right way. Never run npm in the primary checkout — it once deleted
1599 tracked source files there.

**Rebase before every PR.** `git merge-base --is-ancestor origin/main HEAD ||
git rebase origin/main`. A phase branch cut before a sibling merged still
carries the OLD copy of every file it touches — including this spec — so
merging it silently reverts the sibling. It is not a conflict and CI does not
see it. It nearly happened twice: fase 0 would have reverted PR #821, and fase
3 would have reverted fase 0.

---

### Fase 0 — Capacity on the two unwired dock tiles `[done]`

> Implementado por: implementer — rama `feat/spec-96-fase-0-capacidad`, SHAs `01404e9..a8b978e`
> Review: reviewer (opus) — 8 hallazgos, 5 bloqueantes, cerrados en `1513e37`, `e8fd508`, `ebee8da`, `a8b978e`
> QA: PR #822 merged 2026-09-12T02:05:43Z; `e2e-qa` **leído en el reporte**, no en el check: rojo en la corrida 34667301795 y verde al repetirlo contra QA caliente. El fallo era `reception-mobile.spec.ts` agotando 4 min en el *setup* del fixture (paso de QR de Recepción), no una aserción de Distribución, y el job `e2e-qa` es `continue-on-error`, así que el check estaba verde con el job rojo.
> Downstream: este spec no declara `**Downstream:**` — ningún otro spec depende de él. Revisado spec-71 (modo ESTIBAR, comparte `QuickSortMobileView`) — sin cambios: fase 0 no tocó ese árbol.

**Hallazgos abiertos, que esta fase NO cierra:**

- `routeCount` sigue sin pasarse a `DockCard`. No hay fuente en `useDockZones` —
  verificado contra `DockZoneRecord`. No se inventó ni se añadió query.
- El badge `LOTE`/`LOTES` y el borde superior verde de `OutboundDockGrid`
  volvieron con el revert del chip. Son **código muerto** (`openBatches` no
  llega) y `4a` no contiene `LOTE` ninguna vez. **La fase 4 los quita.**
- `EN RITMO`, `DETENIDO`, `SIN ABRIR` y el pie de tarjeta (`R-2481 · R-2483`,
  `Ver`/`Asignar`/`Abrir`) son de la fase 4.
- `DETENIDO` necesita un join zona↔ruta previo a la carga que no existe:
  `dock_batches` no lleva conductor y `packages.loaded_route_id` se puebla
  después del staging. Verificado por el reviewer de forma independiente.
- La verificación visual la hizo el orquestador contra QA, no el implementer
  (que no tiene navegador y lo declaró en vez de fingirla).

**Benchmark:** `4a` (grilla «Andenes de salida»), `4b` (grilla `ANDENES`), `4l`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/OutboundDockGrid.tsx`,
`apps/frontend/src/components/distribution/DockCard.tsx`,
`apps/frontend/src/app/app/distribution/quicksort/page.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- Consume `lib/distribution/dock-capacity.ts` and `DockCapacityBar`. Do not
  reimplement the arithmetic — four screens read that module precisely so it
  cannot drift. `getDockCapacityStatus(count, capacity)` returns
  `{ configured, fillPct, tone, remainingLabel }` and treats `0` and negative
  capacity as unconfigured.
- The artboards show four chips on a dock tile. Only two of them are capacity
  states; the other two are activity states. Derive those from `openBatches`
  and `is_active`, which both components already receive.
- `routeCount` has no source in `useDockZones` (see the `DockZoneRecord`
  interface — there is no route field). If it cannot be resolved without a new
  query, ship the rest and declare `routeCount` as an open finding in this
  phase. **Do not invent a count.**
- A zone with `capacity = null` must render as `4l`'s `A6` does.

**Tareas:**

**Task 0.1 — `OutboundDockGrid` reads capacity**

- Modify: `apps/frontend/src/components/distribution/OutboundDockGrid.tsx`
- Test: `apps/frontend/src/components/distribution/OutboundDockGrid.test.tsx` (create if absent)

- [ ] Write a failing test: a zone with `capacity: 180` and a count of 169
      renders a `dock-occupancy` element; a zone with `capacity: null` renders
      none. Build zones from the real `DockZoneRecord` shape — `id`, `name`,
      `code`, `is_consolidation`, `comunas`, `is_active`, `operator_id`,
      `capacity`.
- [ ] Run `../../node_modules/.bin/vitest.cmd run --pool=forks src/components/distribution/OutboundDockGrid.test.tsx` — expect FAIL (no bar rendered in either case).
- [ ] Implement: render `DockCapacityBar` with `count` and `zone.capacity`. Let the component decide; do not branch on `capacity` in the grid.
- [ ] Run the same command — expect PASS.
- [ ] Write a failing test for the activity chip: `openBatches[zone.id] > 0` and `is_active === false` each produce a distinguishable state, asserted by `data-testid`/`data-state`, **not by chip copy**.
- [ ] Run — expect FAIL. Implement with a `data-state` attribute. Run — expect PASS.
- [ ] Remove the "not wired to it yet" paragraph from the component's doc comment. It will be false.
- [ ] Commit: `feat(spec-96): OutboundDockGrid consume dock-capacity (4a)`

**Task 0.2 — `DockCard` receives occupancy**

- Modify: `apps/frontend/src/components/distribution/DockCard.tsx:24-27` (the doc comment that says callers pass nothing), `apps/frontend/src/app/app/distribution/quicksort/page.tsx:257-265`
- Test: `apps/frontend/src/components/distribution/DockCard.test.tsx`

- [ ] `DockCard` already accepts `occupancyPct` and renders the bar — verify by reading the component before changing anything. The gap is the **call site**.
- [ ] Write a failing test at the page level, or a focused test asserting `DockCard` is given a non-null `occupancyPct` when the zone has a capacity. Prefer computing the percentage with `getDockCapacityStatus` rather than inline arithmetic.
- [ ] Run — expect FAIL. Implement in `quicksort/page.tsx`: pass `occupancyPct` derived from `getDockCapacityStatus(count, zone.capacity).fillPct ?? undefined`.
- [ ] Run — expect PASS.
- [ ] `routeCount`: check `useDockZones` for any route source. If there is none, leave the prop unpassed and write the open finding into this phase's evidence line.
- [ ] Update `DockCard`'s doc comment, which currently states callers pass nothing.
- [ ] Commit: `feat(spec-96): pasar occupancyPct a DockCard desde modo rápido (4b)`

**Task 0.3 — Close the visual diff**

- [ ] Open `4a`, `4b` and `4l` and diff each against the running app at 1442 px and 402 px.
- [ ] Fix what differs, in the files listed above only.
- [ ] Run `npm run test:run` and `npm run type-check` — expect PASS.
- [ ] Commit, then open the PR with auto-merge.

---

### Fase 1 — Scan flow `[in_progress]`

> Implementado por: implementer — rama `feat/spec-96-fase-1-escaneo`, SHAs `57fefbc..HEAD` de esta rama (no se fija un SHA final literal aquí — cualquier commit que lo fije queda un commit corto del HEAD real; ver el reporte de cierre de la fase para el valor exacto)
> Review: pendiente — round 1 recibido y trabajado en esta misma rama (7 hallazgos + 1 hallazgo propio no reportado por el review, ver abajo). El reviewer/orquestador cierra esta línea al validar la rama, no el implementer.
> QA: pendiente — no corrido aún contra QA.
> Downstream: este spec no declara `**Downstream:**`. Revisado spec-71 (modo ESTIBAR, `QuickSortMobileStagePosition`/`mode: 'stage'`, comparte `useQuickSortFlow` y `QuickSortMobileView`) — sin cambios de contrato: `'confirmed'` solo se alcanza desde `handleAndenScan` (ruta sectorize); `handlePositionScan` sigue llamando `resetToStepOne()` sin tocar. `QuickSortScanner.tsx` (escritorio, mismo hook) SÍ requirió un cambio de una línea — ver Hallazgos abiertos.

**Hallazgos abiertos, que esta fase NO cierra:**

- **La acción real de "Marcar excepción" en `4j`** sigue sin resolverse como
  decisión de producto: `markException`/`recordQuickSortException` están
  acotados a un `rejectedCode` que no existe una vez que el escaneo de andén
  ya tuvo éxito. **Round 2:** en vez de un botón `disabled` ocupando medio
  footer de la pantalla que se ve tras cada escaneo correcto, `Cerrar lote`
  quedó como la segunda acción real del footer en `4j`; `Marcar excepción`
  queda deferred, sin ningún control fantasma en pantalla.
- **`DOCK-003` / `rutas R-2481 · R-2483`** — el mock dibuja el código físico
  del andén y su lista de rutas junto al código de sectorización (`A3`) en
  `4h`/`4i`/`4j`. `dock_zones` tiene exactamente **una** columna `code`;
  `ZoneMatchResult` lleva `zone_code`, no dos códigos distintos, y no hay
  fuente para una lista de rutas en este flujo. Mismo tipo de brecha que el
  `routeCount` abierto de la fase 0 — **se agrupan como una sola pregunta al
  diseñador/dato**, no dos. Confirmado independientemente por el reviewer.
- **El ícono de advertencia** en el aviso de capacidad de `4h` no se
  reprodujo — el resto de los avisos en línea de este mismo componente
  (`siblingsPending`, `flagged`) tampoco llevan ícono, y se priorizó la
  consistencia con ese patrón existente sobre la fidelidad exacta al mock en
  ese detalle decorativo.
- **La truncación del título en `4g` a 402 px NO es el conmutador SECT/ESTIB**
  — el reviewer lo verificó: el pill de área de toque real mide ~92px, casi
  idéntico a los 91px del mock. La palanca real es
  `DistributionMobileHeader.tsx:154` (`text-[18px]`, cuando el artboard
  especifica **14px**) — una desviación preexistente, no de esta fase, y de
  un componente compartido por siete pantallas de Distribución. El
  orquestador la deja fuera de esta fase deliberadamente y decide si se abre
  fase propia tras medirla en QA a 402px.
- **Los tests de 44px prueban tamaño declarado, no si el control es
  realmente tocable** — un `pointer-events:none` deja 24/24 en verde. Límite
  del guard, no un bug encontrado; se deja anotado en vez de reescribir el
  comportamiento que esos mismos tests ya fijan.
- **El aviso de capacidad de `4h` se imprime en tono `neutral` también** —
  a 5/180 (2.8%) el operario lee "si no cabe, mándalo a consolidación" con
  el andén casi vacío. El mock solo dibuja ese aviso en el caso ajustado;
  se deja como pregunta de producto, no como cambio de comportamiento
  tone-gated (los tests ya fijan ese comportamiento).
- **Hallazgo propio, no señalado por el review:** `QuickSortScanner.tsx`
  (escritorio, mismo `useQuickSortFlow`) dejaba de renderizar nada en
  absoluto tras cualquier escaneo de andén exitoso — ninguna de sus tres
  ramas reconocía el nuevo estado `'confirmed'`. Lo encontró la corrida
  completa de `src/components/distribution` + `src/hooks/distribution`
  (500/500 verde tras el fix), no el review. **Round 2 confirmó**: revertir
  `QuickSortScanner.tsx:66` rompe un test — el reviewer esperaba que esa
  mutación sobreviviera y no fue así.
- **Round 2, hallazgo must-fix (corregido):** `confirmed` se derivaba solo de
  `flow.state`/`flow.destination`, sin mirar `mode` — sobrevivía a un cambio
  SECT→ESTIB indefinidamente si el operario no volvía a escanear. Corregido
  con `mode === 'sectorize'` como condición adicional; test agregado.

**Benchmark:** `4g`, `4h`, `4i`, `4j`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/QuickSortMobile.tsx`,
`apps/frontend/src/components/distribution/QuickSortMobileView.tsx`,
`apps/frontend/src/components/distribution/QuickSortMobileDock.tsx`,
`apps/frontend/src/components/distribution/QuickSortScanner.tsx`,
`apps/frontend/src/hooks/distribution/useQuickSortFlow.ts`,
`apps/frontend/src/components/distribution/DistributionMobileHeader.tsx`
(aditivo — ver nota abajo), y sus tests hermanos.

> `QuickSortMobile.tsx` faltaba en esta lista y es **el fichero que renderiza la
> cabecera** que esta fase existe para arreglar. Corregido 2026-09-12. Ver la
> nota de componentes compartidos, arriba: la cabecera en sí es de otro módulo.

> `apps/frontend/src/components/distribution/DistributionMobileHeader.tsx` —
> **aditivo únicamente.** Un solo prop opcional nuevo, `titleControl` (sin
> valor por defecto salvo `undefined`), usado por el conmutador SECT/ESTIB de
> `4g`. Los ocho consumidores existentes de este componente compartido —
> incluido `DispatchCrewMobileHeader`, de Despacho — quedan sin cambios;
> verificado corriendo sus ocho suites de test tras el cambio.

> `useQuickSortFlow.ts` — no estaba en la lista original y **tuvo que
> tocarse**: el hallazgo #1 del review (`4j` se vaciaba tras un escaneo
> correcto) vive en la máquina de estados, no en las vistas. Ver Notas no
> visuales.

**Notas no visuales:**

- On step 2 and on rejection the app currently renders **no screen header at
  all** — only an `sr-only` `<h1>`. Verified in QA 2026-09-11: `main`'s first
  rendered text is the destination card. All four artboards have a header.
- **Corrección 2026-09-12 (review #1):** la nota original decía "`4j` is `4h`
  after a correct scan, not a third step. The flow returns to step 1 with the
  field armed, which is what the app already does" — **esa prosa era
  incorrecta** y, por la regla del propio spec, el artboard manda sobre ella.
  `4j` carga la tarjeta de destino recién resuelta, el aviso de orden
  incompleta y el bloque de capacidad — nada de eso sobrevivía a
  `resetToStepOne()`. `useQuickSortFlow` gana un estado `'confirmed'` que
  preserva `destination`/`currentPackage`/`siblingsPending` en vez de
  limpiarlos, condicionado además a `mode === 'sectorize'` (round 2
  must-fix: sin esa condición, el contexto de un andén sobrevivía a un
  cambio a ESTIB). El footer mantiene `Cerrar lote` funcional en todo
  estado — ver Hallazgos abiertos sobre `Marcar excepción`. Ver
  `useQuickSortFlow.test.ts` y `QuickSortMobile.test.tsx`.
- The QA scanner is a gun that types the code and sends no Enter. `4j`'s armed
  field is the mock honouring that; keep using
  `ScanField`/`useScannerAutoSubmit` and never require a tap to scan.
- The header truncates at 402 px today (`Musan Admin · paso 1 de 2 · 0 escan…`).
  Reproduce the artboard's header at that width — do not shorten the string to
  make it fit.
- **`4h`/`4i`'s capacity block (review #6):** `4h` draws capacity as a single
  inline advisory sentence, toned; `4j`'s bar+label shape does not belong
  here. `4i` (rejected) draws no capacity block at all.
- **`4h`/`4i`'s footer (review #7):** both states stack the SAME primary
  ("Enviar a consolidación", boxed) above a plain-text secondary that
  differs — "Cancelar y volver al paso 1" (`4h`) vs "Marcar excepción y
  seguir" (`4i`). `4i` had no consolidation exit before this fix — the one
  screen where the operator is stuck with a rejected dock.
- **`4g`'s SECT/ESTIB control (review #2/#3):** the artboard's box is
  ~91×23.5px at 9.5px mono — nowhere near the 44px touch-target floor. Each
  toggle button carries the real hit area via inline `minHeight`/`minWidth`
  (invisible), with an inner `<span>` carrying the artboard's visible sizing.
  Same pattern reused for `4h`/`4i`'s plain-text footer secondary.

**Tareas:**

**Task 1.1 — A real header on every scan state**

- Modify: `QuickSortMobileView.tsx`, `QuickSortMobileDock.tsx`
- Test: their sibling test files

- [x] Write a failing test: on step 2 and on the rejection state, a visible heading is rendered — assert it is **not** `sr-only` (e.g. the heading element is not inside an element with the `sr-only` class). Do not assert its text.
- [x] Run — expect FAIL on both states.
- [x] Implement one shared header region used by all four states, so they cannot drift apart again.
- [x] Run — expect PASS.
- [x] Commit: `fix(spec-96): cabecera visible en los cuatro estados del escaneo (4g-4j)`

**Task 1.2 — The armed field survives**

- [x] Write a failing test (or confirm an existing one) that a scan is submitted **without** any click — simulate the gun by typing into the focused field, no Enter, and assert submission via `useScannerAutoSubmit`'s path.
- [x] Run. If it already passes, say so and add no code — this task exists to stop Fase 1 from regressing the hardware contract while restyling the footer.
- [x] Commit only if something changed.

**Task 1.3 — Close the visual diff**

- [x] Diff `4g`, `4h`, `4i`, `4j` against the app at 402 px, including the header at that exact width.
- [x] Fix, run the suite and `type-check`, commit.
- [ ] PR with auto-merge — `gh pr list --head feat/spec-96-fase-1-escaneo --state all` returns `[]`; not opened by the implementer, per this repo's process (the orchestrator opens PRs).

---

### Fase 2 — Pendientes, móvil `[pending]`

**Benchmark:** `4d`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/PendingMobileList.tsx`,
`apps/frontend/src/components/distribution/PendingMobileOrderGroup.tsx`,
`apps/frontend/src/app/app/distribution/pendientes/page.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- `DET` / `CMP` and `SEL` are drawn with no state shown, so this phase defines
  their behaviour: `DET`/`CMP` toggles between the two row shapes
  `PendingMobileOrderGroup` already renders (per-bulto rows versus one compact
  row per order); `SEL` enters a selection mode whose action is the existing
  send-to-dock sheet applied to the selection.
- The group for orders with no dock means the comuna resolves but no dock covers
  it. It is **not** the same predicate as `4a`'s `COMUNAS NO RECONOCIDAS`
  (`get_unmatched_comunas`). Keep them distinct in the data as the mock now
  keeps them distinct in the words.

**Tareas:**

**Task 2.1 — `DET` / `CMP`**

- [ ] Write a failing test: in `CMP`, a three-bulto order renders one row; in `DET`, it renders the order line plus one row per bulto. Assert row counts, not copy.
- [ ] Run — expect FAIL. Implement as a state in the page, passed down; `PendingMobileOrderGroup` already renders both shapes.
- [ ] Run — expect PASS. Commit.

**Task 2.2 — `SEL`**

- [ ] Write a failing test: entering selection mode exposes a checkbox per order; selecting two and confirming calls the send handler once with both orders' package ids.
- [ ] Run — expect FAIL. Implement, reusing `SendToDockSheet` with the selection.
- [ ] Run — expect PASS. Commit.

**Task 2.3 — Keep the two predicates apart**

- [ ] Write a test asserting the no-dock group is computed per order via `determineDockZone`, not from the bucket-level flag. `PendingMobileList.tsx`'s own doc comment explains why — the consolidation bucket legitimately mixes three cases, so the bucket-level flag depends on whichever order was fetched first. This test locks that reasoning in before the group header is restyled.
- [ ] Run, implement if needed, commit.

**Task 2.4 — Close the visual diff** at 402 px, including the group header that truncates today. Run suite + type-check, PR with auto-merge.

---

### Fase 3 — Send sheet and consolidación `[done]`

> Implementado por: implementer — rama `feat/spec-96-fase-3-hoja-consolidacion`, SHAs `2ec24e3..cbc6958`
> Review: reviewer (opus) — 5 hallazgos, 2 bloqueantes, cerrados en `2584101` y `cbc6958`
> QA: PR #823 merged 2026-09-12T02:2xZ; `e2e-qa` **leído en el reporte**: verde en la corrida 34669012716 (SHA `353e6b1`), contra QA ya caliente.
> Downstream: ningún spec declara depender de éste. Revisado spec-68 fase 4 (consolidación móvil, misma pantalla) — sin cambios de contrato; el contador cambió de componente pero su comportamiento (ausente sin selección, singular/plural) se conserva y sus tests se movieron, no se borraron.

**Lo que el review encontró, porque vale más que el diff:** apilar el footer
para seguir a `4f` lo llevó de ~80 px a 142 px + `env(safe-area-inset-bottom)`
mientras la lista seguía reservando `pb-[104px]`. El checkbox de la última fila
quedaba **bajo** el footer sin scroll restante: ese bulto no se podía
seleccionar. Sólo afectaba a `ops_leader` (con `warehouse_staff` el footer mide
76 px), que es por qué todos los tests de rol seguían verdes. Un arreglo visual
correcto produjo una regresión funcional que ningún test podía ver.

Arreglado por construcción, no subiendo el número: `FOOTER_METRICS` alimenta a
la vez `getFooterContentHeight()` y las alturas inline de las filas del footer,
y `hasCounter` gobierna el render **y** el cálculo.

**Y el wrap era un síntoma:** el título era `text-lg` (18 px) donde `4e` pide
15 px. A 15 px el código entra en una línea y no hace falta envolverlo;
`break-all` habría partido un identificador escaneable por la mitad.

**Benchmark:** `4e`, `4f`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/SendToDockSheet.tsx`,
`apps/frontend/src/components/distribution/ConsolidationMobileView.tsx`,
`apps/frontend/src/components/distribution/ConsolidationPageContent.tsx`, y sus
tests hermanos.

> Decía `consolidacion/page.tsx`, que son 21 líneas que sólo exportan la página;
> la pantalla entera —cabecera, chip `SALEN YA`, footer— vive en
> `ConsolidationPageContent.tsx`. Corregido 2026-09-12.

**Notas no visuales:**

- `4e` is unchanged from round 1 — the designer reviewed it and altered nothing.
- The sheet title wraps badly on real barcodes (`Enviar
  CARGA-EASY-001-ORD-03-CTN-1 a` breaks after `a`). The artboard's codes are
  shorter than the fixture's; reproduce the artboard using a fixture code.
- `URGENTES` carries overdue packages with an `AYER` row tag. The bare label is
  now the mock's too; do not restore a `HOY Y MAÑANA` qualifier.

**Tareas:**

**Task 3.1 — The sheet holds a real barcode**

- [ ] Write a failing test rendering `SendToDockSheet` with `CARGA-EASY-001-ORD-03-CTN-1` and asserting the title element carries a wrap-safe class (or that the code is in its own element). Assert structure, not the rendered line count — jsdom does not lay out text.
- [ ] Run, implement, run, commit. Then confirm by eye at 402 px; jsdom cannot prove this one.

**Task 3.2 — Close the visual diff** on `4e` and `4f`, including the footer order and the selection counter. Run suite + type-check, PR with auto-merge.

---

### Fase 4 — Escritorio, estado inicial `[in_progress]`

**Benchmark:** `4a`.

**Depende de:** spec-96 fase 0

**Archivos:** `apps/frontend/src/app/app/distribution/page.tsx`,
`apps/frontend/src/components/distribution/ConsolidationPanel.tsx`,
`apps/frontend/src/components/distribution/OutboundDockGrid.tsx`,
`apps/frontend/src/components/distribution/SectorizationIncidentsPanel.tsx`
(nuevo), y sus tests hermanos.

> Antes declaraba un **directorio** para el panel nuevo, que
> `check-phase-overlap.mjs` ignora al resolver contenido e imports — una fase
> cuya superficie el guard no puede leer no se puede juzgar. Nombrado el fichero.
> Se añade `OutboundDockGrid.tsx` porque esta fase termina lo que la fase 0 dejó
> abierto ahí: los chips de actividad, el pie con códigos de ruta y sus acciones,
> y **quitar** el badge `LOTE` muerto que el revert de la fase 0 devolvió.

**Notas no visuales:**

- The three incidence types are now defined by the mock and each maps to a
  different predicate. Wire each to its own source; **do not collapse them into
  one count**:
  - the unrecognised-comuna type — `get_unmatched_comunas`, via
    `useUnmatchedComunas`, the same source the renamed StatTile already uses.
  - the no-dock type — comuna resolves, no dock zone covers it. Same predicate
    as `4d`'s group, which `determineDockZone` already computes per order.
  - the wrong-dock type — the scanned dock is not the one the engine computed.
    `lib/distribution/quicksort-exception.ts` already records this event.
- If a type cannot be sourced without a new query, ship the others and declare
  it open in this phase.
- Depends on Fase 0 because the dock tiles carry the capacity denominator.

**Tareas:**

**Task 4.1 — The incidences panel**

- Create: `apps/frontend/src/components/distribution/SectorizationIncidentsPanel.tsx` + test

- [ ] Write a failing test: given three independent counts, the panel renders three distinct rows, each with its own count, and a footer action. Assert `data-testid` per type, not copy.
- [ ] Run — expect FAIL (module does not exist). Implement the presentational component; it takes counts as props and owns no queries.
- [ ] Run — expect PASS. Commit.
- [ ] Write a failing test that the panel renders an empty state when all three are zero. Run, implement, run, commit.

**Task 4.2 — Feed it**

- [ ] Write a failing test at the page level: each row's count comes from its own source, and two types with different underlying values do not show the same number.
- [ ] Run — expect FAIL. Implement the wiring in `page.tsx`. Any type without a source stays out and is declared — do not pass a placeholder zero that reads as "none".
- [ ] Run — expect PASS. Commit.

**Task 4.3 — Close the visual diff** on `4a`, including the consolidation table and the renamed tile. Run suite + type-check, PR with auto-merge.

---

### Fase 5 — Escritorio, modo rápido `[pending]`

**Benchmark:** `4b`.

**Depende de:** spec-96 fase 0, spec-96 fase 9

**Archivos:** `apps/frontend/src/app/app/distribution/quicksort/page.tsx`,
`apps/frontend/src/components/distribution/RecentScansPanel.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- The pendientes list the app renders below the grid **moves out** to `4m`.
  Depends on Fase 9 so the list has somewhere to go before it is removed here.
- The confirmation banner's data already exists on the client; the screen shows
  nothing today.
- `EN ESTA SESIÓN`, which the app substituted for one of the artboard's tiles,
  is not in the artboard.

**Tareas:**

**Task 5.1 — Remove the in-place pendientes list**

- [ ] Confirm Fase 9 is `[done]` and the route exists. If not, stop — this task cannot run first.
- [ ] Write a failing test: the quicksort page renders no pendientes rows, and offers a way to reach the new route.
- [ ] Run — expect FAIL. Remove the list, add the link. Run — expect PASS. Commit.

**Task 5.2 — The confirmation banner**

- [ ] Write a failing test: after a successful scan the page exposes a confirmation region carrying the dock and the scanned code. Assert presence and data, not styling.
- [ ] Run, implement from the state the page already holds (`lastOkScan`), run, commit.

**Task 5.3 — Close the visual diff** on `4b` at 1442 px. Run suite + type-check, PR with auto-merge.

---

### Fase 6 — Home de la nave `[pending]`

**Benchmark:** `4c`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/DistributionMobileView.tsx`,
`apps/frontend/src/components/distribution/DistributionProcessRow.tsx`,
`apps/frontend/src/components/distribution/DistributionMobileHeader.tsx`, y sus
tests hermanos.

**Notas no visuales:**

- The process-row subtitles carry live data in the artboard where the app has
  static descriptors. One of them is capacity-derived; if Fase 0 has not landed,
  ship the others and say which.
- The KPI tiles the app renders between the hero card and the process list are
  **not** in the artboard. Removing shipped UI is a deliberate act — say so in
  the phase evidence rather than leaving it as an unexplained deletion.
- spec-68 Decisión 2 and Decisión 9 are **confirmed** by this round, not
  reversed: the mock now draws the app's tab bar and drops `turno`. Nothing to
  undo, and no tab-bar work in this phase.
- Verify with an operations account (`bodega@musan.com`). Under
  `admin@musan.com` the tab bar does not render at all.

**Tareas:**

**Task 6.1 — Live subtitles**

- [ ] Write a failing test: each process row's subtitle is derived from the data it links to, and the row for andenes carries a count. Assert the numbers come from props, not that the sentence reads a particular way.
- [ ] Run — expect FAIL (subtitles are static strings today). Implement. Run — expect PASS. Commit.

**Task 6.2 — Remove the KPI tiles**

- [ ] Write a failing test asserting the tiles are absent.
- [ ] Run — expect FAIL. Remove them. Run — expect PASS.
- [ ] Write the reason into the commit body: they are not in `4c`, and the counts they carried now live on the process rows.
- [ ] Commit.

**Task 6.3 — Close the visual diff** on `4c` at 402 px, logged in as `bodega@musan.com`. Run suite + type-check, PR with auto-merge.

---

### Fase 7 — Modo ESTIBAR `[pending]`

**Benchmark:** `4k`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/QuickSortMobileStagePosition.tsx`,
`apps/frontend/src/components/distribution/MoveTaskList.tsx`,
`apps/frontend/src/app/app/distribution/mover-a-posicion/page.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- The mode already ships (spec-71). This phase reconciles it with the artboard
  that now governs it; it does not build it from nothing. Read the existing
  components before planning any change.
- Two entry points, and the artboard names both: `4g`'s `SECT`/`ESTIB` control
  and `4c`'s `Mover a posición` row. They must reach the same screen.
- Same scanner constraint as Fase 1 — the position field is armed, not tapped.

**Tareas:**

**Task 7.1 — One destination, two doors**

- [ ] Write a failing test: both entry points resolve to the same route.
- [ ] Run. Implement if they diverge. Commit.

**Task 7.2 — Close the visual diff** on `4k` at 402 px. Run suite + type-check, PR with auto-merge.

---

### Fase 8 — Andenes de la nave `[pending]`

**Benchmark:** `4l`.

**Depende de:** spec-96 fase 0

**Archivos:** `apps/frontend/src/components/distribution/DockListMobile.tsx`,
`apps/frontend/src/app/app/distribution/andenes/page.tsx`, y sus tests hermanos.

**Notas no visuales:**

- `A6` in the artboard is the unconfigured-capacity case and is as much a
  requirement as the configured ones. A zone with `capacity = null` gets no bar
  and says so; it must never render a bar at 0 %.
- Depends on Fase 0 for the activity-chip derivation shared with the other dock
  surfaces.

**Tareas:**

**Task 8.1 — The unconfigured zone is a first-class state**

- [ ] Write a failing test: a zone with `capacity: null` renders no occupancy element **and** renders an explanatory region; a zone with a capacity renders the bar.
- [ ] Run — expect the first half to pass already (`DockCapacityBar` returns nothing) and the explanatory region to fail.
- [ ] Implement. Run — expect PASS. Commit.

**Task 8.2 — Close the visual diff** on `4l` at 402 px. Run suite + type-check, PR with auto-merge.

---

### Fase 9 — Pendientes por sectorizar, escritorio `[pending]`

**Benchmark:** `4m`.

**Depende de:** spec-96 fase 2

**Archivos:** `apps/frontend/src/app/app/distribution/pendientes/page.tsx`,
`apps/frontend/src/components/distribution/PendingDockList.tsx`,
`apps/frontend/src/components/distribution/PendingDockListOrderGroup.tsx`, y sus
tests hermanos.

**Notas no visuales:**

- **This is not a new route.** `/app/distribution/pendientes` already exists and
  renders `PendingMobileList` **at every width** — its doc comment says so
  outright: "comfortable reading width, no `useIsBelowLg` branch. There is no
  desktop equivalent of this screen to collide with". `4m` *is* that missing
  desktop branch. Creating a second route would duplicate the screen.
- Follow the pattern `app/app/distribution/page.tsx` already uses: `useIsBelowLg`
  picks **exactly one** of the two trees with an early return. Its doc comment
  records why — mounting both has shipped as a bug twice (spec-54's `3h` and
  spec-62), two headers stacked on one phone screen. Do not hide one with CSS.
- That route's doc comment becomes false with this phase. Update it.
- The desktop rows already exist as `PendingDockList`, used by quicksort and
  `/batch`. Reuse it; reuse `usePendingSectorization` — **no new query**.
- `Exportar` and `Cargar más` are new behaviours. Paginate rather than render
  every order at once; the fixture's 50 will not reveal the difference, so state
  the page size chosen in the phase evidence.
- Depends on Fase 2 because both phases edit `pendientes/page.tsx`. Dispatching
  them together is exactly the collision `check-phase-overlap.mjs` exists to
  catch.
- Fase 5 removes the in-place list from `quicksort/page.tsx` once this branch
  exists. Do not remove it here.

**Tareas:**

**Task 9.1 — The desktop branch**

- Modify: `apps/frontend/src/app/app/distribution/pendientes/page.tsx`
- Test: `apps/frontend/src/app/app/distribution/pendientes/page.test.tsx`

- [ ] Read the route and `app/app/distribution/page.tsx`'s `isBelowLg` early return before writing anything — the second is the pattern to copy.
- [ ] Write a failing test: below `lg` the mobile list renders and the desktop table does not; at or above `lg` the reverse. Assert each tree is **absent**, not hidden.
- [ ] Run `../../node_modules/.bin/vitest.cmd run --pool=forks src/app/app/distribution/pendientes/page.test.tsx` — expect FAIL (the mobile list renders at both widths).
- [ ] Implement with an early return, mirroring `distribution/page.tsx`. Reuse `PendingDockList` for the desktop tree.
- [ ] Run — expect PASS.
- [ ] Correct the route's doc comment: there is now a desktop equivalent.
- [ ] Commit: `feat(spec-96): rama de escritorio de /pendientes (4m)`

**Task 9.2 — Pagination**

- [ ] Write a failing test: with more orders than the page size, only the first page renders and a load-more control is present; activating it renders the next page.
- [ ] Run — expect FAIL. Implement client-side pagination over the existing query result.
- [ ] Run — expect PASS. Commit.

**Task 9.3 — Export**

- [ ] Write a failing test: the export action produces a row per order with the columns the artboard's table shows.
- [ ] Run — expect FAIL. Implement. Run — expect PASS. Commit.

**Task 9.4 — Close the visual diff** on `4m` at 1442 px. Run suite + type-check, PR with auto-merge.

---

## Verification

`unit` on every phase. `e2e-qa` on every phase, since all of them change a
screen.

Three honest limits on the QA evidence, to be declared in the phase bodies
rather than worked around:

- **Capacity is configured now, but the tones are not reachable.** `QUIL-001`
  has a capacity and `CONSOL` deliberately does not, so the bar and the
  unconfigured state are both demonstrable. `warning` and `error` need
  sectorized packages first — see the prerequisite section.
- **The QA fixture is nearly empty** — 50 pendientes, 0 clasificados, 0 in
  consolidación, two dock zones. `4b`'s grid, `4f`'s two sections, `4a`'s
  incidence rows and `4m`'s pagination have no data to render. A phase that
  cannot demonstrate its change in QA says so and names the data it would need;
  it does not claim `e2e-qa` green as proof of something the screen never
  displayed.
- **Role changes what renders.** Use `bodega@musan.com`, an operations account,
  for every mobile check. `admin@musan.com` gets no `MobileTabBar`
  (`buildMobileTabs` returns none for admin/manager) and falls back to the
  hamburger, which is not what any `4c`–`4l` artboard draws.

## Suggested order

Fase 0 first — it unblocks 4, 5 and 8, and it is two components. Then Fase 2,
then Fase 9 (which waits on 2 for the shared file), because Fase 5 waits on 9.

Fases 1, 3, 6 and 7 have no dependencies and touch no file any other phase
touches, so they can be dispatched in parallel, in separate worktrees, each on a
branch carrying its phase number.

The dependency chain in one line: `0 → {4, 8}`, `0 + 2 → 9 → 5`, and `1, 3, 6,
7` free. Before dispatching any two together, run them past the guard:

```
node scripts/check-phase-overlap.mjs \
  docs/specs/spec-96-distribucion-correccion-contra-el-mock.md#1 \
  docs/specs/spec-96-distribucion-correccion-contra-el-mock.md#3
```

Exit `0` is dispatchable, `1` is a hard file collision, `4` is an unmet
`**Depende de:**`.
