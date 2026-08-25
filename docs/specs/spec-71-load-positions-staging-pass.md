# Spec-71: Load positions and the staging pass

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (the `stage` column and the route
> lifecycle this builds on), [spec-37](spec-37-pre-route.md) (Pre-ruta — the andén-grouped
> planning screen upstream of this), [spec-68](spec-68-distribution-mobile.md) (`QuickSortScanner`
> / `useQuickSortFlow`, the scan-then-scan loop this repoints), [spec-40](spec-40-dock-zone-barcode-labels.md)
> (dock-zone barcode label layout — `backlog`, not yet built; only its pattern is reused here)

**Status:** backlog

_Date: 2026-08-25_

---

## Goal

Give Despacho a physical object for what a truck actually loads: the **posición de carga**. Today
an order is sorted onto an andén (a comuna-based sortation geography) and nothing downstream
represents *where on the dock a specific truck's load sits*. The driver has to walk the andenes
looking for his packages, because "his truck" is not a place.

This spec introduces `load_positions` — one physical spot per route, fed from many andenes — and a
**staging pass**: at the wave cutoff, the system tells operators which packages must move from
their andén into their route's position, and records that move with one scan per package.

The chosen approach is deliberately **two-pass now, sort-to-route later**. Today's comuna sort
during the day is unchanged; only the cutoff step is new. A future spec can move the cutoff earlier
— running Pre-ruta before the dock scan, so the scan sends a package straight to a position with
late arrivals falling back to the andén — without changing this spec's data model or screens. That
is stated explicitly in Decision 1 so the second step is a config change, not a rewrite.

## Non-Goals

- Any map, pin, geocode, or drag-and-drop UI. Dropped from this line of work entirely; see
  [spec-58](spec-58-geocoding-foundation.md), which stays `backlog` and is not a dependency here.
- Route optimisation or automatic sequencing — spec-72.
- Vehicle capacity, fill rate, or top-up — spec-73.
- Moving the staging cutoff before the sort ("sort-to-route"). Decision 1 designs the data model so
  that move needs no new tables or columns, but it does not happen in this spec.
- Printing physical position labels as a shipped feature. spec-40 (`backlog`) defines the label
  layout pattern this spec's position codes are meant to follow; actually wiring position labels
  into that print flow is separate, out-of-scope work once spec-40 itself ships.
- Changing `dock_zones`, `dock_zone_comunas`, or the sectorization engine (`determineDockZone`,
  `validateDockDestination`). Andenes stay exactly what they are today.
- Changing Pre-ruta's cohort rule or `get_pre_route_snapshot`.

---

## The problem, with evidence

- **There is no object between "andén" and "truck".** `packages.dock_zone_id` (written by
  `trg_dock_scan_advance_package_status`, per `apps/frontend/src/lib/dispatch/scan-validator.ts`'s
  own header comment) puts a package on a sortation geography. `dispatches.route_id` puts an order
  on a route. Nothing in between represents the physical pile a driver loads from. The client is
  explicit that an andén routinely splits across several trucks and a truck routinely draws from
  several andenes — so andén and truck are a many-to-many relationship, and neither table today
  models the third thing that actually gets carried onto the vehicle.

- **spec-37's premise "1 andén = 1 truck" is wrong operationally**, even though the code and UI
  encode it. Pre-ruta's own selection unit is the andén (`docs/specs/spec-37-pre-route.md`, Non-Goal:
  "Order-level selection... matches '1 andén = 1 truck' operational reality"; UX copy on multi-andén
  selection: *"Úsalo solo cuando haga falta completar capacidad"* — framed as the exception). In
  practice it is not the exception; it is roughly as common as the 1:1 case, which is exactly why the
  client asked for a dedicated staging step instead of trusting the andén assignment to double as
  the load.

- **The staging scan has no destination to scan into.** `QuickSortScanner`
  (`apps/frontend/src/components/distribution/QuickSortScanner.tsx`) and its state machine,
  `useQuickSortFlow` (`apps/frontend/src/hooks/distribution/useQuickSortFlow.ts`), implement exactly
  the two-step flow this spec needs — scan package, then scan destination, with a reject state when
  the destination does not match — but the only destination type today is a `dock_zones` row.
  Reusing this flow for load positions therefore needs a second destination type, not a new
  component; see Decision 3.

