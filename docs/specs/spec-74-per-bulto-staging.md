# Spec-74: Per-bulto staging — one scan, one box

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (owns `dispatches.stage`, the
> order-level fact this spec makes package-level), [spec-71](spec-71-load-positions-staging-pass.md)
> (the position seal that cannot be made honest until this lands), [spec-55](spec-55-carton-expansion.md)
> (carton expansion — why multi-bulto orders exist at all)

**Status:** in progress

_Date: 2026-08-31_

---

## Goal

Make staging count **boxes**, not orders. Today one scan of one bulto marks an entire
multi-bulto order as physically loaded. That is not what happened on the floor, and every
screen and gate built on top of it inherits the lie.

## Non-Goals

- Changing what a `dispatches` row *means*. It stays one row per order on a route — the plan
  unit. This spec adds a load unit beneath it; it does not split dispatches per package.
- Route optimisation, capacity, sequencing — specs 72/73.
- Changing Pre-ruta's cohort rule or `get_pre_route_snapshot`.
- Changing `dock_zones` or the sectorization engine.
- Reworking spec-71's position model. `load_positions`, assignment, release and the offset
  rule all stand; only the *completeness* question they depend on changes.

---

## The problem, with evidence

Found by driving the deployed QA build through a real staging pass, not by reading code.

**Reproduced end to end on QA (2026-08-31), order `QA-OUT-007`, 2 bultos:**

1. Scanned only `QA-OUT-007-CTN-2` into position `POS-01`.
2. `dispatches.stage` flipped to `staged` — for the whole order.
3. Sealed the position. It **succeeded**: *"Posición sellada · 1 parada(s)"*, route walked to
   `loaded`, both packages marked `listo_para_despacho`.
4. `QA-OUT-007-CTN-1` had **zero** `dock_scans` rows carrying a `load_position_id`. It was
   never moved. It was still on the andén.

A truck was sealed and dispatch-ready with a box left on the dock, and every screen said the
work was done.

### Why it happens

| # | Fact | Where |
|---|---|---|
| 1 | The first scan stages the **order**. `stageDispatch` sets `dispatches.stage='staged'` for the order the scanned package belongs to. | `lib/dispatch/stage-dispatch.ts` |
| 2 | It also advances **every** package of that order to `en_carga` — scoped by `order_id`, not by the package scanned. | `advancePackagesToEnCarga`, `stage-dispatch.ts:30-42` |
| 3 | A second bulto is then **refused**: `if (onThisRoute.stage !== 'planned') return ALREADY_STAGED` — *"Paquete ya cargado en esta ruta"*. | `lib/dispatch/scan-validator.ts:170` |
| 4 | And refused again independently: `en_carga` is not in `DISPATCHABLE_STATUSES`, so the status check rejects it as `WRONG_STATUS`. | `scan-validator.ts:28-33,138` |
| 5 | The seal's `UNSEALED_STOPS` guard counts dispatches still `planned`. After (1) there are none, so the gate opens. | `lib/dispatch/seal-route.ts` |

So the system is **double-locked against scanning the rest of the order**, and then treats the
order as complete. There is no operator remedy: the remaining bultos cannot be scanned at all.

### Why the obvious fix is not a fix

An attempt was made to add a package-level `UNMOVED_PACKAGES` guard to spec-71's position seal,
counting packages without a `dock_scans.load_position_id` row. It was discarded before merge
after review, because with facts (3) and (4) above it is **unsatisfiable**: the seal would
demand that every bulto be scanned into the position while the scanner refuses to accept them.
That converts *"seals unsafely"* into *"cannot seal, ever, with no way out"* — strictly worse.

Two further reasons that guard could not stand alone, both worth carrying into this spec:

- **The route-level scan writes no `dock_scans` rows at all** (`app/api/dispatch/routes/[id]/scan/route.ts`
  — zero occurrences). Any route staged through the desktop RouteBuilder therefore has no
  per-package evidence whatsoever, so a package-level gate locks it out entirely.
- **`adopted` dispatches only exist on that route-level path**, so they inherit the same lockout.

Any per-package completeness check must land **with** a per-package scan path, never ahead of it.

---

## Decisions

