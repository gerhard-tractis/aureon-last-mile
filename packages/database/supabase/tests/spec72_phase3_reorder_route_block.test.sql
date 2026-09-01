-- =============================================================================
-- spec-72 phase 3 — the manager reorder writer (move_route_block).
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_phase3_reorder_route_block.test.sql
--
-- House style, matching spec72_route_blocks.test.sql /
-- spec72_phase2_default_route_blocks.test.sql: fixtures inside one
-- transaction, SAVEPOINT per test, each test a DO block that RAISEs on
-- failure, ROLLBACK TO the savepoint so later tests are unaffected by an
-- earlier failure, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema/function existence ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'move_route_block'
  ) THEN
    RAISE EXCEPTION 'move_route_block function missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators (A, B), 1 user each, 3 comunas, orders (3 with
-- distinct comunas on operator A, 1 on operator B for cross-tenant tests) ──
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000723', 'Test Op 72p3 A', 'test-op-72-p3-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000723', 'Test Op 72p3 B', 'test-op-72-p3-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000173',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec72p3.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000723"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000173',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec72p3.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000723"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000173','aaaaaaaa-aaaa-aaaa-aaaa-000000000723','user-a@spec72p3.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000173','bbbbbbbb-bbbb-bbbb-bbbb-000000000723','user-b@spec72p3.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('55550001-0000-0000-0000-000000000723', '73201', 'Comuna P3 Uno', 'Provincia Test', 'Region Test', 98),
  ('55550002-0000-0000-0000-000000000723', '73202', 'Comuna P3 Dos', 'Provincia Test', 'Region Test', 98),
  ('55550003-0000-0000-0000-000000000723', '73203', 'Comuna P3 Tres', 'Provincia Test', 'Region Test', 98)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{}', true);

-- Orders 1/2/3: operator A, three distinct comunas.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660001-0000-0000-0000-000000000723', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723', 'ORD-72P3-1',
   'Cliente Uno', '+56911111111', 'Calle Falsa 1', 'Comuna P3 Uno',
   '55550001-0000-0000-0000-000000000723', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660002-0000-0000-0000-000000000723', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723', 'ORD-72P3-2',
   'Cliente Dos', '+56922222222', 'Calle Falsa 2', 'Comuna P3 Dos',
   '55550002-0000-0000-0000-000000000723', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660003-0000-0000-0000-000000000723', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723', 'ORD-72P3-3',
   'Cliente Tres', '+56933333333', 'Calle Falsa 3', 'Comuna P3 Tres',
   '55550003-0000-0000-0000-000000000723', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- Order 4: operator B — used only for the cross-tenant tests.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660004-0000-0000-0000-000000000723', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000723', 'ORD-72P3-4',
   'Cliente Cuatro', '+56944444444', 'Calle Falsa 4', 'Comuna P3 Uno',
   '55550001-0000-0000-0000-000000000723', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: move 'down' swaps the first block with the second, stamps the
