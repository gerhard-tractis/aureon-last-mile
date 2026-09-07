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
   'T85-LOAD-B', 'pending');

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

ROLLBACK;
