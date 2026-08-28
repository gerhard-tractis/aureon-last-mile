-- =============================================================================
-- spec-71 phase 2 — position assignment, release, and the offset re-check.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec71_load_position_assignment.test.sql
--
-- House style, matching spec71_load_positions.test.sql / pre_route_snapshot.test.sql:
-- fixtures inside one transaction, SAVEPOINT per test, each test a DO block
-- that RAISEs on failure, ROLLBACK TO the savepoint so later tests are
-- unaffected by an earlier failure, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assign_load_position'
  ) THEN
    RAISE EXCEPTION 'assign_load_position function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'release_load_position'
  ) THEN
    RAISE EXCEPTION 'release_load_position function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'load_position_conflicts_with_route'
  ) THEN
    RAISE EXCEPTION 'load_position_conflicts_with_route function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_load_position_conflict'
  ) THEN
    RAISE EXCEPTION 'check_load_position_conflict function missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users, 1 test commune, andenes, positions ─────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'Test Op 72-A', 'test-op-72-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000072', 'Test Op 72-B', 'test-op-72-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000172',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec72.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000072"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000172','aaaaaaaa-aaaa-aaaa-aaaa-000000000072','user-a@spec72.test','User A',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

SELECT set_config('request.jwt.claims', '{}', true);

