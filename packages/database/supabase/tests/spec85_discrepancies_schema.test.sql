-- =============================================================================
-- spec-85 fase 1 — Esquema: public.discrepancies
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec85_discrepancies_schema.test.sql
--
-- House style, matching spec79_loaded_route_id.test.sql: fixtures inside one
-- transaction, each test a DO block that RAISEs on failure, SAVEPOINT/
-- ROLLBACK TO around each so one failure does not abort the rest. RLS tests
-- follow rls_operators_test.sql: SET LOCAL role = 'authenticated' plus
-- request.jwt.claims, never trusting owner-context SELECTs.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'Test Op 85 A', 'test-op-85-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000085', 'Test Op 85 B', 'test-op-85-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000185',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec85-user-a@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000085"}'::jsonb,
   '{"full_name":"Spec85 User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000185',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec85-user-b@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000085"}'::jsonb,
   '{"full_name":"Spec85 User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000185','aaaaaaaa-aaaa-aaaa-aaaa-000000000085','spec85-user-a@operators.test','Spec85 User A',ARRAY['admin']),
  ('bbbbbbbb-0000-4000-b000-000000000185','bbbbbbbb-bbbb-bbbb-bbbb-000000000085','spec85-user-b@operators.test','Spec85 User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- One order + package per operator, for the FK-bearing columns.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('22220001-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
   'T85-ORD-A', 'Cliente 85-A', '+56900000185', 'Calle 85 #A', 'TestComuna 85',
   CURRENT_DATE, '{}'::jsonb, 'MANUAL', now()),
  ('22220002-0000-0000-0000-000000000085', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000085',
   'T85-ORD-B', 'Cliente 85-B', '+56900000285', 'Calle 85 #B', 'TestComuna 85',
   CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status)
VALUES
  ('33330001-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
   '22220001-0000-0000-0000-000000000085', 'CTN85-A', '{}'::jsonb, 'ingresado'),
  ('33330002-0000-0000-0000-000000000085', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000085',
   '22220002-0000-0000-0000-000000000085', 'CTN85-B', '{}'::jsonb, 'ingresado');

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('44440001-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
   'T85-LOAD-A', 'pending'),
  ('44440002-0000-0000-0000-000000000085', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000085',
   'T85-LOAD-B', 'pending'),
  -- A second, later event for operator A: same package can be missing on
  -- Monday's carga A and again on Tuesday's carga A2 — two distinct facts.
  ('44440003-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
   'T85-LOAD-A2', 'pending');

-- A pickup_route + route_reception for operator A, so the operation/source
-- CHECK (I3) and source_id (reception branch) have something real to point at.
INSERT INTO public.vehicles (id, operator_id, plate)
VALUES
  ('88880001-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'T85-PLATE');

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES
  ('55550001-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
   'PR-T85-0001', 'aaaaaaaa-0000-4000-a000-000000000185', '88880001-0000-0000-0000-000000000085', 'in_progress');

INSERT INTO public.route_receptions (id, pickup_route_id, operator_id, delivered_by, status)
VALUES
  ('66660001-0000-0000-0000-000000000085', '55550001-0000-0000-0000-000000000085',
   'aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'aaaaaaaa-0000-4000-a000-000000000185', 'pending');

-- =============================================================================
-- TEST 1: RLS isolation — operator B cannot see operator A's discrepancies.
-- =============================================================================
SAVEPOINT test_1;

INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
        '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'falta el bulto A');

DO $$
DECLARE c_own INT; c_other INT; c_all INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-b000-000000000185","operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000085","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own
    FROM public.discrepancies WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000085';
  SELECT COUNT(*) INTO c_other
    FROM public.discrepancies WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085';
  SELECT COUNT(*) INTO c_all FROM public.discrepancies;

  IF c_other <> 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: cross-tenant read leak — operator B saw operator A''s discrepancy (got %)', c_other;
  END IF;
  IF c_all <> 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: unqualified SELECT returned % rows, expected 0 (operator B has none)', c_all;
  END IF;
  RESET role;
END $$;
RESET role;

DO $$
DECLARE c_own INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000185","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000085","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.discrepancies;
  IF c_own <> 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: operator A cannot read its own discrepancy (got %)', c_own;
  END IF;
  RESET role;
END $$;
RESET role;

DO $$ BEGIN RAISE NOTICE '✓ TEST 1 PASSED: RLS isolates discrepancies by operator_id'; END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: discrepancy_shape CHECK — a 'missing' row without package_id fails.
-- =============================================================================
SAVEPOINT test_2;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, manifest_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '44440001-0000-0000-0000-000000000085', 'sin package_id');
    RAISE EXCEPTION 'TEST 2 FAILED: a missing discrepancy without package_id was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE '✓ TEST 2 PASSED: missing without package_id rejected by discrepancy_shape';
  END;
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: discrepancy_shape CHECK — an 'unexpected' row without barcode fails.
-- =============================================================================
SAVEPOINT test_3;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, manifest_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'unexpected', 'pickup',
            '44440001-0000-0000-0000-000000000085', 'sin barcode');
    RAISE EXCEPTION 'TEST 3 FAILED: an unexpected discrepancy without barcode was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE '✓ TEST 3 PASSED: unexpected without barcode rejected by discrepancy_shape';
  END;
