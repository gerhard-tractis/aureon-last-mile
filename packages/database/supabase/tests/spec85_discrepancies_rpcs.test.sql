-- =============================================================================
-- spec-85 fase 2 — RPCs: record_discrepancies, resolve_discrepancy, lectura
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec85_discrepancies_rpcs.test.sql
--
-- House style, matching spec85_discrepancies_schema.test.sql: fixtures inside
-- one transaction, each test a DO block that RAISEs on failure, SAVEPOINT/
-- ROLLBACK TO around each so one failure does not abort the rest.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'Test Op 85r2 A', 'test-op-85r2-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000852', 'Test Op 85r2 B', 'test-op-85r2-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000852',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec85r2-user-a@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000852"}'::jsonb,
   '{"full_name":"Spec85r2 User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000852',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec85r2-user-b@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000852"}'::jsonb,
   '{"full_name":"Spec85r2 User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000852','aaaaaaaa-aaaa-aaaa-aaaa-000000000852','spec85r2-user-a@operators.test','Spec85r2 User A',ARRAY['admin']),
  ('bbbbbbbb-0000-4000-b000-000000000852','bbbbbbbb-bbbb-bbbb-bbbb-000000000852','spec85r2-user-b@operators.test','Spec85r2 User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('22220001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852',
   'T85R2-ORD-A', 'Cliente 85r2-A', '+56900000852', 'Calle 85r2 #A', 'TestComuna 85r2',
   CURRENT_DATE, '{}'::jsonb, 'MANUAL', now()),
  ('22220002-0000-0000-0000-000000000852', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000852',
   'T85R2-ORD-B', 'Cliente 85r2-B', '+56900000853', 'Calle 85r2 #B', 'TestComuna 85r2',
   CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status)
VALUES
  ('33330001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852',
   '22220001-0000-0000-0000-000000000852', 'CTN85R2-A1', '{}'::jsonb, 'ingresado'),
  ('33330002-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852',
   '22220001-0000-0000-0000-000000000852', 'CTN85R2-A2', '{}'::jsonb, 'ingresado'),
  ('33330003-0000-0000-0000-000000000852', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000852',
   '22220002-0000-0000-0000-000000000852', 'CTN85R2-B1', '{}'::jsonb, 'ingresado');

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('44440001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852',
   'T85R2-LOAD-A', 'pending'),
  ('44440002-0000-0000-0000-000000000852', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000852',
   'T85R2-LOAD-B', 'pending');

