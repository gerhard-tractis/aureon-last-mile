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
  ('88880001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'T85R2-PLATE');

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES
  ('55550001-0000-0000-0000-000000000852', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000852',
   'PR-T85R2-0001', 'aaaaaaaa-0000-4000-a000-000000000852', '88880001-0000-0000-0000-000000000852', 'in_progress');

INSERT INTO public.route_receptions (id, pickup_route_id, operator_id, delivered_by, status)
VALUES
  ('66660001-0000-0000-0000-000000000852', '55550001-0000-0000-0000-000000000852',
   'aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'aaaaaaaa-0000-4000-a000-000000000852', 'pending');

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
  v_count INT;
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

  RAISE NOTICE '✓ TEST 1 PASSED: record_discrepancies inserts a missing discrepancy';
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
  v_count INT;
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

  RAISE NOTICE '✓ TEST 2 PASSED: record_discrepancies inserts an unexpected discrepancy';
END $$;
RESET ROLE;

ROLLBACK TO test_2;

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
-- TEST 4 — cross-tenant rejection on record_discrepancies: operator A cannot
-- record a discrepancy against operator B's manifest.
-- =============================================================================
SAVEPOINT test_4;

DO $$
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
      RAISE NOTICE '✓ TEST 4 PASSED: cross-tenant manifest rejected (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5 — cross-tenant rejection: operator A cannot record a discrepancy
-- against a package_id belonging to operator B, even under A's own manifest.
-- =============================================================================
SAVEPOINT test_5;

DO $$
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
      RAISE NOTICE '✓ TEST 5 PASSED: cross-tenant package_id rejected (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6 — resolve_discrepancy, happy path open -> resolved.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_id     UUID;
  v_status public.discrepancy_status_enum;
  v_resolution TEXT;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'para resolver')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'apareció en el siguiente camión');

  RESET ROLE;

  SELECT status, resolution INTO v_status, v_resolution FROM public.discrepancies WHERE id = v_id;

  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: expected status resolved, got %', v_status;
  END IF;
  IF v_resolution IS DISTINCT FROM 'apareció en el siguiente camión' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: resolution text not stored, got %', v_resolution;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: resolve_discrepancy moves open -> resolved';
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
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330002-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'para extraviar')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  PERFORM public.resolve_discrepancy(v_id, 'lost'::public.discrepancy_status_enum, 'nunca apareció, se cierra el caso');

  RESET ROLE;

  SELECT status INTO v_status FROM public.discrepancies WHERE id = v_id;

  IF v_status <> 'lost' THEN
    RAISE EXCEPTION 'TEST 7 FAILED: expected status lost, got %', v_status;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: resolve_discrepancy moves open -> lost';
END $$;
RESET ROLE;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 — resolve_discrepancy rejects reopening a resolved discrepancy.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, status, resolution, resolved_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852',
          'resolved', 'ya se resolvió antes', NOW())
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_a();

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'open'::public.discrepancy_status_enum, 'quiero reabrirla');
    RAISE EXCEPTION 'TEST 8 FAILED: resolve_discrepancy allowed reopening a resolved discrepancy';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 8 FAILED%' THEN
        RAISE;
      END IF;
      RAISE NOTICE '✓ TEST 8 PASSED (a): reopen to open rejected (%)', SQLERRM;
  END;

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'lost'::public.discrepancy_status_enum, 'cambiar de resolved a lost');
    RAISE EXCEPTION 'TEST 8 FAILED: resolve_discrepancy allowed transitioning a resolved discrepancy to lost';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 8 FAILED%' THEN
        RAISE;
      END IF;
      RAISE NOTICE '✓ TEST 8 PASSED (b): resolved -> lost rejected (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 — resolve_discrepancy's reopen rejection uses its own ERRCODE,
-- distinct from a plain validation failure (P0001), so a retrying offline
-- client (spec-81) can tell "already resolved, stop retrying" apart from
-- "malformed request, do not retry blindly".
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
      IF v_sqlstate <> 'P0002' THEN
        RAISE EXCEPTION 'TEST 9 FAILED: expected ERRCODE P0002 for reopen rejection, got % (%)', v_sqlstate, SQLERRM;
      END IF;
      RAISE NOTICE '✓ TEST 9 PASSED: reopen rejection raises P0002 (%)', SQLERRM;
  END;

  RESET ROLE;
END $$;
RESET ROLE;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 — cross-tenant rejection on resolve_discrepancy: operator B cannot
-- resolve operator A's discrepancy.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  v_id UUID;
  v_status public.discrepancy_status_enum;
BEGIN
  INSERT INTO public.discrepancies (operator_id, kind, operation_type, package_id, manifest_id, note)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000852', 'missing', 'pickup',
          '33330001-0000-0000-0000-000000000852', '44440001-0000-0000-0000-000000000852', 'de A')
  RETURNING id INTO v_id;

  PERFORM pg_temp.as_operator_b();

  BEGIN
    PERFORM public.resolve_discrepancy(v_id, 'resolved'::public.discrepancy_status_enum, 'operator B intenta resolver');
    RAISE EXCEPTION 'TEST 10 FAILED: operator B resolved operator A''s discrepancy';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'TEST 10 FAILED%' THEN
        RAISE;
      END IF;
      RAISE NOTICE '✓ TEST 10 PASSED: cross-tenant resolve rejected (%)', SQLERRM;
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

ROLLBACK;