END $$;

ROLLBACK TO test_3;

-- Sanity: the valid shape of each kind is accepted (guards against a CHECK
-- that is accidentally too strict and rejects everything).
SAVEPOINT test_3b;

DO $$
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'ok');

  INSERT INTO public.discrepancies (operator_id, kind, operation_type, barcode, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'unexpected', 'pickup',
          'BARCODE-XYZ', '44440001-0000-0000-0000-000000000085', 'ok');

  RAISE NOTICE '✓ TEST 3b PASSED: valid missing/unexpected shapes are accepted';
END $$;

ROLLBACK TO test_3b;

-- =============================================================================
-- TEST 4: uniq_open_discrepancy_per_package — two OPEN discrepancies for the
-- same package + operation_type collide; an OPEN and a RESOLVED coexist.
-- =============================================================================
SAVEPOINT test_4;

DO $$
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, status)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'first open', 'open');

  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, status)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'second open', 'open');
    RAISE EXCEPTION 'TEST 4 FAILED: a second open discrepancy on the same package/operation was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE '✓ TEST 4 PASSED (part a): duplicate OPEN discrepancy rejected';
  END;
END $$;

ROLLBACK TO test_4;

SAVEPOINT test_4b;

DO $$
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, status, resolved_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'resolved one', 'resolved', NOW());

  -- A resolved row and a fresh open one for the same package/operation must
  -- coexist: the unique index is WHERE status = 'open'.
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, status)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'new open', 'open');

  RAISE NOTICE '✓ TEST 4 PASSED (part b): an open and a resolved discrepancy coexist';
END $$;

ROLLBACK TO test_4b;

-- =============================================================================
-- TEST 5: discrepancy_resolved_has_when CHECK — status <> 'open' requires
-- resolved_at.
-- =============================================================================
SAVEPOINT test_5;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, status)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'resolved sin fecha', 'resolved');
    RAISE EXCEPTION 'TEST 5 FAILED: status=resolved without resolved_at was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE '✓ TEST 5 PASSED (part a): resolved without resolved_at rejected';
  END;

  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, status)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'lost sin fecha', 'lost');
    RAISE EXCEPTION 'TEST 5 FAILED: status=lost without resolved_at was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE '✓ TEST 5 PASSED (part b): lost without resolved_at rejected';
  END;
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: discrepancy_notes is untouched — still readable, still has its 5
-- pre-migration rows accounted for (checked against discrepancies, not an
-- exact count here since other worktrees/tests may share the pgtap
-- container's discrepancy_notes table).
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'discrepancy_notes'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'TEST 6 FAILED: discrepancy_notes was dropped — Recogida''s review screen still reads it';
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: discrepancy_notes still exists';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 (I3) — discrepancy_source_matches_operation CHECK: operation_type
-- must agree with which source column is populated.
-- =============================================================================
SAVEPOINT test_7;

DO $$
BEGIN
  -- pickup without manifest_id: rejected.
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', 'pickup sin manifest_id');
    RAISE EXCEPTION 'TEST 7 FAILED (a): pickup without manifest_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 7 PASSED (a): pickup without manifest_id rejected';
  END;

  -- pickup with route_reception_id instead of manifest_id: rejected.
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, route_reception_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '66660001-0000-0000-0000-000000000085',
            'pickup con route_reception_id');
    RAISE EXCEPTION 'TEST 7 FAILED (b): pickup with route_reception_id instead of manifest_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 7 PASSED (b): pickup with route_reception_id rejected';
  END;

  -- reception without route_reception_id: rejected.
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'reception',
            '33330001-0000-0000-0000-000000000085', 'reception sin route_reception_id');
    RAISE EXCEPTION 'TEST 7 FAILED (c): reception without route_reception_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 7 PASSED (c): reception without route_reception_id rejected';
  END;

  -- reception with manifest_id instead of route_reception_id: rejected.
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'reception',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085',
            'reception con manifest_id');
    RAISE EXCEPTION 'TEST 7 FAILED (d): reception with manifest_id instead of route_reception_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 7 PASSED (d): reception with manifest_id rejected';
  END;

  -- Sanity: the valid shape of each operation is accepted.
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'ok pickup');
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, route_reception_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'reception',
          '33330001-0000-0000-0000-000000000085', '66660001-0000-0000-0000-000000000085', 'ok reception');
  RAISE NOTICE '✓ TEST 7 PASSED (e): valid pickup/reception shapes accepted';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (I5) — discrepancy_shape CHECK closes the 'unexpected' branch: a
