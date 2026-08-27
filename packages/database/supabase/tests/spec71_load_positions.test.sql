-- =============================================================================
-- spec-71 phase 1 — load_positions table, routes occupancy columns,
-- dock_scans.load_position_id.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec71_load_positions.test.sql
--
-- House style, matching pre_route_snapshot.test.sql / spec70_dispatch_stage.test.sql:
-- fixtures inside one transaction, SAVEPOINT per test, each test a DO block
-- that RAISEs on failure, ROLLBACK TO the savepoint so later tests are
-- unaffected by an earlier failure, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'load_positions'
  ) THEN
    RAISE EXCEPTION 'load_positions table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.load_positions'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on load_positions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'routes' AND column_name = 'load_position_id'
  ) THEN
    RAISE EXCEPTION 'routes.load_position_id missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dock_scans' AND column_name = 'load_position_id'
  ) THEN
    RAISE EXCEPTION 'dock_scans.load_position_id missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users ──────────────────────────────────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'Test Op 71-A', 'test-op-71-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000071', 'Test Op 71-B', 'test-op-71-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000171',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec71.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000071"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000171',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec71.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000071"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000171','aaaaaaaa-aaaa-aaaa-aaaa-000000000071','user-a@spec71.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000171','bbbbbbbb-bbbb-bbbb-bbbb-000000000071','user-b@spec71.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- Seed one position per operator, service-role context (no RLS in play).
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.load_positions (id, operator_id, code, label)
VALUES
  ('11110001-0000-0000-0000-000000000071', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'POS-A1', 'Zona frente a Andén 1'),
  ('11110002-0000-0000-0000-000000000071', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000071', 'POS-B1', 'Zona frente a Andén B1')
ON CONFLICT (id) DO NOTHING;

-- Seed one andén (dock_zones) per operator, for the fronts_dock_zone_id tests below.
INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
VALUES
  ('44440011-0000-0000-0000-000000000071', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'Andén A1', 'AN-A1', true),
  ('44440012-0000-0000-0000-000000000071', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000071', 'Andén B1', 'AN-B1', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: operator isolation — RLS read
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000171","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000071","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.load_positions
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071';
  SELECT COUNT(*) INTO c_other FROM public.load_positions
   WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000071';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own position, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B position, got %', c_other;
  END IF;
  RESET role;
  RAISE NOTICE '✓ TEST 1 PASSED: operator isolation on read';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: WITH CHECK blocks a cross-tenant INSERT
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000171","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000071","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.load_positions (operator_id, code)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000071', 'POS-XTENANT');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'WITH CHECK did not block cross-tenant INSERT (operator A wrote a row under operator B)';
  END IF;
  RESET role;
  RAISE NOTICE '✓ TEST 2 PASSED: cross-tenant INSERT blocked';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: WITH CHECK blocks a cross-tenant UPDATE (re-parenting a row)
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000171","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000071","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    UPDATE public.load_positions
       SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000071'
     WHERE id = '11110001-0000-0000-0000-000000000071';
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'WITH CHECK did not block cross-tenant UPDATE (operator A re-parented its row to operator B)';
  END IF;
  RESET role;
  RAISE NOTICE '✓ TEST 3 PASSED: cross-tenant UPDATE blocked';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: unique code per operator — duplicate rejected while live
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE dup_rejected BOOLEAN := false; err_state TEXT; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.load_positions (operator_id, code)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'POS-A1');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT, err_state = RETURNED_SQLSTATE;
    dup_rejected := (err_state = '23505');
  END;

  IF NOT dup_rejected THEN
    RAISE EXCEPTION 'duplicate (operator_id, code) was not rejected while deleted_at IS NULL: %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: duplicate live code rejected';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: index is scoped per-operator, not global
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE cross_op_ok BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.load_positions (operator_id, code)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000071', 'POS-A1');
    cross_op_ok := true;
  EXCEPTION WHEN OTHERS THEN
    cross_op_ok := false;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT cross_op_ok THEN
    RAISE EXCEPTION 'code uniqueness leaked across operators (index is not scoped to operator_id): %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 5 PASSED: code uniqueness is per-operator';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: soft-deleted position's code can be reused
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE reinsert_ok BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  UPDATE public.load_positions SET deleted_at = NOW()
   WHERE id = '11110001-0000-0000-0000-000000000071';

  BEGIN
    INSERT INTO public.load_positions (operator_id, code)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'POS-A1');
    reinsert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    reinsert_ok := false;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT reinsert_ok THEN
    RAISE EXCEPTION 'code reuse after soft-delete was wrongly rejected: %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: code reusable after soft-delete';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: soft-delete behaviour — deleted_at set, row still readable by owner,