INSERT INTO public.vehicles (id, operator_id, plate)
VALUES
  ('88880001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'T85R2-PLATE'),
  ('88880002-0000-0000-0000-000000000852', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000852', 'T85R2-PLATE-B');

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES
  ('55550001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852',
   'PR-T85R2-0001', 'aaaaaaaa-0000-4000-a000-000000000852', '88880001-0000-0000-0000-000000000852', 'in_progress'),
  ('55550002-0000-0000-0000-000000000852', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000852',
   'PR-T85R2-0002', 'bbbbbbbb-0000-4000-b000-000000000852', '88880002-0000-0000-0000-000000000852', 'in_progress');

INSERT INTO public.route_receptions (id, pickup_route_id, operator_id, delivered_by, status)
VALUES
  ('66660001-0000-0000-0000-000000000852', '55550001-0000-0000-0000-000000000852',
   'aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'aaaaaaaa-0000-4000-a000-000000000852', 'pending'),
  ('66660002-0000-0000-0000-000000000852', '55550002-0000-0000-0000-000000000852',
   'bbbbbbbb-bbbb-bbbb-bbbb-000000000852', 'bbbbbbbb-0000-4000-b000-000000000852', 'pending');

-- Helper: run everything as operator A's authenticated JWT.
CREATE OR REPLACE FUNCTION pg_temp.as_operator_a() RETURNS VOID AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000852","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000852","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pg_temp.as_operator_b() RETURNS VOID AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-b000-000000000852","operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000852","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
END $$ LANGUAGE plpgsql;

-- =============================================================================
-- TEST 1 — record_discrepancies, happy path 'missing': inserts one open row.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_count            INT;
  v_detected_by      UUID;
  v_note             TEXT;
  v_detected_at      TIMESTAMPTZ;
BEGIN
  PERFORM pg_temp.as_operator_a();

  PERFORM public.record_discrepancies(
    'pickup'::public.discrepancy_operation_enum,
    '44440001-0000-0000-0000-000000000852'::UUID,
    jsonb_build_array(
      jsonb_build_object('kind', 'missing', 'package_id', '33330001-0000-0000-0000-000000000852', 'note', 'no llegó')
    )
  );

  RESET ROLE;

  SELECT COUNT(*) INTO v_count
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'missing'
     AND package_id = '33330001-0000-0000-0000-000000000852'
     AND status = 'open';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: expected exactly 1 open missing discrepancy, got %', v_count;
  END IF;

  -- m2: the row's whole point is who declared what, when — assert the
  -- attribution actually lands, not just the count.
  SELECT detected_by_user_id, note, detected_at INTO v_detected_by, v_note, v_detected_at
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'missing'
     AND package_id = '33330001-0000-0000-0000-000000000852'
     AND status = 'open';

  IF v_detected_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000852'::UUID THEN
    RAISE EXCEPTION 'TEST 1 FAILED: detected_by_user_id not attributed to the caller, got %', v_detected_by;
  END IF;
  IF v_note IS DISTINCT FROM 'no llegó' THEN
    RAISE EXCEPTION 'TEST 1 FAILED: note not stored, got %', v_note;
  END IF;
  IF v_detected_at IS NULL THEN
    RAISE EXCEPTION 'TEST 1 FAILED: detected_at is NULL';
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: record_discrepancies inserts a missing discrepancy with attribution';
END $$;
RESET ROLE;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2 — record_discrepancies, happy path 'unexpected': inserts one open
-- row with barcode set and package_id NULL.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_count       INT;
  v_detected_by UUID;
BEGIN
  PERFORM pg_temp.as_operator_a();

  PERFORM public.record_discrepancies(
    'pickup'::public.discrepancy_operation_enum,
    '44440001-0000-0000-0000-000000000852'::UUID,
    jsonb_build_array(
      jsonb_build_object('kind', 'unexpected', 'barcode', 'AJENO-999', 'note', 'no es de esta carga')
    )
  );

  RESET ROLE;

  SELECT COUNT(*) INTO v_count
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'unexpected'
     AND barcode = 'AJENO-999'
     AND package_id IS NULL
     AND status = 'open';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: expected exactly 1 open unexpected discrepancy, got %', v_count;
  END IF;

  SELECT detected_by_user_id INTO v_detected_by
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'unexpected' AND barcode = 'AJENO-999';

  IF v_detected_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000852'::UUID THEN
    RAISE EXCEPTION 'TEST 2 FAILED: detected_by_user_id not attributed to the caller, got %', v_detected_by;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: record_discrepancies inserts an unexpected discrepancy with attribution';
END $$;
RESET ROLE;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 2b (B-1, re-review) — record_discrepancies, happy path 'unexpected' on
-- the RECEPTION branch: mirrors TEST 2 exactly, but through
-- p_operation_type='reception' against fixture 66660001-…, the branch
-- mig:166-179 that no other test in this suite ever reaches. Without this,
-- a mutant that swaps that branch's VALUES(...) for garbage
-- (e.g. 'MUTANTE-' || v_barcode) still passes the whole 22/22 suite.
-- =============================================================================
SAVEPOINT test_2b;

DO $$
DECLARE
  v_count       INT;
  v_detected_by UUID;
BEGIN
  PERFORM pg_temp.as_operator_a();

  PERFORM public.record_discrepancies(
    'reception'::public.discrepancy_operation_enum,
    '66660001-0000-0000-0000-000000000852'::UUID, -- A's own route_reception
    jsonb_build_array(
      jsonb_build_object('kind', 'unexpected', 'barcode', 'AJENO-RECEP-999', 'note', 'sobró en recepción')
    )
  );

  RESET ROLE;

  SELECT COUNT(*) INTO v_count
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND operation_type = 'reception'
     AND route_reception_id = '66660001-0000-0000-0000-000000000852'
     AND kind = 'unexpected'
     AND barcode = 'AJENO-RECEP-999'
     AND package_id IS NULL
     AND status = 'open';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 2b FAILED: expected exactly 1 open reception unexpected discrepancy, got %', v_count;
  END IF;

  SELECT detected_by_user_id INTO v_detected_by
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND operation_type = 'reception'
     AND kind = 'unexpected' AND barcode = 'AJENO-RECEP-999';

  IF v_detected_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000852'::UUID THEN
    RAISE EXCEPTION 'TEST 2b FAILED: detected_by_user_id not attributed to the caller, got %', v_detected_by;
  END IF;

  RAISE NOTICE '✓ TEST 2b PASSED: record_discrepancies inserts an unexpected reception discrepancy with attribution';
END $$;
RESET ROLE;

ROLLBACK TO test_2b;

-- =============================================================================
-- TEST 3 — idempotency: calling record_discrepancies twice with the same
-- item leaves exactly one open row (both 'missing' and 'unexpected' shapes).
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_count_missing    INT;
  v_count_unexpected INT;
  v_items JSONB;
BEGIN
  PERFORM pg_temp.as_operator_a();

  v_items := jsonb_build_array(
    jsonb_build_object('kind', 'missing', 'package_id', '33330001-0000-0000-0000-000000000852'),
    jsonb_build_object('kind', 'unexpected', 'barcode', 'AJENO-777')
  );

  PERFORM public.record_discrepancies('pickup'::public.discrepancy_operation_enum,
    '44440001-0000-0000-0000-000000000852'::UUID, v_items);
  -- Second call: same items, same source. Must not duplicate.
  PERFORM public.record_discrepancies('pickup'::public.discrepancy_operation_enum,
    '44440001-0000-0000-0000-000000000852'::UUID, v_items);

  RESET ROLE;

  SELECT COUNT(*) INTO v_count_missing
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'missing' AND package_id = '33330001-0000-0000-0000-000000000852';
  SELECT COUNT(*) INTO v_count_unexpected
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'unexpected' AND barcode = 'AJENO-777';

  IF v_count_missing <> 1 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: missing shape not idempotent, got % rows', v_count_missing;
  END IF;
  IF v_count_unexpected <> 1 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: unexpected shape not idempotent, got % rows', v_count_unexpected;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: record_discrepancies is idempotent for both shapes';
END $$;
RESET ROLE;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 3c (B-1, re-review) — idempotency on the RECEPTION branch: mirrors
-- TEST 3 exactly, but through p_operation_type='reception'. Without this, a
-- mutant that deletes the two `ON CONFLICT ... DO NOTHING` clauses ONLY from
-- the reception branches (mig:141, mig:170) — leaving pickup's intact —
-- passes the whole 22/22 suite. A second call from a spec-81 offline retry
-- after a timeout would then hit a raw 23505 unique_violation on the
-- reception path and, being a batch statement, revert the entire reception
-- close.
-- =============================================================================
SAVEPOINT test_3c;

DO $$
DECLARE
  v_count_missing    INT;
  v_count_unexpected INT;
  v_items JSONB;
BEGIN
  PERFORM pg_temp.as_operator_a();

  v_items := jsonb_build_array(
    jsonb_build_object('kind', 'missing', 'package_id', '33330001-0000-0000-0000-000000000852'),
    jsonb_build_object('kind', 'unexpected', 'barcode', 'AJENO-RECEP-777')
  );

  PERFORM public.record_discrepancies('reception'::public.discrepancy_operation_enum,
    '66660001-0000-0000-0000-000000000852'::UUID, v_items);
  -- Second call: same items, same source. Must not duplicate, and must not
  -- raise a raw 23505 that would abort the whole batch.
  PERFORM public.record_discrepancies('reception'::public.discrepancy_operation_enum,
    '66660001-0000-0000-0000-000000000852'::UUID, v_items);

  RESET ROLE;

  SELECT COUNT(*) INTO v_count_missing
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND operation_type = 'reception'
     AND kind = 'missing' AND package_id = '33330001-0000-0000-0000-000000000852';
  SELECT COUNT(*) INTO v_count_unexpected
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND operation_type = 'reception'
     AND kind = 'unexpected' AND barcode = 'AJENO-RECEP-777';

  IF v_count_missing <> 1 THEN
    RAISE EXCEPTION 'TEST 3c FAILED: missing shape not idempotent on reception, got % rows', v_count_missing;
  END IF;
  IF v_count_unexpected <> 1 THEN
    RAISE EXCEPTION 'TEST 3c FAILED: unexpected shape not idempotent on reception, got % rows', v_count_unexpected;
  END IF;

  RAISE NOTICE '✓ TEST 3c PASSED: record_discrepancies is idempotent for both shapes on the reception branch';
END $$;
RESET ROLE;

ROLLBACK TO test_3c;

-- =============================================================================
-- TEST 3b (m3) — two identical items inside the SAME p_items array, in one
-- call, must still leave exactly one open row. Guards against a future
-- refactor from the per-item loop to a bulk `INSERT ... SELECT
-- jsonb_array_elements(...)`, which would reintroduce fase 1's C1 bug
-- (ON CONFLICT DO NOTHING inside one INSERT statement dedupes source rows
-- but not against each other unless the statement itself is written to).
-- =============================================================================
SAVEPOINT test_3b;

DO $$
DECLARE
  v_count INT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  PERFORM public.record_discrepancies(
    'pickup'::public.discrepancy_operation_enum,
    '44440001-0000-0000-0000-000000000852'::UUID,
    jsonb_build_array(
      jsonb_build_object('kind', 'unexpected', 'barcode', 'AJENO-DUP'),
      jsonb_build_object('kind', 'unexpected', 'barcode', 'AJENO-DUP')
    )
  );

  RESET ROLE;

  SELECT COUNT(*) INTO v_count
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND kind = 'unexpected' AND barcode = 'AJENO-DUP';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 3b FAILED: two identical items in one call produced % rows, expected 1', v_count;
  END IF;

  RAISE NOTICE '✓ TEST 3b PASSED: duplicate items within one p_items array do not duplicate rows';
END $$;
RESET ROLE;

ROLLBACK TO test_3b;

-- =============================================================================
-- TEST 4 — cross-tenant rejection on record_discrepancies: operator A cannot
-- record a discrepancy against operator B's manifest.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_sqlstate TEXT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.record_discrepancies(
      'pickup'::public.discrepancy_operation_enum,
      '44440002-0000-0000-0000-000000000852'::UUID, -- operator B's manifest
      jsonb_build_array(jsonb_build_object('kind', 'unexpected', 'barcode', 'X'))
    );
    RAISE EXCEPTION 'TEST 4 FAILED: record_discrepancies accepted a manifest belonging to another operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 4 FAILED%' THEN
        RAISE;
      END IF;
      -- M6: pin the SQLSTATE, not just "something was raised" — a mutant
      -- that downgrades the guard's ERRCODE to a plain P0001 validation
      -- must fail this test even though a rejection still occurs.
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 4 FAILED: expected ERRCODE 42501 for cross-tenant manifest, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 4 PASSED: cross-tenant manifest rejected with 42501 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 4b (B2) — cross-tenant rejection on the reception branch: operator A
-- cannot record a discrepancy against operator B's route_reception. Mirrors
-- TEST 4, on the branch the original suite never exercised.
-- =============================================================================
SAVEPOINT test_4b;

DO $$
DECLARE
  v_sqlstate TEXT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.record_discrepancies(
      'reception'::public.discrepancy_operation_enum,
      '66660002-0000-0000-0000-000000000852'::UUID, -- operator B's route_reception
      jsonb_build_array(jsonb_build_object('kind', 'unexpected', 'barcode', 'X'))
    );
    RAISE EXCEPTION 'TEST 4b FAILED: record_discrepancies accepted a route_reception belonging to another operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 4b FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 4b FAILED: expected ERRCODE 42501 for cross-tenant route_reception, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 4b PASSED: cross-tenant route_reception rejected with 42501 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_4b;

-- =============================================================================
-- TEST 5 — cross-tenant rejection: operator A cannot record a discrepancy
-- against a package_id belonging to operator B, even under A's own manifest.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_sqlstate TEXT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.record_discrepancies(
      'pickup'::public.discrepancy_operation_enum,
      '44440001-0000-0000-0000-000000000852'::UUID, -- A's own manifest
      jsonb_build_array(jsonb_build_object('kind', 'missing', 'package_id', '33330003-0000-0000-0000-000000000852')) -- B's package
    );
    RAISE EXCEPTION 'TEST 5 FAILED: record_discrepancies accepted a package_id belonging to another operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 5 FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 5 FAILED: expected ERRCODE 42501 for cross-tenant package_id, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 5 PASSED: cross-tenant package_id rejected with 42501 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 5b (B2) — reception happy path: 'missing' against A's own
-- route_reception inserts a row with route_reception_id set and
-- operation_type='reception'. The fixture existed unused before this fix.
-- =============================================================================
SAVEPOINT test_5b;

DO $$
DECLARE
  v_count INT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  PERFORM public.record_discrepancies(
    'reception'::public.discrepancy_operation_enum,
    '66660001-0000-0000-0000-000000000852'::UUID, -- A's own route_reception
    jsonb_build_array(
      jsonb_build_object('kind', 'missing', 'package_id', '33330001-0000-0000-0000-000000000852', 'note', 'no llegó en la recepción')
    )
  );

  RESET ROLE;

  SELECT COUNT(*) INTO v_count
    FROM public.discrepancies
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852'
     AND operation_type = 'reception'
     AND route_reception_id = '66660001-0000-0000-0000-000000000852'
     AND package_id = '33330001-0000-0000-0000-000000000852'
     AND status = 'open';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST 5b FAILED: expected exactly 1 open reception discrepancy, got %', v_count;
  END IF;

  RAISE NOTICE '✓ TEST 5b PASSED: record_discrepancies inserts a reception discrepancy';
END $$;
RESET ROLE;

ROLLBACK TO test_5b;

-- =============================================================================
-- TEST 5c (B2) — cross-tenant rejection on the reception branch's
-- package_id guard: operator A cannot record a 'missing' discrepancy against
-- operator B's package_id, even under A's own route_reception. This is the
-- reception-branch equivalent of TEST 5, on a code path fase 2's original
-- suite never exercised — the exact mutation the review named: deleting
-- `AND operator_id = v_operator` from the route_reception ownership guard
-- left this package_id guard as the only thing standing between A's JWT and
-- B's route_reception, and nothing in that guard looks at route_reception_id
-- at all.
-- =============================================================================
SAVEPOINT test_5c;

DO $$
DECLARE
  v_sqlstate TEXT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.record_discrepancies(
      'reception'::public.discrepancy_operation_enum,
      '66660001-0000-0000-0000-000000000852'::UUID, -- A's own route_reception
      jsonb_build_array(jsonb_build_object('kind', 'missing', 'package_id', '33330003-0000-0000-0000-000000000852')) -- B's package
    );
    RAISE EXCEPTION 'TEST 5c FAILED: record_discrepancies accepted a package_id belonging to another operator on the reception branch';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 5c FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 5c FAILED: expected ERRCODE 42501 for cross-tenant package_id on reception, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 5c PASSED: cross-tenant package_id rejected on reception branch with 42501 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_5c;

-- =============================================================================
-- TEST 6 — resolve_discrepancy, happy path open -> resolved.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_id     UUID;
  v_status public.discrepancy_status_enum;
  v_resolution TEXT;
  v_resolved_by UUID;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'para resolver')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'apareció en el siguiente camión');

  RESET ROLE;

  SELECT status, resolution, resolved_by_user_id INTO v_status, v_resolution, v_resolved_by
    FROM public.discrepancies WHERE id = v_id;

  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: expected status resolved, got %', v_status;
  END IF;
  IF v_resolution IS DISTINCT FROM 'apareció en el siguiente camión' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: resolution text not stored, got %', v_resolution;
  END IF;
  -- m2: attribution is the payload of this table.
  IF v_resolved_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000852'::UUID THEN
    RAISE EXCEPTION 'TEST 6 FAILED: resolved_by_user_id not attributed to the caller, got %', v_resolved_by;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: resolve_discrepancy moves open -> resolved with attribution';
