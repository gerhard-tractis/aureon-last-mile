-- =============================================================================
-- spec-64 Task 1 — remove_manifest_from_route: the missing counterpart to
-- add_manifest_to_route.
-- =============================================================================
-- add_manifest_to_route (20260625000001, authorisation fixed in
-- 20260822000001) lets the crew load a carga onto an open pickup route.
-- There has never been a way to take one back off: once attached, the only
-- paths off a manifest are closing/cancelling the whole route. This adds
-- the single-manifest removal, gated at zero verified pickup scans so a
-- carga someone already scanned into the truck cannot silently vanish.
--
-- WHO MAY REMOVE -- deliberately IDENTICAL to add_manifest_to_route's list,
-- not cancel_pickup_route's (20260821000001, driver-or-manager only, no
-- crew): loading and unloading the truck you are riding are the same kind of
-- job, and get_my_active_pickup_route (20260820000005) already puts crew on
-- this screen for the add flow.
--   * the route's own driver (`pickup_routes.driver_id = auth.uid()`);
--   * an ACTIVE crew member of THAT route (`pickup_route_crew`, removed_at
--     IS NULL);
--   * operations_manager / admin / super_admin, the same operational escape
--     hatch cancel_pickup_route keeps.
--   * a `pickup_leader` who is neither driver nor crew here gets nothing.
--
-- NOT ADDING ops_leader HERE: spec-66 (20260824000001..3) added that role but
-- did not touch add_manifest_to_route or cancel_pickup_route. Adding it only
-- to this new function would make the three diverge for no reason. Follow-up:
-- give all three ops_leader together.
--
-- THE RACE THIS FUNCTION'S "FOR UPDATE" CLOSES
-- usePickupScans inserts into pickup_scans directly from the browser, and
-- trg_pickup_scans_enforce_route_lock (20260812000005) deliberately ALLOWS a
-- scan when the manifest has no route yet ("NO ROUTE -> ALLOW" -- most
-- manifests are scanned before being attached to a route). Once this
-- function has read "no verified scans" but before it clears
-- pickup_route_id, that predicate is still true (the manifest still has a
-- route, just not for much longer) -- UNLESS a scan commits in that gap and
-- lands under a route with zero verified scans one line before this UPDATE
-- clears it. `SELECT ... FOR UPDATE` on the manifest row serializes against
-- any concurrent writer that also takes a lock reachable from that row; the
-- verified-scan EXISTS check and the UPDATE that clears pickup_route_id then
-- happen atomically with respect to a racing scan insert on the same
-- manifest_id, because pickup_scans inserts for THIS manifest are the only
-- concurrent writes that can flip the guard-7 predicate, and they queue
-- behind this transaction's lock on the manifest row until it commits or
-- rolls back.
--
-- Test: packages/database/supabase/tests/spec64_remove_manifest_from_route.sql
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.remove_manifest_from_route(
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

  -- ── AUTHORISATION -- identical shape to add_manifest_to_route's, on purpose
  -- (see file header: same job, same list). Role read from public.users, not
  -- the JWT claim -- the claim is minted at login and goes stale.
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
      SELECT role::text INTO v_role FROM public.users
       WHERE id = v_caller AND operator_id = v_operator AND deleted_at IS NULL;

      IF v_role IS NULL
         OR v_role NOT IN ('operations_manager','admin','super_admin') THEN
        -- Spanish, because it reaches the picker verbatim: the frontend hook
        -- rethrows RPC messages unchanged.
        RAISE EXCEPTION 'Solo la tripulación de esta ruta puede quitarle cargas.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- FOR UPDATE is load-bearing -- see the file header's RACE section. It
  -- locks the manifest row for the rest of this transaction so a pickup_scan
  -- insert racing the verified-scan check below cannot land in the gap.
  SELECT * INTO v_manifest FROM public.manifests
   WHERE id = p_manifest_id AND operator_id = v_operator
   FOR UPDATE;
  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'manifest % not found', p_manifest_id;
  END IF;

  IF v_manifest.pickup_route_id IS DISTINCT FROM p_route_id THEN
    -- Removing from a route it is not on is a caller bug, not a silent
    -- no-op -- mirrors add_manifest_to_route's "already linked to another
    -- route" guard.
    RAISE EXCEPTION 'manifest % is not attached to route %', p_manifest_id, p_route_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pickup_scans
     WHERE manifest_id = p_manifest_id
       AND scan_result = 'verified'
       AND package_id IS NOT NULL
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'manifest % has verified scans and cannot be removed', p_manifest_id;
  END IF;

  UPDATE public.manifests
     SET pickup_route_id  = NULL,
         reception_status = NULL,
         status            = 'pending',
         started_at        = NULL
   WHERE id = p_manifest_id
  RETURNING * INTO v_manifest;
  RETURN v_manifest;
END $$;

COMMENT ON FUNCTION public.remove_manifest_from_route(UUID, UUID)
  IS 'Detach a manifest from an in_progress pickup route while it has zero verified pickup scans (spec-64). Authorised callers: the route''s own driver_id, an active pickup_route_crew member of that route, or an operations_manager/admin/super_admin of the same operator -- the same list as add_manifest_to_route, deliberately not cancel_pickup_route''s driver-or-manager-only list.';

GRANT EXECUTE ON FUNCTION public.remove_manifest_from_route(UUID, UUID) TO authenticated;

-- Post-condition: the gate and the verified-scan guard are present. Guards
-- against a future CREATE OR REPLACE templated on an older copy of this
-- function silently dropping either.
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'remove_manifest_from_route';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'remove_manifest_from_route(UUID, UUID) is missing';
  END IF;
  IF v_src NOT LIKE '%pickup_route_crew%'
     OR v_src NOT LIKE '%Solo la tripulación de esta ruta puede quitarle cargas%' THEN
    RAISE EXCEPTION 'remove_manifest_from_route lost its caller check!';
  END IF;
END $$;

COMMIT;
