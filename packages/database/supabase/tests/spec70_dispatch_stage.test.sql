-- =============================================================================
-- spec-70 phase 1 — dispatch stage, derived stop counts, route state machine.
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
-- Also run as an advisory post-check on every QA deploy by
-- infra/supabase-qa/deploy-qa.sh (sql_tests_check).
--
-- House style, matching pre_route_snapshot.test.sql: fixtures inside one
-- transaction, each test a DO block that RAISEs on failure, ROLLBACK at the
-- end so the database is left clean.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- On the remap invariant, and why it is NOT asserted here.
--
-- 20260825000002 moves every route at `planned` to `dispatched`, and verifies
-- the result in the migration itself (it RAISEs if any row is left behind).
-- That is the right place for it: the check is meaningful exactly once, at
-- deploy, against the pre-migration population.
--
-- Asserting "no routes at planned" from this file would be wrong twice over.
-- It would start failing the moment phase 2 ships, because `planned` then
-- becomes a legitimate local state that Pre-ruta writes on every wave. And on
-- QA it would fail immediately anyway, since the spec-51 scenario seed creates
-- routes long after the migration has run.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Fixtures
-- -----------------------------------------------------------------------------

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000070', 'Test Op 70-A', 'test-op-70-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000070', 'Test Op 70-B', 'test-op-70-b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- Route under test, plus one belonging to the other operator for the
-- isolation check.
INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
VALUES
  ('7e570001-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
   'dispatchtrack', 'spec70-route-a', CURRENT_DATE, 'draft'),
  ('7e570002-0000-0000-0000-000000000070', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000070',
   'dispatchtrack', 'spec70-route-b', CURRENT_DATE, 'draft');

-- Four dispatches on route A: one planned, two staged, one adopted, plus a
-- soft-deleted one that must not be counted. order_id stays NULL — it is
-- nullable, and nothing under test reads it.
INSERT INTO public.dispatches
  (id, operator_id, route_id, provider, stage, staged_at, deleted_at)
