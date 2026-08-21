-- =============================================================================
-- spec-61 Task 5 — cancel_pickup_route: only the route's own driver, or an
--                  operations_manager / admin / super_admin
-- =============================================================================
-- TEMPLATED ON THE LATEST DEFINITION: 20260812000003_spec52_pickup_routes_vehicle.sql:413
-- (PART 7, the one that persists p_reason into cancellation_reason). Verified
-- on 2026-08-21 by grepping every migration for
-- `FUNCTION public.cancel_pickup_route` -- only 20260625000001:453 and
-- 20260812000003:413 define it, and the latter is later. Templating on the
-- spec-47 original would silently drop `cancellation_reason` and go back to
-- throwing p_reason on the floor. Everything below is byte-for-byte that body
-- except the authorisation block, which is new.
--
-- WHAT WAS WRONG
-- The function checked `get_operator_id()`, that the route exists, that it is
-- not soft-deleted, and that its status is draft/in_progress -- and NOTHING
-- about the caller. EXECUTE is granted to `authenticated`
-- (20260625000001:610). Any authenticated user of an operator could therefore
-- cancel ANY open pickup route in that operator by calling the RPC directly:
-- a pickup_crew member could cancel their own leader's route mid-shift,
-- detaching every manifest on it. Nothing in the app called the function
-- until spec-61 Task 5 gave the leader a button, which is when it was found.
--
-- WHO MAY CANCEL, AND WHY
--   * the route's own driver (`pickup_routes.driver_id = auth.uid()`) -- the
--     person this spec puts in charge of the route;
--   * operations_manager / admin / super_admin -- they keep exactly what they
--     can do today. This is not the moment to remove an operational escape
--     hatch: an abandoned route has no other in-app exit, and the whole reason
--     Task 5 wired this RPC up is that a route can strand its loads.
--   * a `pickup_leader` who is NOT this route's driver gets nothing. Leaders
--     own their own route; one leader cancelling another's is the same class
--     of problem as the crew case.
--   * pickup_crew gets nothing.
--
-- DELIBERATELY NOT `ROUTE_LEADER_ROLES` (lib/permissions.ts) NOR
-- start_pickup_route's list. That list answers "who may OPEN a route", which
-- is a different question from "who may cancel THIS one" -- it contains
-- `pickup_leader`, which must NOT appear here, because leading routes in
-- general is not authority over someone else's. If a later change makes the
-- two lists identical, that is a decision to take on purpose, not an
-- inconsistency to tidy away.
--
-- The UI gate stays (app/app/pickup/route/active/page.tsx and 3h render the
-- button only for `route.driver_id === userId`) as defence in depth, and so
-- an elevated user is not casually offered a destructive control on a route
-- that is not theirs. The server is now the authority.
--
-- NOT a data risk: a function body, no constraint and no index, so it cannot
-- abort a deploy on production rows. The behaviour change is a strict
-- NARROWING of who may call it successfully, and no existing caller is
-- affected: until this week there were none (grep on 2026-08-21 --
-- cancel_pickup_route appears in apps/frontend only in the generated types
-- and in the spec-61 Task 5 hook added alongside this migration).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_pickup_route(
  p_route_id UUID,
  p_reason   TEXT
) RETURNS public.pickup_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_route    public.pickup_routes;
  v_caller   UUID;
  v_role     public.user_role;
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
  IF v_route.status NOT IN ('draft','in_progress') THEN
    RAISE EXCEPTION 'cannot cancel route in status %', v_route.status;
  END IF;

  -- ── spec-61: who may cancel ─────────────────────────────────────────────
  -- `sub` read the same way start_pickup_route reads it (20260820000003:120),
  -- so both functions agree on who the caller is.
  --
  -- v_caller is proved NOT NULL before it is compared to anything. Written as
  -- an explicit null check rather than `v_route.driver_id IS DISTINCT FROM
  -- v_caller`, because that form is FALSE when BOTH sides are NULL -- a
  -- driverless route plus an anonymous caller would have walked straight
  -- through the gate. driver_id is NOT NULL today; this does not depend on
  -- that staying true.
  v_caller := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'no driver (sub) in JWT' USING ERRCODE = '42501';
  END IF;

  IF v_route.driver_id IS NULL OR v_route.driver_id <> v_caller THEN
    -- Role read from public.users, not from the JWT claim: the claim is
    -- minted at login, so a freshly promoted manager would still be carrying
    -- the old role. SECURITY DEFINER, so RLS does not hide the row.
    -- operator_id IS scoped (not just id): without it, a JWT whose `sub`
    -- belongs to operator X but whose operator_id claim says Y would be
    -- authorised on X's role while acting on Y's route. That mismatch falls
    -- into the refusal below for free, like any other unauthorised caller.
    SELECT role INTO v_role FROM public.users
     WHERE id = v_caller AND operator_id = v_operator AND deleted_at IS NULL;

    IF v_role IS NULL
       OR v_role::text NOT IN ('operations_manager','admin','super_admin') THEN
      -- Spanish, because it reaches the driver verbatim: the frontend hook
      -- rethrows RPC messages unchanged (useCancelPickupRoute.ts).
      RAISE EXCEPTION 'Solo el líder de esta ruta puede cancelarla.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.pickup_routes
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancellation_reason = NULLIF(trim(COALESCE(p_reason, '')), '')
   WHERE id = p_route_id
  RETURNING * INTO v_route;

  RETURN v_route;
END $$;

COMMENT ON FUNCTION public.cancel_pickup_route(UUID, TEXT)
  IS 'Cancel a draft/in_progress pickup route, recording p_reason in cancellation_reason; trigger detaches its manifests (spec-47, spec-52). spec-61: only the route''s own driver_id, or an operations_manager/admin/super_admin of the same operator.';

-- ─── Verification ────────────────────────────────────────────────────────────
-- Assert the authorisation this migration exists to add is really in the
-- installed body, and that the spec-52 reason persistence it was templated on
-- survived. "The function exists" would stay green if this file had been
-- templated on the spec-47 original, or if a later CREATE OR REPLACE dropped
-- the gate.
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM   pg_proc p
  WHERE  p.oid = 'public.cancel_pickup_route(uuid,text)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'cancel_pickup_route(UUID, TEXT) is missing';
  END IF;
  IF v_src NOT LIKE '%driver_id%' OR v_src NOT LIKE '%Solo el líder de esta ruta%' THEN
    RAISE EXCEPTION 'cancel_pickup_route has no leader gate — any authenticated user of the operator could cancel any open route';
  END IF;
  IF v_src NOT LIKE '%operations_manager%' THEN
    RAISE EXCEPTION 'cancel_pickup_route lost the elevated-role escape hatch';
  END IF;
  -- pickup_leader must NOT be in this list; see the header.
  IF v_src LIKE '%pickup_leader%' THEN
    RAISE EXCEPTION 'cancel_pickup_route authorises pickup_leader — leading routes is not authority over someone else''s route';
  END IF;
  IF v_src NOT LIKE '%cancellation_reason%' THEN
    RAISE EXCEPTION 'cancel_pickup_route no longer persists p_reason — this file was templated on the pre-spec-52 definition';
  END IF;

  RAISE NOTICE '✓ cancel_pickup_route: driver-or-elevated gate installed, reason persistence intact';
END $$;

COMMIT;