END $$;
RESET ROLE;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 — resolve_discrepancy, happy path open -> lost.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_id     UUID;
  v_status public.discrepancy_status_enum;
  v_resolved_by UUID;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330002-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'para extraviar')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  PERFORM public.resolve_discrepancy(v_id, 'lost'::public.discrepancy_status_enum, 'nunca apareció, se cierra el caso');

  RESET ROLE;

  SELECT status, resolved_by_user_id INTO v_status, v_resolved_by FROM public.discrepancies WHERE id = v_id;

  IF v_status <> 'lost' THEN
    RAISE EXCEPTION 'TEST 7 FAILED: expected status lost, got %', v_status;
  END IF;
  IF v_resolved_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000852'::UUID THEN
    RAISE EXCEPTION 'TEST 7 FAILED: resolved_by_user_id not attributed to the caller, got %', v_resolved_by;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: resolve_discrepancy moves open -> lost with attribution';
END $$;
RESET ROLE;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 — resolve_discrepancy rejects reopening a resolved discrepancy.
--
-- B-2 (re-review): part (a) is NOT exercising the "closed evidence, cannot
-- reopen" guard (mig:264) at all — it never gets there. p_status='open' is
-- rejected 30 lines earlier by the enum validation (mig:233,
-- `p_status NOT IN ('resolved', 'lost')`), because 'open' is not a
-- resolve-target value under ANY circumstances, resolved row or not. Renamed
-- to say what it actually proves, and the SQLSTATE is now pinned to P0001 —
-- a mutant that widens the validation to
-- `p_status NOT IN ('resolved', 'lost', 'open')` must fail this test even
-- though *some* exception still gets raised (see TEST 8c for why that
-- mutant is dangerous on an OPEN row, not a resolved one).
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_id UUID;
  v_sqlstate TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, status, resolution, resolved_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852',
          'resolved', 'ya se resolvió antes', NOW())
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'open'::public.discrepancy_status_enum, 'quiero reabrirla');
    RAISE EXCEPTION 'TEST 8 FAILED: resolve_discrepancy accepted p_status = open';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 8 FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> 'P0001' THEN
        RAISE EXCEPTION 'TEST 8 FAILED: expected ERRCODE P0001 for p_status = open (enum validation, not the reopen guard), got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 8 PASSED (a): p_status = open rejected by enum validation with P0001, on a resolved row (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'lost'::public.discrepancy_status_enum, 'cambiar de resolved a lost');
    RAISE EXCEPTION 'TEST 8 FAILED: resolve_discrepancy allowed transitioning a resolved discrepancy to lost';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 8 FAILED%' THEN
        RAISE;
      END IF;
      DECLARE
        v_sqlstate TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
        -- B1: a closed discrepancy is "already happened", the repo's 23505
        -- idiom (see close_manifest, 20260913000002) — not P0002, which
        -- PostgREST maps to 404 and would read as "doesn't exist" to an
        -- offline retry queue (spec-81).
        IF v_sqlstate <> '23505' THEN
          RAISE EXCEPTION 'TEST 8 FAILED: expected ERRCODE 23505 for resolved -> lost, got % (%)', v_sqlstate, SQLERRM;
        END IF;
      END;
      RAISE NOTICE '✓ TEST 8 PASSED (b): resolved -> lost rejected with 23505 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 8c (B-2, re-review) — resolve_discrepancy(open row, p_status='open')