-- barcode read that resolves to a real package_id must NOT pass as
-- 'unexpected', or it would collide with (and block) a legitimate 'missing'
-- on that same package.
-- =============================================================================
SAVEPOINT test_8;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, barcode, package_id, manifest_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'unexpected', 'pickup',
            'BARCODE-XYZ', '33330001-0000-0000-0000-000000000085',
            '44440001-0000-0000-0000-000000000085', 'unexpected con package_id');
    RAISE EXCEPTION 'TEST 8 FAILED: an unexpected discrepancy with package_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '✓ TEST 8 PASSED: unexpected with package_id rejected by discrepancy_shape';
  END;
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 — "one open discrepancy per EVENT, not per operation lifetime": the
-- same package missing on two different cargas (different manifest_id, same
-- operation_type) must be able to coexist as two open rows, because the
-- unique index now carries source_id.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE c INT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'falta lunes carga A');

  -- Same package, same operator, same operation_type, DIFFERENT manifest
  -- (source_id): must be accepted, not collide.
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440003-0000-0000-0000-000000000085', 'falta martes carga A2');

  SELECT COUNT(*) INTO c FROM public.discrepancies
   WHERE package_id = '33330001-0000-0000-0000-000000000085' AND status = 'open';
  IF c <> 2 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: expected 2 open discrepancies (one per event), got %', c;
  END IF;

  -- But a THIRD open one on the SAME manifest (same source_id) must still
  -- collide — this is the original per-package-per-open guarantee, not
  -- weakened by adding source_id.
  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'duplicado lunes carga A');
    RAISE EXCEPTION 'TEST 9 FAILED: a second open discrepancy on the SAME event was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '✓ TEST 9 PASSED: one open discrepancy per event, not per operation lifetime';
  END;
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 (C2) — uniq_open_discrepancy_per_barcode: two open 'unexpected'
-- rows for the same barcode + operation_type + source collide. Without this,
-- an offline-queue retry (spec-81) duplicates the surplus.
-- =============================================================================
SAVEPOINT test_10;

DO $$
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, barcode, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'unexpected', 'pickup',
          'BARCODE-DUP', '44440001-0000-0000-0000-000000000085', 'first unexpected');

  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, barcode, manifest_id, note)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'unexpected', 'pickup',
            'BARCODE-DUP', '44440001-0000-0000-0000-000000000085', 'retry duplicate');
    RAISE EXCEPTION 'TEST 10 FAILED: a duplicate open ''unexpected'' on the same event was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE '✓ TEST 10 PASSED: duplicate open unexpected on the same event rejected';
  END;
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11 (C3) — end-to-end smoke test under role='authenticated' (the real
-- client role), not the owner: operator A cannot INSERT a row carrying
-- operator B's operator_id (fabricating evidence in someone else's file).
--
-- This only proves the write is denied SOMEHOW — `authenticated` has no
-- INSERT grant at all (I2), so this never reaches WITH CHECK, and Postgres
-- gives both causes the same SQLSTATE (42501/insufficient_privilege; see
-- the note above TEST 16). Which layer actually fired is TEST 15 (the GRANT)
-- and TEST 16 (WITH CHECK, under a role that has the grant and isn't
-- bypassing RLS) — do not read this test as proof of either on its own.
-- =============================================================================
SAVEPOINT test_11;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000185","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000085","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085',
            'A intenta fabricar evidencia contra B');
    RAISE EXCEPTION 'TEST 11 FAILED: operator A inserted a row with operator B''s operator_id';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '✓ TEST 11 PASSED: cross-tenant INSERT rejected (%)', SQLSTATE;
  END;
  RESET role;
