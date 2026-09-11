# spec-96 — Distribución: corrección contra el mock

**Status:** backlog
**Verify:** unit, e2e-qa

> Written in English on the user's instruction (2026-09-11). Every UI string is
> quoted verbatim in Spanish — the product's language does not change.

## The benchmark is the file, not this document

**`docs/design/Distribucion.dc.html` is the acceptance criterion.** Thirteen
artboards, `4a`–`4m`, downloaded 2026-09-11 from project
`4656dcbc-00da-4548-a4da-b53e614264c1` and byte-identical to the remote
(136 989 B). Verify the count yourself:

```
grep -oE 'dv-opt" id="[^"]*"' docs/design/Distribucion.dc.html
```

Each phase below names **the artboard it must reproduce and the files it may
touch — nothing else.** It does not describe what the artboard looks like. That
is deliberate, and it is the user's instruction of 2026-09-11: prose drifts from
the file it paraphrases, and when the two disagree there is no way to tell which
one is stale. Open the artboard, diff it against the screen, close the
difference.

Two things prose still carries, because the HTML cannot express them: **where
the data comes from**, and **constraints the drawing cannot show** (scanner
behaviour, the null-capacity contract, viewport limits). Those appear under
`Notas no visuales` inside a phase. Anything that *is* visible in the artboard
is absent here on purpose.

To open an artboard: load the file in a browser and jump to its anchor (`#4k`),
or read the block that starts at `<div class="dv-opt" id="4k">`. `support.js` is
not copied into the repo — it is the generated runtime; render the file through
the design project when you need it laid out.

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

## Two corrections carried over from round 1

Both were first recorded as gaps and are not. They are repeated here because the
screens still look empty in QA and the next reader will re-find them:

1. **Dock capacity is already wired** into the `4e` send sheet
   (`SendToDockSheet.tsx:194`), the scan step-2 screen
   (`QuickSortMobileDock.tsx:120-122`) and `/andenes` (`DockListMobile.tsx:67`).
   Nothing renders because both QA dock zones have `capacity = null`, and
   `lib/distribution/dock-capacity.ts` deliberately draws nothing rather than a
   bar pinned at 0 %. `4l` now draws that exact state (`A6`), so it is a
   requirement, not a fallback.
2. **`4b`'s comuna list and `ACTIVO` badge are already passed**
   (`quicksort/page.tsx:261,264`). The comuna array is empty in the QA fixture.

## Prerequisite — QA cannot demonstrate capacity today

Until `capacity` is set on the QA dock zones, every capacity element in `4a`,
`4b`, `4j` and `4l` is invisible in QA. `DockZoneForm` already edits the field;
no migration, no seed change.

**This is a prerequisite of Fase 0, not part of it.** Set a capacity on both QA
zones — one of them above 90 % of its current count, so the `warning` tone is
exercised — and leave a third zone unconfigured if one can be created, since
`4l` requires the unconfigured state to be correct too. Without this, Fase 0's
`e2e-qa` evidence proves nothing.

---

### Fase 0 — Capacity on the two unwired dock tiles `[pending]`

**Benchmark:** `4a` (grilla «Andenes de salida»), `4b` (grilla `ANDENES`), `4l`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/OutboundDockGrid.tsx`,
`apps/frontend/src/components/distribution/DockCard.tsx`,
`apps/frontend/src/components/distribution/DockListMobile.tsx`,
`apps/frontend/src/app/app/distribution/quicksort/page.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- Consume `lib/distribution/dock-capacity.ts` and `DockCapacityBar`. Do not
  reimplement the arithmetic — four screens read that module precisely so it
  cannot drift.
- `getDockCapacityStatus` returns `neutral` / `warning` / `error`. The artboards
  show four chips; two of them are not capacity states — derive those from
  `openBatches` and `is_active`, which the components already receive.
- `routeCount` has no source in `useDockZones` today. If it cannot be resolved
  without a new query, ship the rest and declare `routeCount` as an open finding
  in this phase. Do not invent a count.
- A zone with `capacity = null` must render as `4l`'s `A6` does. That is the
  existing contract of `dock-capacity.ts`; this phase must not weaken it.

---

### Fase 1 — Scan flow `[pending]`

**Benchmark:** `4g`, `4h`, `4i`, `4j`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/QuickSortMobileDock.tsx`,
`apps/frontend/src/components/distribution/QuickSortScanner.tsx`,
`apps/frontend/src/components/distribution/QuickSortMobileView.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- On step 2 and on rejection the app currently renders **no screen header at
  all** — only an `sr-only` `<h1>`. Verified in QA 2026-09-11: `main`'s first
  rendered text is the destination card. All four artboards have a header.
