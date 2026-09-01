-- =============================================================================
-- spec-73 phase 1 — capacity ladder data model: fleet_vehicles.capacity_packages,
-- routes.max_drops, dock_zone_adjacency, vehicle_load_samples.
--
-- Client was explicit and the spec's Goal repeats it: capacity parameters
-- must be OPTIONAL and must NEVER block the workflow. Every column this
-- migration adds is nullable, has no CHECK forcing a value to be present or
-- positive, and an unconfigured vehicle/route behaves exactly as it does
-- today — no fill bar, no cap, no suggestion, never a bar pinned at 0%. This
-- migration copies spec-68's dock_zones.capacity precedent verbatim (see
-- 20260824000005's header comment for the reasoning): a CHECK would turn a
-- harmless mis-keyed negative into a hard failure instead of a value the UI
-- already knows how to ignore; the defensive floor lives in the arithmetic
-- module (lib/dispatch/vehicle-capacity.ts, phase 2), not the schema.
--
-- Template for table + RLS + soft-delete shape:
-- 20260827000001_spec71_load_positions.sql (load_positions) and
-- 20260812000001_spec52_vehicles_table.sql (vehicles) — the repo's canonical
-- instances of this pattern.
--
-- Four objects, all additive, none blocking:
--   1. fleet_vehicles.capacity_packages — tier 1's typed number.
--   2. routes.max_drops — the independent drop-count hard cap (Decision 6).
--   3. dock_zone_adjacency — one-time manual andén-pair table for top-up
--      candidate selection (Decision 5.1). Phase 1 only creates the table;
--      no reader exists yet (that's phase 4).
--   4. vehicle_load_samples — append-only per-seal demand signal (Decision
--      4). Phase 1 only creates the table; nothing writes to it yet
--      (that's phase 6, hooked to spec-70's /seal event).
--
-- Code-review correction (phase 1, post-review): vehicle_load_samples.
-- vehicle_id was originally NOT NULL. That is unsatisfiable at seal time in
-- the current codebase — routes.vehicle_id is written only by the dispatch
-- handler (app/api/dispatch/routes/[id]/dispatch/route.ts), which itself
-- refuses unless the route is already 'loaded', i.e. already sealed
-- (seal-route.ts's SEALABLE_FROM is draft/planned/loading). Spec-70 phase 3
-- was assumed to provide a pre-seal vehicle assignment; it landed
-- (20260825000004) and does not. So when phase 6 writes a sample on every
-- successful /seal, routes.vehicle_id is NULL for every route today.
-- vehicle_id is therefore nullable here: a sample with an unknown vehicle
-- is still a usable observation of "this load fitted," while a NOT NULL
-- that can only be satisfied by refusing the seal is exactly the "must
-- never block the workflow" failure this spec forbids. See
-- docs/specs/spec-73-capacity-ladder-truck-topup.md (phase 6 note) for the
-- full reasoning and the options for phase 6 to attribute a NULL-vehicle
-- sample later.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. fleet_vehicles.capacity_packages — tier 1
-- ---------------------------------------------------------------------------

ALTER TABLE public.fleet_vehicles
  ADD COLUMN IF NOT EXISTS capacity_packages INT;

COMMENT ON COLUMN public.fleet_vehicles.capacity_packages IS
  'spec-73 tier 1. Max packages this vehicle can carry, set by eye by a '
  'manager. NULL means "not configured": lib/dispatch/vehicle-capacity.ts '
  '(phase 2) and everything built on it render no fill bar, no under-fill '
  'flag, no top-up suggestion sizing for it — never a bar pinned at 0%. '
  'Zero or negative values are treated the same as NULL by that module; '
  'deliberately no CHECK constraint, mirroring 20260824000005 '
  '(dock_zones.capacity) for the same reasoning. NEVER add this column to '
  'the DispatchTrack webhook upsert payload in '
  'apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json — that '
  'upsert uses Prefer: resolution=merge-duplicates and only overwrites '
  'columns present in its body; including this one would silently null '
  'out every manager-typed capacity on the next webhook event for that '
  'vehicle.';

-- ---------------------------------------------------------------------------
-- 2. routes.max_drops — independent hard cap (Decision 6)
-- ---------------------------------------------------------------------------

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS max_drops INT;

COMMENT ON COLUMN public.routes.max_drops IS
  'spec-73 Decision 6. Optional cap on delivery stops for this route, '
  'independent of vehicle capacity. NULL means unconfigured — no cap '
  'enforced, no warning shown. Exists because a full truck can still be a '
  'bad route if it takes too many hours: fill rate is a cost metric, '
  'cost-per-drop is the real one. No CHECK constraint, same reasoning as '
  'fleet_vehicles.capacity_packages above — a defensive floor belongs in '
  'the arithmetic module that reads this, not the schema.';

-- ---------------------------------------------------------------------------
-- 3. dock_zone_adjacency — one-time manual andén-pair table (Decision 5.1)
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT derived from geocoding or coordinates — dock_zones has
-- no lat/lng, and chile_comunas.geometry, though present, has never been
-- populated by any writer in this repo (spec-73 Decision 5.1). Santiago
-- comuna geography is static, so this is a flat table an operator populates
-- once and rarely touches again — no map, no drag-and-drop (spec's
-- Non-Goals).
--
-- Directional in storage: a row for A->B does not imply B->A. The spec
-- flags this explicitly as undecided (whether the write path stores both
-- directions or treats the table as symmetric at read time is a phase-3
-- UI-scoping decision, not a phase-1 one) — this migration does not guess;
-- it only makes both directions representable and lets phase 3 decide how
-- to write them.
CREATE TABLE IF NOT EXISTS public.dock_zone_adjacency (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  dock_zone_id      UUID NOT NULL REFERENCES public.dock_zones(id) ON DELETE CASCADE,
  adjacent_zone_id  UUID NOT NULL REFERENCES public.dock_zones(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT dock_zone_adjacency_not_self CHECK (dock_zone_id <> adjacent_zone_id)
);

-- Partial unique index, not a table-level UNIQUE constraint — the repo
-- convention for soft-deleted tables (idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate, unique_load_position_code_per_operator). A
-- table-level UNIQUE would refuse to let a soft-deleted adjacency pair be
-- reconfigured later under the same zone pair.
CREATE UNIQUE INDEX IF NOT EXISTS unique_dock_zone_adjacency_pair
  ON public.dock_zone_adjacency (operator_id, dock_zone_id, adjacent_zone_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dock_zone_adjacency_operator_id
  ON public.dock_zone_adjacency (operator_id)
  WHERE deleted_at IS NULL;

-- Reverse-lookup index — phase 4's candidate search needs both "what is
-- adjacent to zone X" and "what considers zone X adjacent", and this table
-- is directional in storage (see header), so a lookup keyed on
-- adjacent_zone_id is not served by the composite unique index above (whose
-- leading column is dock_zone_id).
CREATE INDEX IF NOT EXISTS idx_dock_zone_adjacency_adjacent_zone_id
  ON public.dock_zone_adjacency (adjacent_zone_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.dock_zone_adjacency ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY dock_zone_adjacency_operator_isolation ON public.dock_zone_adjacency
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.dock_zone_adjacency TO authenticated;
REVOKE ALL ON public.dock_zone_adjacency FROM anon;
GRANT ALL ON public.dock_zone_adjacency TO service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_dock_zone_adjacency
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_zone_adjacency
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.dock_zone_adjacency IS
  'spec-73 Decision 5.1. One-time, manually configured andén-pair '
  'adjacency, feeding phase 4''s top-up candidate search. Deliberately not '
  'derived from geocoding/coordinates — see migration header. Directional: '
  'a row for (dock_zone_id, adjacent_zone_id) does not imply the reverse '
  'row exists. No reader exists yet; this migration only creates the table.';

COMMENT ON COLUMN public.dock_zone_adjacency.dock_zone_id IS
  'spec-73. The andén this row is stated from. Paired with '
  'adjacent_zone_id under unique_dock_zone_adjacency_pair, scoped per '
  'operator so two tenants can never collide on the same dock_zones ids '
  '(which are themselves already operator-scoped).';

COMMENT ON COLUMN public.dock_zone_adjacency.adjacent_zone_id IS
  'spec-73. The andén stated to be adjacent to dock_zone_id. Whether the '
  'reverse pair is also stored, or the table is treated as symmetric at '
  'read time, is left to phase 3 (adjacency management UI) — not decided '
  'here.';

-- Direction hazard, probed post-review and confirmed to match the
-- documented "directional in storage" design (not a defect): (A,B) and
-- (B,A) can both exist as live rows — only self-pairs and exact duplicates
-- are prevented. A phase-4 symmetric read must therefore be
-- `WHERE dock_zone_id = X OR adjacent_zone_id = X` WITH DISTINCT, since a
-- pair stored in both directions returns the neighbour twice. If phase 3's
-- write path stores only one direction while phase 4's read only checks
-- one column, top-up candidates go silently asymmetric (zone X sees zone Y
-- as a candidate but not vice versa) with no error to surface it. Phase 3
-- and phase 4 must agree on write direction(s) and read shape together.

-- ---------------------------------------------------------------------------
-- 4. vehicle_load_samples — append-only learned demand signal (Decision 4)
-- ---------------------------------------------------------------------------
--
-- One row per sealed route, feeding an empirical p90. Append-only,
-- intentionally not upserted per vehicle: the p90 needs the distribution,
-- not a running average, and an append-only table gives a free audit trail
-- of what actually left the dock over time. This is a DEMAND signal, not a
-- learned capacity — it measures what a vehicle has actually been asked to
-- carry, never what it can carry (spec-73 Decision 4). No reader or writer
-- exists yet; phase 6 hooks this to spec-70's /seal event.
CREATE TABLE IF NOT EXISTS public.vehicle_load_samples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  -- Nullable — see the header's code-review correction. routes.vehicle_id
  -- is NULL for every route at seal time in the current codebase, so a
  -- NOT NULL here would either raise 'null value in column "vehicle_id"'
  -- at the dock on every seal, or force phase 6 to silently skip writing
  -- the sample. Neither is acceptable: a sample with an unknown vehicle is
  -- still a usable observation of "this load fitted."
  vehicle_id       UUID REFERENCES public.fleet_vehicles(id) ON DELETE CASCADE,
  route_id         UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  package_count    INT NOT NULL,
  total_volume_m3  DECIMAL(10,6),   -- null unless every order on the route had tier-2 data
  total_weight_kg  DECIMAL(10,3),   -- null unless every order on the route had tier-2 data
  sealed_at        TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- deleted_at is included for the project's non-negotiable soft-delete rule
-- (CLAUDE.md), even though Decision 4's append-only design gives this table
-- no ordinary write path that would ever set it — a correction requires an
-- explicit administrative soft-delete, not a routine app-layer UPDATE.

CREATE INDEX IF NOT EXISTS idx_vehicle_load_samples_operator_id
  ON public.vehicle_load_samples (operator_id)
  WHERE deleted_at IS NULL;

-- Phase 6's p90 query is keyed on "this vehicle's sealed samples, most
-- recent first" — this is that access path.
CREATE INDEX IF NOT EXISTS idx_vehicle_load_samples_vehicle_sealed
  ON public.vehicle_load_samples (vehicle_id, sealed_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_load_samples_route_id
  ON public.vehicle_load_samples (route_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.vehicle_load_samples ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY vehicle_load_samples_operator_isolation ON public.vehicle_load_samples
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- GRANT SELECT, INSERT (omitting UPDATE/DELETE) does NOT by itself make
-- this table append-only: Supabase's project-wide `ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ON TABLES TO authenticated` already grants
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE/... on every new table before this
-- migration runs, and the FOR ALL RLS policy above then permits in-tenant
-- UPDATE/DELETE regardless of this explicit (redundant) grant. This is
-- true of every table in the repo (load_positions, dock_zones, vehicles,
-- route_blocks are identical) — not a defect introduced here, and not
-- fixed here; a real append-only guarantee would need a trigger or a
-- narrower default-privileges policy, out of scope for phase 1. The
-- REVOKE ALL ... FROM anon line below IS real and load-bearing: anon has
-- no default grant to revoke from at the project level for this table, so
-- this statement is what actually keeps anon off it.
GRANT SELECT, INSERT ON public.vehicle_load_samples TO authenticated;
REVOKE ALL ON public.vehicle_load_samples FROM anon;
GRANT ALL ON public.vehicle_load_samples TO service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_vehicle_load_samples
    AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_load_samples
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.vehicle_load_samples IS
  'spec-73 Decision 4. One row per sealed route (spec-70''s /seal), '
  'append-only, feeding an empirical p90 of observed load history per '
  'vehicle. This is a DEMAND signal, not a learned capacity: a route can '
  'seal well under a vehicle''s true ceiling, so this measures what the '
  'vehicle has actually been asked to carry, never what it can carry. UI '
  'copy consuming this MUST say "observed load history" / "demand", never '
  '"measured capacity", and must show it alongside (never in place of) '
  'fleet_vehicles.capacity_packages. No writer exists yet — phase 6 (app '
  'layer) hooks this to the /seal event. vehicle_id is nullable: '
  'routes.vehicle_id is NULL for every route at seal time in the current '
  'codebase (see migration header), so phase 6 must tolerate a NULL '
  'vehicle_id here and attribute the sample later rather than skip the '
  'write or block the seal.';

COMMENT ON COLUMN public.vehicle_load_samples.total_volume_m3 IS
  'spec-73. NULL unless every order on the sealed route had '
  'orders.total_volume_m3 populated (tier 2). Most rows will be NULL for '
  'the foreseeable future — tier-2 ingestion is a separate, '
  'connector-specific decision this spec does not make (see Non-Goals).';

COMMENT ON COLUMN public.vehicle_load_samples.total_weight_kg IS
  'spec-73. NULL unless every order on the sealed route had '
  'orders.total_weight_kg populated (tier 2). See total_volume_m3 comment.';

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fleet_vehicles' AND column_name = 'capacity_packages'
  ) THEN
    RAISE EXCEPTION 'fleet_vehicles.capacity_packages not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routes' AND column_name = 'max_drops'
  ) THEN
    RAISE EXCEPTION 'routes.max_drops not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dock_zone_adjacency'
  ) THEN
    RAISE EXCEPTION 'dock_zone_adjacency table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.dock_zone_adjacency'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on dock_zone_adjacency';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.dock_zone_adjacency'::regclass
      AND conname = 'dock_zone_adjacency_not_self'
  ) THEN
    RAISE EXCEPTION 'dock_zone_adjacency_not_self CHECK not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicle_load_samples'
  ) THEN
    RAISE EXCEPTION 'vehicle_load_samples table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vehicle_load_samples'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on vehicle_load_samples';
  END IF;
  RAISE NOTICE '✓ spec-73 phase 1 (capacity ladder data model) migration complete';
END $$;

COMMIT;