-- MOVED block sequence_source='manual', leaves the neighbour's provenance
-- untouched (still 'default').
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  r jsonb; v_route_id uuid;
  v_block1 uuid; v_block2 uuid; v_block3 uuid;
  v_seq1 INT; v_seq2 INT; v_src1 TEXT; v_src2 TEXT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723',
          '66660003-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT id INTO v_block2 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'down');

  SELECT sequence_index, sequence_source INTO v_seq1, v_src1 FROM public.route_blocks WHERE id = v_block1;
  SELECT sequence_index, sequence_source INTO v_seq2, v_src2 FROM public.route_blocks WHERE id = v_block2;

  IF v_seq1 <> 2 THEN
    RAISE EXCEPTION 'TEST 1: expected block 1 to move to sequence_index 2, got %', v_seq1;
  END IF;
  IF v_seq2 <> 1 THEN
    RAISE EXCEPTION 'TEST 1: expected block 2 to move to sequence_index 1, got %', v_seq2;
  END IF;
  IF v_src1 <> 'manual' THEN
    RAISE EXCEPTION 'TEST 1: expected the MOVED block (block 1) to be stamped sequence_source=manual, got %', v_src1;
  END IF;
  IF v_src2 <> 'default' THEN
    RAISE EXCEPTION 'TEST 1: expected the neighbour (block 2) to keep sequence_source=default (it did not choose to move), got %', v_src2;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: move down swaps sequence_index, stamps only the moved block manual';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: move 'up' swaps the last block with the middle one.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  r jsonb; v_route_id uuid; v_block2 uuid; v_block3 uuid; v_seq2 INT; v_seq3 INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723',
          '66660003-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block2 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT id INTO v_block3 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550003-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block3, 'up');

  SELECT sequence_index INTO v_seq2 FROM public.route_blocks WHERE id = v_block2;
  SELECT sequence_index INTO v_seq3 FROM public.route_blocks WHERE id = v_block3;

  IF v_seq3 <> 2 OR v_seq2 <> 3 THEN
    RAISE EXCEPTION 'TEST 2: expected block 3 -> seq 2 and block 2 -> seq 3, got block3=%, block2=%', v_seq3, v_seq2;
  END IF;
  RAISE NOTICE '✓ TEST 2 PASSED: move up swaps the last block with its predecessor';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: moving the FIRST block up is a no-op (no neighbour), not an error.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; v_seq_before INT; v_seq_after INT; v_src_before TEXT; v_src_after TEXT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT sequence_index, sequence_source INTO v_seq_before, v_src_before FROM public.route_blocks WHERE id = v_block1;

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'up');

  SELECT sequence_index, sequence_source INTO v_seq_after, v_src_after FROM public.route_blocks WHERE id = v_block1;

  IF v_seq_after <> v_seq_before OR v_src_after <> v_src_before THEN
    RAISE EXCEPTION 'TEST 3: moving the first block up should be a no-op, got seq %->%, source %->%', v_seq_before, v_seq_after, v_src_before, v_src_after;
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: moving the first block up is a no-op, not an error';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: moving the LAST block down is a no-op.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block2 uuid; v_seq_before INT; v_seq_after INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block2 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT sequence_index INTO v_seq_before FROM public.route_blocks WHERE id = v_block2;

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block2, 'down');

  SELECT sequence_index INTO v_seq_after FROM public.route_blocks WHERE id = v_block2;

  IF v_seq_after <> v_seq_before THEN
    RAISE EXCEPTION 'TEST 4: moving the last block down should be a no-op, got %->%', v_seq_before, v_seq_after;
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: moving the last block down is a no-op';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5 (operator isolation, MUTATION-TARGETED): a caller passing the
-- CORRECT block id but operator B's operator_id must be refused with
-- ROUTE_NOT_FOUND, never silently reorder operator A's route. This is the
-- test that catches a dropped `AND operator_id = p_operator_id` filter on
-- the route lock.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; v_seq_before INT; v_seq_after INT; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT sequence_index INTO v_seq_before FROM public.route_blocks WHERE id = v_block1;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(v_route_id, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000723'::uuid, v_block1, 'down');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 5: expected ROUTE_NOT_FOUND when operator B tries to reorder operator A''s route, got no error';
  END IF;

  SELECT sequence_index INTO v_seq_after FROM public.route_blocks WHERE id = v_block1;
  IF v_seq_after <> v_seq_before THEN
    RAISE EXCEPTION 'TEST 5: operator A''s block was reordered by operator B''s call (seq %->%)', v_seq_before, v_seq_after;
  END IF;
  RAISE NOTICE '✓ TEST 5 PASSED: a foreign operator_id is refused with ROUTE_NOT_FOUND and never reorders the route';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: a nonexistent route raises ROUTE_NOT_FOUND (P0002).
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE raised BOOLEAN;
BEGIN
  raised := false;
  BEGIN
    PERFORM public.move_route_block(
      '00000000-0000-0000-0000-000000000000'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'up');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 6: expected ROUTE_NOT_FOUND for a nonexistent route, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: ROUTE_NOT_FOUND raised for a nonexistent route';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: a nonexistent block id raises BLOCK_NOT_FOUND (P0002), not a
-- silent no-op. (The soft-deleted-block case -- a row that DOES exist but
-- is filtered by `deleted_at IS NULL` -- is a materially different proof
-- and is covered separately by TEST 12 below; a random UUID here proves
-- nothing about that filter.)
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE r jsonb; v_route_id uuid; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(
      v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
      '00000000-0000-0000-0000-000000000002'::uuid, 'up');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 7: expected BLOCK_NOT_FOUND for a nonexistent block id, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 7 PASSED: BLOCK_NOT_FOUND raised for a nonexistent block';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: an invalid p_direction value is rejected.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;
  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'sideways');
  EXCEPTION WHEN OTHERS THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 8: expected an error for an invalid direction, got none';
  END IF;
  RAISE NOTICE '✓ TEST 8 PASSED: an invalid direction is rejected';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: no duplicate sequence_index ever exists after a swap — the
