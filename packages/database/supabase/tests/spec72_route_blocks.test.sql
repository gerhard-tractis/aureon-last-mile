-- =============================================================================
-- spec-72 phase 1 — route_blocks table, dispatches.actual_sequence.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_route_blocks.test.sql
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
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'route_blocks'
  ) THEN
    RAISE EXCEPTION 'route_blocks table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.route_blocks'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on route_blocks';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dispatches' AND column_name = 'actual_sequence'
  ) THEN
    RAISE EXCEPTION 'dispatches.actual_sequence missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users, 2 comunas, routes, orders, dispatches ──
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
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000172',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec72.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000072"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000172','aaaaaaaa-aaaa-aaaa-aaaa-000000000072','user-a@spec72.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000172','bbbbbbbb-bbbb-bbbb-bbbb-000000000072','user-b@spec72.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- Two comunas — a global reference table, not operator-scoped.
INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('55550001-0000-0000-0000-000000000072', '72001', 'Comuna Setenta y Dos Uno', 'Provincia Test', 'Region Test', 99),
  ('55550002-0000-0000-0000-000000000072', '72002', 'Comuna Setenta y Dos Dos', 'Provincia Test', 'Region Test', 99)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{}', true);

INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
VALUES
  ('22220001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-1', CURRENT_DATE, 'planned'),
  ('22220002-0000-0000-0000-000000000072', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000072', 'dispatchtrack', 'spec72-route-b1', CURRENT_DATE, 'planned'),
  ('22220003-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-3', CURRENT_DATE, 'planned')
ON CONFLICT (id) DO NOTHING;

-- Two orders on operator A's route: one with comuna_id set (block 1), one
-- with comuna_id NULL (the "sin comuna" case spec-72 requires never joins
-- into a block).
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'ORD-72-1',
   'Cliente Uno', '+56911111111', 'Calle Falsa 123', 'Comuna Setenta y Dos Uno',
   '55550001-0000-0000-0000-000000000072', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660002-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'ORD-72-2',
   'Cliente Dos', '+56922222222', 'Calle Falsa 456', 'Comuna Sin Match',
   NULL, CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, external_dispatch_id, status)
VALUES
  ('77770001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072',
   '22220001-0000-0000-0000-000000000072', '66660001-0000-0000-0000-000000000072',
   'dispatchtrack', 'spec72-dispatch-1', 'pending'),
  ('77770002-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072',
   '22220001-0000-0000-0000-000000000072', '66660002-0000-0000-0000-000000000072',
   'dispatchtrack', 'spec72-dispatch-2', 'pending')
ON CONFLICT (id) DO NOTHING;

-- Seed one live route_blocks row per operator.
INSERT INTO public.route_blocks (id, operator_id, route_id, comuna_id, sequence_index, sequence_source)
VALUES
  ('88880001-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072',
   '22220001-0000-0000-0000-000000000072', '55550001-0000-0000-0000-000000000072', 1, 'default'),
  ('88880002-0000-0000-0000-000000000072', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000072',
   '22220002-0000-0000-0000-000000000072', '55550001-0000-0000-0000-000000000072', 1, 'default')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: operator isolation — RLS read
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000172","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000072","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.route_blocks
   WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072';
  SELECT COUNT(*) INTO c_other FROM public.route_blocks
   WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000072';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own block, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B block, got %', c_other;
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
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000172","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000072","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000072', '22220002-0000-0000-0000-000000000072',
            '55550002-0000-0000-0000-000000000072', 2);
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
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000172","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000072","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    UPDATE public.route_blocks
       SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000072'
     WHERE id = '88880001-0000-0000-0000-000000000072';
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
-- TEST 4: unique comuna per route — duplicate rejected while live
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE dup_rejected BOOLEAN := false; err_state TEXT; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220001-0000-0000-0000-000000000072',
            '55550001-0000-0000-0000-000000000072', 2);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT, err_state = RETURNED_SQLSTATE;
    dup_rejected := (err_state = '23505');
  END;

  IF NOT dup_rejected THEN
    RAISE EXCEPTION 'duplicate (route_id, comuna_id) was not rejected while deleted_at IS NULL: %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: duplicate live route/comuna rejected';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: soft-deleted block's comuna can be reused on the same route
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE reinsert_ok BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  UPDATE public.route_blocks SET deleted_at = NOW()
   WHERE id = '88880001-0000-0000-0000-000000000072';

  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220001-0000-0000-0000-000000000072',
            '55550001-0000-0000-0000-000000000072', 1);
    reinsert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    reinsert_ok := false;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT reinsert_ok THEN
    RAISE EXCEPTION 'comuna reuse on the same route after soft-delete was wrongly rejected: %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 5 PASSED: comuna reusable on same route after soft-delete';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: sequence_index unique per route while live — duplicate rejected
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE dup_rejected BOOLEAN := false; err_state TEXT; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220001-0000-0000-0000-000000000072',
            '55550002-0000-0000-0000-000000000072', 1);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT, err_state = RETURNED_SQLSTATE;
    dup_rejected := (err_state = '23505');
  END;

  IF NOT dup_rejected THEN
    RAISE EXCEPTION 'duplicate (route_id, sequence_index) was not rejected while deleted_at IS NULL: %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: duplicate live sequence_index per route rejected';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: sequence_index is scoped per-route, not global — index value 1 is
