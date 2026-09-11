# spec-96 — Distribución: corrección contra el mock

**Status:** backlog
**Verify:** unit, e2e-qa

> Written in English on the user's instruction (2026-09-11). Every UI string is
> quoted verbatim in Spanish — the product's language does not change.

## Why this spec exists

On 2026-09-11 the Distribución module was walked screen by screen in QA
(`qa.aureon.tractis.ai`, `admin@musan.com`, light theme, 1442 px and 402 px)
against all ten artboards of `Distribucion.dc.html`.

The user set the tie-breaker explicitly, and it is the opposite of the one
Recogida used: **the mock is the source of truth and the app is corrected
against it.** `docs/design/README.md`'s standing rule ("el mock manda en diseño,
el spec manda en comportamiento") is unchanged — this spec only says that where
the two disagree on *appearance*, the mock wins and the app moves.

The diff produced two piles. This spec is the larger one: roughly forty-five
differences where the mock draws something concrete, the app does not have it,
and the correction needs no design decision.

The smaller pile — nine points where the mock contradicts a decision that has a
written reason, says nothing at all, or says something the data disproves — went
back to the designer as `docs/design/mock-feedback-distribucion.md`. **Every
phase below explicitly excludes the item from that list which touches its
screen**, so the two rounds never collide. The two tracks run in parallel by
the user's decision; anything the designer resolves lands as a follow-up phase
here, or as its own spec.

## Screens in scope

`4a` desktop initial · `4b` desktop modo rápido · `4c` mobile nave home ·
`4d` pendientes de sectorizar · `4e` send sheet · `4f` consolidación ·
`4g` scan step 1 · `4h` scan step 2 · `4i` wrong dock.

`4j` gets no phase — it is entirely a design question (feedback point 5).

## Two corrections to the walkthrough, so they are not re-reported

Both were initially recorded as gaps and are not:

1. **Dock capacity is already wired** into the `4e` send sheet
   (`SendToDockSheet.tsx:194`), the scan step-2 screen
   (`QuickSortMobileDock.tsx:120-122`, `Quedan N espacios` included) and
   `/andenes` (`DockListMobile.tsx:67`). None of it renders in QA because both
   QA dock zones have `capacity = null`, and `lib/distribution/dock-capacity.ts`
   deliberately renders no bar rather than one pinned at 0 %. Only
   `OutboundDockGrid` (`4a`) and `DockCard`'s `routeCount`/`occupancyPct` (`4b`)
   are genuinely unwired, and both say so in their own doc comments.
2. **`4b`'s comuna list and `ACTIVO` badge are already passed**
   (`quicksort/page.tsx:261,264`). The comuna array is empty in the QA fixture
   and `ACTIVO` only appears after a scan.

## Prerequisite — QA cannot demonstrate capacity today

Until `capacity` is set on the QA dock zones, an entire class of mock elements
is invisible in QA and will keep being re-reported as missing. `DockZoneForm`
already edits the field; no migration, no seed change.

**This is a prerequisite of Phase 0, not part of it.** Set a capacity on both QA
zones (a value that puts one of them above 90 % against its current package
count, so the `warning` tone is exercised too) before verifying anything below.
Without it, Phase 0's `e2e-qa` evidence proves nothing.

---

### Fase 0 — Capacity on the two unwired dock tiles `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/OutboundDockGrid.tsx`,
`apps/frontend/src/components/distribution/DockCard.tsx`,
`apps/frontend/src/app/app/distribution/quicksort/page.tsx`, y sus tests
hermanos.

Consume `lib/distribution/dock-capacity.ts` and `DockCapacityBar` from the two
components that still ignore them.

- `OutboundDockGrid` (`4a`): the `168 / 180 paq.` denominator, the fill bar, and
  the state chip. The mock's chips are `CASI LLENO` / `EN RITMO` / `DETENIDO` /
  `SIN ABRIR`; `getDockCapacityStatus` returns `neutral` / `warning` / `error`,
  so the mapping is capacity-derived for the first two only. `DETENIDO` and
  `SIN ABRIR` are batch states, not capacity states — derive them from
  `openBatches` and `is_active`, which the component already receives.
- `DockCard` (`4b`): pass `occupancyPct` and `routeCount` from the call site.
  `routeCount` has no source in `useDockZones` today; if it cannot be resolved
  without a new query, ship `occupancyPct` alone and declare `routeCount` as an
  open finding in this phase rather than inventing a count.

A zone with `capacity = null` must keep rendering exactly as it does now — no
bar, no denominator, no chip. That is the existing contract of
`dock-capacity.ts` and it is what makes the unconfigured QA zones legible.

**Excludes:** nothing from the feedback list.

---

