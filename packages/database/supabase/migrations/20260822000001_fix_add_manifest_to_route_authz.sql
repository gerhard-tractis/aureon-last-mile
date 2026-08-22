-- =============================================================================
-- Fix: add_manifest_to_route had no caller check
-- TEMPLATED ON THE LATEST DEFINITION: 20260625000001_spec47_pickup_routes_
-- consolidated_reception.sql:354. Verified 2026-08-22 by grepping every
-- migration for `FUNCTION public.add_manifest_to_route` -- that file is the
-- only definition. Everything below is byte-for-byte that body except the
-- DECLARE additions and the authorisation block, which are new.
--
-- WHAT WAS WRONG
-- The function checked `get_operator_id()`, that the route exists and is not
-- soft-deleted, and that its status is in_progress -- and NOTHING about the
-- caller. EXECUTE is granted to `authenticated` (20260625000001:608). Any
-- authenticated user of an operator could therefore attach a manifest to ANY
-- open pickup route in it: loading cargas onto a stranger's truck, which
-- reception then expects and the driver never had.
--
-- This is the mirror image of the hole spec-61 closed on cancel_pickup_route
-- (20260821000001) one day earlier, and it was found while specifying the
-- removal counterpart (spec-64). Same class of bug, same shape of fix.
--
-- WHO MAY ADD -- and why the list differs from cancel's, on purpose:
--   * the route's own driver (`pickup_routes.driver_id = auth.uid()`);
--   * an ACTIVE crew member of THAT route (`pickup_route_crew`, removed_at
--     IS NULL) -- cancel gives crew nothing, but adding a load to the truck
--     you are riding is the job, and spec-61 puts crew on this screen by
--     design (get_my_active_pickup_route, 20260820000005);
--   * operations_manager / admin / super_admin, keeping the operational
--     escape hatch cancel_pickup_route also keeps;
--   * a `pickup_leader` who is neither driver nor crew here gets nothing,
--     exactly as in cancel.
--
-- Test: packages/database/supabase/tests/add_manifest_to_route_authz.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.add_manifest_to_route(
  p_route_id    UUID,
  p_manifest_id UUID
) RETURNS public.manifests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator   UUID;
  v_caller     UUID;
  v_role       TEXT;
  v_route      public.pickup_routes;
  v_manifest   public.manifests;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;
  IF v_route.status <> 'in_progress' THEN
    RAISE EXCEPTION 'pickup route % is not in_progress (status=%)', p_route_id, v_route.status;
  END IF;

  -- ── AUTHORISATION (new) ──────────────────────────────────────────────────
  -- Deliberately NOT cancel_pickup_route's list (20260821000001). That one is
  -- driver-or-manager, and crew get nothing, because ending someone else's
  -- shift is not their call. Loading the truck they are riding IS: spec-61's
  -- get_my_active_pickup_route (20260820000005) returns the route to leader OR
  -- ACTIVE CREW precisely so crew reach /app/pickup/route/active and its
  -- AddManifestSheet. A driver-only gate here would break every crew member
  -- mid-shift. `pickup_leader` as a bare role still gets nothing: leading
  -- routes in general is not authority over this one.
  v_caller := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'no driver (sub) in JWT' USING ERRCODE = '42501';
  END IF;

  IF v_route.driver_id IS NULL OR v_route.driver_id <> v_caller THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pickup_route_crew c
       WHERE c.pickup_route_id = p_route_id
         AND c.user_id         = v_caller
         AND c.removed_at IS NULL
         AND c.deleted_at IS NULL
    ) THEN
      -- Role from public.users, not the JWT claim: the claim is minted at
      -- login, so a freshly promoted manager would still carry the old role.
      -- SECURITY DEFINER, so RLS does not hide the row.
      SELECT role::text INTO v_role FROM public.users
       WHERE id = v_caller AND operator_id = v_operator AND deleted_at IS NULL;

      IF v_role IS NULL
         OR v_role NOT IN ('operations_manager','admin','super_admin') THEN
        -- Spanish, because it reaches the picker verbatim: the frontend hook
        -- rethrows RPC messages unchanged (useAddManifestToRoute.ts).
        RAISE EXCEPTION 'Solo la tripulación de esta ruta puede agregarle cargas.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_manifest FROM public.manifests
   WHERE id = p_manifest_id AND operator_id = v_operator;
  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'manifest % not found', p_manifest_id;
  END IF;
  IF v_manifest.pickup_route_id IS NOT NULL AND v_manifest.pickup_route_id <> p_route_id THEN
    RAISE EXCEPTION 'manifest % already linked to another route %',
      p_manifest_id, v_manifest.pickup_route_id;
  END IF;

  UPDATE public.manifests
     SET pickup_route_id = p_route_id
   WHERE id = p_manifest_id
  RETURNING * INTO v_manifest;
  RETURN v_manifest;
END $$;

COMMENT ON FUNCTION public.add_manifest_to_route(UUID, UUID)
  IS 'Link a manifest to an in_progress pickup route (spec-47). Authorised callers: the route''s own driver_id, an active pickup_route_crew member of that route, or an operations_manager/admin/super_admin of the same operator. Crew are included here but NOT in cancel_pickup_route: loading the truck they ride is the job, ending the shift is not.';

-- Post-condition: the gate is present. Guards against a later CREATE OR
-- REPLACE templated on the spec-47 original silently dropping it again.
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'add_manifest_to_route';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'add_manifest_to_route(UUID, UUID) is missing';
  END IF;
  IF v_src NOT LIKE '%pickup_route_crew%'
     OR v_src NOT LIKE '%Solo la tripulación de esta ruta%' THEN
    RAISE EXCEPTION 'add_manifest_to_route lost its caller check!';
  END IF;
END $$;
