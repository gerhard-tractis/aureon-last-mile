-- spec-52 Task 1 — operator-owned vehicles table
--
-- Purely additive. Nothing references this table yet; later spec-52 tasks
-- add a FK from pickup_routes.vehicle_id -> vehicles.id.
--
-- Distinct from fleet_vehicles (DispatchTrack webhook sync mirror, all 84
-- production rows have a NULL plate_number, keyed on
-- UNIQUE(operator_id, provider, external_vehicle_id)): vehicles is
-- hand-managed by the operator and is never synced.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  plate        TEXT NOT NULL,
  vehicle_type TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_vehicles_operator_plate
  ON public.vehicles (operator_id, plate) WHERE deleted_at IS NULL;

-- Leads on plate (not just operator_id) so it covers the operator's active
-- vehicle list query, which filters on operator_id + active and sorts by
-- plate: WHERE operator_id=$1 AND active AND deleted_at IS NULL ORDER BY plate.
CREATE INDEX IF NOT EXISTS idx_vehicles_operator_active
  ON public.vehicles (operator_id, plate) WHERE active AND deleted_at IS NULL;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY vehicles_operator_isolation ON public.vehicles
    FOR ALL USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON public.vehicles TO authenticated;
REVOKE ALL ON public.vehicles FROM anon;
GRANT ALL ON public.vehicles TO service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_vehicles_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_vehicles_updated_at
    BEFORE UPDATE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE public.vehicles IS
  'Operator-owned pickup fleet (spec-52). Distinct from fleet_vehicles, which mirrors DispatchTrack delivery vehicles and carries no plate data.';

COMMENT ON COLUMN public.vehicles.plate IS
  'Free-text plate/registration string. Deliberately not named plate_number like fleet_vehicles.plate_number (that column is always NULL — a DispatchTrack sync artifact); normalization rules are decided at the RPC boundary, not here.';

COMMENT ON COLUMN public.vehicles.active IS
  'Independent of deleted_at: a soft-deleted row (deleted_at IS NOT NULL) can still carry active = true. Consumers must check both columns, not active alone.';

COMMIT;
