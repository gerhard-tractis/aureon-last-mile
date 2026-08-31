-- spec-72 phase 1 — route_blocks table, dispatches.actual_sequence.
--
-- Scope: DATA MODEL ONLY, per spec-72's phase breakdown. Nothing populates
-- route_blocks yet (phase 2, the Pre-ruta/route-builder writer), nothing
-- reorders it (phase 3, the manager review UI), nothing reads
-- routes.driver_name for territory stability (phase 4, blocked on spec-70
-- phase 3), and nothing computes actual_sequence (phase 5, the DispatchTrack
-- webhook / scheduled pass). This migration only lays the columns those
-- phases write to.
--
-- Template for table + RLS + soft-delete shape: 20260812000001_spec52_vehicles_table.sql
-- (vehicles) and 20260319000001_create_distribution_tables.sql (dock_zones) —
-- the repo's two canonical instances of this pattern, same ones spec-71
-- phase 1 cites.
--
-- route_blocks is NOT the load_positions/vehicles style of "long-lived
-- resource occupied over time" — it is a per-route ordering fact, closer in
-- shape to dispatches.planned_sequence itself: one row per (route, comuna),
-- reordered by plain UPDATE of sequence_index, never migrated.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. route_blocks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.route_blocks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  route_id         UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  comuna_id        UUID NOT NULL REFERENCES public.chile_comunas(id),
  sequence_index   INTEGER NOT NULL,        -- 1-based position within this route's block list
  sequence_source  TEXT NOT NULL DEFAULT 'default'
                     CHECK (sequence_source IN ('default','manual','optimizer')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);

-- Partial unique index, not a table-level UNIQUE constraint — the repo
-- convention for soft-deleted tables (idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate, unique_load_position_code_per_operator). A
-- table-level UNIQUE would refuse to let a soft-deleted block's comuna be
-- reused by a new block on the same route.
CREATE UNIQUE INDEX IF NOT EXISTS unique_route_comuna_block
  ON public.route_blocks (route_id, comuna_id) WHERE deleted_at IS NULL;

-- sequence_index is a strict total order per live route (spec-72's "Open
-- questions" leaves the enforcement mechanism to this suite; a partial
-- unique index is the same tool already used above and for
-- unique_route_per_active_load_position in spec-71 — a manual reorder is a
-- normal UPDATE of this column, not a migration, and the index simply
-- refuses a route to land in an inconsistent state mid-write. A caller that
-- reorders a whole block list must do so inside one transaction (renumbering
-- via a temporary offset if needed), same requirement any strict-order
-- partial-unique-index table has.
CREATE UNIQUE INDEX IF NOT EXISTS unique_route_block_sequence
  ON public.route_blocks (route_id, sequence_index) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_route_blocks_operator_id
  ON public.route_blocks (operator_id);

ALTER TABLE public.route_blocks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY route_blocks_operator_isolation ON public.route_blocks
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.route_blocks TO authenticated;
REVOKE ALL ON public.route_blocks FROM anon;
GRANT ALL ON public.route_blocks TO service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_route_blocks
    AFTER INSERT OR UPDATE OR DELETE ON public.route_blocks
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_route_blocks_updated_at
    BEFORE UPDATE ON public.route_blocks
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.route_blocks IS
  'spec-72 phase 1. One block = one comuna within one route, ordered by '
  'sequence_index. The manager-reviewed structure a driver''s ~40 stops roll '
  'up into (3-6 blocks/route). A block''s order membership is NOT stored '
  'here — it is derived by joining dispatches -> orders on comuna_id, per '
  'the same "counts are derived, never incremented" rule spec-70 built '
  'route_stop_counts to enforce. Nothing populates this table yet: phase 2 '
  '(default sequencing from Pre-ruta/route builder) is the first writer.';

COMMENT ON COLUMN public.route_blocks.comuna_id IS
  'References chile_comunas directly, matching orders.comuna_id '
  '(20260321000001). An order whose comuna_id IS NULL (normalize_comuna_id '
  'failed to match) cannot join into any route_blocks row by design — spec-72 '
  'requires that order be surfaced separately as "sin comuna", never folded '
  'into a block or silently dropped from the route''s manifest. That surfacing '
  'is an app-layer/UI concern (phase 3), not a constraint this migration adds.';

COMMENT ON COLUMN public.route_blocks.sequence_index IS
  '1-based position within this route''s block list. Reordering is a plain '
  'UPDATE of this column (spec-72: "not a migration"). unique_route_block_sequence '
  'enforces a strict total order per live route.';

COMMENT ON COLUMN public.route_blocks.sequence_source IS
  'Provenance, not correctness (spec-72 Decision 2). ''default'' = comuna '
  'order as it came off Pre-ruta/the route builder (phase 2, day-one '
  'behaviour). ''manual'' = a manager reordered it (phase 3). ''optimizer'' is '
  'reserved for a future automated writer over this same structure — '
  'sidecar/or-tools/ stays unwired in this spec (Non-Goals); the value exists '
  'so that day needs no schema change, only a new writer.';

-- ---------------------------------------------------------------------------
-- 2. dispatches: derived actual-arrival sequence
-- ---------------------------------------------------------------------------
--
-- Separate column from planned_sequence (provider-sourced, inbound-only per
-- spec-72 Decision 3) so neither writer ever overwrites the other's meaning.
-- Nothing computes this yet: phase 5 (webhook/scheduled pass over completed
-- routes) is the first writer, ordering by arrived_at (fallback
-- completed_at) once a route reaches 'completed'.

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS actual_sequence INTEGER;

COMMENT ON COLUMN public.dispatches.actual_sequence IS
  'spec-72 phase 1 (column only; phase 5 is the writer). Derived from '
  'arrived_at (fallback completed_at) ordering within the route, once the '
  'route completes. Never written by the planning flow -- planned_sequence '
  'and route_blocks.sequence_index are the plan; this is what happened.';

-- ---------------------------------------------------------------------------
-- 3. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'route_blocks'
  ) THEN
    RAISE EXCEPTION 'route_blocks table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.route_blocks'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on route_blocks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.route_blocks'::regclass
       AND polname  = 'route_blocks_operator_isolation'
  ) THEN
    RAISE EXCEPTION 'route_blocks_operator_isolation policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.route_blocks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%sequence_source%'
  ) THEN
    RAISE EXCEPTION 'route_blocks sequence_source CHECK missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'route_blocks'
      AND indexname = 'unique_route_comuna_block'
  ) THEN
    RAISE EXCEPTION 'unique_route_comuna_block index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'route_blocks'
      AND indexname = 'unique_route_block_sequence'
  ) THEN
    RAISE EXCEPTION 'unique_route_block_sequence index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dispatches' AND column_name = 'actual_sequence'
  ) THEN
    RAISE EXCEPTION 'dispatches.actual_sequence not created';
  END IF;
  RAISE NOTICE '✓ spec-72 phase 1 (route_blocks, dispatches.actual_sequence) migration complete';
END $$;

COMMIT;