-- is rejected by the SAME enum validation as TEST 8(a), on a row that is
-- ALREADY open. This is the test TEST 8(a) could not stand in for: with a
-- resolved row, a mutant that lets 'open' through the enum validation still
-- gets caught downstream by the reopen guard (mig:264,
-- `v_row.status <> 'open'` — resolved <> open is true, so it still raises).
-- But on an OPEN row, that same guard reads `'open' <> 'open'` = false and
-- does NOT fire — with the mutant in place, the UPDATE would proceed
-- silently, writing `status='open', resolved_at=NOW(), resolved_by_user_id=…`
-- on a row that was never actually resolved: an open discrepancy that both
-- spec-83's shrinkage count and the resolution screen would then read as
-- something it is not. Asserts both the SQLSTATE and, more importantly, that
-- the row is untouched — the real failure mode here is silent corruption,
-- not a raised exception.
-- =============================================================================
SAVEPOINT test_8c;

DO $$
DECLARE
  v_id           UUID;
  v_sqlstate     TEXT;
  v_status       public.discrepancy_status_enum;
  v_resolved_at  TIMESTAMPTZ;
  v_resolved_by  UUID;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'todavía abierta')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'open'::public.discrepancy_status_enum, 'quiero "cerrarla" como open');
    RAISE EXCEPTION 'TEST 8c FAILED: resolve_discrepancy accepted p_status = open on an already-open row';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 8c FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> 'P0001' THEN
        RAISE EXCEPTION 'TEST 8c FAILED: expected ERRCODE P0001 for p_status = open on an open row, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 8c PASSED: p_status = open on an open row rejected by enum validation with P0001 (%)', SQLERRM;
  END;

  RESET ROLE;

  SELECT status, resolved_at, resolved_by_user_id INTO v_status, v_resolved_at, v_resolved_by
    FROM public.discrepancies WHERE id = v_id;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'TEST 8c FAILED: row status changed despite rejection, got %', v_status;
  END IF;
  IF v_resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 8c FAILED: resolved_at got populated on a rejected open->open call';
  END IF;
  IF v_resolved_by IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 8c FAILED: resolved_by_user_id got populated on a rejected open->open call';
  END IF;