1. **The load unit is the package; the plan unit stays the order.** `dispatches` keeps meaning
   "this order is planned on this route" — spec-70's axis is not re-cut. What changes is that
   "physically loaded" stops being read off that row for a multi-package order.

2. **Three order states, not two: `planned` -> `partially_staged` -> `staged`.** A dispatch is
   `staged` only when every one of its live packages is loaded; it is `partially_staged` while
   some are and some are not. The intermediate value is the point, not an implementation detail:
   "nothing has been scanned" and "half this order is on the truck and half is on the andén" are
   different operational facts and a supervisor has to be able to tell them apart. Collapsing
   both into `planned` would hide exactly the situation this spec exists to surface.

   Both seals refuse while any dispatch is `planned` **or** `partially_staged`, so spec-70's
   existing `UNSEALED_STOPS` guard becomes correct by widening its predicate rather than by
   adding a second gate beside it.

3. **`packages` carries the per-box load fact, not a join table.** A package is loaded onto
   exactly one route at a time, so the relationship is many-packages-to-one-route — a plain
   column, matching the reasoning spec-71 Decision 4 used for `routes.load_position_id`. The
   exact column set is settled in implementation against spec-70 phase 1's `staged_by` convention
   (a dedicated actor column) **and** spec-70 phase 3's app-layer `audit_logs` convention — both,
   as spec-71 phase 2 established.

4. **`dock_scans.load_position_id` is evidence, not state.** It already records which position a
   package was scanned into (spec-71 phase 1) and it stays the audit trail. It is deliberately
   *not* promoted into the completeness gate: the route-level scan path writes no such row, so a
   gate built on it locks out every desktop-staged route. The gate reads the new package column.

5. **The scanner must accept the remaining bultos of a partly-staged order.** `ALREADY_STAGED`
   becomes a per-*package* check, not a per-dispatch one, and `advancePackagesToEnCarga` advances
   only the package actually scanned. Both are the locks that make today's state unrecoverable.

6. **Both seals get the same truth.** spec-71's position seal and spec-70's route-level `/seal`
   must agree on completeness. Today only the position path was going to be guarded, leaving the
   RouteBuilder seal — the one a dispatcher is most likely to use — as unsafe as before. Whatever
   `UNSEALED_STOPS` becomes, both endpoints inherit it, because they already share `sealRoute`.

---

## Settled during scoping

- **The per-package fact lives on `packages`, and both scan paths write it.** The desktop
  RouteBuilder scan already scans a *package* barcode — it simply never recorded which box. So it
  marks the scanned package loaded exactly as the mobile position scan does. The asymmetry that
  made a naive seal guard impossible disappears without touching `dock_scans`, which stays
  spec-71's position audit trail and is deliberately NOT the completeness gate (Decision 4).

- **Backfill is optimistic, and says so.** Existing `staged` **and `adopted`** dispatches predate
  per-box scanning, so no evidence exists either way for their packages. Both are backfilled as
  loaded, flagged inferred: leaving them NULL would make phase 3's own rule refuse to seal boxes
  already sitting on trucks the day this column ships. (Not "leaving them NULL flips every
  in-flight route to `partially_staged`" — under phase 3's rule a dispatch with zero live
  packages backfilled loaded recomputes to `planned`, since none are loaded; there simply is no
  route where *some but not all* packages are backfilled, because the backfill is all-or-nothing
  per order.) This is a placeholder born of missing evidence, not a claim that adoption proves a
  whole order was loaded — a scan only ever adopts the ONE package barcode it scanned, so an
  adopted multi-bulto order can still be genuinely incomplete underneath this optimistic backfill.
  Phase 3 MUST recompute `adopted` dispatches too, not just `planned`/`partially_staged`/`staged`
  (see its checklist below) — otherwise an adopted order keeps sealing on the strength of one
  box's scan, the exact QA repro this spec exists to kill, just wearing a different stage name.
  The migration records that all backfilled rows are inferred rather than scanned, so a later
  report can tell migrated assumption from real evidence.

- **`en_carga` stays order-level and is not the new fact.** It currently means "this order is
  being loaded" and is written for every package of an order at once. The per-package load state
  is a separate column; whether `en_carga` is eventually derived from it is out of scope here.

## Implementation phases

