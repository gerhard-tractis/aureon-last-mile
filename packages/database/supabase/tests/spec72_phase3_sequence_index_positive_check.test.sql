-- =============================================================================
-- spec-72 phase 3 review item 5 — route_blocks_sequence_index_positive CHECK.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_phase3_sequence_index_positive_check.test.sql
--
-- House style, matching the other spec72 phase3 suites: fixtures inside one
-- transaction, SAVEPOINT per test, each test a DO block that RAISEs on
-- failure, ROLLBACK TO the savepoint, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.route_blocks'::regclass
       AND conname  = 'route_blocks_sequence_index_positive'
  ) THEN
    RAISE EXCEPTION 'route_blocks_sequence_index_positive CHECK missing';
  END IF;
END $$;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'Test Op 72p3 Check', 'test-op-72-p3-check', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES ('55550001-0000-0000-0000-000000000724', '74201', 'Comuna P3 Check Uno', 'Provincia Test', 'Region Test', 97)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
VALUES ('99990001-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724',
        'dispatchtrack', 'spec72p3-check-test', CURRENT_DATE, 'planned', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: sequence_index = 0 is rejected.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE raised BOOLEAN;
BEGIN
  raised := false;
  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724', '99990001-0000-0000-0000-000000000724',
            '55550001-0000-0000-0000-000000000724', 0, 'default');
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 1: expected a CHECK violation for sequence_index = 0, got none';
  END IF;
  RAISE NOTICE '✓ TEST 1 PASSED: sequence_index = 0 is rejected';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: a negative sequence_index is rejected (the exact shape
-- move_route_block's intermediate offset-swap state relies on never being
-- reachable via a direct write).
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE raised BOOLEAN;
BEGIN
  raised := false;
  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724', '99990001-0000-0000-0000-000000000724',
            '55550001-0000-0000-0000-000000000724', -2, 'default');
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 2: expected a CHECK violation for sequence_index = -2, got none';
  END IF;
  RAISE NOTICE '✓ TEST 2 PASSED: a negative sequence_index is rejected';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: a positive sequence_index (the only legal shape) is accepted.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724', '99990001-0000-0000-0000-000000000724',
          '55550001-0000-0000-0000-000000000724', 1, 'default')
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'TEST 3: expected a positive sequence_index to be accepted';
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: a positive sequence_index is accepted';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: an UPDATE that drives an existing row to 0 is rejected too (the
-- constraint applies on UPDATE, not only INSERT).
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE v_id uuid; raised BOOLEAN;
BEGIN
  INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724', '99990001-0000-0000-0000-000000000724',
          '55550001-0000-0000-0000-000000000724', 1, 'default')
  RETURNING id INTO v_id;

  raised := false;
  BEGIN
    UPDATE public.route_blocks SET sequence_index = 0 WHERE id = v_id;
  EXCEPTION WHEN check_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 4: expected a CHECK violation updating sequence_index to 0, got none';
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: an UPDATE to sequence_index = 0 is rejected';
END $$;

ROLLBACK TO test_4;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72 phase3 sequence_index-positive-check tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