END $$;
RESET ROLE;

ROLLBACK TO test_8c;

-- =============================================================================
-- TEST 9 — resolve_discrepancy's reopen rejection uses its own ERRCODE,
-- distinct from a plain validation failure (P0001), so a retrying offline
-- client (spec-81) can tell "already resolved, stop retrying" apart from
-- "malformed request, do not retry blindly". B1: that ERRCODE is 23505
-- (unique_violation, the repo's "this already happened" idiom -> HTTP 409),
-- not P0002 (Postgres's standard no_data_found -> PostgREST 404, which the
-- offline queue would read as "doesn't exist" and discard).
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_id UUID;
  v_sqlstate TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, status, resolution, resolved_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852',
          'lost', 'no volvió', NOW())
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'apareció después de todo');
    RAISE EXCEPTION 'TEST 9 FAILED: resolve_discrepancy allowed re-resolving a lost discrepancy';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '23505' THEN
        RAISE EXCEPTION 'TEST 9 FAILED: expected ERRCODE 23505 for reopen rejection, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 9 PASSED: reopen rejection raises 23505 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 9b (m5) — the literal idempotent retry a spec-81 offline queue makes:
-- calling resolve_discrepancy again with the SAME target status and
-- resolution text that already closed the row. Still rejected with 23505 —
-- "idempotent" here means the caller gets a stable, recognizable "already
-- done" response, not that the call silently no-ops.
-- =============================================================================
SAVEPOINT test_9b;