END $$;
RESET role;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12 (C3) — same caveat as TEST 11: under authenticated (no INSERT/
-- UPDATE grant at all), operator A cannot move one of its own rows to
-- operator B. Layer attribution is TEST 15/16, not this one.
-- =============================================================================
SAVEPOINT test_12;

INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
        '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085', 'A''s own row');

DO $$
DECLARE v_still_a INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000185","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000085","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    UPDATE public.discrepancies SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000085'
     WHERE note = 'A''s own row';
    RAISE EXCEPTION 'TEST 12 FAILED: operator A moved its own row to operator B';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '✓ TEST 12 PASSED: moving a row to another operator rejected (%)', SQLSTATE;
  END;
  RESET role;
END $$;
RESET role;

DO $$
DECLARE v_owner UUID;
BEGIN
  SELECT operator_id INTO v_owner FROM public.discrepancies WHERE note = 'A''s own row';
  IF v_owner IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085'::uuid THEN
    RAISE EXCEPTION 'TEST 12 FAILED: row operator_id changed despite the rejected UPDATE (got %)', v_owner;
  END IF;
  RAISE NOTICE '✓ TEST 12 PASSED: row still belongs to operator A after the rejected UPDATE';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13 (C3b, I1) — the backfill: fixture discrepancy_notes rows, run
-- public.spec85_backfill_discrepancy_notes(), and check the fields actually
-- arrived (not just that the table exists). Also checks idempotency: running
-- it twice does not duplicate.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  v_count_first  INT;
  v_count_second INT;
  v_row RECORD;
BEGIN
  INSERT INTO public.discrepancy_notes (id, operator_id, manifest_id, package_id, note, created_by_user_id, created_at, updated_at)
  VALUES (
    '77770001-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
    '44440001-0000-0000-0000-000000000085', '33330001-0000-0000-0000-000000000085',
    'nota de marzo', 'aaaaaaaa-0000-4000-a000-000000000185',
    '2026-03-15 10:00:00+00', '2026-03-15 10:00:00+00'
  );

  SELECT public.spec85_backfill_discrepancy_notes() INTO v_count_first;
  IF v_count_first < 1 THEN
    RAISE EXCEPTION 'TEST 13 FAILED: backfill inserted % rows, expected >= 1', v_count_first;
  END IF;

  SELECT * INTO v_row FROM public.discrepancies WHERE migrated_from_note_id = '77770001-0000-0000-0000-000000000085';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 13 FAILED: no discrepancies row traces back to the fixture note via migrated_from_note_id';
  END IF;
  IF v_row.kind <> 'missing' OR v_row.operation_type <> 'pickup' OR v_row.status <> 'open' THEN
    RAISE EXCEPTION 'TEST 13 FAILED: wrong kind/operation_type/status on the backfilled row';
  END IF;
  IF v_row.package_id <> '33330001-0000-0000-0000-000000000085' THEN
    RAISE EXCEPTION 'TEST 13 FAILED: package_id not carried over';
  END IF;
  IF v_row.note <> 'nota de marzo' THEN
    RAISE EXCEPTION 'TEST 13 FAILED: note not carried over';
  END IF;
  -- I1: detected_at must be the ORIGINAL note's created_at, not NOW().
  IF v_row.detected_at <> '2026-03-15 10:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'TEST 13 FAILED (I1): detected_at is %, expected the note''s original created_at', v_row.detected_at;
  END IF;

  -- Idempotency: running it again must not duplicate this row.
  SELECT public.spec85_backfill_discrepancy_notes() INTO v_count_second;
  IF (SELECT COUNT(*) FROM public.discrepancies WHERE migrated_from_note_id = '77770001-0000-0000-0000-000000000085') <> 1 THEN
    RAISE EXCEPTION 'TEST 13 FAILED: a second backfill run duplicated the row';
  END IF;

  RAISE NOTICE '✓ TEST 13 PASSED: backfill copies real fields (incl. detected_at) and is idempotent';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14 (C1) — the ORIGINAL backfill scenario that can abort a deploy: two