### Fase 1 — The scan flow's missing chrome, `4g` / `4h` / `4i` `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/QuickSortMobileDock.tsx`,
`apps/frontend/src/components/distribution/QuickSortScanner.tsx`,
`apps/frontend/src/components/distribution/QuickSortMobileView.tsx`, y sus tests
hermanos.

The most visible defect in the module. On step 2 and on rejection the app drops
the screen header entirely — title, `paso 2 de 2 · lote abierto`, the
`LEÍDO` / `RECHAZADO` chip and the back arrow — leaving only an `sr-only`
`<h1>`. Verified in QA: `main`'s first rendered text is the destination card.

- Restore the header on both states, with the chip the mock specifies for each.
- `4h` destination card: amber, not green. Add the divider, `DOCK-003 · rutas
  R-2481 · R-2483`, the customer name and `paquete 2 de 3`.
- `4h`: the heading `Lee el código del andén A3 para asignar el paquete` above
  the armed field.
- `4i`: lift the correct-destination card out of the red box into its own amber
  card with `DOCK-003 · destino correcto de este bulto`; drop the strikethrough
  on the scanned code in favour of the mock's large dock letter; change the
  eyebrow to `VUELVE A ESCANEAR EL ANDÉN`.
- Footers: `Enviar a consolidación` is the outline action on both screens.
  `Cancelar y volver al paso 1` (`4h`) and `Marcar excepción y seguir` (`4i`)
  are text links below it, not filled buttons beside it. `4i` must keep
  `Enviar a consolidación`, which the app currently drops.
- `4g`: barcode glyph instead of the scan-frame icon, `CL…` placeholder, the
  `ENTER` hint, and the sentence form `N paquetes sectorizados en esta sesión ·
  lote abierto HH:MM` in place of the bordered `EN ESTA SESIÓN` row.
- `4g` footer: both buttons are equal outlines in the mock; today `Cerrar lote`
  is a filled amber primary.
- The header truncates at 402 px (`Musan Admin · paso 1 de 2 · 0 escan…`). Fix
  it here, not with a shorter string.

**Excludes:** the `SECTORIZAR / ESTIBAR` tab pair (feedback point 7) — leave it
exactly where it is, whatever it does to the layout.

---

### Fase 2 — `4d` pendientes, density and grouping `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/PendingMobileList.tsx`,
`apps/frontend/src/components/distribution/PendingMobileOrderGroup.tsx`,
`apps/frontend/src/app/app/distribution/pendientes/page.tsx`, y sus tests
hermanos.

- Header: add the order count and `en bodega` (`148 bultos · 62 órdenes · en
  bodega`), and the `DET / CMP` segmented control.
- Order row: the customer name beside the order number, the `N BULTOS` badge,
  and `entrega 13/08` in place of the `hoy` chip.