Each phase is one PR with auto-merge, per `CLAUDE.md`. Phase 1 is the only irreversible one and
must be verified applied against QA before phase 2 merges.

- **Phase 1 — Database.** The per-package load columns on `packages` (`loaded_at`, `loaded_by`,
  `load_inferred`), **plus `partially_staged` added to `dispatches.stage`'s CHECK** (the value is
  added to the schema now so phase 3 is a pure app-layer change; nothing writes it until phase 3),
  plus a SQL suite in the repo's `DO $$ ... RAISE` style: operator isolation, soft-delete
  behaviour, and the backfill decision above exercised both ways.
- **Phase 2 — Make the scanner accept every bulto.** Turn `ALREADY_STAGED` into a per-package
  check and scope `advancePackagesToEnCarga` to the scanned package. **This phase alone fixes the
  deadlock** and must ship before any completeness gate. Both scan paths — the position scan and
  the route-level scan — get the same treatment.
- **Phase 3 — The writer, and every reader that currently ignores `partially_staged`.** The
  schema change already happened in phase 1 — `stage` is TEXT + CHECK, not an enum, so there is no
  "enum label" step here (a two-file dance only applies to `route_status_enum`-style Postgres
  enums, which `dispatches.stage` deliberately is not, per 20260825000002). This phase is the
  writer plus the blocker list below.

  **Writer:** each package scan recomputes the dispatch — `partially_staged` while any live
  package is outstanding, `staged` once none are. The recompute covers `adopted` dispatches too,
  not just `planned`/`partially_staged`/`staged` — see the Backfill bullet above for why. **When
  moving `planned` → `partially_staged`, the writer must also set `staged_at`** —
  `dispatches_staged_at_check` is `(stage = 'planned') = (staged_at IS NULL)` (20260825000002) and
  rejects the write with a 23514 otherwise (probe-verified).

  **Blocker checklist — every one of these currently mis-handles a dispatch sitting in
  `partially_staged`, because nothing produces that value yet so nothing had to:**

  - `route_stop_counts` view (`20260825000002`) — counts it in `total_stops` but in none of
    pending/staged/adopted_stops.
  - `lib/dispatch/seal-route.ts:123,133` — `pendingCount` comes out 0 → **seal opens on a
    partially-loaded route** (the production failure this spec exists to fix).
  - `lib/dispatch/expected-load-position.ts:98` (as of phase 2, `.in('stage', ['planned',
    'staged', 'adopted'])`) — still needs `partially_staged` added, or the 2nd bulto's position
    scan hits `NO_POSITION_ASSIGNED` again once the dispatch is in that state (mobile deadlock).
  - `get_move_task_snapshot` (`20260828000001:170,190`) — `stage IN ('planned','staged')` → the
    route drops off the move list with work still outstanding.
  - `lib/dispatch/seal-route.ts:166` — `.in('stage',['staged','adopted'])` → `partially_staged`
    packages never advance to `listo_para_despacho`.
  - `components/dispatch/RouteBuilder.tsx:53` and `PackageRow.tsx:16` — undercount / no "Sin
    estibar" warning.
  - `lib/dispatch/types.ts:23` and `lib/types.ts:2281-2284` — `DispatchStage` / `dispatch_stage`
    are missing the value; `useRoutePackages.ts:30` casts blindly. **`dispatch_stage` in
    `lib/types.ts` is a fiction — no such enum exists in the database; `stage` is TEXT + a CHECK
    constraint, not a Postgres enum.**
  - **New in phase 2:** `stage-dispatch.ts`'s `stageDispatch` now preserves `adopted` instead of
    overwriting it to `staged` (review item 3) — phase 3's own recompute must keep doing the
    same. It MUST still walk `adopted` dispatches (not just `planned`/`partially_staged`/
    `staged`) when deciding whether any live package is outstanding, exactly as phase 1's
    backfill comment already requires — an adopted multi-bulto order must not be able to seal
    with a sibling bulto still on the andén just because the recompute skipped `adopted` rows.

  `lib/dispatch/scan-validator.ts:170`'s `stage !== 'planned'` refusal — **fixed by phase 2.**
  The gate is now per-package (`packages.loaded_at`/`load_inferred`), not per-dispatch-stage, so
  it no longer re-refuses the 2nd bulto once the order's dispatch reads `staged`. Not a phase 3
  blocker.

  Widen `UNSEALED_STOPS` to refuse on `planned` OR `partially_staged`, which both seals inherit
  through the shared `sealRoute` (Decision 6) once `seal-route.ts` is fixed per the checklist
  above.