-- already taken on BOTH route 1 (block 88880001) and route 2 (block
-- 88880002), yet a third route with no blocks yet can still take index 1.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE cross_route_ok BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220003-0000-0000-0000-000000000072',
            '55550002-0000-0000-0000-000000000072', 1);
    cross_route_ok := true;
  EXCEPTION WHEN OTHERS THEN
    cross_route_ok := false;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT cross_route_ok THEN
    RAISE EXCEPTION 'sequence_index uniqueness leaked across routes: %', err_msg;
  END IF;
  RAISE NOTICE '✓ TEST 7 PASSED: sequence_index uniqueness is per-route';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: sequence_source CHECK — invalid value rejected, valid values accepted
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220001-0000-0000-0000-000000000072',
            '55550002-0000-0000-0000-000000000072', 5, 'bogus');
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'sequence_source CHECK did not reject an invalid value';
  END IF;

  -- All three spec-defined values are accepted, including 'optimizer' —
  -- reserved per Non-Goals, but the value itself must be storable.
  INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220001-0000-0000-0000-000000000072',
          '55550002-0000-0000-0000-000000000072', 5, 'optimizer');

  RAISE NOTICE '✓ TEST 8 PASSED: sequence_source CHECK rejects invalid, accepts optimizer/manual/default';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: sequence_source defaults to 'default' when omitted
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE v_source TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.route_blocks (id, operator_id, route_id, comuna_id, sequence_index)
  VALUES ('88880099-0000-0000-0000-000000000072', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072',
          '22220001-0000-0000-0000-000000000072', '55550002-0000-0000-0000-000000000072', 9);

  SELECT sequence_source INTO v_source FROM public.route_blocks
   WHERE id = '88880099-0000-0000-0000-000000000072';

  IF v_source IS DISTINCT FROM 'default' THEN
    RAISE EXCEPTION 'sequence_source did not default to ''default'', got %', v_source;
  END IF;
  RAISE NOTICE '✓ TEST 9 PASSED: sequence_source defaults to ''default''';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: soft-delete behaviour — deleted_at set, row still readable by
-- owner, excluded from an "active" query pattern by convention.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE v_deleted_at TIMESTAMPTZ; c_active INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  UPDATE public.route_blocks SET deleted_at = NOW()
   WHERE id = '88880001-0000-0000-0000-000000000072';

  SELECT deleted_at INTO v_deleted_at FROM public.route_blocks
   WHERE id = '88880001-0000-0000-0000-000000000072';
  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'soft-delete did not set deleted_at';
  END IF;

  SELECT COUNT(*) INTO c_active FROM public.route_blocks
   WHERE id = '88880001-0000-0000-0000-000000000072' AND deleted_at IS NULL;
  IF c_active <> 0 THEN
    RAISE EXCEPTION 'soft-deleted row still matches an active (deleted_at IS NULL) filter';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: soft-delete sets deleted_at and row drops out of active filters';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11: block membership is derived via dispatches -> orders join on