DO $$
DECLARE
  v_id UUID;
  v_sqlstate TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, status, resolution, resolved_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852',
          'resolved', 'apareció en el siguiente camión', NOW())
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  BEGIN
    -- Literal retry: identical status and resolution text to what is already stored.
    PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'apareció en el siguiente camión');
    RAISE EXCEPTION 'TEST 9b FAILED: resolve_discrepancy allowed a literal resolved -> resolved retry to silently succeed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 9b FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '23505' THEN
        RAISE EXCEPTION 'TEST 9b FAILED: expected ERRCODE 23505 for resolved -> resolved retry, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 9b PASSED: literal resolved -> resolved retry rejected with 23505 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_9b;

-- =============================================================================
-- TEST 10 — cross-tenant rejection on resolve_discrepancy: operator B cannot
-- resolve operator A's discrepancy.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  v_id UUID;
  v_status public.discrepancy_status_enum;
  v_sqlstate TEXT;
  v_current_user TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'de A')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_b();

  -- m6: pg_temp.as_operator_b() sets SET LOCAL role inside a function frame
  -- (fase 1 set it inline in the DO block) — assert the role switch actually
  -- took, not just that the JWT claim GUC is set.
  SELECT current_user INTO v_current_user;
  IF v_current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'TEST 10 FAILED: pg_temp.as_operator_b() did not switch role, current_user is %', v_current_user;
  END IF;

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'operator B intenta resolver');
    RAISE EXCEPTION 'TEST 10 FAILED: operator B resolved operator A''s discrepancy';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 10 FAILED%' THEN
        RAISE;
      END IF;
      -- M6: pin the SQLSTATE — a mutant that downgrades this guard's
      -- ERRCODE from 42501 to a plain P0001 must fail this test.
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 10 FAILED: expected ERRCODE 42501 for cross-tenant resolve, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 10 PASSED: cross-tenant resolve rejected with 42501 (%)', SQLERRM;
  END;

  RESET ROLE;

  SELECT status INTO v_status FROM public.discrepancies WHERE id = v_id;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'TEST 10 FAILED: discrepancy status changed despite rejection, got %', v_status;
  END IF;
END $$;
RESET ROLE;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 10b (M-5, re-review) — record_discrepancies rejects an authenticated
-- caller that resolves to no operator, with the sentinel-prefixed 42501
-- (mig:59). No test in the original suite ever called any of the three RPCs
-- without a valid operator behind the JWT, so a mutant downgrading this
-- specific RAISE to a plain P0001 survived 22/22.
-- =============================================================================
SAVEPOINT test_10b;

DO $$
DECLARE
  v_sqlstate TEXT;
