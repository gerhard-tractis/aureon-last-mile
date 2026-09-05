# Spec-71: Load positions and the staging pass

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (the `stage` column and the route
> lifecycle this builds on), [spec-37](spec-37-pre-route.md) (Pre-ruta — the andén-grouped
> planning screen upstream of this), [spec-68](spec-68-distribution-mobile.md) (`QuickSortScanner`
> / `useQuickSortFlow`, the scan-then-scan loop this repoints), [spec-40](spec-40-dock-zone-barcode-labels.md)
> (dock-zone barcode label layout — `backlog`, not yet built; only its pattern is reused here)

**Status:** completed

_Date: 2026-08-25_

> **What `completed` rests on (2026-09-01).** All five phases shipped and were
> verified against the deployed QA build in a browser: a package scanned to a
> position flips `dispatches.stage` to `staged` and writes
> `dock_scans.load_position_id`; the position seal refuses an unstaged load and
> succeeds once complete; the move list groups by andén and its group counts sum
> to its headline; the offset rule, the occupancy guard, release semantics and
> the re-assignment contract were each exercised against live data.
>
> **Not verified: the physical scanner.** Every scan in that pass was a typed
> string. The hyphen normalisation (`POS01` matching a stored `POS-01`) is proven
> in logic and unproven against the QA gun's US/ES layout on a printed label —
> which is the failure this normalisation exists for. Positions for a real tenant
> are also still an onboarding step, as andenes are. See the Known limitation
> below, which [spec-74](spec-74-per-bulto-staging.md) closes.


---

## Goal

Give Despacho a physical object for what a truck actually loads: the **posición de carga**. Today
an order is sorted onto an andén (a comuna-based sortation geography) and nothing downstream
represents *where on the dock a specific truck's load sits*. The driver has to walk the andenes
looking for his packages, because "his truck" is not a place.

This spec introduces `load_positions` — physical dock spots, long-lived and fewer than the routes
dispatched in a day, reused across waves and fed from many andenes (Decision 4) — and a
**staging pass**: at the wave cutoff, the system tells operators which packages must move from
their andén into their route's position, and records that move with one scan per package.

The chosen approach is deliberately **two-pass now, sort-to-route later**. Today's comuna sort
during the day is unchanged; only the cutoff step is new. A future spec can move the cutoff earlier
— running Pre-ruta before the dock scan, so the scan sends a package straight to a position with
late arrivals falling back to the andén — without changing this spec's data model or screens. That
is stated explicitly in Decision 1 so the second step is a config change, not a rewrite.

## Known limitation — the seal does not verify every bulto

Found on 2026-08-31 by driving the deployed build through a real staging pass. The position
seal accepts a load in which some boxes of a multi-bulto order were never moved.

`dispatches.stage` is per **order**, and one package scan flips the whole order to `staged`
(`stage-dispatch.ts`). The seal's `UNSEALED_STOPS` guard counts dispatches still `planned`, so
after the first bulto it stops refusing. Reproduced on QA with a 2-bulto order: one bulto
scanned, seal succeeded, route walked to `loaded`, and the other bulto was still on the andén
with no position scan against it.

A package-level guard was written and **discarded before merge**: the scanner independently
refuses the remaining bultos (`ALREADY_STAGED`, and `en_carga` failing `DISPATCHABLE_STATUSES`),
so the guard would have been unsatisfiable — turning "seals unsafely" into "cannot seal, ever".
The same applies to spec-70's route-level `/seal`, which shares `sealRoute` and is equally
permissive.

Fixing it means making staging per-bulto, which re-cuts spec-70's staging model rather than
spec-71's position model — so it is [spec-74](spec-74-per-bulto-staging.md), not a spec-71 phase.
Everything spec-71 specified was built; this limitation was inherited, not introduced. It is
recorded here so `completed` is not read as "the seal guarantees a complete load."

---

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
   down: a position cannot be sealed while any dispatch assigned to it is still un-staged. The
   position seal calls the same `sealRoute` the route-level seal does (Decision 3/5 above), so
   [spec-77](spec-77-despacho-movil-cierre.md)'s audited `force` exception to spec-70 decision 2
   applies here too — but only through the route-level `/seal` endpoint, which is the only caller
   that passes `force`; the position-level endpoint does not expose it.

