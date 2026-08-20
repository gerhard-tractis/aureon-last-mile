-- =============================================================================
-- spec-61 Task 1 — pickup_route_crew, and pickup_leader's permission default
-- =============================================================================
-- Several people work one pickup trip. `pickup_routes.driver_id` keeps meaning
-- THE LEADER and is unchanged; everyone else on the trip is a row here.
--
-- Depends on 20260820000001 having COMMITTED (it adds 'pickup_leader' to
-- user_role, which the handle_new_user CASE below names). Separate files, not
-- style: see that file's header.
--
-- Safe on live data: a brand-new table has no rows, so the unique index below
-- cannot abort the deploy the way a constraint over existing rows can (the
-- spec-56 lesson). Nothing existing is altered except the handle_new_user
-- function body, which only affects users created AFTER this runs.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.pickup_route_crew (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  pickup_route_id UUID NOT NULL REFERENCES public.pickup_routes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id),
  added_by        UUID NOT NULL REFERENCES public.users(id),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.pickup_route_crew IS
  'Who besides the leader is on a pickup trip (spec-61). The leader is '
  'pickup_routes.driver_id and is deliberately NOT a row here. The crew is '
  'fixed when the route opens: start_pickup_route inserts these rows in the '
  'same transaction as the route and nothing else ever inserts one.';

COMMENT ON COLUMN public.pickup_route_crew.removed_at IS
  'Set when the route stops being in_progress, by trg_pickup_route_crew_sync. '
  'It is the ACTIVE-SEAT marker that uniq_pickup_route_crew_one_active_per_user '
  'reads -- an index predicate cannot contain a subquery, so the route''s '
  'activeness has to live on the crew row. Do not write it by hand.';

CREATE INDEX IF NOT EXISTS idx_pickup_route_crew_route
  ON public.pickup_route_crew(pickup_route_id);
CREATE INDEX IF NOT EXISTS idx_pickup_route_crew_user
  ON public.pickup_route_crew(operator_id, user_id);
CREATE INDEX IF NOT EXISTS idx_pickup_route_crew_deleted_at
  ON public.pickup_route_crew(deleted_at);

-- One active seat per person per operator -- the crew twin of
-- uniq_pickup_routes_one_active_per_driver (20260812000003:109).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_route_crew_one_active_per_user
  ON public.pickup_route_crew(operator_id, user_id)
  WHERE removed_at IS NULL AND deleted_at IS NULL;

-- ── removed_at follows the route's status ──────────────────────────────────
-- One trigger instead of edits to close_pickup_route / cancel_pickup_route /
-- complete_route_reception / reopen_pickup_route / the receptionist trigger:
-- they all write pickup_routes.status, and a new closing path cannot forget it.
CREATE OR REPLACE FUNCTION public.sync_pickup_route_crew_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.status <> 'in_progress' THEN
    UPDATE public.pickup_route_crew
       SET removed_at = NOW()
     WHERE pickup_route_id = NEW.id
       AND removed_at IS NULL
       AND deleted_at IS NULL;
    RETURN NEW;
  END IF;

  -- Back to in_progress (reopen_pickup_route, 20260812000005:185, and the
  -- receptionist trigger's undo). Restore only seats whose holder is not
  -- already active somewhere else: a raw restore would hit the unique index
  -- and abort the receptionist's reopen with a 23505 on someone else's data.
  --
  -- KNOWN LIMITATION: when the holder IS active elsewhere, this branch
  -- silently skips restoring their seat and nothing retries -- that person
  -- is left off the reopened route with no way back on except being re-added
  -- by hand. Accepted so a reopen can never abort with a 23505; see spec-61
  -- Task 1.2 test 5.
  UPDATE public.pickup_route_crew c
     SET removed_at = NULL
   WHERE c.pickup_route_id = NEW.id
     AND c.removed_at IS NOT NULL
     AND c.deleted_at IS NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.pickup_route_crew o
            WHERE o.operator_id = c.operator_id
              AND o.user_id     = c.user_id
              AND o.removed_at IS NULL
              AND o.deleted_at IS NULL);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pickup_route_crew_sync ON public.pickup_routes;
CREATE TRIGGER trg_pickup_route_crew_sync
  AFTER UPDATE ON public.pickup_routes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.sync_pickup_route_crew_seats();

-- ── RLS: the sibling shape (20260812000001:33-49) ──────────────────────────
ALTER TABLE public.pickup_route_crew ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY pickup_route_crew_tenant_isolation ON public.pickup_route_crew
    FOR ALL USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SELECT only, deliberately. Nothing in the frontend writes this table:
-- start_pickup_route and the route-status trigger are both SECURITY
-- DEFINER and bypass these grants. Granting INSERT/UPDATE here would let
-- any authenticated user of the operator seat themselves on any route
-- over PostgREST, or UPDATE removed_at to free their own seat — which
-- would falsify the "exactly one writer" property the one-active-seat
-- index depends on. vehicles grants INSERT/UPDATE because it IS written
-- from the UI; this table is not, so do not copy that shape.
GRANT SELECT ON public.pickup_route_crew TO authenticated;
REVOKE ALL ON public.pickup_route_crew FROM anon;
GRANT ALL ON public.pickup_route_crew TO service_role;

DO $$ BEGIN
  CREATE TRIGGER audit_pickup_route_crew_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.pickup_route_crew
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Role defaults: pickup_leader ───────────────────────────────────────────
-- Template: the LIVE definition, 20260811000001_align_permission_vocabulary.sql:70.
-- The only change is the pickup_leader line. A leader does the same work as
-- pickup_crew plus route creation, and route creation is gated by ROLE in
-- start_pickup_route (20260820000003), not by a permission token -- so the
-- permission set is identical to pickup_crew's on purpose.
-- Its frontend twin is ROLE_DEFAULT_PERMISSIONS in
-- apps/frontend/src/lib/permissions.ts:38 -- change both together.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_operator_id UUID;
  v_role user_role;
  v_full_name VARCHAR(255);
  v_permissions TEXT[];
BEGIN
  v_operator_id := (NEW.raw_app_meta_data->>'operator_id')::uuid;

  IF v_operator_id IS NULL THEN
    RAISE EXCEPTION 'User creation failed: operator_id required in signup metadata';
  END IF;

  v_role := COALESCE((NEW.raw_app_meta_data->>'role')::user_role, 'pickup_crew');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);

  v_permissions := CASE v_role::text
    WHEN 'pickup_crew'        THEN ARRAY['pickup']
    WHEN 'pickup_leader'      THEN ARRAY['pickup']
    WHEN 'warehouse_staff'    THEN ARRAY['reception','distribution']
    WHEN 'loading_crew'       THEN ARRAY['distribution','dispatch']
    WHEN 'operations_manager' THEN ARRAY['pickup','reception','distribution','dispatch','customer_service']
    WHEN 'admin'              THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
    WHEN 'super_admin'        THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
    ELSE ARRAY[]::text[]
  END;

  INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
  VALUES (NEW.id, v_operator_id, v_role, NEW.email, v_full_name, v_permissions);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'User creation failed: %', SQLERRM;
END;
$function$;

COMMIT;