BEGIN
  -- Authenticated role, but `sub` matches no row in public.users —
  -- get_operator_id() (20260216170542) resolves operator_id by looking up
  -- `id = auth.uid()`, not from an `operator_id` JWT claim, so this is the
  -- actual way to make it return NULL: an authenticated caller the operator
  -- roster does not know. Same synthetic-caller pattern as
  -- 20260813000002:110.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    PERFORM public.record_discrepancies(
      'pickup'::public.discrepancy_operation_enum,
      '44440001-0000-0000-0000-000000000852'::UUID,
      jsonb_build_array(jsonb_build_object('kind', 'unexpected', 'barcode', 'X'))
    );
    RAISE EXCEPTION 'TEST 10b FAILED: record_discrepancies accepted a caller with no resolvable operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 10b FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 10b FAILED: expected ERRCODE 42501 for no resolvable operator, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      IF SQLERRM NOT LIKE 'NO_OPERATOR_IN_JWT:%' THEN
        RAISE EXCEPTION 'TEST 10b FAILED: expected NO_OPERATOR_IN_JWT: sentinel prefix, got %', SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 10b PASSED: record_discrepancies rejects a caller with no resolvable operator (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_10b;

-- =============================================================================
-- TEST 10c (M-5, re-review) — resolve_discrepancy rejects the same missing-
-- operator_id JWT, with its own sentinel-prefixed 42501 (mig:229).
-- =============================================================================
SAVEPOINT test_10c;

DO $$
DECLARE
  v_id       UUID;
  v_sqlstate TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'de A')
  RETURNING id INTO v_id;

  -- Same synthetic-caller pattern as TEST 10b: a `sub` with no matching
  -- public.users row, not a missing `operator_id` JWT claim.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'algo');
    RAISE EXCEPTION 'TEST 10c FAILED: resolve_discrepancy accepted a JWT with no matching operator';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 10c FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 10c FAILED: expected ERRCODE 42501 for a JWT with no operator_id, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      IF SQLERRM NOT LIKE 'NO_OPERATOR_IN_JWT:%' THEN
        RAISE EXCEPTION 'TEST 10c FAILED: expected NO_OPERATOR_IN_JWT: sentinel prefix, got %', SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 10c PASSED: resolve_discrepancy rejects a JWT with no operator_id claim (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_10c;

-- =============================================================================
-- TEST 11 — lectura: get_discrepancies filters by operation_type and status,
-- and never returns another operator's rows.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE
  v_open_count INT;
  v_cross_count INT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
     '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'abierta A1'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-000000000852', 'missing', 'pickup',
     '33330003-0000-0000-0000-000000000852', '44440002-0000-0000-0000-000000000852', 'abierta B1');

  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, status, resolution, resolved_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330002-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852',
          'resolved', 'ya resuelta', NOW());

  PERFORM pg_temp.as_operator_a();

  SELECT COUNT(*) INTO v_open_count
    FROM public.get_discrepancies(p_operation_type := 'pickup'::public.discrepancy_operation_enum,
                                   p_status := 'open'::public.discrepancy_status_enum);

  SELECT COUNT(*) INTO v_cross_count
    FROM public.get_discrepancies(p_operation_type := 'pickup'::public.discrepancy_operation_enum)
   WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000852';

  RESET ROLE;

  IF v_open_count <> 1 THEN
    RAISE EXCEPTION 'TEST 11 FAILED: expected 1 open discrepancy for operator A, got %', v_open_count;
  END IF;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'TEST 11 FAILED: get_discrepancies leaked % row(s) from operator B', v_cross_count;
  END IF;

  RAISE NOTICE '✓ TEST 11 PASSED: get_discrepancies filters by operation_type/status and stays tenant-scoped';
END $$;
RESET ROLE;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12 (M7) — get_discrepancies filters by p_source_id, and never returns
-- soft-deleted rows. Both screens (Recogida/Recepción resolution) filter by
-- the manifest/route_reception they are looking at — without this filter
-- every call returns the whole tenant's history instead of one operation's.
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE
  v_source_count   INT;
  v_other_source_count INT;
  v_deleted_count  INT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'de la carga 1');

  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note, deleted_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330002-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'borrada', NOW());

  PERFORM pg_temp.as_operator_a();

  SELECT COUNT(*) INTO v_source_count
    FROM public.get_discrepancies(p_source_id := '44440001-0000-0000-0000-000000000852'::UUID);

  -- A source_id that has no rows at all — proves the filter narrows, not
  -- just that it's silently ignored.
  SELECT COUNT(*) INTO v_other_source_count
    FROM public.get_discrepancies(p_source_id := '66660001-0000-0000-0000-000000000852'::UUID);

  SELECT COUNT(*) INTO v_deleted_count
    FROM public.get_discrepancies(p_source_id := '44440001-0000-0000-0000-000000000852'::UUID)
   WHERE note = 'borrada';

  RESET ROLE;

  IF v_source_count <> 1 THEN
    RAISE EXCEPTION 'TEST 12 FAILED: p_source_id filter returned % rows, expected 1', v_source_count;
  END IF;
  IF v_other_source_count <> 0 THEN
    RAISE EXCEPTION 'TEST 12 FAILED: p_source_id filter leaked % row(s) from a different source', v_other_source_count;
  END IF;
  IF v_deleted_count <> 0 THEN
    RAISE EXCEPTION 'TEST 12 FAILED: get_discrepancies returned a soft-deleted row';
  END IF;

  RAISE NOTICE '✓ TEST 12 PASSED: get_discrepancies filters by p_source_id and excludes deleted_at';
END $$;
RESET ROLE;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13 (M3) — resolve_discrepancy with p_status = NULL raises a clean
-- P0001 validation error instead of falling through `NULL NOT IN (...)`
-- (which evaluates to NULL, not TRUE, so the guard never fires) into a raw
-- 23502 not-null violation on the UPDATE. Reachable from PostgREST with
-- {"p_status": null}.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  v_id UUID;
  v_sqlstate TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'de A')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, NULL::public.discrepancy_status_enum, 'algo');
    RAISE EXCEPTION 'TEST 13 FAILED: resolve_discrepancy accepted p_status = NULL';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 13 FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> 'P0001' THEN
        RAISE EXCEPTION 'TEST 13 FAILED: expected clean ERRCODE P0001 for p_status = NULL, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 13 PASSED: p_status = NULL rejected cleanly with P0001 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14 (M5) — record_discrepancies with p_items = '[]' returns an empty
-- set instead of raising. close_manifest (spec-80) is named as this RPC's
-- caller; a clean close (0 missing, 0 unexpected) must not fail the close
-- with a 400 precisely when nothing went wrong.
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE
  v_count INT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  SELECT COUNT(*) INTO v_count
    FROM public.record_discrepancies(
      'pickup'::public.discrepancy_operation_enum,
      '44440001-0000-0000-0000-000000000852'::UUID,
      '[]'::JSONB
    );

  RESET ROLE;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST 14 FAILED: expected 0 rows for an empty p_items array, got %', v_count;
  END IF;

  RAISE NOTICE '✓ TEST 14 PASSED: record_discrepancies with an empty p_items array returns an empty set, does not raise';
