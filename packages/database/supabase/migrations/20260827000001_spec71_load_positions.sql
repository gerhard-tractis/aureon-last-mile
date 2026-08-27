-- spec-71 phase 1 — load_positions table, routes occupancy columns,
-- dock_scans.load_position_id.
--
-- Template for table + RLS + soft-delete shape: 20260812000001_spec52_vehicles_table.sql
-- (vehicles) and 20260319000001_create_distribution_tables.sql (dock_zones) —
-- the repo's two canonical instances of this pattern.
--
-- On the routes column set (assigned_at/released_at/assigned_by/released_by):
-- the Data-model note in spec-71 asks this to be settled against spec-70
-- phase 3's audit convention. Spec-70 phase 3 (20260825000004,
-- "seal, dispatch, delete, manager-only removal", a8d2505 / PR #552) HAS
-- landed and is an ancestor of this branch. Its actual convention is an
-- app-layer `supabase.from('audit_logs').insert(...)` for the actor, plus a
-- domain column on the row (dispatches.removal_reason) — deliberately with
-- no removed_by column. That pulls against a dedicated actor column here.
--
-- But spec-70 phase 1's dispatches.staged_by (20260825000002) is the
-- precedent that cuts the other way: a dedicated actor column for a
-- physical-confirmation event, even though every table here also carries
-- the generic audit_trigger_func -> audit_logs trail. Assignment and
-- release of a load position are judged physical-confirmation events like
-- staging, not removal events, so they follow staged_by and get their own
-- actor columns here. Phase 2 (the app layer that writes these columns)
-- must additionally write audit_logs rows for assign/release, matching
-- phase 3's convention for those events too — both conventions apply, not
-- either.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. load_positions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.load_positions (
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
-- convention for soft-deleted tables (idx_dock_zones_operator_code,
-- uniq_vehicles_operator_plate). A table-level UNIQUE would refuse to let an
-- operator soft-delete a position and later reuse its code for a new one.
CREATE UNIQUE INDEX IF NOT EXISTS unique_load_position_code_per_operator
  ON public.load_positions (operator_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_load_positions_operator_active
  ON public.load_positions (operator_id, is_active)
  WHERE deleted_at IS NULL;

ALTER TABLE public.load_positions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY load_positions_operator_isolation ON public.load_positions
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.load_positions TO authenticated;
REVOKE ALL ON public.load_positions FROM anon;
GRANT ALL ON public.load_positions TO service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_load_positions
    AFTER INSERT OR UPDATE OR DELETE ON public.load_positions
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_load_positions_updated_at
    BEFORE UPDATE ON public.load_positions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.load_positions IS
  'spec-71. One physical dock spot a route''s load occupies, fed from many '
  'andenes (dock_zones). Long-lived and reused across waves — occupancy by a '
  'specific route is a separate, time-bounded fact on routes.load_position_id, '
  'not a status on this table.';

COMMENT ON COLUMN public.load_positions.is_active IS
  'Temporarily out of service (still visible in history). Independent of '
  'deleted_at, which means the position is gone from the physical dock.';

-- ---------------------------------------------------------------------------
-- 2. routes: occupancy columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS load_position_id          UUID REFERENCES public.load_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_position_assigned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS load_position_assigned_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_position_released_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS load_position_released_by  UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.routes.load_position_id IS
  'spec-71. The load_positions row this route''s load currently occupies, or '
  'most recently occupied. NULL only when the route has never been assigned '
  'a position. On release this is LEFT SET (not cleared) so it still records '
  'which position was released; load_position_released_at is stamped '
  'instead. Occupied = load_position_id IS NOT NULL AND '
  'load_position_released_at IS NULL AND deleted_at IS NULL.';

COMMENT ON COLUMN public.routes.load_position_assigned_by IS
  'spec-71. The user who assigned this route to its position, mirroring '
  'dispatches.staged_by''s actor-column convention (spec-70 phase 1) for a '
  'physical-confirmation event.';

COMMENT ON COLUMN public.routes.load_position_released_by IS
  'spec-71. The user who released this route from its position.';

-- One position can be occupied by at most one un-released route at a time.
-- A route occupies its position while load_position_id IS NOT NULL AND
-- load_position_released_at IS NULL AND deleted_at IS NULL — the partial
-- index below enforces exactly that triple, globally on load_position_id. A
-- plain index (not additionally scoped to operator_id) is still correct: a
-- load_positions row already belongs to exactly one operator, so uniqueness
-- on the FK column alone can never let two operators collide on "the same
-- position".
--
-- CONTRACT for phase 2: re-assigning a route to a new position (or
-- re-assigning it back to the same one after release) MUST reset
-- load_position_released_at = NULL alongside setting
-- load_position_assigned_at/load_position_assigned_by. load_position_id is
-- LEFT SET on release (see the column comment above), so a row with a stale
-- non-NULL released_at is what keeps it out of this index; forgetting to
-- clear released_at on re-assignment leaves the row silently unprotected.
CREATE UNIQUE INDEX IF NOT EXISTS unique_route_per_active_load_position
  ON public.routes (load_position_id)
  WHERE load_position_id IS NOT NULL
    AND load_position_released_at IS NULL
    AND deleted_at IS NULL;

-- Phase 2 must never produce a row where released_at is set but
-- load_position_id is NULL (that would silently defeat the occupancy index
-- above by discarding which position was released), and never a row where
-- assigned_at is NULL but load_position_id is set (an occupancy fact with no
-- record of when it started).
DO $$ BEGIN
  ALTER TABLE public.routes
    ADD CONSTRAINT routes_load_position_released_requires_id_chk
    CHECK (load_position_released_at IS NULL OR load_position_id IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.routes
    ADD CONSTRAINT routes_load_position_assigned_at_requires_id_chk
    CHECK (load_position_assigned_at IS NOT NULL OR load_position_id IS NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. dock_scans: per-package staging audit trail
-- ---------------------------------------------------------------------------
--
-- Nullable, alongside the existing dock_zone_id (20260504000002). Kept
-- because routes.load_position_id is reassigned as positions are reused
-- across waves — the same position row backs a different route each time
-- it is occupied — so a per-scan record is the only stable per-package fact
-- of "which position did this package land in"; reading it off the route
-- later would give whichever route currently (or most recently) holds that
-- position, not necessarily the one this package was staged under.

ALTER TABLE public.dock_scans
  ADD COLUMN IF NOT EXISTS load_position_id UUID REFERENCES public.load_positions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dock_scans_load_position_id
  ON public.dock_scans (load_position_id)
  WHERE load_position_id IS NOT NULL;

COMMENT ON COLUMN public.dock_scans.load_position_id IS
  'spec-71. The load_positions row this scan staged the package into, '
  'alongside the existing dock_zone_id (andén scan). Nullable: only staging '
  'scans against a position set this; ordinary andén scans leave it NULL.';

COMMIT;