-- unique_route_block_sequence index is never transiently (or permanently)
-- violated. Runs three swaps back to back on a 3-block route.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; v_block3 uuid; dup_count INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723',
          '66660003-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;
  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT id INTO v_block3 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550003-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'down');
  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block3, 'up');
  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'up');

  SELECT COUNT(*) INTO dup_count FROM (
    SELECT sequence_index FROM public.route_blocks
     WHERE route_id = v_route_id AND deleted_at IS NULL
     GROUP BY sequence_index HAVING COUNT(*) > 1
  ) d;

  IF dup_count <> 0 THEN
    RAISE EXCEPTION 'TEST 9: found % duplicate sequence_index value(s) after repeated swaps', dup_count;
  END IF;
  RAISE NOTICE '✓ TEST 9 PASSED: sequence_index stays a strict total order across repeated swaps';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 (mutation-targeted): a "rogue" route_blocks row -- same route_id as
-- a legitimate operator-A route, but stamped with operator B's operator_id
-- (route_blocks.operator_id carries no FK-level cross-check against the
-- route's own operator_id, so this is a reachable data shape, not a
-- constraint violation -- same class of fixture as spec72 phase 2's TEST 8).
-- Calling move_route_block AS operator A, targeting that rogue block id,
-- must raise BLOCK_NOT_FOUND, not silently move it. This is what actually
-- isolates the block-level `AND operator_id = p_operator_id` filter: TEST 5
-- above is caught by EITHER the route-level or the block-level filter (both
-- point at the same operator in that scenario), so it alone does not prove
-- the block-level filter is load-bearing.
-- =============================================================================
SAVEPOINT test_10_rogue;

DO $$
DECLARE r jsonb; v_route_id uuid; v_rogue_block uuid; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  -- Rogue block: operator A's route_id, but operator B's operator_id.
  INSERT INTO public.route_blocks (id, operator_id, route_id, comuna_id, sequence_index, sequence_source)
  VALUES (gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-000000000723'::uuid, v_route_id,
          '55550003-0000-0000-0000-000000000723'::uuid, 99, 'default')
  RETURNING id INTO v_rogue_block;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(
      v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_rogue_block, 'up');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 10 (rogue): expected BLOCK_NOT_FOUND for a block row stamped with a different operator_id, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 10 (rogue) PASSED: a block row with a foreign operator_id is unreachable, even sharing the route_id';
END $$;

ROLLBACK TO test_10_rogue;

-- =============================================================================
-- TEST 11: end-to-end under RLS as 'authenticated' (not postgres). Every
-- earlier test in this file runs as postgres, which bypasses RLS entirely.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; v_seq1 INT; v_seq2 INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;
  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000173","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000723","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'down');

  RESET role;

  SELECT sequence_index INTO v_seq1 FROM public.route_blocks WHERE id = v_block1;
  IF v_seq1 <> 2 THEN
    RAISE EXCEPTION 'TEST 11: expected block 1 at sequence_index 2 after RLS-scoped move, got %', v_seq1;
  END IF;
  RAISE NOTICE '✓ TEST 11 PASSED: move_route_block works end-to-end under RLS as authenticated';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12 (review item 3, mutation-targeted): a soft-deleted block cannot be