END $$;
RESET ROLE;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 14b (M-4, re-review) — record_discrepancies with p_items = '[]' still
-- rejects a cross-tenant p_source_id with 42501. Fixes the decision the
-- implementer made in M5 (ownership check moved BEFORE the empty-array early
-- return) — this test is what makes that ordering non-negotiable: a future
-- "simplification" that moves the early return back above the ownership
-- guard would silently let an empty-payload call through against a manifest
-- that does not belong to the caller.
-- =============================================================================
SAVEPOINT test_14b;

DO $$
DECLARE
  v_sqlstate TEXT;
BEGIN
  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.record_discrepancies(
      'pickup'::public.discrepancy_operation_enum,
      '44440002-0000-0000-0000-000000000852'::UUID, -- operator B's manifest
      '[]'::JSONB
    );
    RAISE EXCEPTION 'TEST 14b FAILED: record_discrepancies accepted an empty p_items array against another operator''s manifest';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 14b FAILED%' THEN
        RAISE;
      END IF;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate <> '42501' THEN
        RAISE EXCEPTION 'TEST 14b FAILED: expected ERRCODE 42501 for cross-tenant manifest with p_items = [], got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 14b PASSED: cross-tenant manifest rejected with 42501 even with an empty p_items array (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_14b;

-- =============================================================================
-- TEST 15 (m7) — no PUBLIC EXECUTE grant survives on any of the three RPCs.
-- Postgres's default ACL grants EXECUTE to PUBLIC on every new function;
-- fase 1 REVOKEd it explicitly on spec85_backfill_discrepancy_notes
-- (20260913000001:282) and this fase's three RPCs need the same treatment.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  v_leaked TEXT;
BEGIN
  -- aclexplode(proacl), not has_function_privilege(): the latter, called by
  -- postgres (superuser), always returns true regardless of ACL and would
  -- pass even with the REVOKE deleted. A NULL proacl means Postgres's
  -- implicit default ACL still applies — which grants EXECUTE to PUBLIC —
  -- so that also counts as leaked.
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL aclexplode(p.proacl) a ON a.grantee = 0 AND a.privilege_type = 'EXECUTE'
   WHERE n.nspname = 'public'
     AND p.proname IN ('record_discrepancies', 'resolve_discrepancy', 'get_discrepancies')
     AND (p.proacl IS NULL OR a.grantee IS NOT NULL);

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 15 FAILED: PUBLIC still has (or implicitly has) EXECUTE on: %', v_leaked;
  END IF;

  RAISE NOTICE '✓ TEST 15 PASSED: no PUBLIC EXECUTE grant survives on the three RPCs';
END $$;

ROLLBACK TO test_15;

-- =============================================================================
-- TEST 15b (M-5, re-review) — `anon` has no EXECUTE on any of the three RPCs.
-- The real ACL Supabase produces on a new function is
-- {postgres=X, anon=X, authenticated=X, service_role=X} — `anon` gets EXECUTE
-- from a default privilege grant made directly TO anon, not by inheriting
-- from PUBLIC. `REVOKE ALL ... FROM PUBLIC` (TEST 15) does not touch that
-- grant at all; only an explicit `REVOKE ALL ... FROM anon` does. There is
-- no live exploit today (the JWT guard rejects an unauthenticated caller
-- regardless), but leaving the grant in place is the exposure this repo's
-- convention exists to close off before it becomes one.
-- =============================================================================
SAVEPOINT test_15b;

DO $$
DECLARE
  v_leaked TEXT;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ') INTO v_leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
    JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
   WHERE n.nspname = 'public'
     AND p.proname IN ('record_discrepancies', 'resolve_discrepancy', 'get_discrepancies')
     AND p.proacl IS NOT NULL;

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 15b FAILED: anon still has EXECUTE on: %', v_leaked;
  END IF;

  RAISE NOTICE '✓ TEST 15b PASSED: anon has no EXECUTE grant on the three RPCs';
END $$;

ROLLBACK TO test_15b;

-- =============================================================================
-- TEST 16 (m10) — get_discrepancies is SECURITY INVOKER, not SECURITY
-- DEFINER. It relies on the table's own SELECT-only RLS + GRANT for tenant
-- scoping, unlike record_discrepancies/resolve_discrepancy which must be
-- DEFINER to write past that same RLS. A DEFINER get_discrepancies would run
-- as postgres and the explicit get_operator_id() filter in its body would be
-- the only thing standing between it and every tenant's rows.
-- =============================================================================
SAVEPOINT test_16;

DO $$
DECLARE
  v_is_definer BOOLEAN;
BEGIN
  SELECT p.prosecdef INTO v_is_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_discrepancies';

  IF v_is_definer THEN
    RAISE EXCEPTION 'TEST 16 FAILED: get_discrepancies is SECURITY DEFINER, expected SECURITY INVOKER';
  END IF;

  RAISE NOTICE '✓ TEST 16 PASSED: get_discrepancies is SECURITY INVOKER';
END $$;

ROLLBACK TO test_16;

ROLLBACK;