- `4j` is `4h` after a correct scan, not a third step. The flow returns to step 1
  with the field armed, which is what the app already does.
- The QA scanner is a gun that types the code and sends no Enter. `4j`'s armed
  field is the mock honouring that; keep using
  `ScanField`/`useScannerAutoSubmit` and never require a tap to scan.
- The header truncates at 402 px today (`Musan Admin · paso 1 de 2 · 0 escan…`).
  Reproduce the artboard's header at that width — do not shorten the string to
  make it fit.

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

---

### Fase 3 — Send sheet and consolidación `[pending]`

**Benchmark:** `4e`, `4f`.

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/SendToDockSheet.tsx`,
`apps/frontend/src/components/distribution/ConsolidationMobileView.tsx`,
`apps/frontend/src/app/app/distribution/consolidacion/page.tsx`, y sus tests
hermanos.

**Notas no visuales:**

- `4e` is unchanged from round 1 — the designer reviewed it and altered nothing.
- The sheet title wraps badly on real barcodes (`Enviar
  CARGA-EASY-001-ORD-03-CTN-1 a` breaks after `a`). The artboard's codes are
  shorter than the fixture's; reproduce the artboard using a fixture code.
- `URGENTES` carries overdue packages with an `AYER` row tag. The bare label is
  now the mock's too; do not restore a `HOY Y MAÑANA` qualifier.

---

### Fase 4 — Escritorio, estado inicial `[pending]`

**Benchmark:** `4a`.

**Depende de:** spec-96 fase 0

**Archivos:** `apps/frontend/src/app/app/distribution/page.tsx`,
`apps/frontend/src/components/distribution/ConsolidationPanel.tsx`, un
componente nuevo para el panel de incidencias bajo
`apps/frontend/src/components/distribution/`, y sus tests hermanos.

**Notas no visuales:**

- The three incidence types are now defined by the mock and each maps to a
  different predicate. Wire each to its own source; do not collapse them into
  one count:
  - the unrecognised-comuna type — `get_unmatched_comunas`, the same source the
    renamed StatTile already uses.
  - the no-dock type — comuna resolves, no dock zone covers it. Same predicate
    as `4d`'s group, which `determineDockZone` already computes per order.
  - the wrong-dock type — the scanned dock is not the one the engine computed.
    `lib/distribution/quicksort-exception.ts` already records this event.
- If a type cannot be sourced without a new query, ship the others and declare it
  open in this phase.
- Depends on Fase 0 because the dock tiles carry the capacity denominator.

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
  undo.

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
  that now governs it; it does not build it from nothing.
- Two entry points, and the artboard names both: `4g`'s `SECT`/`ESTIB` control
  and `4c`'s `Mover a posición` row. They must reach the same screen.
- Same scanner constraint as Fase 1 — the position field is armed, not tapped.

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
- Depends on Fase 0 for the chip derivation shared with the other dock surfaces.

---

### Fase 9 — Pendientes por sectorizar, escritorio `[pending]`

**Benchmark:** `4m`.

**Depende de:** ninguna

**Archivos:** una ruta nueva bajo `apps/frontend/src/app/app/distribution/`,
componentes nuevos bajo `apps/frontend/src/components/distribution/`,
`apps/frontend/src/components/distribution/PendingDockList.tsx`,
`apps/frontend/src/components/distribution/PendingDockListOrderGroup.tsx`, y sus
tests hermanos.

**Notas no visuales:**

- The rows exist today inside the quicksort screen; this phase gives them their
  own route. Reuse `usePendingSectorization` — no new query.
- `Exportar` and `Cargar más` are new behaviours. Paginate rather than render
  every order at once; the fixture's 50 will not reveal the difference, so state
  the page size chosen.
- Fase 5 removes the in-place list once this route exists.

---

## Verification

`unit` on every phase. `e2e-qa` on every phase, since all of them change a
screen.

Three honest limits on the QA evidence, to be declared in the phase bodies
rather than worked around:

- **Capacity needs the prerequisite above.** Without it, Fase 0, Fase 8 and one
  of `4c`'s subtitles cannot be seen in QA at all.
- **The QA fixture is nearly empty** — 50 pendientes, 0 clasificados, 0 in
  consolidación, two dock zones. `4b`'s grid, `4f`'s two sections, `4a`'s
  incidence rows and `4m`'s pagination have no data to render. A phase that
  cannot demonstrate its change in QA says so and names the data it would need;
  it does not claim `e2e-qa` green as proof of something the screen never
  displayed.
- **Role changes what renders.** `admin@musan.com` gets no `MobileTabBar`
  (`buildMobileTabs` returns none for admin/manager), so `4c`'s tab bar cannot be
  verified from that account. Use an operations account.