-- excluded from an "active" query pattern by convention (deleted_at IS NULL)
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE v_deleted_at TIMESTAMPTZ; c_active INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  UPDATE public.load_positions SET deleted_at = NOW()
   WHERE id = '11110001-0000-0000-0000-000000000071';

  SELECT deleted_at INTO v_deleted_at FROM public.load_positions
   WHERE id = '11110001-0000-0000-0000-000000000071';
  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'soft-delete did not set deleted_at';
  END IF;

  SELECT COUNT(*) INTO c_active FROM public.load_positions
   WHERE id = '11110001-0000-0000-0000-000000000071' AND deleted_at IS NULL;
  IF c_active <> 0 THEN
    RAISE EXCEPTION 'soft-deleted row still matches an active (deleted_at IS NULL) filter';
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: soft-delete sets deleted_at and row drops out of active filters';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: a position can be reassigned to a new route only after being
-- released from its previous one — enforced by
-- unique_route_per_active_load_position (partial unique index on
-- routes.load_position_id WHERE load_position_id IS NOT NULL AND
-- load_position_released_at IS NULL).
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_route_1 UUID := '22220001-0000-0000-0000-000000000071';
  v_route_2 UUID := '22220002-0000-0000-0000-000000000071';
  v_pos     UUID := '11110001-0000-0000-0000-000000000071';
  blocked   BOOLEAN := false;
  err_msg   TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_route_1, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-1', CURRENT_DATE, 'planned'),
    (v_route_2, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-2', CURRENT_DATE, 'planned');

  -- Route 1 occupies the position.
  UPDATE public.routes
     SET load_position_id = v_pos, load_position_assigned_at = NOW()
   WHERE id = v_route_1;

  -- Route 2 cannot occupy the SAME position while route 1 has not released it.
  BEGIN
    UPDATE public.routes
       SET load_position_id = v_pos, load_position_assigned_at = NOW()
     WHERE id = v_route_2;
  EXCEPTION WHEN unique_violation THEN
    blocked := true;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'route 2 was allowed to occupy a position still held by route 1';
  END IF;

  -- Release route 1 from the position.
  UPDATE public.routes
     SET load_position_released_at = NOW()
   WHERE id = v_route_1;

  -- Now route 2 CAN occupy the position.
  BEGIN
    UPDATE public.routes
       SET load_position_id = v_pos, load_position_assigned_at = NOW()
     WHERE id = v_route_2;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'route 2 should be able to occupy the position once route 1 released it: %', err_msg;
  END;

  RAISE NOTICE '✓ TEST 8 PASSED: reassignment blocked until release, allowed after';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: dock_scans.load_position_id accepts a value and is nullable
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_batch UUID := '33330001-0000-0000-0000-000000000071';
  v_scan  UUID;
  v_read  UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
  VALUES ('44440001-0000-0000-0000-000000000071', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'Andén 71', 'AN71', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.dock_batches (id, operator_id, dock_zone_id, status, created_by)
  VALUES (v_batch, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', '44440001-0000-0000-0000-000000000071',
          'open', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000171');

  INSERT INTO public.dock_scans (id, operator_id, batch_id, barcode, scan_result, scanned_by, load_position_id)
  VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', v_batch, 'BARCODE-71-1',
          'accepted', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000171', '11110001-0000-0000-0000-000000000071')
  RETURNING id INTO v_scan;

  SELECT load_position_id INTO v_read FROM public.dock_scans WHERE id = v_scan;
  IF v_read IS DISTINCT FROM '11110001-0000-0000-0000-000000000071'::UUID THEN
    RAISE EXCEPTION 'dock_scans.load_position_id did not persist, got %', v_read;
  END IF;

  -- Nullable: a scan against a dock_zone (no position) must still insert.
  INSERT INTO public.dock_scans (id, operator_id, batch_id, barcode, scan_result, scanned_by)
  VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', v_batch, 'BARCODE-71-2',
          'accepted', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000171');

  RAISE NOTICE '✓ TEST 9 PASSED: dock_scans.load_position_id persists and is nullable';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: a route released from position P and reassigned to a DIFFERENT
-- position P2 (resetting load_position_released_at to NULL, per the
-- phase-2 contract documented next to unique_route_per_active_load_position)
-- is still covered by the occupancy index at its new position — a second
-- route cannot also take P2 while the first holds it un-released. This is
-- the hole finding 1 (contradictory release semantics) described: with
-- load_position_id left set on release, a stale released_at is the only
-- thing keeping a row out of the index, so reassignment MUST clear it.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  v_route_1 UUID := '22220001-0000-0000-0000-000000000071';
  v_route_3 UUID := '22220003-0000-0000-0000-000000000071';
  v_pos_a   UUID := '11110001-0000-0000-0000-000000000071';
  v_pos_a2  UUID := '11110003-0000-0000-0000-000000000071';
  blocked   BOOLEAN := false;
  err_msg   TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.load_positions (id, operator_id, code, label)
  VALUES (v_pos_a2, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'POS-A2', 'Zona frente a Andén 2')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_route_1, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-1', CURRENT_DATE, 'planned'),
    (v_route_3, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-3', CURRENT_DATE, 'planned');

  -- Route 1 occupies position A, then is released from it.
  UPDATE public.routes
     SET load_position_id = v_pos_a, load_position_assigned_at = NOW()
   WHERE id = v_route_1;
  UPDATE public.routes
     SET load_position_released_at = NOW()
   WHERE id = v_route_1;

  -- Route 1 is reassigned to position A2 — released_at MUST be reset to
  -- NULL per the phase-2 contract, or it falls out of the occupancy index.
  UPDATE public.routes
     SET load_position_id = v_pos_a2,
         load_position_assigned_at = NOW(),
         load_position_released_at = NULL
   WHERE id = v_route_1;

  -- Route 3 cannot also occupy position A2 while route 1 holds it un-released.
  BEGIN
    UPDATE public.routes
       SET load_position_id = v_pos_a2, load_position_assigned_at = NOW()
     WHERE id = v_route_3;
  EXCEPTION WHEN unique_violation THEN
    blocked := true;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'route 3 was allowed to occupy position A2 while route 1 (reassigned there after release) still holds it';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: reassignment to a new position after release stays covered by the occupancy index';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11: the "deleted_at IS NULL" arm of the occupancy index — a
-- soft-deleted route still holding a position must not block another route
-- from taking that position.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE
  v_route_4 UUID := '22220004-0000-0000-0000-000000000071';
  v_route_5 UUID := '22220005-0000-0000-0000-000000000071';
  v_pos     UUID := '11110001-0000-0000-0000-000000000071';
  err_msg   TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_route_4, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-4', CURRENT_DATE, 'planned'),
    (v_route_5, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-5', CURRENT_DATE, 'planned');

  -- Route 4 occupies the position, un-released, then is soft-deleted.
  UPDATE public.routes
     SET load_position_id = v_pos, load_position_assigned_at = NOW()
   WHERE id = v_route_4;
  UPDATE public.routes
     SET deleted_at = NOW()
   WHERE id = v_route_4;

  -- Route 5 must be able to take the same position — route 4's row is
  -- excluded from the partial index once deleted_at IS NOT NULL.
  BEGIN
    UPDATE public.routes
       SET load_position_id = v_pos, load_position_assigned_at = NOW()
     WHERE id = v_route_5;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    RAISE EXCEPTION 'route 5 should be able to occupy a position still held (un-released) only by a soft-deleted route: %', err_msg;
  END;

  RAISE NOTICE '✓ TEST 11 PASSED: a soft-deleted route holding a position does not block reassignment of that position';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12: CHECK routes_load_position_released_requires_id_chk rejects
-- load_position_released_at set with load_position_id NULL.
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE
  v_route UUID := '22220006-0000-0000-0000-000000000071';
  blocked BOOLEAN := false;
  err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-6', CURRENT_DATE, 'planned');

  BEGIN
    UPDATE public.routes
       SET load_position_id = NULL, load_position_released_at = NOW()
     WHERE id = v_route;
  EXCEPTION WHEN check_violation THEN
    blocked := true;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'routes_load_position_released_requires_id_chk did not reject released_at set with load_position_id NULL';
  END IF;

  RAISE NOTICE '✓ TEST 12 PASSED: released_at requires load_position_id CHECK enforced';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13: CHECK routes_load_position_assigned_at_requires_id_chk rejects
-- load_position_id set with load_position_assigned_at NULL.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  v_route UUID := '22220007-0000-0000-0000-000000000071';
  v_pos   UUID := '11110001-0000-0000-0000-000000000071';
  blocked BOOLEAN := false;
  err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'dispatchtrack', 'spec71-route-7', CURRENT_DATE, 'planned');

  BEGIN
    UPDATE public.routes
       SET load_position_id = v_pos, load_position_assigned_at = NULL
     WHERE id = v_route;
  EXCEPTION WHEN check_violation THEN
    blocked := true;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'routes_load_position_assigned_at_requires_id_chk did not reject load_position_id set with assigned_at NULL';
  END IF;

  RAISE NOTICE '✓ TEST 13 PASSED: load_position_id requires assigned_at CHECK enforced';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14: load_positions_operator_isolation RLS policy exists by name
-- (matches rls_operators_test.sql:30-34's pg_policy existence pattern).
-- =============================================================================
SAVEPOINT test_14;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.load_positions'::regclass
       AND polname  = 'load_positions_operator_isolation'
  ) THEN
    RAISE EXCEPTION 'load_positions_operator_isolation policy is missing';
  END IF;
  RAISE NOTICE '✓ TEST 14 PASSED: load_positions_operator_isolation policy exists';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15: load_positions.fronts_dock_zone_id accepts NULL (default) and
-- accepts a valid dock_zones id.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  v_pos  UUID := '11110001-0000-0000-0000-000000000071';
  v_zone UUID := '44440011-0000-0000-0000-000000000071';
  v_read UUID;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Default / explicit NULL.
  SELECT fronts_dock_zone_id INTO v_read FROM public.load_positions WHERE id = v_pos;
  IF v_read IS NOT NULL THEN
    RAISE EXCEPTION 'fronts_dock_zone_id should default to NULL, got %', v_read;
  END IF;

  -- Accepts a valid dock_zones id.
  UPDATE public.load_positions SET fronts_dock_zone_id = v_zone WHERE id = v_pos;

  SELECT fronts_dock_zone_id INTO v_read FROM public.load_positions WHERE id = v_pos;
  IF v_read IS DISTINCT FROM v_zone THEN
    RAISE EXCEPTION 'fronts_dock_zone_id did not persist a valid dock_zones id, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 15 PASSED: fronts_dock_zone_id accepts NULL and a valid dock_zones id';
END $$;

ROLLBACK TO test_15;

-- =============================================================================
-- TEST 16: fronts_dock_zone_id rejects a dock_zone id that does not exist
-- (FK violation).
-- =============================================================================
SAVEPOINT test_16;

DO $$
DECLARE
  v_pos     UUID := '11110001-0000-0000-0000-000000000071';
  v_missing UUID := '99999999-9999-9999-9999-999999999999';
  blocked   BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  BEGIN
    UPDATE public.load_positions SET fronts_dock_zone_id = v_missing WHERE id = v_pos;
  EXCEPTION WHEN foreign_key_violation THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'fronts_dock_zone_id accepted a dock_zones id that does not exist';
  END IF;

  RAISE NOTICE '✓ TEST 16 PASSED: fronts_dock_zone_id rejects a nonexistent dock_zones id';
END $$;

ROLLBACK TO test_16;

-- =============================================================================
-- TEST 17: ON DELETE SET NULL — hard-deleting the referenced dock_zones row
-- nulls load_positions.fronts_dock_zone_id rather than deleting the
-- position. Uses a dedicated dock_zones row (inserted and deleted inside
-- this savepoint) so it cannot be blocked by any other fixture referencing
-- it, e.g. dock_batches.dock_zone_id (NOT NULL, no ON DELETE action).
-- =============================================================================
SAVEPOINT test_17;

DO $$
DECLARE
  v_pos      UUID := '11110001-0000-0000-0000-000000000071';
  v_zone     UUID := '44440099-0000-0000-0000-000000000071';
  v_read     UUID;
  c_position INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
  VALUES (v_zone, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000071', 'Andén Temp', 'AN-TEMP', true);

  UPDATE public.load_positions SET fronts_dock_zone_id = v_zone WHERE id = v_pos;

  DELETE FROM public.dock_zones WHERE id = v_zone;

  SELECT COUNT(*) INTO c_position FROM public.load_positions WHERE id = v_pos;
  IF c_position <> 1 THEN
    RAISE EXCEPTION 'load_positions row was removed by ON DELETE SET NULL on fronts_dock_zone_id, expected it to survive';
  END IF;

  SELECT fronts_dock_zone_id INTO v_read FROM public.load_positions WHERE id = v_pos;
  IF v_read IS NOT NULL THEN
    RAISE EXCEPTION 'fronts_dock_zone_id was not nulled after its dock_zones row was deleted, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 17 PASSED: deleting the referenced dock_zone nulls fronts_dock_zone_id (ON DELETE SET NULL), position survives';
END $$;

ROLLBACK TO test_17;

-- =============================================================================
-- TEST 18: cross-tenant fronts_dock_zone_id — pinning current behaviour, not
-- a spec-71 decision. FK checks bypass RLS, so operator A CAN set
-- fronts_dock_zone_id to operator B's andén; there is no composite FK,
-- trigger, or CHECK anywhere in this repo that guards a cross-table FK
-- against pointing at another tenant's row (every sibling FK — e.g.
-- dock_zones_id on dock_batches/dock_scans/packages — has this identical
-- exposure), so spec-71 does not invent a one-off guard for this column
-- either. What IS guaranteed is that reading the andén back under RLS, from
-- a different operator's session, returns no row — RLS still protects reads
-- of dock_zones itself even though the FK let the pointer be set. A future
-- change to this characteristic (e.g. a repo-wide tenancy guard) should be
-- a deliberate decision made with full knowledge of this test, not an
-- accidental side effect.
-- =============================================================================
SAVEPOINT test_18;

DO $$
DECLARE
  v_pos_a     UUID := '11110001-0000-0000-0000-000000000071';
  v_zone_b    UUID := '44440012-0000-0000-0000-000000000071'; -- operator B's andén
  v_read      UUID;
  c_joined    INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Operator A's session sets its own position to front operator B's andén.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000171","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000071","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  UPDATE public.load_positions SET fronts_dock_zone_id = v_zone_b WHERE id = v_pos_a;

  SELECT fronts_dock_zone_id INTO v_read FROM public.load_positions WHERE id = v_pos_a;
  IF v_read IS DISTINCT FROM v_zone_b THEN
    RAISE EXCEPTION 'operator A should be able to set fronts_dock_zone_id to another operator''s dock_zones row (FK checks bypass RLS), got %', v_read;
  END IF;

  -- A join back to dock_zones, still under operator A's RLS session, sees
  -- no andén row — RLS filters out operator B's zone even though the FK
  -- pointer is live.
  SELECT COUNT(*) INTO c_joined
    FROM public.load_positions lp
    JOIN public.dock_zones dz ON dz.id = lp.fronts_dock_zone_id
   WHERE lp.id = v_pos_a;
  IF c_joined <> 0 THEN
    RAISE EXCEPTION 'joining fronts_dock_zone_id to dock_zones under RLS unexpectedly returned a row for another operator''s andén, got %', c_joined;
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 18 PASSED: cross-tenant fronts_dock_zone_id can be set (no repo-wide guard exists for this), and a join back under RLS returns no andén row';
END $$;

ROLLBACK TO test_18;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec71_load_positions tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
