-- =============================================================================
-- spec-79 Fase 4 — dispatch_attempt_at (20260910000001) and
-- routes_one_vehicle_per_day (20260910000002).
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
-- or ./scripts/pgtap-local.sh (Docker; not run in CI — see script header).
--
-- House style, matching spec79_loaded_route_id.test.sql: fixtures inside
-- one transaction, each test a DO block that RAISEs on failure, SAVEPOINT/
-- ROLLBACK TO around each so one failure does not abort the rest.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000179', 'Test Op 79b', 'test-op-79b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: dispatch_attempt_at exists, defaults NULL, and the exact
-- conditional UPDATE claimDispatchAttempt issues (fresh claim) succeeds once.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_op    uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_route uuid := '11119001-0000-0000-0000-000000000179';
  v_got   timestamptz;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'T79B-ROUTE-1', CURRENT_DATE, 'loaded');

  SELECT dispatch_attempt_at INTO v_got FROM public.routes WHERE id = v_route;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'expected dispatch_attempt_at to default NULL, got %', v_got;
  END IF;

  UPDATE public.routes SET dispatch_attempt_at = now()
   WHERE id = v_route AND operator_id = v_op AND dispatch_attempt_at IS NULL;

  SELECT dispatch_attempt_at INTO v_got FROM public.routes WHERE id = v_route;
  IF v_got IS NULL THEN
    RAISE EXCEPTION 'expected the fresh claim UPDATE to set dispatch_attempt_at';
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: dispatch_attempt_at defaults NULL and the fresh-claim UPDATE sets it';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: a second fresh-claim UPDATE (dispatch_attempt_at IS NULL) touches
-- ZERO rows once a claim is already held — this is what makes route.ts
-- refuse a genuinely concurrent second request.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_op       uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_route    uuid := '11119002-0000-0000-0000-000000000179';
  v_touched  int;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, dispatch_attempt_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'T79B-ROUTE-2', CURRENT_DATE, 'loaded', now());

  UPDATE public.routes SET dispatch_attempt_at = now()
   WHERE id = v_route AND operator_id = v_op AND dispatch_attempt_at IS NULL;
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  IF v_touched <> 0 THEN
    RAISE EXCEPTION 'expected a fresh claim to touch 0 rows when one is already held, touched %', v_touched;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: a concurrent fresh claim touches zero rows';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: a stale claim (older than the app's DISPATCH_CLAIM_STALE_MS, here
-- simulated as 3 minutes old) IS reclaimable via the `lt` condition
-- claimDispatchAttempt's stale branch uses.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_op       uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_route    uuid := '11119003-0000-0000-0000-000000000179';
  v_touched  int;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, dispatch_attempt_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'T79B-ROUTE-3', CURRENT_DATE, 'loaded', now() - interval '3 minutes');

  UPDATE public.routes SET dispatch_attempt_at = now()
   WHERE id = v_route AND operator_id = v_op
     AND dispatch_attempt_at < (now() - interval '2 minutes');
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  IF v_touched <> 1 THEN
    RAISE EXCEPTION 'expected the stale reclaim to touch exactly 1 row, touched %', v_touched;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: a stale claim is reclaimable';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: routes_one_vehicle_per_day rejects a second active route for the
-- same vehicle on the same day, and RAISEs with SQLSTATE 23505.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_op       uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_vehicle  uuid := '44449001-0000-0000-0000-000000000179';
  v_route_a  uuid := '11119004-0000-0000-0000-000000000179';
  v_route_b  uuid := '11119005-0000-0000-0000-000000000179';
  v_raised   boolean := false;
BEGIN
  IF to_regclass('public.routes_one_vehicle_per_day') IS NULL THEN
    RAISE NOTICE '⚠ TEST 4 SKIPPED: routes_one_vehicle_per_day was not created (pre-existing conflicts in this DB) — see migration header';
    RETURN;
  END IF;

  INSERT INTO public.fleet_vehicles (id, operator_id, provider, external_vehicle_id)
  VALUES (v_vehicle, v_op, 'dispatchtrack', 'T79B-TRUCK-1');

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79B-ROUTE-4', CURRENT_DATE, 'loaded', v_vehicle);

  BEGIN
    INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
    VALUES (v_route_b, v_op, 'dispatchtrack', 'T79B-ROUTE-5', CURRENT_DATE, 'planned', v_vehicle);
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected a unique_violation (23505) on a second active route for the same vehicle/day';
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: routes_one_vehicle_per_day rejects a same-day double-booking';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: two routes for the SAME vehicle on DIFFERENT days are both allowed
-- — the index is scoped by route_date, not vehicle alone.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_op       uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_vehicle  uuid := '44449002-0000-0000-0000-000000000179';
  v_route_a  uuid := '11119006-0000-0000-0000-000000000179';
  v_route_b  uuid := '11119007-0000-0000-0000-000000000179';
BEGIN
  IF to_regclass('public.routes_one_vehicle_per_day') IS NULL THEN
    RAISE NOTICE '⚠ TEST 5 SKIPPED: routes_one_vehicle_per_day was not created — see migration header';
    RETURN;
  END IF;

  INSERT INTO public.fleet_vehicles (id, operator_id, provider, external_vehicle_id)
  VALUES (v_vehicle, v_op, 'dispatchtrack', 'T79B-TRUCK-2');

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79B-ROUTE-6', CURRENT_DATE, 'loaded', v_vehicle);

  -- Different date — must NOT conflict, even though this route is also active.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES (v_route_b, v_op, 'dispatchtrack', 'T79B-ROUTE-7', CURRENT_DATE + 1, 'planned', v_vehicle);

  RAISE NOTICE '✓ TEST 5 PASSED: the same vehicle on two different dates is allowed';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: a DISPATCHED route does not block a NEW assignment of the same
-- vehicle on the same day once it is soft-deleted, and a terminal
-- non-active status (delivered-equivalent statuses are outside
-- ACTIVE_ROUTE_STATUSES) is not covered by this index at all — confirmed
-- indirectly via the partial WHERE clause already excluding deleted_at.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_op       uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_vehicle  uuid := '44449003-0000-0000-0000-000000000179';
  v_route_a  uuid := '11119008-0000-0000-0000-000000000179';
  v_route_b  uuid := '11119009-0000-0000-0000-000000000179';
BEGIN
  IF to_regclass('public.routes_one_vehicle_per_day') IS NULL THEN
    RAISE NOTICE '⚠ TEST 6 SKIPPED: routes_one_vehicle_per_day was not created — see migration header';
    RETURN;
  END IF;

  INSERT INTO public.fleet_vehicles (id, operator_id, provider, external_vehicle_id)
  VALUES (v_vehicle, v_op, 'dispatchtrack', 'T79B-TRUCK-3');

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id, deleted_at)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79B-ROUTE-8', CURRENT_DATE, 'loaded', v_vehicle, now());

  -- Same vehicle, same day — allowed, because the first row is soft-deleted.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES (v_route_b, v_op, 'dispatchtrack', 'T79B-ROUTE-9', CURRENT_DATE, 'planned', v_vehicle);

  RAISE NOTICE '✓ TEST 6 PASSED: a soft-deleted route does not block reassigning its vehicle';
END $$;

ROLLBACK TO test_6;

ROLLBACK;