-- moved. TEST 7 above only proves a nonexistent id is refused; this is what
-- actually exercises the `AND deleted_at IS NULL` filter on the TARGET
-- block lookup -- a random UUID (TEST 7's fixture) is caught by the row
-- simply not existing at all, which is a weaker proof than a row that DOES
-- exist but is soft-deleted.
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block2 uuid; v_seq_before INT; v_seq_after INT; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723',
          '66660003-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block2 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT sequence_index INTO v_seq_before FROM public.route_blocks WHERE id = v_block2;

  UPDATE public.route_blocks SET deleted_at = now() WHERE id = v_block2;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block2, 'up');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 12: expected BLOCK_NOT_FOUND for a soft-deleted target block, got no error';
  END IF;

  -- Bypass the soft-delete filter to confirm the row itself was never
  -- touched by the aborted call.
  SELECT sequence_index INTO v_seq_after FROM public.route_blocks WHERE id = v_block2;
  IF v_seq_after <> v_seq_before THEN
    RAISE EXCEPTION 'TEST 12: a soft-deleted block''s sequence_index changed (%->%) despite BLOCK_NOT_FOUND', v_seq_before, v_seq_after;
  END IF;
  RAISE NOTICE '✓ TEST 12 PASSED: a soft-deleted target block raises BLOCK_NOT_FOUND and is left untouched';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13 (review item 3, mutation-targeted): a live block moving past a
-- soft-deleted one skips to the correct live neighbour by RANK, not by
-- sequence_index +/- 1 arithmetic. Four blocks seeded at sequence_index
-- 1,2,3,4; the block at 3 is soft-deleted, leaving live indices 1, 2, 4 --
-- a real gap, the same shape a mid-list soft-delete always produces (see
-- spec-72 review item 7 / "Record for phases 4-5"). Moving the block at
-- live index 2 'down' must swap with the block at live index 4 (the next
-- LIVE row by rank), never with the soft-deleted row at 3 and never by
-- computing "2 + 1 = 3" and looking for that literal value. This is what
-- exercises the `AND deleted_at IS NULL` filter on the NEIGHBOUR lookup --
-- TEST 12 above only covers the filter on the target block lookup.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  r jsonb; v_route_id uuid;
  v_block1 uuid; v_block2 uuid; v_block3 uuid; v_block4 uuid;
  v_seq1 INT; v_seq2 INT; v_seq3 INT; v_seq4 INT;