- **`dispatches.stage` already exists and already means "physically confirmed."** spec-70 phase 1
  added `stage TEXT CHECK (stage IN ('planned','staged','adopted'))` with `staged_at`/`staged_by`
  across two migrations (`20260825000001` adds the enum labels; `20260825000002`, per its own
  header, is "phase 1 (2 of 2)" — the column/remap migration, not phase 2). Phase 2's application
  code (merged separately: the rewritten `validateScan` and the scan handler) is what makes the
  first stage scan on a route flip a `dispatches` row from `planned` to `staged`. That is precisely
  the semantics of "this package is now confirmed onto this truck's load" — the vocabulary spec-71
  needs already shipped one spec ago. This spec must reuse it, not invent a parallel
  `load_positions`-side status.

---

## Decisions

1. **Two-pass now, sort-to-route later — same data model, only the cutoff moves.** Today: packages
   sort to andenes all day as they always have; at the wave cutoff, the system computes which
   `staged` packages (well, which `planned`-but-not-yet-staged dispatches, per spec-70) belong to
   each route and emits move tasks from andén → position. Later: once Pre-ruta runs *before* the
   sort for a given wave, the dock scan's destination lookup resolves straight to the order's
   `load_positions` row instead of its `dock_zones` row, and only late arrivals (packages scanned
   before their route is planned) fall back to the andén. Both states use the same
   `load_positions` table, the same `dispatches.stage` column, and the same staging scan component
   — the second step is a routing decision inside `useQuickSortFlow`, not new infrastructure.

2. **The staging pass is the existing Distribution scanner, repointed — not new UI.** `QuickSortScanner`
   / `useQuickSortFlow` already implement scan-package-then-scan-destination with a reject state.
   The staging scan adds a second destination kind alongside `dock_zones`: a `load_positions` row,
   matched by its `code` the same way a dock zone is matched by its `code` today. Position barcodes
   follow the label layout spec-40 defines for dock zones (Code128 of the `code` field, A4 landscape
   printable label) — spec-40 is itself still `backlog`, so this spec reuses its *pattern*, not a
   shipped print route.

3. **One per-package scan; loading the truck is a single position-level seal, not another scan per
   package.** The staging scan (package → position) is the only per-package touch this spec adds.
   Once every package meant for a position is physically in it, the operator seals the *position*
   with one scan/tap — not one scan per package again. This mirrors spec-70's route-level `/seal`
   (Decision 2 there: "a route cannot be sealed while any dispatch is still `planned`") one level
   down: a position cannot be sealed while any dispatch assigned to it is still un-staged.

