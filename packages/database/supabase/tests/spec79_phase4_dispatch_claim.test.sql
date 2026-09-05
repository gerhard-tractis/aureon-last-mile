-- =============================================================================
-- spec-79 Fase 4 — dispatch_attempt_at (20260911000001). Also covers B-1
-- (review round 6): routes_one_vehicle_per_day (20260911000002) was
-- WITHDRAWN by 20260911000003 — TESTs 4-5 below assert the withdrawal
-- itself, not the constraint's old behaviour.
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
-- TEST 4: routes_one_vehicle_per_day was WITHDRAWN (spec-79 B-1, review
-- round 6, 20260911000003) — it contradicted Fase 0 finding 3 ("un camión
-- puede legítimamente correr dos rutas el mismo día") and, once a truck's
-- second-turn route hit it, drove an unbounded DT-route-creation loop on
-- every retry (dispatch-local-completion.ts's persist write kept
-- 23505-ing). This asserts the index does NOT exist — a genuine failure,
-- not a silent skip, if anyone reintroduces it without also reverting the
-- application-level 23505 mapping this migration removed. H-3 (Fase 1g)
-- found the previous version of this file used
-- `IF ... IS NULL THEN RAISE NOTICE '⚠ SKIPPED'; RETURN; END IF` here,
-- which the harness scored PASS even with the constraint entirely absent —
-- this test now fails loudly (RAISE EXCEPTION) in exactly that situation
-- instead.
-- =============================================================================
SAVEPOINT test_4;

DO $$
BEGIN
  IF to_regclass('public.routes_one_vehicle_per_day') IS NOT NULL THEN
    RAISE EXCEPTION 'expected routes_one_vehicle_per_day to have been WITHDRAWN (spec-79 B-1) — it still exists';
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: routes_one_vehicle_per_day was withdrawn, as spec-79 B-1 requires';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: with the index withdrawn, TWO active routes for the SAME vehicle
-- on the SAME day both insert successfully — the DB no longer forbids what
-- Fase 0 finding 3 says is normal operation (a truck's second turn).
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_op       uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000179';
  v_vehicle  uuid := '44449001-0000-0000-0000-000000000179';
  v_route_a  uuid := '11119004-0000-0000-0000-000000000179';
  v_route_b  uuid := '11119005-0000-0000-0000-000000000179';
BEGIN
  INSERT INTO public.fleet_vehicles (id, operator_id, provider, external_vehicle_id)
  VALUES (v_vehicle, v_op, 'dispatchtrack', 'T79B-TRUCK-1');

  -- Route A: this truck's morning route, already dispatched.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79B-ROUTE-4', CURRENT_DATE, 'dispatched', v_vehicle);

  -- Route B: the SAME truck's second turn, same day — must succeed.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, vehicle_id)
  VALUES (v_route_b, v_op, 'dispatchtrack', 'T79B-ROUTE-5', CURRENT_DATE, 'loaded', v_vehicle);

  RAISE NOTICE '✓ TEST 5 PASSED: a truck''s second turn the same day is not blocked at the DB layer';
END $$;

ROLLBACK TO test_5;

ROLLBACK;