-- Andenes for operator A: AN-1 (will be a source andén), AN-2 (unrelated).
INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
VALUES
  ('44440101-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'Andén 72-1', 'AN72-1', true),
  ('44440102-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'Andén 72-2', 'AN72-2', true)
ON CONFLICT (id) DO NOTHING;

-- Positions for operator A:
--   POS-72-1 fronts AN-1 (will conflict with a route sourcing from AN-1)
--   POS-72-2 fronts AN-2 (no conflict with an AN-1-only route)
--   POS-72-3 fronts nothing (never conflicts)
INSERT INTO public.load_positions (id, operator_id, code, label, fronts_dock_zone_id)
VALUES
  ('11120001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'POS-72-1', 'Zona 1', '44440101-0000-0000-0000-000000000072'),
  ('11120002-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'POS-72-2', 'Zona 2', '44440102-0000-0000-0000-000000000072'),
  ('11120003-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'POS-72-3', 'Zona 3', NULL)
ON CONFLICT (id) DO NOTHING;

-- One order + one package sourcing from AN72-1, for operator A.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('eeee0001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072',
  'T72-ORD-001', 'Cliente Uno', '+56900000001', 'Calle 1', 'TestComuna', '2099-01-01'::date,
  '{}'::jsonb, 'MANUAL', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
VALUES ('ffff0001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072',
  'eeee0001-0000-0000-0000-000000000072', 'PKG-T72-001', '{}'::jsonb, 'sectorizado',
  '44440101-0000-0000-0000-000000000072')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: auto-assign picks the lowest-code non-conflicting, unoccupied
-- position (POS-72-2, since POS-72-1 conflicts and POS-72-2 sorts before
-- POS-72-3).
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_route  UUID := '22221001-0000-0000-0000-000000000072';
  v_result UUID;
  v_row    RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-1', CURRENT_DATE, 'planned');

  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'eeee0001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'pending', 'dispatchtrack', 'planned');

  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  IF v_result IS DISTINCT FROM '11120002-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'expected POS-72-2 (lowest-code non-conflicting), got %', v_result;
  END IF;

  SELECT load_position_id, load_position_assigned_at, load_position_assigned_by, load_position_released_at
    INTO v_row FROM public.routes WHERE id = v_route;

  IF v_row.load_position_id IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'routes.load_position_id not stamped, got %', v_row.load_position_id;
  END IF;
  IF v_row.load_position_assigned_at IS NULL THEN
    RAISE EXCEPTION 'load_position_assigned_at not stamped';
  END IF;
  IF v_row.load_position_assigned_by IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172'::UUID THEN
    RAISE EXCEPTION 'load_position_assigned_by not stamped, got %', v_row.load_position_assigned_by;
  END IF;
  IF v_row.load_position_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'load_position_released_at should be NULL on fresh assignment';
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: auto-assign excludes the offset-conflicting position and picks the lowest-code survivor';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: auto-assign excludes a position occupied by another active route
-- of the same operator.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_route_holder UUID := '22221002-0000-0000-0000-000000000072';
  v_route_new    UUID := '22221003-0000-0000-0000-000000000072';
  v_result       UUID;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_route_holder, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-holder', CURRENT_DATE, 'planned'),
    (v_route_new,    'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-new',    CURRENT_DATE, 'planned');

  -- Holder occupies POS-72-2 and POS-72-3 is left free; POS-72-1 conflicts by
  -- offset for both routes (neither sources from AN72-1 here, so it doesn't).
  UPDATE public.routes
     SET load_position_id = '11120002-0000-0000-0000-000000000072',
         load_position_assigned_at = now()
   WHERE id = v_route_holder;

  v_result := public.assign_load_position(v_route_new, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  IF v_result IS DISTINCT FROM '11120001-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'expected POS-72-1 (POS-72-2 occupied, no source andén conflict here), got %', v_result;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: auto-assign skips a position occupied by another active route';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: best-effort — no position available returns NULL, no error, route
-- stays NULL (Decision 8).
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_r1 UUID := '22221004-0000-0000-0000-000000000072';
  v_r2 UUID := '22221005-0000-0000-0000-000000000072';
  v_r3 UUID := '22221006-0000-0000-0000-000000000072';
  v_result UUID;
  v_load_position_id UUID;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_r1, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-r1', CURRENT_DATE, 'planned'),
    (v_r2, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-r2', CURRENT_DATE, 'planned'),
    (v_r3, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-r3', CURRENT_DATE, 'planned');

  -- Occupy all three positions with r1 and r2 (POS-72-1 has no conflicting
  -- dispatches for these routes, so both r1/r2 can legitimately hold it —
  -- pick two distinct ones directly instead of relying on auto-select).
  UPDATE public.routes SET load_position_id = '11120001-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_r1;
  UPDATE public.routes SET load_position_id = '11120002-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_r2;
  UPDATE public.routes SET load_position_id = '11120003-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_r3;

  -- A fourth route now has nothing free.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES ('22221007-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-r4', CURRENT_DATE, 'planned');

  v_result := public.assign_load_position('22221007-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'expected NULL (no position available), got %', v_result;
  END IF;

  SELECT load_position_id INTO v_load_position_id FROM public.routes WHERE id = '22221007-0000-0000-0000-000000000072';
  IF v_load_position_id IS NOT NULL THEN
    RAISE EXCEPTION 'route should remain unassigned, got load_position_id %', v_load_position_id;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: best-effort auto-assign returns NULL and raises no error when nothing is free';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: idempotent — a route that already holds an active position keeps
-- it; calling assign_load_position again is a no-op that returns the same id.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_route  UUID := '22221008-0000-0000-0000-000000000072';
  v_result UUID;
  v_assigned_at_1 TIMESTAMPTZ;
  v_assigned_at_2 TIMESTAMPTZ;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-8', CURRENT_DATE, 'planned');

  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');
  SELECT load_position_assigned_at INTO v_assigned_at_1 FROM public.routes WHERE id = v_route;

  PERFORM pg_sleep(0.01);
  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');
  SELECT load_position_assigned_at INTO v_assigned_at_2 FROM public.routes WHERE id = v_route;

  IF v_assigned_at_1 IS DISTINCT FROM v_assigned_at_2 THEN
    RAISE EXCEPTION 'second call re-stamped assigned_at; expected a no-op (% vs %)', v_assigned_at_1, v_assigned_at_2;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: assign_load_position is idempotent on an already-occupying route';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: explicit target succeeds, and re-assigning a released route to a
-- DIFFERENT explicit position resets released_at/released_by to NULL.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_route UUID := '22221009-0000-0000-0000-000000000072';
  v_result UUID;
  v_row RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-9', CURRENT_DATE, 'planned');

  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120003-0000-0000-0000-000000000072');
  IF v_result IS DISTINCT FROM '11120003-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'explicit assign did not return the requested position, got %', v_result;
  END IF;

  PERFORM public.release_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120002-0000-0000-0000-000000000072');
  IF v_result IS DISTINCT FROM '11120002-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'reassignment to a different explicit position failed, got %', v_result;
  END IF;

  SELECT load_position_id, load_position_released_at, load_position_released_by INTO v_row FROM public.routes WHERE id = v_route;
  IF v_row.load_position_id IS DISTINCT FROM '11120002-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'load_position_id not updated to the new position, got %', v_row.load_position_id;
  END IF;
  IF v_row.load_position_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'reassignment did not reset load_position_released_at to NULL, got %', v_row.load_position_released_at;
  END IF;
  IF v_row.load_position_released_by IS NOT NULL THEN
    RAISE EXCEPTION 'reassignment did not reset load_position_released_by to NULL, got %', v_row.load_position_released_by;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: explicit reassignment to a new position resets release fields';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: explicit target already occupied by another active route raises a
-- clean domain error (POSITION_ALREADY_OCCUPIED), not a raw unique-violation.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_holder UUID := '22221010-0000-0000-0000-000000000072';
  v_other  UUID := '22221011-0000-0000-0000-000000000072';
  caught   BOOLEAN := false;
  err_msg  TEXT := 'no error raised';
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_holder, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-10', CURRENT_DATE, 'planned'),
    (v_other,  'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-11', CURRENT_DATE, 'planned');

  UPDATE public.routes SET load_position_id = '11120003-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_holder;

  BEGIN
    PERFORM public.assign_load_position(v_other, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120003-0000-0000-0000-000000000072');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    caught := err_msg LIKE 'POSITION_ALREADY_OCCUPIED%';
  END;

  IF NOT caught THEN
    RAISE EXCEPTION 'expected a POSITION_ALREADY_OCCUPIED domain error, got: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: explicit assign to an occupied position raises a clean domain error';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: explicit target that conflicts by the offset rule raises
-- POSITION_OFFSET_CONFLICT.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_route UUID := '22221012-0000-0000-0000-000000000072';
  caught  BOOLEAN := false;
  err_msg TEXT := 'no error raised';
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-12', CURRENT_DATE, 'planned');

  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'eeee0001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'pending', 'dispatchtrack', 'planned');

  BEGIN
    PERFORM public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120001-0000-0000-0000-000000000072');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    caught := err_msg LIKE 'POSITION_OFFSET_CONFLICT%';
  END;

  IF NOT caught THEN
    RAISE EXCEPTION 'expected a POSITION_OFFSET_CONFLICT domain error, got: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: explicit assign to an offset-conflicting position raises a clean domain error';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: explicit target that does not exist (or belongs to another
-- operator, or is soft-deleted / inactive) raises POSITION_NOT_FOUND.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_route UUID := '22221013-0000-0000-0000-000000000072';
  caught  BOOLEAN := false;
  err_msg TEXT := 'no error raised';
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-13', CURRENT_DATE, 'planned');

  BEGIN
    PERFORM public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '99999999-9999-9999-9999-999999999999');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    caught := err_msg LIKE 'POSITION_NOT_FOUND%';
  END;

  IF NOT caught THEN
    RAISE EXCEPTION 'expected a POSITION_NOT_FOUND domain error, got: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 8 PASSED: explicit assign to a nonexistent position raises a clean domain error';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: soft-deleted andén — a position fronting a retired andén (deleted
-- dock_zones row) is treated as "no live conflict" and is NOT excluded, even
-- though the route sources from that same (now-retired) dock_zone_id.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_route  UUID := '22221014-0000-0000-0000-000000000072';
  v_result UUID;
BEGIN
  -- Retire AN72-1 (soft-delete). POS-72-1 still fronts it, dangling.
  UPDATE public.dock_zones SET deleted_at = now() WHERE id = '44440101-0000-0000-0000-000000000072';

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-14', CURRENT_DATE, 'planned');

  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'eeee0001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'pending', 'dispatchtrack', 'planned');

  -- Explicit assign to POS-72-1 must now succeed (no live conflict).
  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120001-0000-0000-0000-000000000072');
  IF v_result IS DISTINCT FROM '11120001-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'position fronting a retired andén should not conflict, got %', v_result;
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: a position fronting a soft-deleted andén is not treated as conflicting';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: release stamps released_at/released_by and LEAVES load_position_id
-- set (Decision 4). Idempotent on a second call.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  v_route UUID := '22221015-0000-0000-0000-000000000072';
  v_row   RECORD;
  v_released_at_1 TIMESTAMPTZ;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-15', CURRENT_DATE, 'planned');

  PERFORM public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120003-0000-0000-0000-000000000072');
  PERFORM public.release_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  SELECT load_position_id, load_position_released_at, load_position_released_by INTO v_row FROM public.routes WHERE id = v_route;
  IF v_row.load_position_id IS DISTINCT FROM '11120003-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'release cleared load_position_id; it must stay set, got %', v_row.load_position_id;
  END IF;
  IF v_row.load_position_released_at IS NULL THEN
    RAISE EXCEPTION 'release did not stamp load_position_released_at';
  END IF;
  IF v_row.load_position_released_by IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172'::UUID THEN
    RAISE EXCEPTION 'release did not stamp load_position_released_by, got %', v_row.load_position_released_by;
  END IF;

  v_released_at_1 := v_row.load_position_released_at;
  PERFORM pg_sleep(0.01);
  PERFORM public.release_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  SELECT load_position_released_at INTO v_row FROM public.routes WHERE id = v_route;
  IF v_row.load_position_released_at IS DISTINCT FROM v_released_at_1 THEN
    RAISE EXCEPTION 'release is not idempotent; released_at changed on second call';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: release stamps released_at/by, keeps load_position_id, and is idempotent';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11: check_load_position_conflict — no conflict for a route with no
-- active position.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE
  v_route UUID := '22221016-0000-0000-0000-000000000072';
  v_out   jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-16', CURRENT_DATE, 'planned');

  v_out := public.check_load_position_conflict(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072');
  IF (v_out->>'conflict')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expected conflict=false for an unassigned route, got %', v_out;
  END IF;

  RAISE NOTICE '✓ TEST 11 PASSED: check_load_position_conflict reports no conflict when no position is assigned';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12: check_load_position_conflict — a package added AFTER assignment
-- that sources from the assigned position's fronted andén surfaces
-- conflict=true (Decision 7's offset re-check on dispatch-set change).
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE
  v_route UUID := '22221017-0000-0000-0000-000000000072';
  v_out   jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-17', CURRENT_DATE, 'planned');

  -- Assigned to POS-72-1 (fronts AN72-1) while the route has no dispatches yet
  -- — no conflict at assignment time.
  PERFORM public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120001-0000-0000-0000-000000000072');

  v_out := public.check_load_position_conflict(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072');
  IF (v_out->>'conflict')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expected conflict=false before any AN72-1-sourced dispatch, got %', v_out;
  END IF;

  -- A package sourcing from AN72-1 is now added to the route's dispatch set.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'eeee0001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'pending', 'dispatchtrack', 'planned');

  v_out := public.check_load_position_conflict(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072');
  IF (v_out->>'conflict')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expected conflict=true after an AN72-1-sourced dispatch was added, got %', v_out;
  END IF;

  RAISE NOTICE '✓ TEST 12 PASSED: check_load_position_conflict detects a conflict introduced by a dispatch-set change';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13: cross-operator — assign_load_position on operator A's route with
-- p_operator_id set to operator B raises ROUTE_NOT_FOUND (never touches
-- another tenant's row).
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  v_route UUID := '22221018-0000-0000-0000-000000000072';
  caught  BOOLEAN := false;
  err_msg TEXT := 'no error raised';
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-18', CURRENT_DATE, 'planned');

  BEGIN
    PERFORM public.assign_load_position(v_route, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    caught := err_msg LIKE 'ROUTE_NOT_FOUND%';
  END;

  IF NOT caught THEN
    RAISE EXCEPTION 'expected ROUTE_NOT_FOUND for a cross-operator call, got: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 13 PASSED: cross-operator assign raises ROUTE_NOT_FOUND';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14: reassigning a route to the SAME position after release resets
-- load_position_released_at/_by to NULL, and the row is covered by
-- unique_route_per_active_load_position — another route is then refused
-- that same position. This is the exact scenario the reassign contract
-- protects (test 5 above only covers reassignment to a DIFFERENT position).
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE
  v_route UUID := '22221019-0000-0000-0000-000000000072';
  v_other UUID := '22221020-0000-0000-0000-000000000072';
  v_result UUID;
  v_row    RECORD;
  caught   BOOLEAN := false;
  err_msg  TEXT := 'no error raised';
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-19', CURRENT_DATE, 'planned'),
    (v_other, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-20', CURRENT_DATE, 'planned');

  -- Assign P (POS-72-3), release, then reassign to the SAME P.
  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120003-0000-0000-0000-000000000072');
  IF v_result IS DISTINCT FROM '11120003-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'initial assign to POS-72-3 failed, got %', v_result;
  END IF;

  PERFORM public.release_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  v_result := public.assign_load_position(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120003-0000-0000-0000-000000000072');
  IF v_result IS DISTINCT FROM '11120003-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'reassignment to the SAME position (POS-72-3) failed, got %', v_result;
  END IF;

  SELECT load_position_id, load_position_released_at, load_position_released_by INTO v_row FROM public.routes WHERE id = v_route;
  IF v_row.load_position_id IS DISTINCT FROM '11120003-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'load_position_id not POS-72-3 after same-position reassignment, got %', v_row.load_position_id;
  END IF;
  IF v_row.load_position_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'same-position reassignment did not reset load_position_released_at to NULL, got %', v_row.load_position_released_at;
  END IF;
  IF v_row.load_position_released_by IS NOT NULL THEN
    RAISE EXCEPTION 'same-position reassignment did not reset load_position_released_by to NULL, got %', v_row.load_position_released_by;
  END IF;

  -- unique_route_per_active_load_position now covers this row again: a
  -- different route explicitly targeting POS-72-3 must be refused.
  BEGIN
    PERFORM public.assign_load_position(v_other, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', '11120003-0000-0000-0000-000000000072');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    caught := err_msg LIKE 'POSITION_ALREADY_OCCUPIED%';
  END;

  IF NOT caught THEN
    RAISE EXCEPTION 'expected another route to be refused POS-72-3 after same-position reassignment, got: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 14 PASSED: reassigning a route to the SAME position after release resets released_at/_by and re-establishes exclusivity';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15: check_load_position_conflict raises ROUTE_NOT_FOUND for a
-- missing / cross-operator route rather than returning a NULL row a caller
-- could misread as "no conflict".
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  caught  BOOLEAN := false;
  err_msg TEXT := 'no error raised';
BEGIN
  BEGIN
    PERFORM public.check_load_position_conflict('99999999-9999-9999-9999-999999999998', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    caught := err_msg LIKE 'ROUTE_NOT_FOUND%';
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'expected ROUTE_NOT_FOUND for a nonexistent route, got: %', err_msg;
  END IF;

  caught := false;
  err_msg := 'no error raised';
  DECLARE
    v_route UUID := '22221021-0000-0000-0000-000000000072';
  BEGIN
    INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
    VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-21', CURRENT_DATE, 'planned');

    BEGIN
      PERFORM public.check_load_position_conflict(v_route, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000072');
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
      caught := err_msg LIKE 'ROUTE_NOT_FOUND%';
    END;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'expected ROUTE_NOT_FOUND for a cross-operator route, got: %', err_msg;
  END IF;

  RAISE NOTICE '✓ TEST 15 PASSED: check_load_position_conflict raises ROUTE_NOT_FOUND for a missing / cross-operator route';
END $$;

ROLLBACK TO test_15;

-- =============================================================================
-- TEST 16: sweep_load_position_assignments — a route left at
-- load_position_id NULL because nothing was free at creation time gets a
-- position once one is released (the missing re-attempt this phase adds).
-- =============================================================================
SAVEPOINT test_16;

DO $$
DECLARE
  v_holder1 UUID := '22221022-0000-0000-0000-000000000072';
  v_holder2 UUID := '22221023-0000-0000-0000-000000000072';
  v_holder3 UUID := '22221024-0000-0000-0000-000000000072';
  v_waiting UUID := '22221025-0000-0000-0000-000000000072';
  v_row     RECORD;
  v_swept_count INTEGER;
BEGIN
  -- All 3 positions occupied.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_holder1, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-22', CURRENT_DATE, 'planned'),
    (v_holder2, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-23', CURRENT_DATE, 'planned'),
    (v_holder3, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-24', CURRENT_DATE, 'planned');
  UPDATE public.routes SET load_position_id = '11120001-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_holder1;
  UPDATE public.routes SET load_position_id = '11120002-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_holder2;
  UPDATE public.routes SET load_position_id = '11120003-0000-0000-0000-000000000072', load_position_assigned_at = now() WHERE id = v_holder3;

  -- A route created with nothing free — stays NULL, exactly like
  -- assign_load_position's best-effort miss.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_waiting, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-25', CURRENT_DATE, 'planned');
  PERFORM public.assign_load_position(v_waiting, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  SELECT load_position_id INTO v_row FROM public.routes WHERE id = v_waiting;
  IF v_row.load_position_id IS NOT NULL THEN
    RAISE EXCEPTION 'fixture broken: v_waiting should start unassigned, got %', v_row.load_position_id;
  END IF;

  -- Sweeping now (nothing released yet) assigns nothing.
  SELECT COUNT(*) INTO v_swept_count FROM public.sweep_load_position_assignments('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');
  IF v_swept_count <> 0 THEN
    RAISE EXCEPTION 'expected 0 sweep assignments with nothing free, got %', v_swept_count;
  END IF;

  -- Release holder2's position (POS-72-2) — the same one that frees up here.
  PERFORM public.release_load_position(v_holder2, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  -- The sweep now picks it up for the waiting route.
  PERFORM public.sweep_load_position_assignments('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172');

  SELECT load_position_id INTO v_row FROM public.routes WHERE id = v_waiting;
  IF v_row.load_position_id IS DISTINCT FROM '11120002-0000-0000-0000-000000000072'::UUID THEN
    RAISE EXCEPTION 'sweep did not assign the freed position to the waiting route, got %', v_row.load_position_id;
  END IF;

  RAISE NOTICE '✓ TEST 16 PASSED: sweep_load_position_assignments assigns a freed position to a route that missed out earlier';
END $$;

ROLLBACK TO test_16;

-- =============================================================================
-- TEST 17: sweep_load_position_assignments only touches routes at
-- load_position_id NULL in a pre-dispatch status, is capped by p_limit, and
-- returns the (route_id, load_position_id) pairs it actually assigned.
-- =============================================================================
SAVEPOINT test_17;

DO $$
DECLARE
  v_dispatched UUID := '22221026-0000-0000-0000-000000000072';
  v_planned    UUID := '22221027-0000-0000-0000-000000000072';
  v_row        RECORD;
  v_count      INTEGER;
BEGIN
  -- A `dispatched` route with no position must never be touched by the
  -- sweep — it has already moved past needing one.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_dispatched, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-26', CURRENT_DATE, 'dispatched');

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_planned, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-27', CURRENT_DATE, 'planned');

  SELECT * INTO v_row FROM public.sweep_load_position_assignments('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', 1) LIMIT 1;

  -- All 3 positions are still free at this savepoint (test 17 runs in its
  -- own fixture scope after the outer ROLLBACK TO test_16), so the eligible
  -- v_planned route gets one; v_dispatched must never appear.
  IF v_row.route_id IS DISTINCT FROM v_planned THEN
    RAISE EXCEPTION 'sweep should have returned v_planned as the sole assignment, got %', v_row.route_id;
  END IF;

  SELECT load_position_id INTO v_row FROM public.routes WHERE id = v_planned;
  IF v_row.load_position_id IS NULL THEN
    RAISE EXCEPTION 'sweep did not assign a free position to the eligible planned route';
  END IF;

  SELECT load_position_id INTO v_row FROM public.routes WHERE id = v_dispatched;
  IF v_row.load_position_id IS NOT NULL THEN
    RAISE EXCEPTION 'sweep must never assign a position to a dispatched route, got %', v_row.load_position_id;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.sweep_load_position_assignments('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000172', 0);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'p_limit=0 should attempt no routes, got % assignments', v_count;
  END IF;

  RAISE NOTICE '✓ TEST 17 PASSED: sweep only considers planned/loading/loaded routes with no position, and respects p_limit';
END $$;

ROLLBACK TO test_17;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec71_load_position_assignment tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