4. **New `load_positions` table, operator-scoped, with assignment and release as first-class
   operations — not an afterthought.** The client is explicit that positions are physically fewer
   than the routes dispatched in a day: a position is a dock location, and it gets reused across
   waves. So `load_positions` rows are **long-lived** (one per physical spot, soft-deletable like
   every other table in this schema) and a route's occupancy of one is a separate, time-bounded fact
   — `routes.load_position_id`, nullable, set when a position is assigned to a route and cleared
   when it is released back to the pool after dispatch. Modelling occupancy as a column on `routes`
   rather than a join table is deliberate: a route occupies at most one position at a time (a route
   is one truck's load), so the relationship is many-routes-to-one-position over time, not
   many-to-many at any instant — a plain FK captures that without inventing a bridge table nothing
   else needs.

5. **Staging writes `dispatches.stage = 'staged'`. No parallel status.** spec-70 already gives every
   dispatch a plan/load axis; this spec's staging scan is the physical-confirmation event that axis
   was built for. The scan handler sets `stage = 'staged'`, `staged_at = now()`, `staged_by = <user>`
   exactly as spec-70 phase 2 already does for a route-level stage scan — the only change is which
   destination the scan is validated against. A `load_positions`-specific status column would create
   a second place a package's "is it loaded yet" fact can live, and the two would need reconciling
   on every read, which is the same class of bug spec-70 was written to close (its own Decision 1:
   "Overloading `status` with local lifecycle would put two writers with two vocabularies on one
   column, which is how we got here").

---

## Data model

```sql
-- packages/database/supabase/migrations/<timestamp>_spec71_load_positions.sql

CREATE TABLE public.load_positions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,           -- scanned/printed identifier, e.g. "POS-04"
  label        TEXT,                    -- human-readable name/location, e.g. "Muelle 4"
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

-- Partial unique index, not a table-level UNIQUE constraint — the repo
-- convention for soft-deleted tables (see idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate). A table-level UNIQUE would refuse to let an
-- operator soft-delete a position and later reuse its code for a new one.
CREATE UNIQUE INDEX unique_load_position_code_per_operator
  ON public.load_positions (operator_id, code) WHERE deleted_at IS NULL;

-- routes: which position (if any) this route's load currently occupies
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS load_position_id UUID REFERENCES public.load_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_position_assigned_at TIMESTAMPTZ;
```

**Note on the second `routes` column above:** the exact column set (assigned_at, assigned_by,
released_at) needs to be settled against spec-70 phase 3's audit pattern (`removal_reason` +
`audit_logs`) during implementation, not guessed here. The implementing PR picks the final shape and
writes it into the migration; this spec fixes the *decision* (assignment/release are tracked facts,
not derived) and leaves the column list to be finalized alongside spec-70 phase 3, which lands the
audit-log convention this should match.

RLS: `operator_id = public.get_operator_id()`, matching every other table in this schema (e.g.
`dock_zones`, `vehicles` in `20260812000001_spec52_vehicles_table.sql`). Soft delete via
`deleted_at`, per the project's non-negotiable rule — an inactive position is `is_active = false`
(temporarily out of service, still visible in history), a removed one is soft-deleted (gone from the
physical dock).

**No change to `dispatches`.** Staging a package still writes `dispatches.stage`; which destination
it was staged against — andén or position — is derivable from the scan event, not a new column. If
a scan-event audit trail is needed for "which position did this package land in," it belongs in
`dock_scans` (the existing scan-event table `trg_dock_scan_advance_package_status` reads), extended
with a nullable `load_position_id` alongside its existing `dock_zone_id`, not in `dispatches`.

---

## Implementation phases

Each phase is one PR with auto-merge, per `CLAUDE.md`. Verify phase 1's migration applied against QA
before phase 2 merges — per `project_deploy_path_filter_masks_db_failures`, a green PR check does
not confirm the DB job ran.

- **Phase 1 — Database.** `load_positions` table, RLS, soft delete, the `routes` occupancy column(s)
  (final shape decided against spec-70 phase 3's audit convention, per the Data model note above),
  and a SQL suite in the project's own style (fixtures + `DO $$ ... RAISE` blocks, matching
  `pre_route_snapshot.test.sql`): operator isolation, unique code per operator, soft-delete
  behaviour, and that a position can be reassigned to a new route only after being released from its
  previous one.
- **Phase 2 — Assignment and release.** The operations to attach a `load_positions` row to a route
  (at or after the route reaches `loaded` — spec-70's state — or earlier if operations wants to
  reserve a position ahead of the seal; this ordering choice is deferred to implementation and
  should be validated with the client, not assumed here) and to release it back to the pool once the
  route is `dispatched`. A route cannot be assigned a position that is already occupied by another
  non-released route of the same operator.
- **Phase 3 — Staging scan.** Extend `useQuickSortFlow` with a second destination kind
  (`load_positions`, matched by `code`) alongside the existing `dock_zones` kind; wire the reject
  state for a mismatched position exactly as it already exists for a mismatched andén. The scan
  handler validates that the package's order is planned on the route occupying the scanned position
  (spec-70's `stage='planned'` dispatch on that `route_id`) before flipping it to `staged` — this is
  the same check spec-70 phase 2 already does for the route-level stage scan; this phase points it
  at a position instead of a route directly, resolving route via `load_positions.id → routes.load_position_id`.
- **Phase 4 — Position seal.** One scan/tap per position, refusing while any dispatch assigned to a
  route occupying that position is still `planned` (mirrors spec-70's `/seal` `UNSEALED_STOPS`
  guard, one level down). Idempotent, per the same pattern.
- **Phase 5 — Move-task UI.** At the wave cutoff, a view/screen listing "faltan por mover a posición"
  per route — packages whose dispatch is `planned` or already `staged` on the andén, not yet staged
  onto their route's position — so an operator can work the move list rather than hunting the dock.
  This is presentation over the state built in phases 1–4; no new write path.

## Open questions for implementation

- Exact timing of position assignment relative to spec-70's `loaded`/`dispatched` states (see phase
  2) — needs a client conversation, not an assumption in this doc.
- Whether `dock_scans` gets the `load_position_id` column mentioned in the Data model section, or
  whether a lighter-weight event log is preferred — decide when phase 3 is scoped in detail.