BEGIN
  INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
  VALUES ('55550004-0000-0000-0000-000000000723', '73204', 'Comuna P3 Cuatro', 'Provincia Test', 'Region Test', 98)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
  VALUES ('66660006-0000-0000-0000-000000000723', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723', 'ORD-72P3-6',
    'Cliente Seis', '+56966666666', 'Calle Falsa 6', 'Comuna P3 Cuatro',
    '55550004-0000-0000-0000-000000000723', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
  ON CONFLICT (id) DO NOTHING;

  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723',
          '66660003-0000-0000-0000-000000000723',
          '66660006-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT id INTO v_block2 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT id INTO v_block3 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550003-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT id INTO v_block4 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550004-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  -- Sanity: seeded 1,2,3,4 in that order.
  SELECT sequence_index INTO v_seq3 FROM public.route_blocks WHERE id = v_block3;
  IF v_seq3 <> 3 THEN
    RAISE EXCEPTION 'TEST 13 setup: expected block 3 at sequence_index 3, got %', v_seq3;
  END IF;

  -- Soft-delete the block at sequence_index 3, opening a gap: live indices
  -- become 1, 2, 4.
  UPDATE public.route_blocks SET deleted_at = now() WHERE id = v_block3;

  -- Move the block at live index 2 down. Its live neighbour by rank is the
  -- block at 4 (index 3 is dead), not "sequence_index 3" literally.
  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block2, 'down');

  SELECT sequence_index INTO v_seq1 FROM public.route_blocks WHERE id = v_block1;
  SELECT sequence_index INTO v_seq2 FROM public.route_blocks WHERE id = v_block2;
  SELECT sequence_index INTO v_seq3 FROM public.route_blocks WHERE id = v_block3;
  SELECT sequence_index INTO v_seq4 FROM public.route_blocks WHERE id = v_block4;

  IF v_seq1 <> 1 THEN
    RAISE EXCEPTION 'TEST 13: block 1 (untouched) should stay at sequence_index 1, got %', v_seq1;
  END IF;
  IF v_seq2 <> 4 THEN
    RAISE EXCEPTION 'TEST 13: block 2 should land at sequence_index 4 (swapped with its live neighbour, skipping the dead block at 3), got %', v_seq2;
  END IF;
  IF v_seq3 <> 3 THEN
    RAISE EXCEPTION 'TEST 13: the soft-deleted block 3 must be untouched (still at 3), got %', v_seq3;
  END IF;
  IF v_seq4 <> 2 THEN
    RAISE EXCEPTION 'TEST 13: block 4 should land at sequence_index 2 (the slot block 2 vacated), got %', v_seq4;
  END IF;

  RAISE NOTICE '✓ TEST 13 PASSED: a live block moving past a soft-deleted one swaps with the correct live neighbour by rank';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14 (review item 1, BLOCKER): reordering a route past the loading
-- window is refused with ROUTE_SEALED (P0001), not silently accepted --
-- exercised for both `loaded` (sealed manifest) and `dispatched` (one-way
-- door), matching packages/[pkgId] DELETE's REMOVABLE_FROM set exactly.
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; v_seq_before INT; v_seq_after INT; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;
  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;
  SELECT sequence_index INTO v_seq_before FROM public.route_blocks WHERE id = v_block1;

  -- (a) 'loaded' -- the manifest is sealed.
  UPDATE public.routes SET status = 'loaded' WHERE id = v_route_id;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'down');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 14a: expected ROUTE_SEALED for a loaded route, got no error';
  END IF;

  -- (b) 'dispatched' -- a one-way door.
  UPDATE public.routes SET status = 'dispatched' WHERE id = v_route_id;

  raised := false;
  BEGIN
    PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'down');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 14b: expected ROUTE_SEALED for a dispatched route, got no error';
  END IF;

  SELECT sequence_index INTO v_seq_after FROM public.route_blocks WHERE id = v_block1;
  IF v_seq_after <> v_seq_before THEN
    RAISE EXCEPTION 'TEST 14: block was reordered despite ROUTE_SEALED (seq %->%)', v_seq_before, v_seq_after;
  END IF;
  RAISE NOTICE '✓ TEST 14 PASSED: reordering a loaded or dispatched route is refused with ROUTE_SEALED, never silently applied';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15 (positive control for TEST 14): 'loading' -- still inside the
-- editable window -- is NOT refused. Without this, a mutant that widens the
-- status check to exclude 'loading' too would survive TEST 14 alone.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE r jsonb; v_route_id uuid; v_block1 uuid; v_seq_after INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000723',
          '66660002-0000-0000-0000-000000000723'],
    NULL);
  v_route_id := (r->>'id')::uuid;
  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000723' AND deleted_at IS NULL;

  UPDATE public.routes SET status = 'loading' WHERE id = v_route_id;

  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000723'::uuid, v_block1, 'down');

  SELECT sequence_index INTO v_seq_after FROM public.route_blocks WHERE id = v_block1;
  IF v_seq_after <> 2 THEN
    RAISE EXCEPTION 'TEST 15: expected the move to succeed while status=loading (seq -> 2), got %', v_seq_after;
  END IF;
  RAISE NOTICE '✓ TEST 15 PASSED: reordering a route still in loading succeeds';
END $$;

ROLLBACK TO test_15;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72 phase3 reorder-route-block tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
