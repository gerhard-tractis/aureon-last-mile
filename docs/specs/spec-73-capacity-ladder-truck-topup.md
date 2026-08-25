# Spec-73: Capacity ladder and truck top-up

> **Related:** [spec-70](spec-70-dispatch-state-machine.md) (route lifecycle, `dispatches.stage`
> — the seal event this spec's learned-capacity sampling hooks into),
> [spec-71](spec-71-load-positions-staging-pass.md) (load positions — sibling spec; a borrowed
> block's move task uses the same staging-scan mechanism), [spec-72](spec-72-blocks-delivery-sequence.md)
> (blocks — sibling spec; top-up moves whole blocks, never loose orders), [spec-68](spec-68-distribution-mobile.md)
> (`dock_zones.capacity` / `lib/distribution/dock-capacity.ts` — the nullable-capacity precedent
> this spec copies exactly)

**Status:** backlog

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
  (`DECIMAL(10,3)` / `DECIMAL(10,6)`, both nullable, both commented "from manifest, may be
  inaccurate"). The Easy connector's `column_map` seed in that same migration maps
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
   nothing recomputes the arithmetic locally, for the same reason spec-68 gave: "cuatro pantallas la
   leen; escrita cuatro veces se desincroniza a la primera."

4. **Capacity is also learned, not only typed.** Every time a route is sealed (spec-70's `/seal`,
   entered when zero dispatches remain `planned`), the loaded package count (and, where tier-2 data
   is present, volume/weight) for that vehicle is recorded. A rolling empirical p90 across a
   vehicle's sealed loads is computed and shown alongside the manager's typed `capacity_packages` —
   not in place of it. This does not replace tier 1; a manager's typed number is still what drives
   the fill bar and the blocking-free top-up suggestions, because the p90 needs sealed history to
   exist at all and a new or rarely-used vehicle has none. The p90 is a second, quieter number: "you
   said 200, your last 12 loads averaged 174" is exactly the signal that lets a manager correct a
   guessed capacity without a new measurement device.

5. **Top-up rules — all five required, none optional:**

   1. **Adjacent andenes only.** Adjacency is a one-time, manually configured table —
      `dock_zone_adjacency`, listing which andén pairs are geographically next to each other. Santiago
      comuna geography is static, so this table is populated once by an operator and rarely touched
      again. It is deliberately **not** derived from geocoding or coordinates — there is no lat/lng
      anywhere on `dock_zones` or `chile_comunas` (`chile_comunas` carries `codigo_cut`, `nombre`,
      `provincia`, `region`, `region_num` — no coordinates; see
      `20260321000001_chile_comunas_normalization.sql`), so adjacency has to be a fact someone states,
      not one the system derives.
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
  CONSTRAINT dock_zone_adjacency_not_self CHECK (dock_zone_id <> adjacent_zone_id),
  CONSTRAINT unique_dock_zone_adjacency_pair UNIQUE (operator_id, dock_zone_id, adjacent_zone_id)
);

-- learned capacity: one row per sealed route, feeding the empirical p90
CREATE TABLE public.vehicle_load_samples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  vehicle_id       UUID NOT NULL REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
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
  `DockCapacityBar`.
- **Phase 3 — Adjacency management.** A settings screen (flat table UI, no map) for configuring
  `dock_zone_adjacency` pairs. Manager-only, per the same role gate spec-68 used for manual dock
  assignment (`ops_leader`/`admin`/`operations_manager`, to be confirmed against the current
  permission set at implementation time rather than assumed here).
- **Phase 4 — Top-up suggestions and the move task.** Computes candidate adjacent blocks under-fill
  routes could borrow (respecting the cap in Decision 5.4 and the `max_drops` check in Decision 6),
  surfaces them to a manager, and on acceptance creates the scan-confirmed move task described in
  Decision 5.5 — built on spec-71's staging-scan mechanism and spec-72's block concept, but shippable
  before either of those specs lands, since a "move task" here can start as a manual checklist entry
  and be wired to spec-71's actual scan flow once that exists.
- **Phase 5 — Tier 2 (cubication).** Once `orders.total_volume_m3`/`total_weight_kg` are actually
  populated for a given retailer/connector (a separate, connector-specific decision this spec does
  not make — see Non-Goals), extend `vehicle-capacity.ts` to prefer volume/weight-aware fill over
  package-count fill for routes where every order carries both figures, falling back to tier 1
  per-route otherwise.
- **Phase 6 — Learned capacity.** Write a `vehicle_load_samples` row on every successful `/seal`
  (spec-70's seal event). Compute and display the rolling p90 alongside the manager's typed
  `capacity_packages` wherever the fill bar renders.

## Open questions for implementation

- Which role(s) can configure `dock_zone_adjacency` and edit `max_drops` — confirm against the
  current permission set rather than assuming `ops_leader` covers it.
- Whether `dock_zone_adjacency` is stored symmetrically or directionally (see Data model note) —
  decide when phase 3 is scoped.
- The exact retailer/connector path that would populate `orders.total_volume_m3` for tier 2 is
  explicitly not decided here; phase 5 is blocked on that separate decision, not on anything in this
  spec's own phases 1–4.