VALUES
  ('d1500001-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
   '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'planned', NULL,  NULL),
  ('d1500002-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
   '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'staged',  NOW(), NULL),
  ('d1500003-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
   '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'staged',  NOW(), NULL),
  ('d1500004-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
   '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'adopted', NOW(), NULL),
  ('d1500005-0000-0000-0000-000000000070', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
   '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'staged',  NOW(), NOW());

-- -----------------------------------------------------------------------------
-- TEST 1: the four new route_status_enum labels exist
-- -----------------------------------------------------------------------------
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(want, ', ')
    INTO missing
    FROM unnest(ARRAY['loading','loaded','dispatched','in_transit']) AS want
   WHERE want NOT IN (
     SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'route_status_enum'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 1: route_status_enum is missing: %', missing;
  END IF;
  RAISE NOTICE 'TEST 1 passed: new route_status_enum labels present';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 2: enum sort order is NOT lifecycle order.
-- 20260324000001 added 'draft' with a bare ADD VALUE and no BEFORE clause, so
-- it sorts last despite being first in the lifecycle; spec-70's four labels
-- inherit the same. This test exists so that anyone who "fixes" it by writing
-- ORDER BY status somewhere finds out here rather than in production.
-- -----------------------------------------------------------------------------
DO $$
DECLARE draft_pos INT; planned_pos INT;
BEGIN
  SELECT e.enumsortorder INTO draft_pos
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'route_status_enum' AND e.enumlabel = 'draft';
  SELECT e.enumsortorder INTO planned_pos
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'route_status_enum' AND e.enumlabel = 'planned';

  IF draft_pos < planned_pos THEN
    RAISE EXCEPTION
      'TEST 2: draft now sorts before planned — the enum ordering changed. '
      'Either a migration reordered the type, or this database was built from '
      'scratch with a different order. Re-check every comparison on '
      'route_status_enum before deleting this test.';
  END IF;
  RAISE NOTICE 'TEST 2 passed: enum sort order confirmed non-lifecycle (draft=%, planned=%)',
    draft_pos, planned_pos;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 3: stage defaults to 'planned'
-- -----------------------------------------------------------------------------
DO $$
DECLARE got TEXT;
BEGIN
  INSERT INTO public.dispatches (id, operator_id, route_id, provider)
  VALUES ('d1500010-0000-0000-0000-000000000070',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
          '7e570001-0000-0000-0000-000000000070', 'dispatchtrack');

  SELECT stage INTO got FROM public.dispatches
   WHERE id = 'd1500010-0000-0000-0000-000000000070';

  IF got IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'TEST 3: expected default stage=planned, got %', got;
  END IF;

  DELETE FROM public.dispatches WHERE id = 'd1500010-0000-0000-0000-000000000070';
  RAISE NOTICE 'TEST 3 passed: stage defaults to planned';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 4: dispatches_stage_check rejects an unknown stage
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
    VALUES ('d1500011-0000-0000-0000-000000000070',
            'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
            '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'short', NOW());
    RAISE EXCEPTION 'TEST 4: stage=short was accepted; the CHECK is missing';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 4 passed: unknown stage rejected';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 5: staged_at CHECK works in both directions.
-- A staged row without a timestamp claims a confirmation nobody can date; a
-- planned row with one is a contradiction.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
    VALUES ('d1500012-0000-0000-0000-000000000070',
            'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
            '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'staged', NULL);
    RAISE EXCEPTION 'TEST 5a: staged with NULL staged_at was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 5a passed: staged requires staged_at';
  END;

  BEGIN
    INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
    VALUES ('d1500013-0000-0000-0000-000000000070',
            'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
            '7e570001-0000-0000-0000-000000000070', 'dispatchtrack', 'planned', NOW());
    RAISE EXCEPTION 'TEST 5b: planned with a staged_at was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 5b passed: planned forbids staged_at';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 6: route_stop_counts. Four live rows on route A — 1 planned, 2 staged,
-- 1 adopted — and the soft-deleted fifth must not appear anywhere.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.route_stop_counts
   WHERE route_id = '7e570001-0000-0000-0000-000000000070';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 6: route_stop_counts returned no row for route A';
  END IF;
  IF r.total_stops   <> 4 THEN RAISE EXCEPTION 'TEST 6: total_stops=%, want 4', r.total_stops; END IF;
  IF r.pending_stops <> 1 THEN RAISE EXCEPTION 'TEST 6: pending_stops=%, want 1', r.pending_stops; END IF;
  IF r.staged_stops  <> 2 THEN RAISE EXCEPTION 'TEST 6: staged_stops=%, want 2', r.staged_stops; END IF;
  IF r.adopted_stops <> 1 THEN RAISE EXCEPTION 'TEST 6: adopted_stops=%, want 1', r.adopted_stops; END IF;

  RAISE NOTICE 'TEST 6 passed: stop counts derived correctly, soft-deletes excluded';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 7: legal transitions walk the whole happy path
-- -----------------------------------------------------------------------------
DO $$
DECLARE got route_status_enum;
BEGIN
  FOREACH got IN ARRAY ARRAY['planned','loading','loaded','dispatched','in_transit','completed']::route_status_enum[]
  LOOP
    PERFORM public.transition_route_status(
      '7e570001-0000-0000-0000-000000000070',
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
      got);
  END LOOP;

  SELECT status INTO got FROM public.routes
   WHERE id = '7e570001-0000-0000-0000-000000000070';
  IF got <> 'completed' THEN
    RAISE EXCEPTION 'TEST 7: route ended at % after walking the happy path', got;
  END IF;
  RAISE NOTICE 'TEST 7 passed: draft -> ... -> completed accepted';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 8: illegal transitions are refused. `completed` is terminal, and the
-- route is sitting there after TEST 7.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM public.transition_route_status(
      '7e570001-0000-0000-0000-000000000070',
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
      'loading'::route_status_enum);
    RAISE EXCEPTION 'TEST 8: completed -> loading was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'ILLEGAL_ROUTE_TRANSITION%' THEN RAISE; END IF;
    RAISE NOTICE 'TEST 8 passed: completed -> loading refused';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 9: no backward edge out of dispatched. Once a route is at
-- DispatchTrack, undoing it needs a compensating cancel there — not a local
-- status write. This is the guard behind spec-70 decision 6.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE public.routes SET status = 'dispatched'
   WHERE id = '7e570001-0000-0000-0000-000000000070';

  BEGIN
    PERFORM public.transition_route_status(
      '7e570001-0000-0000-0000-000000000070',
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
      'loaded'::route_status_enum);
    RAISE EXCEPTION 'TEST 9: dispatched -> loaded was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'ILLEGAL_ROUTE_TRANSITION%' THEN RAISE; END IF;
    RAISE NOTICE 'TEST 9 passed: dispatched -> loaded refused';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 10: a transition to the state the route is already in is a success.
-- The callers are HTTP endpoints an operator can double-tap.
-- -----------------------------------------------------------------------------
DO $$
DECLARE got route_status_enum;
BEGIN
  got := public.transition_route_status(
    '7e570001-0000-0000-0000-000000000070',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',
    'dispatched'::route_status_enum);

  IF got <> 'dispatched' THEN
    RAISE EXCEPTION 'TEST 10: idempotent call returned %, want dispatched', got;
  END IF;
  RAISE NOTICE 'TEST 10 passed: same-state transition is a no-op success';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 11: operator isolation. Operator A must not be able to move operator
-- B's route, and the failure must be indistinguishable from "no such route" —
-- a distinct error would confirm the row exists.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM public.transition_route_status(
      '7e570002-0000-0000-0000-000000000070',   -- operator B's route
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000070',   -- operator A asking
      'planned'::route_status_enum);
    RAISE EXCEPTION 'TEST 11: operator A moved operator B''s route';
  -- WHEN OTHERS, not WHEN raise_exception: ROUTE_NOT_FOUND is raised with
  -- ERRCODE P0002, which is no_data_found. The LIKE guard below re-raises this
  -- block's own assertion failure, which arrives here as P0001.
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'ROUTE_NOT_FOUND%' THEN RAISE; END IF;
    RAISE NOTICE 'TEST 11 passed: cross-operator transition refused as NOT_FOUND';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 12: route_stop_counts is security_invoker, so RLS on dispatches
-- applies to whoever queries it rather than to the view's owner.
-- -----------------------------------------------------------------------------
DO $$
DECLARE opts TEXT[];
BEGIN
  SELECT c.reloptions INTO opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'route_stop_counts';

  IF opts IS NULL OR NOT ('security_invoker=true' = ANY(opts)) THEN
    RAISE EXCEPTION
      'TEST 12: route_stop_counts is not security_invoker — it would return '
      'every operator''s counts to every operator. reloptions=%', opts;
  END IF;
  RAISE NOTICE 'TEST 12 passed: route_stop_counts runs with invoker rights';
END $$;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec-70 phase 1 tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