- Group headers as the mock's breadcrumb line — `ANDÉN A3 › DOCK-003 · La
  Florida    14 pendientes` and `SIN ANDÉN › comuna sin mapear    6 pendientes`.
  Today `SIN ANDÉN` is an amber box whose middle text truncates at 402 px
  (`Comuna sin mapear …`); the breadcrumb form removes the truncation rather
  than working around it.
- Tint the order card for an unmapped order, the way the mock tints `ORD-48250`.
- Footer: add the `SEL` multi-select affordance beside `Escanear`.

`DET / CMP` and `SEL` are new interactions, not restyling. Both are drawn in the
mock with no state shown, so this phase defines them: `DET`/`CMP` toggles
per-bulto rows versus one compact row per order (`PendingMobileOrderGroup`
already renders both shapes); `SEL` enters a selection mode whose action is the
existing send-to-dock sheet applied to the selection.

**Excludes:** nothing from the feedback list.

---

### Fase 3 — `4e` send sheet and `4f` consolidación `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/SendToDockSheet.tsx`,
`apps/frontend/src/components/distribution/ConsolidationMobileView.tsx`,
`apps/frontend/src/app/app/distribution/consolidacion/page.tsx`, y sus tests
hermanos.

`4e` is the module's closest match; four small things separate it:

- Subtitle carries the order too: `ORD-48213 · La Florida · sugerido A3 por
  comuna`, not just the comuna.
- Grab handle at the top instead of the `✕`.
- The manual-assignment note sits in a grey pill with an ⓘ glyph.
- The title wraps badly on real barcodes (`Enviar CARGA-EASY-001-ORD-03-CTN-1
  a` breaks after `a`). The mock's codes are short enough to hide this; the
  fixture's are not.

`4f`:

- `N SALEN YA` chip in the header.
- The selection counter is plain uppercase text above the footer, not a bordered
  amber pill.
- Footer stacks vertically with `→ Mover a andén` as the primary on top and
  `Liberar a sectorización` below. Today they sit side by side with the
  secondary on the left.

**Excludes:** the `URGENTES` section label (feedback point 3) — it stays as
built until the designer rules on it.

---

### Fase 4 — `4a` desktop `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/app/app/distribution/page.tsx`,
`apps/frontend/src/components/distribution/OutboundDockGrid.tsx`, un componente
nuevo de panel de excepciones bajo
`apps/frontend/src/components/distribution/`, y sus tests hermanos.

- The right rail's second panel, `Excepciones de andén`, with the count in its
  header, typed rows and the `Resolver excepciones` footer action. **Only the
  panel shell and the row that today's data can populate** — the mock's three
  types (`Destino no reconocido`, `Orden incompleta`, `Zona incorrecta`) are not
  defined anywhere, and feedback point 9 asks the designer for the taxonomy.
  Build the first, leave the other two out, and say so in the phase evidence.
- The `Lotes abiertos / Todas` filter above the grid.
- Per-tile footer: route codes and the tile action (`Ver` / `Asignar` / `Abrir`,
  the last two for the states `4a` shows on `A4` and `A6`).
- `capacidad y` restored in the section subtitle, which is only true once
  Phase 0 has landed.

The `EXCEPCIONES DE ANDÉN` StatTile is **not** in scope: it already carries the
error tone and the `requieren decisión` detail, and reads neutral in QA only
because the value is 0.

**Excludes:** `ConsolidationPanel`'s placement (feedback point 8) — leave it
full-width where it is.

---

### Fase 5 — `4b` desktop modo rápido `[pending]`

**Depende de:** spec-96 fase 0

**Archivos:** `apps/frontend/src/app/app/distribution/quicksort/page.tsx`,
`apps/frontend/src/components/distribution/RecentScansPanel.tsx`, y sus tests
hermanos.

- The confirmation banner under the scan field: green, `ANDÉN 3 · SUR ORIENTE`,
  `ORD-48213 · La Florida · Falabella · paquete 2 de 3`, the dock letter, and
  `CONFIRMADO 12:41:07`. The app has the data and shows nothing.
- `Últimos escaneos`: the red `NO EN MANIFIESTO` row for a code that does not
  belong, and the `COMUNAS SIN ZONA` chip footer.
- KPI tiles: restore `RITMO /h` as the mock's second tile. The app replaced it
  with `EN ESTA SESIÓN`; both are useful, so this is a four-tile question —
  keep `PENDIENTES` and `CONSOLIDACIÓN`, and decide between session and pace
  inside the phase rather than growing the row to five.

Depends on Phase 0 because the tile that carries `169 / 180` is the same
`DockCard` that phase wires.

**Excludes:** the pendientes list the app renders below the grid (feedback
point 6) — do not move it, do not restyle it.

---

### Fase 6 — `4c` mobile nave home `[pending]`

**Depende de:** ninguna

**Archivos:** `apps/frontend/src/components/distribution/DistributionMobileView.tsx`,
`apps/frontend/src/components/distribution/DistributionProcessRow.tsx`, y sus
tests hermanos.

- The hero card is near-black in the mock, not the light `surface-raised` the
  app uses. Add the `CLASIFICAR` chip on the eyebrow row and the second line
  `Deben quedar en cero al cierre · N andenes activos`.
- `PROCESOS DE LA NAVE` subtitles carry live data in the mock — `148 bultos · 62
  órdenes`, `12 salen hoy o mañana`, `A3 al 94% de capacidad` — where the app
  has static descriptors. The third needs Phase 0's capacity to be true, so
  either take the dependency or ship the first two and say which.
- The `Andenes` row has no count; the mock shows `12`.
- The unmatched-comuna warning needs its second line: `Sus bultos caen a
  consolidación · avisa al jefe de nave`.

**Excludes:** the bottom tab bar (feedback point 1), `turno`/`nave` in the
greeting (point 2), and the `Mover a posición` fourth row (point 4) — all three
stay exactly as built.

---

## Verification

`unit` on every phase. `e2e-qa` on every phase that changes a screen, which is
all of them.

Two honest limits on the QA evidence, both to be declared in the phase bodies
rather than worked around:

- **Capacity needs the prerequisite above.** Without it Phase 0, the `4e`
  occupancy line, the `4h` capacity warning and `4c`'s third subtitle cannot be
  seen in QA at all.
- **The QA fixture is nearly empty** — 50 pendientes, 0 clasificados, 0 in
  consolidación, two dock zones. `4b`'s grid, `4f`'s two sections and `4a`'s
  exception rows have no data to render. A phase that cannot demonstrate its
  change in QA says so and names what data it would need; it does not claim
  `e2e-qa` green as proof of something the screen never displayed.
