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
-- usePickupScans inserts into pickup_scans directly from the browser.
-- Two windows, two different reasons a scan is admitted:
--   * BEFORE the manifest is ever attached to a route, pickup_route_id is
--     NULL and trg_pickup_scans_enforce_route_lock's "NO ROUTE -> ALLOW"
--     branch (20260812000005) lets the scan through -- that is the ordinary
--     pre-attachment pickup flow and is not this race.
--   * INSIDE this function's own window -- after it has read "no verified
--     scans" but before it clears pickup_route_id -- the manifest STILL HAS
--     its route (still `p_route_id`, still `in_progress`), so the racing
--     scan is admitted by the trigger's `v_status = 'in_progress'` branch,
--     not the no-route one.
-- Without a lock, a scan committing in that second window defeats guard 7
-- (the verified-scan check) even though it read clean.
--
-- `SELECT ... FOR UPDATE` on the manifest row closes it, and specifically
-- because of `pickup_scans.manifest_id UUID NOT NULL REFERENCES
-- public.manifests(id)` (20260310100000_create_pickup_verification_tables.sql:87,
-- no ON DELETE clause, so no CASCADE lock quirks either way). A NOT NULL
-- FK column forces Postgres to acquire a `FOR KEY SHARE` lock on the
-- referenced parent row as part of the INSERT, to stop the parent being
-- deleted or having its key changed underneath the new child row. `FOR KEY
-- SHARE` conflicts with `FOR UPDATE`. So a concurrent `INSERT INTO
-- pickup_scans (..., manifest_id) VALUES (..., p_manifest_id)` blocks on
-- this transaction's `FOR UPDATE` until it commits or rolls back; the
-- verified-scan EXISTS check and the UPDATE that clears pickup_route_id
-- therefore run as one atomic step with respect to any scan racing this
-- specific manifest_id. Dropping or `NOT VALID`-ing that FK removes the
-- implicit `FOR KEY SHARE` and reopens this race silently -- `FOR UPDATE`
-- alone locks nothing that pickup_scans' INSERT would ever contend for.
--
-- NOT LOCKED: pickup_routes. The `status = 'in_progress'` check below can be
-- stale by the time the UPDATE runs (e.g. the route closes concurrently).
-- Left unlocked on purpose: the consequence is small (the manifest still had
-- zero verified scans at the moment this ran), and locking pickup_routes
-- here risks a deadlock against open_route_reception / reopen_pickup_route,
-- which take a lock on pickup_routes first and would then need one on
-- manifests -- the reverse acquisition order from here.
--
-- KNOWN DIVERGENCE from cancel_pickup_route's detach (trg_pickup_routes_...
-- cancellation path, 20260625000001:203-208): that trigger clears only
-- `pickup_route_id` and `reception_status` on every manifest a cancelled
-- route drops, leaving `status` and `started_at` untouched. This function
-- also resets `status` to 'pending' and clears `started_at`, because a
-- single manifest coming off an otherwise-still-open route needs to look
-- exactly like a manifest that was never attached -- the bulk cancel-drop
-- doesn't carry that requirement since the whole route is dying anyway.
-- Recorded in the spec under "Known divergences"; recorded here too so the
-- difference does not read as an oversight in either file.
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
  -- GUARD 1: operator present in the JWT.
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- GUARD 2: route exists, belongs to this operator, is not soft-deleted.
  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_route.id IS NULL THEN
    RAISE EXCEPTION 'pickup route % not found', p_route_id;
  END IF;

  -- GUARD 3: route is in_progress. See the header note above: this is read
  -- without a lock on pickup_routes and can go stale before the UPDATE
  -- below runs; accepted deliberately to avoid a deadlock with
  -- open_route_reception / reopen_pickup_route's reverse lock order.
  IF v_route.status <> 'in_progress' THEN
    RAISE EXCEPTION 'pickup route % is not in_progress (status=%)', p_route_id, v_route.status;
  END IF;

  -- GUARD 4 (AUTHORISATION) -- identical shape to add_manifest_to_route's,
  -- on purpose (see file header: same job, same list). Role read from
  -- public.users, not the JWT claim -- the claim is minted at login and
  -- goes stale.
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

  -- GUARD 5: manifest exists for this operator. FOR UPDATE is load-bearing
  -- -- see the file header's RACE section. It locks the manifest row for
  -- the rest of this transaction so a pickup_scan insert racing the
  -- verified-scan check below cannot land in the gap (the lock works
  -- because pickup_scans.manifest_id is a NOT NULL FK onto this row, which
  -- forces its INSERT to take FOR KEY SHARE here).
  --
  -- No `deleted_at IS NULL` here, unlike the route lookup above -- this
  -- matches add_manifest_to_route's manifest lookup exactly (same
  -- asymmetry exists there too), not an oversight: a soft-deleted manifest
  -- still attached to a route is exactly the state this function should be
  -- able to clean up.
  SELECT * INTO v_manifest FROM public.manifests
   WHERE id = p_manifest_id AND operator_id = v_operator
   FOR UPDATE;
  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'manifest % not found', p_manifest_id;
  END IF;

  -- GUARD 6: the manifest must actually be on the given route. Removing
  -- from a route it is not on is a caller bug, not a silent no-op --
  -- mirrors add_manifest_to_route's "already linked to another route"
  -- guard.
  IF v_manifest.pickup_route_id IS DISTINCT FROM p_route_id THEN
    RAISE EXCEPTION 'manifest % is not attached to route %', p_manifest_id, p_route_id;
  END IF;

  -- GUARD 7: no verified scan. `package_id IS NOT NULL` is not redundant
  -- with `scan_result = 'verified'` today (the only other populated result
  -- in this codebase, 'not_found', always has package_id NULL by
  -- construction) -- it is kept as an explicit belt-and-braces condition on
  -- the actual thing that must never be true (a real package confirmed
  -- present), rather than relying on scan_result alone staying disjoint
  -- from package_id forever.
  IF EXISTS (
    SELECT 1 FROM public.pickup_scans
     WHERE manifest_id = p_manifest_id
       AND scan_result = 'verified'
       AND package_id IS NOT NULL
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'manifest % has verified scans and cannot be removed', p_manifest_id;
  END IF;

  -- Reset to "never attached" shape (see KNOWN DIVERGENCE note in the file
  -- header for how this differs from the bulk cancel-drop trigger).
  --
  -- completed_at and the four signature columns are cleared too:
  -- apps/frontend/.../pickup/complete/[loadId]/page.tsx can close a carga
  -- out via the discrepancy path (every scan not_found) while it is still
  -- attached to an in_progress route -- zero verified scans, so guard 7
  -- lets it through. Left uncleared, the manifest would come back as
  -- 'pending' but still carry completed_at and a signature, and
  -- PickupMobileCompactRow renders "cerrada HH:MM" off completed_at alone
  -- with no status check -- a pending carga would sit on the pending tab
  -- looking closed, with someone's signature attached to a handover that
  -- was just undone. Clearing these loses no evidence: audit_trigger_func
  -- on public.manifests writes changes_json = {before: row_to_json(OLD),
  -- after: row_to_json(NEW)} on every UPDATE, so the pre-clear values of
  -- completed_at and every signature column are already preserved in
  -- audit_logs. Do not "restore" these columns out of an audit worry.
  UPDATE public.manifests
     SET pickup_route_id         = NULL,
         reception_status        = NULL,
         status                   = 'pending',
         started_at               = NULL,
         completed_at             = NULL,
         signature_operator       = NULL,
         signature_operator_name  = NULL,
         signature_client         = NULL,
         signature_client_name    = NULL
   WHERE id = p_manifest_id
  RETURNING * INTO v_manifest;
  RETURN v_manifest;
END $$;

COMMENT ON FUNCTION public.remove_manifest_from_route(UUID, UUID)
  IS 'Detach a manifest from an in_progress pickup route while it has zero verified pickup scans (spec-64). Clears completed_at and the four signature columns too -- audit_trigger_func preserves the pre-clear values in audit_logs. Authorised callers: the route''s own driver_id, an active pickup_route_crew member of that route, or an operations_manager/admin/super_admin of the same operator -- the same list as add_manifest_to_route, deliberately not cancel_pickup_route''s driver-or-manager-only list.';

GRANT EXECUTE ON FUNCTION public.remove_manifest_from_route(UUID, UUID) TO authenticated;

-- ─── Verification ────────────────────────────────────────────────────────────
-- Assert that every guard this migration exists to add is really in the
-- installed body: the caller gate, the verified-scan guard, and the FOR
-- UPDATE lock that makes the verified-scan guard race-safe. "The function
-- exists" would stay green if a later CREATE OR REPLACE were templated on a
-- stale copy that silently dropped any one of them.
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM   pg_proc p
  WHERE  p.oid = 'public.remove_manifest_from_route(uuid,uuid)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'remove_manifest_from_route(UUID, UUID) is missing';
  END IF;
  IF v_src NOT LIKE '%pickup_route_crew%'
     OR v_src NOT LIKE '%Solo la tripulación de esta ruta puede quitarle cargas%' THEN
    RAISE EXCEPTION 'remove_manifest_from_route lost its caller check!';
  END IF;
  IF v_src NOT LIKE '%scan_result = ''verified''%' THEN
    RAISE EXCEPTION 'remove_manifest_from_route lost its verified-scan guard!';
  END IF;
  IF v_src NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'remove_manifest_from_route lost the FOR UPDATE lock -- the verified-scan guard is race-unsafe without it';
  END IF;
  -- ops_leader must NOT be in this list yet; see the header's "NOT ADDING
  -- ops_leader HERE" note -- it should land on this function, add, and
  -- cancel together, not one at a time.
  IF v_src LIKE '%ops_leader%' THEN
    RAISE EXCEPTION 'remove_manifest_from_route authorises ops_leader on its own -- add it to add_manifest_to_route and cancel_pickup_route in the same change';
  END IF;

  RAISE NOTICE '✓ remove_manifest_from_route: caller gate, verified-scan guard, and FOR UPDATE lock all installed';
END $$;

COMMIT;