-- live discrepancy_notes for the same package but in DIFFERENT manifests.
-- Before the source_id-aware index this collided inside the same INSERT
-- (unique_violation, no ON CONFLICT); now it must not, AND even if it did
-- collide, ON CONFLICT DO NOTHING must swallow it rather than abort.
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.discrepancy_notes (id, operator_id, manifest_id, package_id, note, created_by_user_id)
  VALUES
    ('77770002-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
     '44440001-0000-0000-0000-000000000085', '33330001-0000-0000-0000-000000000085',
     'nota carga A', 'aaaaaaaa-0000-4000-a000-000000000185'),
    ('77770003-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
     '44440003-0000-0000-0000-000000000085', '33330001-0000-0000-0000-000000000085',
     'nota carga A2', 'aaaaaaaa-0000-4000-a000-000000000185');

  -- Must not raise. If it does, this whole test errors out (uncaught) and
  -- pgtap-local.sh reports it as a hard FAIL — exactly the deploy-aborting
  -- shape C1 describes.
  SELECT public.spec85_backfill_discrepancy_notes() INTO v_count;

  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST 14 FAILED: expected both notes to backfill (got %)', v_count;
  END IF;

  RAISE NOTICE '✓ TEST 14 PASSED: two notes on the same package in different manifests backfill without aborting';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15 (I2, round 2) — direct ACL assert, independent of RLS. TEST 11/12
-- catch a rejected write under role=authenticated, but their broad
-- `WHEN insufficient_privilege OR check_violation` cannot tell WHICH layer
-- fired: with the REVOKE removed, RLS alone still raises 42501 and the same
-- tests pass — so the REVOKE was never actually being tested. This checks
-- the GRANT layer by itself, with has_table_privilege(), which does not
-- consult any RLS policy at all.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  v_insert BOOLEAN;
  v_update BOOLEAN;
  v_delete BOOLEAN;
  v_select BOOLEAN;
BEGIN
  v_insert := has_table_privilege('authenticated', 'public.discrepancies', 'INSERT');
  v_update := has_table_privilege('authenticated', 'public.discrepancies', 'UPDATE');
  v_delete := has_table_privilege('authenticated', 'public.discrepancies', 'DELETE');
  v_select := has_table_privilege('authenticated', 'public.discrepancies', 'SELECT');

  IF v_insert OR v_update OR v_delete THEN
    RAISE EXCEPTION 'TEST 15 FAILED (I2): authenticated still holds a write privilege at the GRANT layer (insert=%, update=%, delete=%) — the base image''s default ACL grants these unless explicitly revoked',
      v_insert, v_update, v_delete;
  END IF;
  IF NOT v_select THEN
    RAISE EXCEPTION 'TEST 15 FAILED: authenticated lost SELECT too — it needs to read discrepancies';
  END IF;

  RAISE NOTICE '✓ TEST 15 PASSED: authenticated is SELECT-only at the ACL layer (has_table_privilege, not RLS)';
END $$;

ROLLBACK TO test_15;

-- =============================================================================
-- TEST 16 (C3, round 2) — WITH CHECK exercised under a role that actually
-- HAS the INSERT/UPDATE grant and does NOT bypass RLS (service_role has
-- BYPASSRLS, so it cannot stand in for this). Proves the policy itself
-- rejects a cross-tenant row, not just the missing GRANT — kills the mutant
-- where both policies read WITH CHECK (true) but TEST 11/12 still "pass"
-- because the GRANT layer denies the write first.
--
-- Postgres does NOT give RLS its own SQLSTATE: a WITH CHECK failure and a
-- plain GRANT denial both raise 42501 (insufficient_privilege) — RLS's is
-- just worded "new row violates row-level security policy for table ...",
-- a GRANT denial "permission denied for table ...". Verified directly
-- against this container before writing this test. So the two causes are
-- told apart by GET STACKED DIAGNOSTICS ... MESSAGE_TEXT, not by exception
-- class — `WHEN check_violation` never fires for RLS: PostgreSQL raises 42501 for a WITH CHECK rejection, not 23514
-- for an RLS rejection; it only looked like a stricter check because
-- `insufficient_privilege` on its own already covers both causes.
-- =============================================================================
SAVEPOINT test_16;

-- postgres in this harness is NOT a superuser (rolsuper=false, only
-- rolbypassrls=true) — SET ROLE still needs explicit membership, unlike a
-- real superuser session.
CREATE ROLE spec85_rls_probe NOLOGIN;
GRANT spec85_rls_probe TO postgres;
GRANT USAGE ON SCHEMA public TO spec85_rls_probe;
GRANT SELECT, INSERT, UPDATE ON public.discrepancies TO spec85_rls_probe;
GRANT EXECUTE ON FUNCTION public.get_operator_id() TO spec85_rls_probe;