- **Phase 4 — Screens tell the truth.** spec-71's move list counts per package already; verify it
  against the new fact and drop the `dock_scans` proxy if the column supersedes it. RouteBuilder's
  "Faltan N por estibar" and `PackageRow`'s "Sin estibar" become per-bulto.
- **Phase 5 — Verify on the floor.** The QA repro above, re-run: partially stage a multi-bulto
  order, confirm the remaining bultos **can** be scanned, and confirm neither seal accepts the
  load until they are. A browser pass, not a unit test — this whole spec exists because unit
  tests could not see it.

---

## Testing notes

The bug survived a full spec's worth of unit tests, two Opus reviews and a data-layer QA pass.
It needed a *sequence* against a real environment: a multi-bulto order, a partial scan, then a
seal. Phase 5 is not optional, and neither is doing it in a browser.

Note also that jsdom does not reproduce the browser behaviours this area depends on — a
`key={mode}` focus fix passed its jsdom test and shipped broken on the same screens
(`lib/scan/refocus-package-field.ts` records that one). Treat green unit tests here as evidence
of wiring, not of behaviour.

---

## Deferred: `get_move_task_snapshot` still reads `dock_scans`, not `packages.loaded_at`

Phase 4 left `get_move_task_snapshot` and `MoveTaskList.tsx` untouched, on purpose, even though
phase 1 gave the whole codebase a more authoritative per-box fact than the one this function
still reads. There are now two records of "this box was loaded": `dock_scans.load_position_id`
(spec-71's position scan, an audit trail of which box went to which spot) and `packages.loaded_at`
(this spec's phase 1, the state both seals check). They can disagree, and the reason is the same
one this spec's own "why the obvious fix is not a fix" section already names: the desktop
route-level scan writes `packages.loaded_at` but writes no `dock_scans` row at all — it never has.

The consequence today is real but survivable: because the move list still counts remaining boxes
from `dock_scans`, a route staged entirely from the desktop shows every one of its boxes as still
needing to be moved to a load position. That over-reports work in the safe direction — it never
lets an actually-outstanding box disappear from the list — but it is factually wrong, and a
dispatcher who staged a route from the desktop and then opens the move-task picker will see it
call boxes "not moved" that were, by the record the seals now trust, loaded. It will read as
broken on the floor even though nothing it gates is unsafe.

This is deliberately not fixed here because of the product direction it runs into: **the loading
scan is meant to be mobile-only.** The desktop route-level scan may need to keep a fallback for
when mobile is unavailable, but that fallback should be a bulk action — "mark these as loaded" —
not a second scanning path standing in for the real one. If the desktop scan path goes away in
that form, `dock_scans` and `packages.loaded_at` stop being able to disagree on their own, and the
move list needs no special-casing at all. Switching `get_move_task_snapshot` to
`packages.loaded_at` now would be patching a disagreement that the right product decision removes
outright — worth not doing twice.

The open question for whoever picks this back up, stated plainly rather than resolved here:
`packages.loaded_at` means "loaded" — loaded onto the route, full stop. It does not mean "loaded
INTO THIS POSITION." The move list is specifically about getting boxes to the right physical
spot, so if the desktop path survives in any form, a box marked loaded without ever having
reached a load position must still count as work left to do — a plain switch to
`packages.loaded_at` would make that box vanish from the list while it is still sitting on the
wrong andén. Resolving this means first deciding which question the move list is actually
asking: "is this box loaded" or "is this box where it needs to be." Those are NOT the same
question today, and the desktop route-level scan is not the only place they diverge: phase 1's
backfill (20260901000001) set `loaded_at` (with `load_inferred = true`) on every live package of
every pre-existing `staged`/`adopted` dispatch, with no `dock_scans` row involved at all — and
those backfilled rows are the majority of pre-existing data, a larger case than the desktop path.
The desktop scan is the one case that keeps producing new disagreements going forward; the
backfill is the larger, one-time case already sitting in the data.