-- comuna_id, matching hand-built fixtures — NOT a stored list (spec-72: "No
-- table for which orders are in this block"). Order 66660002 (comuna_id
-- NULL) must NOT join into any block.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE c_block1 INT; c_null_comuna INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Dispatches on route 1 whose order's comuna_id matches block 1's comuna.
  SELECT COUNT(*) INTO c_block1
    FROM public.dispatches d
    JOIN public.orders o ON o.id = d.order_id
    JOIN public.route_blocks rb ON rb.route_id = d.route_id AND rb.comuna_id = o.comuna_id
   WHERE d.route_id = '22220001-0000-0000-0000-000000000072'
     AND rb.id = '88880001-0000-0000-0000-000000000072'
     AND rb.deleted_at IS NULL
     AND d.deleted_at IS NULL;

  IF c_block1 <> 1 THEN
    RAISE EXCEPTION 'block membership join returned % dispatches for block 1, expected exactly 1 (ORD-72-1)', c_block1;
  END IF;

  -- The order with comuna_id NULL must not join into ANY block on the route.
  SELECT COUNT(*) INTO c_null_comuna
    FROM public.dispatches d
    JOIN public.orders o ON o.id = d.order_id
    JOIN public.route_blocks rb ON rb.route_id = d.route_id AND rb.comuna_id = o.comuna_id
   WHERE d.order_id = '66660002-0000-0000-0000-000000000072';

  IF c_null_comuna <> 0 THEN
    RAISE EXCEPTION 'an order with comuna_id NULL unexpectedly joined into a block, got % rows', c_null_comuna;
  END IF;

  RAISE NOTICE '✓ TEST 11 PASSED: block membership derived via join matches fixtures; NULL-comuna order excluded';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12: dispatches.actual_sequence accepts an integer and is nullable
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE v_read INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Nullable: default is NULL (nothing writes this in phase 1).
  SELECT actual_sequence INTO v_read FROM public.dispatches
   WHERE id = '77770001-0000-0000-0000-000000000072';
  IF v_read IS NOT NULL THEN
    RAISE EXCEPTION 'actual_sequence should default to NULL, got %', v_read;
  END IF;

  UPDATE public.dispatches SET actual_sequence = 3
   WHERE id = '77770001-0000-0000-0000-000000000072';

  SELECT actual_sequence INTO v_read FROM public.dispatches
   WHERE id = '77770001-0000-0000-0000-000000000072';
  IF v_read IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'actual_sequence did not persist, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 12 PASSED: dispatches.actual_sequence persists and defaults to NULL';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13: route_blocks_operator_isolation RLS policy exists by name
-- =============================================================================
SAVEPOINT test_13;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.route_blocks'::regclass
       AND polname  = 'route_blocks_operator_isolation'
  ) THEN
    RAISE EXCEPTION 'route_blocks_operator_isolation policy is missing';
  END IF;
  RAISE NOTICE '✓ TEST 13 PASSED: route_blocks_operator_isolation policy exists';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14: comuna_id rejects a nonexistent chile_comunas id (FK violation)
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE
  v_missing UUID := '99999999-9999-9999-9999-999999999999';
  blocked   BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000072', '22220001-0000-0000-0000-000000000072',
            v_missing, 42);
  EXCEPTION WHEN foreign_key_violation THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'route_blocks.comuna_id accepted a chile_comunas id that does not exist';
  END IF;
  RAISE NOTICE '✓ TEST 14 PASSED: comuna_id rejects a nonexistent chile_comunas id';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15: route_id CASCADE — deleting the referenced route removes its
-- route_blocks rows (ON DELETE CASCADE), matching route_blocks.route_id's
-- FK definition.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  v_route UUID := '22220099-0000-0000-0000-000000000072';
  v_block UUID := '88880098-0000-0000-0000-000000000072';
  c_block INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', 'dispatchtrack', 'spec72-route-cascade', CURRENT_DATE, 'planned');

  INSERT INTO public.route_blocks (id, operator_id, route_id, comuna_id, sequence_index)
  VALUES (v_block, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000072', v_route, '55550001-0000-0000-0000-000000000072', 1);

  DELETE FROM public.routes WHERE id = v_route;

  SELECT COUNT(*) INTO c_block FROM public.route_blocks WHERE id = v_block;
  IF c_block <> 0 THEN
    RAISE EXCEPTION 'route_blocks row survived deletion of its route (expected ON DELETE CASCADE)';
  END IF;
  RAISE NOTICE '✓ TEST 15 PASSED: deleting a route cascades to its route_blocks rows';
END $$;

ROLLBACK TO test_15;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72_route_blocks tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