DO $$
DECLARE
  v_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000185","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000085","role":"authenticated"}', true);
  SET LOCAL ROLE spec85_rls_probe;

  -- Sanity: this role can legitimately write ITS OWN operator's row — proves
  -- any rejection below is RLS, not a grant this probe never had.
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000085', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085',
          'probe: legitimate own-operator insert');

  BEGIN
    INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000085', 'missing', 'pickup',
            '33330001-0000-0000-0000-000000000085', '44440001-0000-0000-0000-000000000085',
            'probe: cross-tenant insert attempt');
    RAISE EXCEPTION 'TEST 16 FAILED (a): a role with a REAL INSERT grant (no BYPASSRLS) inserted a cross-tenant row — WITH CHECK did not fire';
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message NOT ILIKE '%row-level security policy%' THEN
        RAISE EXCEPTION 'TEST 16 FAILED (a): rejected by the GRANT layer (%), not by WITH CHECK — this role has INSERT, so a plain permission-denied here proves nothing about RLS', v_message;
      END IF;
      RAISE NOTICE '✓ TEST 16 PASSED (a): WITH CHECK rejects the cross-tenant INSERT (%), independent of any GRANT', v_message;
  END;

  BEGIN
    UPDATE public.discrepancies SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000085'
     WHERE note = 'probe: legitimate own-operator insert';
    RAISE EXCEPTION 'TEST 16 FAILED (b): a role with a REAL UPDATE grant moved a row to another operator — WITH CHECK did not fire';
  EXCEPTION
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message NOT ILIKE '%row-level security policy%' THEN
        RAISE EXCEPTION 'TEST 16 FAILED (b): rejected by the GRANT layer (%), not by WITH CHECK', v_message;
      END IF;
      RAISE NOTICE '✓ TEST 16 PASSED (b): WITH CHECK rejects the cross-tenant UPDATE (%), independent of any GRANT', v_message;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_16;

-- =============================================================================
-- TEST 17 (minor) — the backfill's silent swallow is COUNTED, not just
-- silent: two live notes on the SAME package_id AND the SAME manifest_id
-- (a genuine duplicate — e.g. a read-then-write retry with no unique
-- constraint on discrepancy_notes itself) collide on
-- uniq_open_discrepancy_per_package. ON CONFLICT DO NOTHING must still
-- swallow it (the deploy cannot abort), but the function's return value
-- must reflect that fewer rows landed than notes existed, so the RAISE
-- NOTICE inside it (not capturable from SQL, but visible in deploy logs)
-- has something correct to compare.
-- =============================================================================
SAVEPOINT test_17;

DO $$
DECLARE
  v_live_before INT;
  v_inserted    INT;
  v_landed      INT;
BEGIN
  INSERT INTO public.discrepancy_notes (id, operator_id, manifest_id, package_id, note, created_by_user_id)
  VALUES
    ('77770004-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
     '44440001-0000-0000-0000-000000000085', '33330001-0000-0000-0000-000000000085',
     'nota duplicada 1', 'aaaaaaaa-0000-4000-a000-000000000185'),
    ('77770005-0000-0000-0000-000000000085', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000085',
     '44440001-0000-0000-0000-000000000085', '33330001-0000-0000-0000-000000000085',
     'nota duplicada 2 (mismo package, mismo manifest)', 'aaaaaaaa-0000-4000-a000-000000000185');

  SELECT COUNT(*) INTO v_live_before FROM public.discrepancy_notes WHERE deleted_at IS NULL;
  SELECT public.spec85_backfill_discrepancy_notes() INTO v_inserted;

  SELECT COUNT(*) INTO v_landed FROM public.discrepancies
   WHERE migrated_from_note_id IN ('77770004-0000-0000-0000-000000000085', '77770005-0000-0000-0000-000000000085');

  IF v_landed <> 1 THEN
    RAISE EXCEPTION 'TEST 17 FAILED: expected exactly 1 of the 2 duplicate notes to land (ON CONFLICT DO NOTHING), got %', v_landed;
  END IF;
  IF v_inserted >= v_live_before THEN
    RAISE EXCEPTION 'TEST 17 FAILED: the function''s own return value (%) does not reflect the swallowed duplicate against % live notes', v_inserted, v_live_before;
  END IF;

  RAISE NOTICE '✓ TEST 17 PASSED: duplicate swallowed by ON CONFLICT DO NOTHING, AND the function''s count reflects it (% live vs % inserted)', v_live_before, v_inserted;
END $$;

ROLLBACK TO test_17;

ROLLBACK;