4. **New `load_positions` table, operator-scoped, with assignment and release as first-class
   operations — not an afterthought.** The client is explicit that positions are physically fewer
   than the routes dispatched in a day: a position is a dock location, and it gets reused across
   waves. So `load_positions` rows are **long-lived** (one per physical spot, soft-deletable like
   every other table in this schema) and a route's occupancy of one is a separate, time-bounded fact
   — `routes.load_position_id`, nullable, set when a position is assigned to a route. Modelling
   occupancy as a column on `routes` rather than a join table is deliberate: a route occupies at most
   one position at a time (a route is one truck's load), so the relationship is many-routes-to-one-
   position over time, not many-to-many at any instant — a plain FK captures that without inventing a
   bridge table nothing else needs.

   **Shipped release semantics (corrects an earlier draft of this passage):** release does **not**
   clear `load_position_id`. The phase 1 migration
   (`20260827000001_spec71_load_positions.sql:105-111`) stamps `load_position_released_at = now()`
   and `load_position_released_by = <user>` and leaves `load_position_id` set, so the row still
   records which position was released; `routes_load_position_released_requires_id_chk` rejects any
   attempt to clear `load_position_id` while `load_position_released_at` is set. **Occupied** means
   `load_position_id IS NOT NULL AND load_position_released_at IS NULL AND deleted_at IS NULL` — the
   predicate the partial unique index `unique_route_per_active_load_position` and the CHECK
   constraints below actually enforce. Reassigning a released route to a new (or the same) position
   requires resetting `load_position_released_at` back to `NULL`; see Decision 8 and the phase 2
   bullet under Implementation phases for the residual work this creates.

5. **Staging writes `dispatches.stage = 'staged'`. No parallel status.** spec-70 already gives every
   dispatch a plan/load axis; this spec's staging scan is the physical-confirmation event that axis
   was built for. The scan handler sets `stage = 'staged'`, `staged_at = now()`, `staged_by = <user>`
   exactly as spec-70 phase 2 already does for a route-level stage scan — the only change is which
   destination the scan is validated against. A `load_positions`-specific status column would create
   a second place a package's "is it loaded yet" fact can live, and the two would need reconciling
   on every read, which is the same class of bug spec-70 was written to close (its own Decision 1:
   "Overloading `status` with local lifecycle would put two writers with two vocabularies on one
   column, which is how we got here").

6. **Positions are open floor in front of the andenes, not truck bays.** New operational fact from
   the client: this tenant has **no truck bays**. Andenes (`dock_zones`) are zones against the
   wall, and a load position is an area of open floor in front of them, where a route's load is
   consolidated before loading — not a bay a truck backs into. This corrects the "Muelle 4" example
   used for `label` in the Data model section below, which read as a bay; it is better read as a
   named floor spot, e.g. "Zona frente a Andén 4."

7. **Positions are offset from the andenes they serve — this is an exclusion rule, not a proximity
   rule.** The client is explicit: a route's position must **not** front an andén that route is
   still drawing packages from, because the pile sitting in that position would block the andén's
   face while sorting into it is still running. `load_positions.fronts_dock_zone_id` (new nullable
   FK to `dock_zones`, added in the follow-on migration `20260827000002`) records which andén, if
   any, a position physically stands in front of — so assignment (phase 2) can check "does this
   route source from the andén this candidate position fronts?" and exclude it if so, and so the
   phase-5 move-task list can order work by short andén→position hops. It is deliberately not used
   to pick "the nearest position to this route's andenes" — that would be the opposite of the rule.
   The alternative considered — stage a route only after every andén it draws from has closed its
   wave — was rejected: it hard-couples the staging cutoff to the sort schedule and makes a package
   that arrives late to one andén hold up staging for every other andén the route already finished
   with, which is exactly the kind of awkward late-arrival handling Decision 1's phased cutover was
   designed to avoid. Enforcement of the offset rule is deliberately **not** a database constraint —
   whether a candidate position conflicts with a route depends on that route's package composition
   (which andenes its `dispatches` rows actually source from), which is dynamic, only known through
   joins across `dispatches`/`packages`, and not derivable from `load_positions` alone. It is a
   phase 2 (assignment-time) application concern.

   **The offset rule can be evaluated at `planned`.** A Pre-ruta-created route's source andenes are
   already known at that point: `get_pre_route_snapshot`'s cohort requires `p.dock_zone_id IS NOT
   NULL` (`20260817000003_fix_pre_route_sectorizado_cohort.sql:57`), so `packages.dock_zone_id` is
   populated for the packages a Pre-ruta-planned route draws from before assignment happens. This
   does not change the assignment timing decided above.

   **Residual risk: the dispatch set can change after assignment.** Packages added to a route after
   its position was assigned can introduce a new source andén that was not part of the offset check
   at assignment time, silently invalidating a check that passed. This is a stated requirement, not
   designed here: **the offset check must be re-evaluated whenever a route's dispatch set changes**,
   and a route whose position becomes conflicting as a result must be surfaced for reassignment, not
   silently left wrong. See the phase 2 bullet under Implementation phases.

   **Soft-deleted andenes leave a dangling `fronts_dock_zone_id`.** `dock_zones` is soft-deleted and
   hard deletes never happen in production, so `fronts_dock_zone_id`'s `ON DELETE SET NULL` is
   effectively dead there: a retired andén leaves `fronts_dock_zone_id` pointing at a `dock_zones`
   row that every RLS-scoped read filters out via `deleted_at IS NULL`. Consumers joining through
   this column MUST filter `dock_zones.deleted_at IS NULL`, and must treat a non-NULL
   `fronts_dock_zone_id` whose join comes back empty as "fronts a retired andén," not as "fronts
   nothing." The FK action is kept as `ON DELETE SET NULL` regardless (see the column comment in
   `20260827000002_spec71_position_adjacency.sql`); this is a consumer-side contract, not a schema
   change.

8. **Position assignment happens at route creation (`planned`); release happens at `dispatched`.**
   Settling the timing question phase 2 left open (see the former Open Question below): a route is
   assigned a `load_positions` row as soon as it is created and reaches spec-70's `planned` state,
   not deferred to `loaded` or the seal. It is released back to the pool when the route reaches
   `dispatched`. This gives operators a position to stage into from the moment a route exists,
   which matches how staging actually starts well before a route is sealed.

   **Assignment is best-effort — no position available is not an error.** If no `load_positions` row
   is free when a route reaches `planned`, the route is created and planned normally with
   `load_position_id` left `NULL`; it is assigned a position later, whenever one is released. There
   is **no queue**, route planning is **never blocked**, and no error is raised for this case.
   Staging cannot start for that route until it has a position, but that is a downstream consequence,
   not a gate on planning. The schema already permits this: `load_position_id` is nullable and
   `routes_load_position_assigned_at_requires_id_chk` allows both NULL together (no position, no
   assigned-at) and both set (a position, with its assigned-at) — it does not require a position to
   exist. See the phase 2 bullet under Implementation phases.

9. **Phase 5 is the mobile picker; the desktop supervisor view is a separate spec.** The phase-5
   bullet under Implementation phases asks for "a view/screen listing 'faltan por mover a posición'
   per route... so an operator can work the move list rather than hunting the dock" — that is an
   operator standing on the floor doing one andén→position hop at a time, which is a mobile,
   andén-grouped task list, not a dashboard. Shipped as `/app/distribution/mover-a-posicion`
   (`get_move_task_snapshot`, `20260828000001`): for each route holding an active position, its
   remaining packages grouped by the andén they currently sit in, plus Decision 7's offset-conflict
   flag and Decision 8's unassigned (blocked, no position) routes surfaced inline — not on a separate
   screen, per the phase-5 bullet's own framing of both as currently-invisible states that need a
   home. **Deliberately out of scope here:** a desktop, wave-level supervisor view — staging progress
   across every route in a wave, every conflict at a glance, every unassigned route in one table, from
   a floor lead's or dispatcher's chair rather than a single operator's walk. That is oversight of the
   staging pass, not execution of a single move task; it needs its own data shape (aggregates across
   routes, not one route's next hop) and its own UI (a table/board, not a phone card list), and
   conflating the two would have pulled this phase past a single mobile screen. It is left for a
   future spec, scoped separately once there is real usage of the mobile picker to design the
   supervisor view against.

   **Ambiguity in the phase-5 bullet's own wording (code review, phase-5 item 10):** it asks for
   "packages whose dispatch is `planned` or already `staged` on the andén, not yet staged onto their
   route's position" — but there is no "staged on the andén" state under spec-70's `dispatches.stage`
   axis (`planned` / `staged` / `adopted`); `staged` there already means "reached its route's
   position" (phase 3's write path). The bullet is describing a physical fact (the package sits on an
   andén, ready to move) using dispatch-stage vocabulary that cannot express it. The reading shipped:
   `dispatches.stage IN ('planned', 'staged')` decides which packages belong to a route's plan at all
   (`adopted` packages were confirmed physically present by a route-level scan and are out of this
   screen's scope); whether a member package still counts as "remaining" is decided per package by
   `dock_scans.load_position_id` (phase 1, `20260827000001`) — not by `stage` a second time — because
   `stage` lives on the ORDER's dispatch row and a multi-bulto order's `stage` flips to `staged` on
   its first package scan, which would otherwise hide the rest of that order's unmoved packages (code
   review, phase-5 item 1).

---

## Data model

Shipped across two migrations: the table and the `routes` occupancy columns in
`20260827000001_spec71_load_positions.sql` (phase 1); `fronts_dock_zone_id` added by `ALTER TABLE`
in the follow-on `20260827000002_spec71_position_adjacency.sql` (Decision 7). What follows is the
resulting shape, not a single migration's contents.

```sql
-- packages/database/supabase/migrations/20260827000001_spec71_load_positions.sql

CREATE TABLE public.load_positions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  code                 TEXT NOT NULL,           -- scanned/printed identifier, e.g. "POS-04"
  label                TEXT,                    -- human-readable name/location, e.g. "Zona frente a Andén 4"
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

-- Partial unique index, not a table-level UNIQUE constraint — the repo
-- convention for soft-deleted tables (see idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate). A table-level UNIQUE would refuse to let an
-- operator soft-delete a position and later reuse its code for a new one.
CREATE UNIQUE INDEX unique_load_position_code_per_operator
  ON public.load_positions (operator_id, code) WHERE deleted_at IS NULL;

-- routes: which position (if any) this route's load currently occupies, and
-- the assign/release audit facts (actor columns follow dispatches.staged_by's
-- precedent for a physical-confirmation event — see the note below).
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS load_position_id          UUID REFERENCES public.load_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_position_assigned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS load_position_assigned_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_position_released_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS load_position_released_by  UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- At most one un-released route per position at a time (Decision 4's
-- "occupied" predicate: load_position_id IS NOT NULL AND
-- load_position_released_at IS NULL AND deleted_at IS NULL).
CREATE UNIQUE INDEX unique_route_per_active_load_position
  ON public.routes (load_position_id)
  WHERE load_position_id IS NOT NULL
    AND load_position_released_at IS NULL
    AND deleted_at IS NULL;

ALTER TABLE public.routes
  ADD CONSTRAINT routes_load_position_released_requires_id_chk
    CHECK (load_position_released_at IS NULL OR load_position_id IS NOT NULL),
  ADD CONSTRAINT routes_load_position_assigned_at_requires_id_chk
    CHECK (load_position_assigned_at IS NOT NULL OR load_position_id IS NULL);
```

```sql
-- packages/database/supabase/migrations/20260827000002_spec71_position_adjacency.sql

ALTER TABLE public.load_positions
  ADD COLUMN IF NOT EXISTS fronts_dock_zone_id UUID
    REFERENCES public.dock_zones(id) ON DELETE SET NULL;
                                                 -- andén this position stands in front of, if any
                                                 -- (Decision 7) — exclusion input for phase 2, not
                                                 -- a proximity/nearest-position input

CREATE INDEX idx_load_positions_fronts_dock_zone_id
  ON public.load_positions (fronts_dock_zone_id)
  WHERE fronts_dock_zone_id IS NOT NULL;
```

**On the `routes` actor columns (settled, not guessed):** the Data-model note in an earlier draft of
this spec left the column set (assigned_at/assigned_by/released_at/released_by) to be settled
against spec-70 phase 3's audit convention during implementation. It has since been settled and
shipped. Spec-70 phase 3 (`20260825000004`, "seal, dispatch, delete, manager-only removal") landed
an app-layer `audit_logs` insert for the actor plus a domain column on the row
(`dispatches.removal_reason`) with no dedicated `removed_by` column — that convention pulls toward
no dedicated actor columns here. But spec-70 phase 1's `dispatches.staged_by` is the precedent that
cuts the other way: a dedicated actor column for a *physical-confirmation event*, even though every
table in this schema also carries the generic `audit_trigger_func → audit_logs` trail. Assignment
and release of a load position were judged physical-confirmation events like staging, not removal
events, so they follow `staged_by` and get their own actor columns
(`load_position_assigned_by`/`load_position_released_by`) here. **Both conventions apply, not
either:** phase 2 (the application code that writes these columns) must additionally write
`audit_logs` rows for assign/release, matching phase 3's convention for those events too.

RLS: `operator_id = public.get_operator_id()`, matching every other table in this schema (e.g.
`dock_zones`, `vehicles` in `20260812000001_spec52_vehicles_table.sql`). Soft delete via
`deleted_at`, per the project's non-negotiable rule — an inactive position is `is_active = false`
(temporarily out of service, still visible in history), a removed one is soft-deleted (gone from the
physical dock).

**No change to `dispatches`.** Staging a package still writes `dispatches.stage`; which destination
it was staged against — andén or position — is derivable from the scan event, not a new column. The
scan-event audit trail for "which position did this package land in" was decided **yes** and has
shipped: `dock_scans` (the existing scan-event table `trg_dock_scan_advance_package_status` reads)
carries a nullable `load_position_id` column alongside its existing `dock_zone_id`, added in
`20260827000001_spec71_load_positions.sql`. Not in `dispatches`.

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
  at route creation / `planned` (Decision 8) and to release it back to the pool once the route is
  `dispatched`. A route cannot be assigned a position that is already occupied by another
  non-released route of the same operator, and — per Decision 7 — assignment must honour the offset
  rule: a candidate position whose `fronts_dock_zone_id` names an andén the route is still sourcing
  packages from (via its `dispatches`/`packages`) must be excluded from assignment for that route.
  **Best-effort assignment (Decision 8):** if no position is free at `planned`, the route is created
  with `load_position_id` left `NULL` — no queue, no blocking of route planning, no error — and is
  assigned a position later, whenever one is released. **Offset re-check (Decision 7):** the offset
  check must be re-evaluated whenever a route's dispatch set changes after assignment, and a route
  whose position becomes conflicting as a result must be surfaced for reassignment, not silently
  left wrong; the mechanism for this is not designed here. Reassigning a released route must reset
  `load_position_released_at` to `NULL` (Decision 4) or it stays invisible to the occupancy index.
- **Phase 3 — Staging scan.** Extend `useQuickSortFlow` with a second destination kind
  (`load_positions`, matched by `code`) alongside the existing `dock_zones` kind; wire the reject
  state for a mismatched position exactly as it already exists for a mismatched andén. The scan
  handler validates that the package's order is planned on the route occupying the scanned position
  (spec-70's `stage='planned'` dispatch on that `route_id`) before flipping it to `staged` — this is
  the same check spec-70 phase 2 already does for the route-level stage scan; this phase points it
  at a position instead of a route directly, resolving route via `load_positions.id → routes.load_position_id`.
  Both destination codes (`load_positions.code` and `dock_zones.code`) are compared through the same
  guarded `normalizeScanCode`/`scanCodesMatch` (`lib/scan/normalize-scan-code.ts`), with an ambiguity
  guard on both paths: a scan that normalizes to more than one active row fails loudly instead of
  resolving to an arbitrary first match. **Known limit (review finding 3):** this only fixes the
  DESTINATION code. Package/manifest lookups (`.eq('label', barcode)`) are still unnormalized, and
  QA's observed scanner corruption (`CARGA'PARIS'...`) was a package code — that hardware problem is
  not solved by this phase.
- **Phase 4 — Position seal.** One scan/tap per position, refusing while any dispatch assigned to a
  route occupying that position is still `planned` (mirrors spec-70's `/seal` `UNSEALED_STOPS`
  guard, one level down). Idempotent, per the same pattern.
- **Phase 5 — Move-task UI.** At the wave cutoff, a view/screen listing "faltan por mover a posición"
  per route — packages whose dispatch is `planned` or already `staged` on the andén, not yet staged
  onto their route's position — so an operator can work the move list rather than hunting the dock.
  This is presentation over the state built in phases 1–4; no new write path.

## Open questions for implementation

Both prior open questions here are answered: position assignment timing is Decision 8
(route creation / `planned`, released on `dispatched`), and `dock_scans.load_position_id` was
decided YES and shipped in the phase 1 migration (`20260827000001_spec71_load_positions.sql`).
