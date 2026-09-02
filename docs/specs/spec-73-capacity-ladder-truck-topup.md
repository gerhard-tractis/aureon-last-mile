# Spec-73: Capacity ladder and truck top-up

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (route lifecycle, `dispatches.stage`
> — the seal event this spec's learned-capacity sampling hooks into),
> [spec-71](spec-71-load-positions-staging-pass.md) (load positions — sibling spec; a borrowed
> block's move task uses the same staging-scan mechanism), [spec-72](spec-72-blocks-delivery-sequence.md)
> (blocks — sibling spec; top-up moves whole blocks, never loose orders), [spec-68](spec-68-distribution-mobile.md)
> (`dock_zones.capacity` / `lib/distribution/dock-capacity.ts` — the nullable-capacity precedent
> this spec copies exactly)

**Status:** in progress (phases 1–4b landed — count/capacity ladder, adjacency management, top-up backend and its manager-facing UI; phases 5/6 — cubication and learned capacity — remain backlog)

_Date: 2026-08-25_

---

## Goal

Let a manager see and manage truck fill without ever requiring the data that makes it accurate.
The client was explicit: **capacity parameters must be optional and must never block the
workflow.** This spec designs a three-tier ladder — count-only, typed capacity, cubication — where
each tier is strictly additive over the last, each is opt-in per vehicle, and the system says what
it *cannot* compute rather than guessing or blocking.

It also adds the two things the client named as necessary to keep "fill the truck" from becoming a
bad instruction on its own: **whole-block top-up** from adjacent andenes (never loose orders, never
interleaved, capped, always a scan-confirmed second touch) and a **max-drops** constraint that stops
"full truck" from quietly becoming "driver finishes at 22:00."

## Non-Goals

- Any map, pin, geocode, or drag-and-drop UI — including for adjacency configuration, which is a
  flat manual table, not a map click-through. See [spec-58](spec-58-geocoding-foundation.md), still
  `backlog`, not a dependency here.
- Route optimisation / automatic load-building. This spec surfaces suggestions and enforces rules a
  human confirms; it does not compute an optimal load.
- Load positions or block sequencing themselves — spec-71 and spec-72. This spec's top-up move
  reuses spec-71's staging-scan mechanism and spec-72's block concept by name, but does not
  redefine either, and does not depend on either shipping first (each of the three specs stands on
  spec-70 alone).
- Populating `orders.total_volume_m3` / `orders.total_weight_kg` from any new ingestion path.
  Whether/how those columns get filled is a connector-config question (see the problem section) that
  this spec deliberately leaves open rather than deciding as a side effect of capacity work.

## Dependencies this spec is not fully independent of

Every one of specs 71/72/73 is written to depend only on spec-70, not on each other, and that holds
for this spec's data model and its Tier 0/1 fill-bar work (Phases 1–2, 6). It does **not** fully hold
for the top-up feature:

- **Decisions 5.2, 5.3, and 5.5 (whole-block moves, end-of-route append, the scan-confirmed move
  task) lean directly on spec-72's block concept and spec-71's staging-scan mechanism.** Phase 4
  below is written so it can ship before either of those specs lands — a "block" can start as an
  ad-hoc comuna grouping computed on the fly rather than a `route_blocks` row, and the move task can
  start as a manual checklist entry rather than a wired staging scan — but a top-up feature shipped
  that way, alone, is thin: no first-class block structure to move as a unit, no load-position
  destination for the move to land in, no LIFO payoff. The full value of Phase 4 is realized once
  spec-71 and spec-72 exist, even though this spec does not require either to be built first.
- **Phases 2 and 6 need a vehicle known before dispatch, which spec-70 phase 3 is what provides.**
  `routes.vehicle_id` is not written locally today — `RouteBuilder.tsx` holds the selected vehicle in
  `useState` and only DispatchTrack's webhook back-fills `fleet_vehicles`/`routes.vehicle_id` after
  the fact (see the problem section's evidence on `RouteBuilder.tsx` and the dispatch handler). A fill
  bar that needs "this route's vehicle" before the route is dispatched, and a `vehicle_load_samples`
  row that needs a `vehicle_id` at seal time (before dispatch, per spec-70's state machine), both
  depend on spec-70 phase 3 (still unmerged as of this writing) actually persisting the vehicle
  assignment locally. Without it, Phase 2's fill bar and Phase 6's learned samples have no vehicle to
  key against until the route is already gone.

---

## The problem, with evidence

- **Truck capacity is not measured today, anywhere.** `fleet_vehicles`
  (`20260306000001_add_routes_dispatches_fleet_tables.sql:55-67`) — the DispatchTrack-synced vehicle
  table `routes.vehicle_id` points at — has no capacity column of any kind: `id`, `operator_id`,
  `provider`, `external_vehicle_id`, `plate_number`, `vehicle_type`, `driver_name`, `raw_data`,
  timestamps. The client's own framing — trucks sometimes leave half full and they want that to
  stop — has no data path to act on today; a manager has no number to compare a load against.

- **`orders.total_volume_m3` and `orders.total_weight_kg` exist and are effectively unpopulated.**
  Both columns were added by `20260223000001_create_automation_worker_schema.sql:328-333`
  (`total_volume_m3` is `DECIMAL(10,6)`, `total_weight_kg` is `DECIMAL(10,3)`, both nullable, both
  commented "from manifest, may be inaccurate"). The Easy connector's `column_map` seed in that same migration maps
  `"total_weight_kg": "PESO KG"` — so *if* a retailer's manifest carries a weight column and the
  ingestion pipeline is wired to read it, weight could arrive today — but `total_volume_m3` has no
  column mapped for any seeded connector, and a repo-wide search outside migrations and the pgTAP
  suite (`packages/database/supabase/tests/automation_worker_schema_test.sql`) finds **no
  application code that reads or writes either column** — no hook, no component, no RPC. So both
  columns are live, nullable, and currently dead: nothing populates volume, and nothing downstream
  of ingestion consumes either one, regardless of whether a manifest happens to carry the figures.

- **The nullable-capacity precedent already exists and works exactly the way this spec needs to
  copy.** spec-68 added `dock_zones.capacity INT` (nullable, no CHECK constraint — see
  `20260824000005_spec68_dock_zone_capacity.sql`'s header comment for the reasoning it gives:
  a CHECK would turn a harmless mis-keyed negative into a hard failure instead of a value the UI
  already ignores) and `lib/distribution/dock-capacity.ts`, whose `getDockCapacityStatus(count,
  capacity)` returns `{ configured: false, fillPct: null, tone: null, remainingLabel: null }` for
  any `capacity == null || capacity <= 0`, and a populated status object otherwise. Every consuming
  screen renders the raw count regardless; only the *bar* disappears when unconfigured. This is the
  exact shape spec-73's tier ladder needs, one level up (vehicle instead of dock zone), and it is
  proven in production rather than a proposal.

- **`fleet_vehicles` is a webhook-sync mirror, which affects where a manager-entered field can
  safely live.** The Paris DispatchTrack webhook (`apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json`)
  upserts `fleet_vehicles` with `Prefer: resolution=merge-duplicates` sending only
  `{operator_id, provider, external_vehicle_id, vehicle_type, raw_data}` on every dispatch/route
  event. PostgREST's `merge-duplicates` upsert only sets the columns present in the request body on
  conflict — a column not sent is left untouched. So a manager-typed `capacity_packages` on
  `fleet_vehicles` is safe from being silently clobbered by the sync, **provided the migration and
  any future webhook change never add it to that upsert payload.** This is worth stating explicitly
  because it is the one way this design could quietly break: a well-meaning future edit to the n8n
  workflow that includes `capacity_packages` in its upsert body (e.g. to "keep it in sync with
  `raw_data`") would start overwriting manager-entered values with `null` on every webhook event.

---

## Decisions

1. **Three tiers, strictly additive, each opt-in per vehicle.**

   | Tier | Data required | What it unlocks |
   |---|---|---|
   | 0 | none | Order and package counts only. Every screen that shows a load works with this alone — no fill %, no suggestions, no blocking. |
   | 1 | `fleet_vehicles.capacity_packages` (nullable, set by eye) | Fill bar, under-fill flag, top-up suggestions sized by package count. |
   | 2 | `orders.total_volume_m3` + `orders.total_weight_kg` populated for the orders on a route | Accurate mixed-size fill (volume/weight-aware), not just a package count against a package-count capacity. |

   A vehicle with no tier-1 number gets tier-0 treatment forever, permanently, not as a fallback
   state waiting to be filled in. A route whose orders lack tier-2 data falls back to tier-1 (or
   tier-0) for that route specifically — tiers are evaluated per-route against the data actually
   present, not as a single global switch on the operator.

2. **`fleet_vehicles.capacity_packages` is nullable, no CHECK, follows spec-68's constraint reasoning
   verbatim.** Same column shape, same reasoning: the one app write path never submits `<= 0`
   (empty input persists as `null`), and a defensive floor in the arithmetic module treats `0`/
   negative the same as `null`. No new constraint pattern is invented.

3. **The arithmetic lives in one module, read by every consuming screen — same as
   `dock-capacity.ts`, one level up.** `lib/dispatch/vehicle-capacity.ts` (new, mirroring
   `lib/distribution/dock-capacity.ts`'s shape and signature style) is the single place that turns a
   route's package/volume/weight totals and a vehicle's tier-1/tier-2 numbers into fill percentage,
   tone, and top-up suggestion sizing. Every screen that renders truck fill reads this module;
   nothing recomputes the arithmetic locally — spec-68's own spec doc gives the reason for the
   equivalent module one level down: four screens read `dock-capacity.ts`, and writing the same
   arithmetic four times is how it drifts (`docs/specs/spec-68-distribution-mobile.md`, Decision 5).
   `dock-capacity.ts`'s own header comment in the codebase makes the same point in English.

4. **A demand signal is also learned from sealed loads — it is not a learned capacity, and the
   copy must not claim otherwise.** Every time a route is sealed (spec-70's `/seal`, entered when
   zero dispatches remain `planned`), the loaded package count (and, where tier-2 data is present,
   volume/weight) for that vehicle is recorded. A route can seal well under a vehicle's true ceiling
   — a light day, a half-empty wave, an operator choosing not to top it up — so an empirical p90
   across a vehicle's sealed loads measures **what this vehicle has actually been asked to carry**,
   not what it can carry. Showing it as "your last 12 loads averaged 174" next to a manager's typed
   200 reads as a correction toward the truck's true limit, which it is not entitled to claim: a
   vehicle that could carry 220 but has only ever been loaded to a comfortable 174 would show exactly
   the same p90 as one whose real ceiling is 174. The UI copy has to say what the number is —
   observed load history, a demand/utilization figure — not "measured capacity," and it is shown
   alongside the manager's typed `capacity_packages` as a second, separate number, never in place of
   it and never as a suggested replacement value. Tier 1's typed number stays what drives the fill
   bar and the blocking-free top-up suggestions; the p90 needs sealed history to exist at all and a
   new or rarely-used vehicle has none.

5. **Top-up rules — all six required, none optional:**

   1. **Adjacent andenes only.** Adjacency is a one-time, manually configured table —
      `dock_zone_adjacency`, listing which andén pairs are geographically next to each other. Santiago
      comuna geography is static, so this table is populated once by an operator and rarely touched
      again. It is deliberately **not** derived from geocoding or coordinates. `dock_zones` has no
      lat/lng. `chile_comunas` does carry a `geometry GEOMETRY(MultiPolygon, 4326)` column — the
      table is PostGIS-backed (`CREATE EXTENSION IF NOT EXISTS postgis`,
      `20260321000001_chile_comunas_normalization.sql:5-17`) alongside `codigo_cut`, `nombre`,
      `provincia`, `region`, `region_num` — but that column has never been populated: the same
      migration's seed data only inserts the five text columns, and a repo-wide search finds no
      writer of `chile_comunas.geometry` anywhere. So the conclusion holds — there is no usable
      coordinate data to derive adjacency from today — but the column itself is not absent, only
      empty. Deriving adjacency from `geometry` instead of a manual table is a real future option if
      that column is ever populated; this spec does not assume or depend on that happening, and until
      it does, adjacency has to be a fact someone states, not one the system derives.
   2. **Whole comuna blocks move, never loose orders.** A top-up candidate is one of spec-72's blocks
      in its entirety — this preserves the block model, the LIFO load order spec-72 defines, and the
      driver's mental map of "which comuna am I delivering in." Splitting a block for top-up would
      undo exactly what spec-72 exists to protect.
   3. **The borrowed block appends at the end of the route, never interleaved.** Combined with
      spec-72's LIFO load order (Decision 5 there), this means the borrowed block loads *first* and
      unloads *last* — it never disrupts the sequence of the route's own blocks.
   4. **Capped: one borrowed block per route, or roughly 25% of the load, whichever binds first.**
      Past that, the route stops being "this driver's territory plus a top-up" and starts being a
      second driver's territory wearing a costume — which is exactly what Decision 6 in spec-72
      (territory stability) exists to discourage.
   5. **The borrowed block is a second physical touch, always an explicit scan-confirmed move task,
      never implicit.** A top-up suggestion the manager accepts creates the same kind of move task
      spec-71 defines for the staging pass — packages physically move from their original andén into
      the accepting route's load position, one scan each, sealed like any other move. A top-up that
      only updates `route_id` in the database without a physical confirmation is how packages go
      missing; this spec refuses that shortcut even though it would be the smaller diff.
   6. **The donor side is a manager-only removal, exactly as spec-70 already requires, and a donor
      route that is `loaded` or beyond cannot be raided.** Moving a block onto another route means
      those dispatches leave the donor route's plan. spec-70 already makes any such removal a
      manager-only action (`admin`/`ops_leader`) requiring a `removal_reason` and an `audit_logs`
      entry (spec-70 Decision 3, and the `DELETE /routes/[id]/packages/[pkgId]` endpoint it
      describes) — top-up reuses that exact mechanism rather than a top-up-specific removal path, so
      there is one audited way to take an order off a route's plan, not two. A route that has already
      reached spec-70's `loaded` state (zero dispatches left `planned` — its manifest is sealed) is
      not a valid donor: raiding a sealed manifest for a top-up would reopen a route the seal step
      exists to close, and would mean a donor route's own load could come up short after the fact
      with no scan to explain the gap. A donor may only be a route still `planned` or `loading`.

6. **Fill rate is a cost metric; cost-per-drop is the real one — so max-drops is a second hard
   constraint, not a nice-to-have.** A full truck making 11 hours of stops costs more than two
   trucks at 70% making 6 hours each. Top-up suggestions (Decision 5) and the fill bar (Decision 1)
   both respect an optional `routes.max_drops` (or an operator-level default) alongside capacity: a
   route already at its drop cap does not get top-up suggestions even if it has physical room left,
   and the fill UI shows drop count with the same tier-0-always-visible treatment as package count —
   it needs no capacity data configured to be useful, because it is a count, not a percentage.
   Without this constraint, "dispatch trucks full" as an operational push quietly becomes "drivers
   finish at 22:00," which is the opposite of what capacity work is meant to achieve.

---

## Data model

```sql
-- packages/database/supabase/migrations/<timestamp>_spec73_vehicle_capacity.sql

ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS capacity_packages INT;

COMMENT ON COLUMN public.fleet_vehicles.capacity_packages IS
  'Max packages this vehicle can carry, set by eye by a manager. NULL means '
  '"not configured": lib/dispatch/vehicle-capacity.ts and everything built on '
  'it render no fill bar, no under-fill flag, no top-up suggestion sizing for '
  'it — never a bar pinned at 0%. Zero or negative values are treated the '
  'same as NULL by that module; deliberately no CHECK constraint, mirroring '
  '20260824000005 (dock_zones.capacity) for the same reasoning. NEVER add '
  'this column to the DispatchTrack webhook upsert payload in '
  'apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json — that upsert '
  'uses Prefer: resolution=merge-duplicates and only overwrites columns '
  'present in its body; including this one would silently null out every '
  'manager-typed capacity on the next webhook event for that vehicle.';

-- routes: optional hard cap independent of package/volume capacity
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS max_drops INT;

COMMENT ON COLUMN public.routes.max_drops IS
  'Optional cap on delivery stops for this route, independent of vehicle '
  'capacity. NULL means unconfigured — no cap enforced, no warning shown. '
  'Exists because a full truck can still be a bad route if it takes too '
  'many hours; see spec-73 Decision 6.';

-- one-time, manually configured andén-pair adjacency (no geocoding)
CREATE TABLE public.dock_zone_adjacency (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  dock_zone_id      UUID NOT NULL REFERENCES public.dock_zones(id) ON DELETE CASCADE,
  adjacent_zone_id  UUID NOT NULL REFERENCES public.dock_zones(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT dock_zone_adjacency_not_self CHECK (dock_zone_id <> adjacent_zone_id)
);

-- Partial unique index, not a table-level UNIQUE constraint -- the repo
-- convention for soft-deleted tables (see idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate). A table-level UNIQUE would refuse to let a
-- soft-deleted adjacency pair be reconfigured later under the same zones.
CREATE UNIQUE INDEX unique_dock_zone_adjacency_pair
  ON public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  WHERE deleted_at IS NULL;

-- learned capacity: one row per sealed route, feeding the empirical p90.
-- vehicle_id is nullable — corrected in phase 1 code review, see the phase
-- 6 note below: routes.vehicle_id is NULL for every route at seal time in
-- the current codebase, so a NOT NULL here would block every seal.
CREATE TABLE public.vehicle_load_samples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  vehicle_id       UUID REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  route_id         UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  package_count    INT NOT NULL,
  total_volume_m3  DECIMAL(10,6),   -- null unless every order on the route had tier-2 data
  total_weight_kg  DECIMAL(10,3),   -- null unless every order on the route had tier-2 data
  sealed_at        TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`dock_zone_adjacency` is directional in storage (a row for A→B does not imply B→A) so the SQL suite
and any write path must decide explicitly whether to store both directions or treat the table as
symmetric at read time — flagged here rather than decided, since either is workable and the choice
should be made when the adjacency-management UI is scoped, not guessed in this document.

`vehicle_load_samples` is append-only, one row per seal, intentionally not upserted per vehicle —
the p90 needs the distribution, not just a running average, and an append-only table also gives a
free audit trail of what actually left the dock over time. All three tables carry `operator_id` and
standard RLS (`operator_id = public.get_operator_id()`), per the project's non-negotiable rule.

---

## Implementation phases

Each phase is one PR with auto-merge, per `CLAUDE.md`.

- **Phase 1 — Database.** `fleet_vehicles.capacity_packages`, `routes.max_drops`,
  `dock_zone_adjacency`, `vehicle_load_samples`, RLS, and a SQL suite (fixtures + `DO $$ ... RAISE`,
  matching `pre_route_snapshot.test.sql`): operator isolation on all three; the `not_self` and
  unique-pair CHECKs on adjacency; that a `capacity_packages` of `0`/negative round-trips without
  error (no CHECK, per Decision 2).
- **Phase 2 — Tier 0/1 arithmetic and the fill bar.** `lib/dispatch/vehicle-capacity.ts` (mirroring
  `dock-capacity.ts`'s tested shape: `configured`, `fillPct`, `tone`, plus under-fill/top-up sizing
  fields this module needs that `dock-capacity.ts` doesn't) with unit tests covering: no capacity →
  everything null except the raw count; a configured capacity → fill %, tone, under-fill flag at the
  low end mirroring spec-68's thresholds inverted for "too empty" rather than "too full." A fill-bar
  UI component consuming it, rendering nothing when unconfigured — same contract as
  `DockCapacityBar`. **`VehicleCapacityBar` and `DockCapacityBar` deliberately carry opposite tone
  semantics** despite near-identical markup: on `/andenes` amber means "nearly full, stop sending"
  (spec-68 thresholds), on dispatch amber means "under-filled, send more" (this spec's Decision 1).
  Same colours, same geometry, inverted meaning — invisible from the markup alone. Any future
  refactor that shares the two into one component must not merge that semantic inversion away; keep
  the tone-to-meaning mapping an explicit prop, not a hardcoded assumption either component owns.
- **Phase 3 — Adjacency management.** A settings screen (flat table UI, no map) for configuring
  `dock_zone_adjacency` pairs. Manager-only, per the same role gate spec-68 used for manual dock
  assignment (`ops_leader`/`admin`/`operations_manager`, to be confirmed against the current
  permission set at implementation time rather than assumed here).
- **Phase 4 — Top-up suggestions and the move task.** Computes candidate adjacent blocks under-fill
  routes could borrow (respecting the cap in Decision 5.4 and the `max_drops` check in Decision 6),
  surfaces them to a manager, and on acceptance creates the scan-confirmed move task described in
  Decision 5.5 — built on spec-71's staging-scan mechanism and spec-72's block concept, but shippable
  before either of those specs lands, since a "move task" here can start as a manual checklist entry
  and be wired to spec-71's actual scan flow once that exists. **Direction hazard (confirmed against
  phase 1's schema, not a defect — matches the documented directional-storage design):**
  `dock_zone_adjacency` allows both an (A,B) row and a (B,A) row to exist as independent live rows;
  only self-pairs and exact duplicates are blocked. A symmetric candidate read must therefore be
  `WHERE dock_zone_id = X OR adjacent_zone_id = X` **with DISTINCT** — a pair stored in both
  directions otherwise returns the neighbour twice. If phase 3's UI ends up writing only one
  direction while this phase's read checks only one column, top-up candidates go silently
  asymmetric (X offers Y as a candidate but Y does not offer X) with nothing to surface the gap.
  Phase 3's write path and this phase's read path must agree on direction(s) explicitly when phase 3
  is scoped — see the Open question below.
- **Phase 5 — Tier 2 (cubication).** Once `orders.total_volume_m3`/`total_weight_kg` are actually
  populated for a given retailer/connector (a separate, connector-specific decision this spec does
  not make — see Non-Goals), extend `vehicle-capacity.ts` to prefer volume/weight-aware fill over
  package-count fill for routes where every order carries both figures, falling back to tier 1
  per-route otherwise.
- **Phase 6 — Learned capacity.** Write a `vehicle_load_samples` row on every successful `/seal`
  (spec-70's seal event). Compute and display the rolling p90 alongside the manager's typed
  `capacity_packages` wherever the fill bar renders.

  **Premise failure, found in phase 1 code review (2026-09-01):** this phase assumed spec-70 phase 3
  would provide a pre-seal vehicle assignment on `routes.vehicle_id`. Spec-70 phase 3 landed
  (`20260825000004`) and does not. In the current codebase `routes.vehicle_id` has exactly one local
  writer — the dispatch handler (`app/api/dispatch/routes/[id]/dispatch/route.ts`) — which itself
  refuses unless the route is already `loaded`, i.e. already sealed (`seal-route.ts`'s
  `SEALABLE_FROM` is `draft`/`planned`/`loading`). The only other writer is the DispatchTrack
  webhook, which back-fills the column after the fact. So **`routes.vehicle_id` is NULL for every
  route at the moment `/seal` fires**, for every route in the codebase today. Phase 1's migration was
  corrected to make `vehicle_load_samples.vehicle_id` nullable (see that migration's header comment)
  so a sample can still be written without blocking the seal. That fixes "phase 6 cannot land at all
  without either blocking a seal or silently dropping every sample," but it does not by itself
  produce a usable p90 per vehicle — a sample with a NULL `vehicle_id` cannot be attributed to a
  specific vehicle at write time. Phase 6, when scoped, must pick one of:
  1. Add a pre-seal vehicle assignment step to the dispatch/loading workflow (does not exist locally
     today — new scope, not something this spec can assume for free), or
  2. Write the sample with `vehicle_id = NULL` at seal time and attribute it after the fact once the
     DispatchTrack webhook back-fills `routes.vehicle_id` (a join through `route_id` at read/report
     time rather than a value stored on the sample row itself), or
  3. Some other explicit mechanism decided when phase 6 is scoped.
  This paragraph exists so phase 6 is scoped against the real state of the codebase, not the
  assumption this spec started with.

## Phase 4 implementation note (2026-09-02)

**Scope check, done before writing code, per this phase's own instructions:**

- spec-70's audited manager-only removal (`DELETE /routes/[id]/packages/[pkgId]`,
  `removal_reason` + `audit_logs`, gated to `PLAN_MANAGER_ROLES`, refusing any
  route past `loading`) exists and works exactly as Decision 5.6 describes.
  Confirmed by reading the endpoint directly before building on it.
- spec-72's `route_blocks` (all phases 1-5 merged) is a real, populated table
  by the time this phase landed — top-up moves an actual `route_blocks` row,
  not an ad-hoc comuna grouping the spec allowed as a fallback.
- spec-71's staging-scan mechanism (`load_positions`, `dock_scans.load_position_id`,
  `get_move_task_snapshot`) already defines "moved" as a per-package fact and
  already groups a route's remaining work by andén. **No new move-task table
  or endpoint was built** — a borrowed block's dispatches are re-pointed at
  the receiving route while the packages physically stay at the donor andén,
  which makes `get_move_task_snapshot` surface them as ordinary remaining
  work for that route, exactly the way any other not-yet-staged package
  would appear. This *is* Decision 5.5's scan-confirmed move task, satisfied
  by reuse rather than a second, parallel mechanism.

**What was built (backend, one PR):**

- Migration `20260906000001_spec73_phase4_topup_suggestions.sql`:
  `route_blocks.donor_route_id` (provenance), `route_source_dock_zone_ids`
  (shared source-andén read), `get_topup_candidates` (read), `accept_topup_block`
  (write — donor-side audited removal + receiving-side append, one transaction).
  10 pgTAP tests (`spec73_phase4_topup_suggestions.test.sql`), all mutation-proven.
- API: `GET /api/dispatch/routes/[id]/topup` (suggestions),
  `POST /api/dispatch/routes/[id]/topup/accept` (accept), both manager-gated
  (`PLAN_MANAGER_ROLES`), 25 vitest cases.

**Left out of this slice, deliberately — proposed as phase 4b:** the manager-facing
UI (a suggestions list on the route detail screen + an accept button/dialog).
The phase is large enough that landing DB + API as their own reviewable PR,
then UI as a second, was judged the safer split — the enforcement logic (all
six Decision 5 sub-rules plus Decision 6) is where the real risk lives, and it
is now independently tested at the API boundary without a UI dependency.
`lib/dispatch/vehicle-capacity.ts`'s `getMaxDropsStatus` (phase 2) is already
available for phase 4b's UI to reuse for the same max_drops read the backend
enforces server-side.

### Phase 4 code review (2026-09-02) — findings and fixes

The reviewer attacked the Decision 5.5 reuse claim above empirically rather than
by reading its prose, and it holds **only for a block that has not started
loading onto its donor's truck**. Everything below was reproduced live against
the local pgTAP database before it was fixed.

1. **Decision 5.5 — HIGH, fixed.** A donor may be `loading`, and a `loading`
   route is precisely one whose packages are being scanned onto its own load
   position right now. Moving such a block re-pointed the plan while the boxes
   stayed in the donor's truck. `get_move_task_snapshot` reads "moved" from
   `dock_scans.load_position_id`, which is a **global per-package fact, not a
   per-route one**, so those packages read as already moved: the receiving
   route's snapshot went `total_packages` 1 → 2 while `remaining_packages`
   stayed at 1, with no group naming the borrowed andén. The box was invisible
   to the move task, `validateScan` refused to re-scan it (`ALREADY_STAGED`:
   `loaded_at` set with `load_inferred = false`), and the new dispatch's
   `stage='planned'` left the receiving route permanently unsealable
   (`UNSEALED_STOPS`). That is the "only updates `route_id` in the database
   without a physical confirmation" shortcut Decision 5.5 refuses by name.
   **Fix:** `route_block_is_physically_staged` — such a block is neither
   suggested nor accepted (`BLOCK_ALREADY_STAGED`). Blocks that were never
   staged move exactly as before, and TEST 12 is the positive control proving
   they really do appear as a donor-andén group on the receiving route's move
   task. So the reuse claim stands, narrowed to the case it is actually true for.
2. **Decision 5.4b (25% cap) — HIGH, fixed.** `get_topup_candidates` filtered on
   the block's **package** count; `accept_topup_block` compared its **dispatch**
   count. They disagreed on every multi-bulto order — the normal case since
   spec-55's carton expansion. With a cap of 1, the read path correctly offered
   nothing for an 8-package single-order block and the write path accepted the
   same block, taking the receiving route from 1 package to 9. Both paths now
   measure packages.
3. **Decision 6 (`max_drops`) — HIGH, fixed.** Both paths only asked whether the
   route was *already* at its cap, never whether the block would push it past.
   A route with `max_drops = 2` holding 1 drop was offered — and accepted — a
   5-order block and ended at 6 drops. Both paths now use the post-move count.
   `NULL`/`0` `max_drops` still means *no cap*, and TEST 14 pins that.
4. **Security — HIGH, fixed.** The manager gate lived **only** in the Next.js
   handlers, while `accept_topup_block` is `GRANT EXECUTE ... TO authenticated`.
   A `loading_crew` user — the exact person spec-70 Decision 3 exists to keep
   away from the plan — executed a complete top-up through PostgREST and chose
   the `p_user_id` written to `audit_logs`, attributing their own action to a
   manager. The same class of finding phase 3 landed one table over. The RPC now
   reads the caller's role from `public.users` and takes the audit actor from
   the JWT, and the handler maps a `42501` back to a 403.
5. **`route_blocks` direct writes — HIGH, partially fixed.** spec-72 phase 1's
   `GRANT SELECT, INSERT, UPDATE ON route_blocks TO authenticated` has an RLS
   policy that checks only the tenant, never the role. Phase 4 makes that newly
   harmful: `donor_route_id` is the ledger Decision 5.4's "one borrowed block per
   route" cap reads, so one forged row (reproduced from a `loading_crew` session)
   makes `get_topup_candidates` answer `ALREADY_HAS_TOPUP` for that route
   forever — a denial of service against every legitimate top-up, available to
   any signed-in user in the tenant. A `BEFORE INSERT OR UPDATE` trigger now
   requires a manager to write top-up provenance, which closes the part phase 4
   introduced. **Residual, unfixed and deliberately out of scope:** the direct
   INSERT/UPDATE grant on the other three `sequence_source` values. Phase 3's
   full remedy (`REVOKE` + `SECURITY DEFINER`) would require rewriting spec-72's
   three `SECURITY INVOKER` block writers (`seed_default_route_blocks`,
   `move_route_block`, `create_seeded_route`), which belongs in its own change.
6. **Soft-deleted orders — LOW, fixed.** The donor removal loop and the read
   path's `package_count` did not filter `orders.deleted_at`, though every other
   read in the migration does.
7. **Test gaps closed.** `accept_topup_block`'s own `NOT_ADJACENT` guard
   (Decision 5.1, write side) had no test at all — a mutant that deleted it
   survived the original suite. So did a mutant that dropped the receiving-route
   lookup's `operator_id` filter (the cross-tenant test was being refused by the
   *donor* lookup and never reached it). TESTS 9 and 16 now cover both. The
   suite is 17 assertions across 16 tests; 15 of 16 mutants are killed, the
   survivor being an equivalent mutant (the "already at cap" pre-check is now
   strictly subsumed by the post-move headroom check, and is kept only for
   symmetry with the read path's fast return).

**Verified correct, no change needed:** the two-route lock is taken in canonical
id order (no repeat of phase 3's deadlock); `move_route_block` and
`seed_default_route_blocks` take the same `routes` `FOR UPDATE` lock, so the
`MAX(sequence_index) + 1` append cannot race them; the append respects spec-72's
non-contiguous indices and its `CHECK (sequence_index > 0)`; the donor removal
writes the same soft-delete + `removal_reason` + `packages.status` +
`audit_logs('remove_from_plan')` the `DELETE .../packages/[pkgId]` endpoint
writes, so Decision 5.6's "one audited way" holds; all functions are
`SECURITY INVOKER` with `search_path` pinned; no map, pin, geocode,
drag-and-drop, optimizer or `sidecar/or-tools` wiring was added.

**Known residual (not fixed, no ticket yet):** `get_topup_candidates` is
`GRANT EXECUTE ... TO authenticated` with no role check of its own, so a
non-manager can enumerate other routes' `external_route_id` / `driver_name`
through PostgREST. Read-only and same-tenant; the write path is now gated. Worth
folding into the same change that fixes finding 5.

## Phase 4b implementation note (2026-09-02)

The manager-facing UI phase 4 left out: a suggestions list wired into
`RouteBuilder.tsx` right below `RouteBlockList` (the same spot the fill-bar
under-fill signal belongs — see the wiring gap noted below), and above the
package list.

**What was built:**

- `hooks/dispatch/useTopupCandidates.ts` — `useTopupCandidates` (GET
  `.../topup`, react-query, `enabled` withholds the fetch entirely when the
  role gate fails) and `useAcceptTopup` (POST `.../topup/accept`,
  invalidates the candidates/blocks/packages/route queries in `onSettled`
  — on BOTH success and a refusal, so a stale suggestion refused by the
  database is never left rendering as if still available).
- `components/dispatch/TopupSuggestions.tsx` — the list + accept button.
  Renders `null` for every case that is not "eligible with at least one
  candidate": loading, `eligible: false` for any reason
  (`ROUTE_NOT_LOADABLE`, `AT_MAX_DROPS`, `ALREADY_HAS_TOPUP`), and
  `eligible: true` with zero candidates — the same render-nothing contract
  `VehicleCapacityBar` already honours, never a "no suggestions available"
  message that would misreport "capacity/adjacency never configured" as
  "nothing to top up". Gated on `PLAN_MANAGER_ROLES`, defence in depth only
  — the database is the real gate (the GET route and `accept_topup_block`
  itself, per the phase 4 review's security fix). Accepting a candidate
  reuses `RouteBuilder`'s existing `window.prompt` reason pattern (same
  convention `handleRemove` already uses for a manager-only plan removal,
  which `accept_topup_block` performs internally on the donor side) rather
  than inventing a second reason-collection UI.
- Refusal-code -> message mapping (`TOPUP_ACCEPT_REFUSAL_MESSAGES`), one
  distinct, honest Spanish sentence per code the accept route can return:
  `BLOCK_ALREADY_STAGED`, `OVER_TOPUP_CAP`, `AT_MAX_DROPS`,
  `DONOR_ROUTE_NOT_RAIDABLE`, `RECEIVING_ROUTE_NOT_LOADABLE`,
  `ALREADY_HAS_TOPUP`, `BLOCK_NOT_FOUND`, `NOT_ADJACENT`, `INVALID_TOPUP`,
  `ROUTE_NOT_FOUND`, `REASON_REQUIRED`, `FORBIDDEN` — plus a generic
  fallback for anything unmapped. Mutation-proven distinct (see below).
- Copy discipline: no "óptimo"/"recomendado"/"mejor opción" language
  anywhere — a suggestion the manager confirms, never an instruction or an
  optimisation, per Decision 4's reasoning about the p90 applied here too.

**Wiring gap found, not fixed (out of this phase's scope):**
`VehicleCapacityBar`/`getVehicleFillStatus` (phase 2) were never actually
wired into any screen — no consumer imports them anywhere in the app tree,
confirmed by a repo-wide search. The fill bar this phase's suggestions
widget was meant to sit "next to" does not currently render anywhere. This
widget was placed where that bar belongs (`RouteBuilder.tsx`, directly
below the block sequence), so wiring the fill bar in later drops it into
the right spot automatically, but today a manager sees top-up suggestions
with no visible fill percentage motivating them. Worth its own small
follow-up; not attempted here since it is phase 2's gap, not phase 4b's.

**Review fixes (2026-09-02, adversarial review of this phase):**

- *Failed read no longer renders as silence.* The original contract folded
  "the read failed" into the same `null` as "there is nothing to suggest".
  Those are different facts, and asserting the first when the second is true
  is the exact defect phase 3's review found in `RouteBlockList`. A query
  error now renders one muted line saying the suggestions could not be
  loaded and that this does not mean there are none; every legitimate empty
  state (loading, ineligible, zero candidates) still renders nothing.
- *The refusal now outlives the row it refused.* The refusal invalidates the
  candidate list and the refetch usually returns fewer rows — often zero,
  since the refused row is normally the stale one. The render-nothing guard
  sat ahead of the banner, so the widget unmounted and took the explanation
  with it: the manager was prompted for a reason and then watched the screen
  go blank with no statement that anything had been refused.
- *One accept at a time, route-wide.* Only the clicked row was disabled while
  its POST was in flight, so a second row could be accepted for the same
  route. `ALREADY_HAS_TOPUP` is a one-shot ledger (the database serialises
  and refuses the second), but the manager only learned that after the fact.
- *The donor route's caches are invalidated too.* `accept_topup_block`
  soft-deletes the block's dispatches off the DONOR route; only the receiving
  route's caches were invalidated, so the donor's own `RouteBuilder` went on
  rendering the block it no longer owns — the borrowed block visible on both
  routes at once.
- *Two refusal messages asserted causes the database does not guarantee.*
  `DONOR_ROUTE_NOT_RAIDABLE` blamed a sealed manifest, but the function
  refuses for any donor status outside `('planned','loading')` — `draft` and
  `cancelled` included. `NOT_ADJACENT` blamed adjacency, but the same code is
  raised when the RECEIVING route has no source andén at all
  (`array_length(v_own_zones, 1) IS NULL`). Both reworded.
- *The `eligible` flag was decorative.* Deleting `!data.eligible` from the
  guard left the whole suite green — the one "ineligible" fixture also had
  zero candidates. Now covered by an `eligible: false` payload that still
  carries rows.

**Verification:** hook (8 tests) + component (28 tests) + no regression in
`RouteBuilder.test.tsx` (30 tests, updated only to mock the two new hooks — verified
mocks-only: `useOperatorId` has no other consumer in the `RouteBuilder`
subtree, so no pre-existing assertion was weakened)
+ phase 4's own API suites re-run unchanged (7 + 21 = 28 tests, all green)
= 102 tests total across the touched files (5 files). `npx tsc --noEmit`
clean. Eight mutants introduced and reverted, all killed: role gate, the
`eligible` flag, the refusal-code map, the failed-read note, the refusal
surviving an emptied list, the route-wide in-flight guard, donor-side cache
invalidation, and the loading-vs-error distinction.

## Open questions for implementation

- Which role(s) can configure `dock_zone_adjacency` and edit `max_drops` — confirm against the
  current permission set rather than assuming `ops_leader` covers it.
- Whether `dock_zone_adjacency` is stored symmetrically or directionally (see Data model note) —
  decide when phase 3 is scoped.
- The exact retailer/connector path that would populate `orders.total_volume_m3` for tier 2 is
  explicitly not decided here; phase 5 is blocked on that separate decision, not on anything in this
  spec's own phases 1–4.
