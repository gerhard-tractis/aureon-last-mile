-- =============================================================================
-- spec-72 phase 3 review item 2 — seed_default_route_blocks made re-runnable
-- (appends new comunas without touching existing rows).
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_phase3_reseed_route_blocks.test.sql
--
-- spec72_phase2_default_route_blocks.test.sql already covers TEST 4/5/7 of
-- the ORIGINAL all-or-nothing no-op contract and continues to pass
-- unmodified against this new definition (see this migration's header
-- comment). This suite covers only the NEW behaviour: appending blocks for
-- comunas that gained a live dispatch after the route was first seeded —
-- the scan-adopt / empty-draft-route gap spec-72 phase 2's migration
-- deferred to phase 3.
--
-- House style, matching the other spec72 phase3 suites: fixtures inside one
-- transaction, SAVEPOINT per test, each test a DO block that RAISEs on
-- failure, ROLLBACK TO the savepoint, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'seed_default_route_blocks'
  ) THEN
    RAISE EXCEPTION 'seed_default_route_blocks function missing';
  END IF;
END $$;

-- ─── Fixture: 1 operator, 1 user, 4 comunas, 4 orders (operator A only —
-- this suite is about the append behaviour, not cross-tenant isolation,
-- which spec72_phase2/phase3's own suites already cover for this function
-- and move_route_block respectively) ───────────────────────────────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'Test Op 72p3 Reseed', 'test-op-72-p3-reseed', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000175',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec72p3reseed.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000725"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000175','aaaaaaaa-aaaa-aaaa-aaaa-000000000725','user-a@spec72p3reseed.test','User A',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('55550001-0000-0000-0000-000000000725', '75201', 'Comuna P3 Reseed Uno', 'Provincia Test', 'Region Test', 96),
  ('55550002-0000-0000-0000-000000000725', '75202', 'Comuna P3 Reseed Dos', 'Provincia Test', 'Region Test', 96),
  ('55550003-0000-0000-0000-000000000725', '75203', 'Comuna P3 Reseed Tres', 'Provincia Test', 'Region Test', 96)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{}', true);

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660001-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P3R-1',
   'Cliente Uno', '+56911111111', 'Calle Falsa 1', 'Comuna P3 Reseed Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660002-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P3R-2',
   'Cliente Dos', '+56922222222', 'Calle Falsa 2', 'Comuna P3 Reseed Dos',
   '55550002-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660003-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P3R-3',
   'Cliente Tres (scan-adopted later)', '+56933333333', 'Calle Falsa 3', 'Comuna P3 Reseed Tres',
   '55550003-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: the empty-draft-route case. A route created directly (no
-- create_seeded_route, no dispatches — mirrors createEmptyDraft) has zero
-- blocks. Simulate a scan-adopt INSERT INTO dispatches directly, then call
-- seed_default_route_blocks: it must produce exactly one block, at
-- sequence_index 1.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE v_route_id uuid := '99990001-0000-0000-0000-000000000725'; n_blocks INT; v_seq INT;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725',
          'dispatchtrack', 'spec72p3r-test1', CURRENT_DATE, 'draft', 0, 0);

  -- Scan-adopt shape: a dispatch inserted directly onto an existing route,
  -- no seeding call alongside it.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES (v_route_id, '66660001-0000-0000-0000-000000000725',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'pending', 'dispatchtrack');

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_blocks <> 0 THEN
    RAISE EXCEPTION 'TEST 1 setup: expected 0 blocks before the writer runs, got %', n_blocks;
  END IF;

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_blocks <> 1 THEN
    RAISE EXCEPTION 'TEST 1: expected exactly 1 block for the empty-draft-then-scan-adopted route, got %', n_blocks;
  END IF;

  SELECT sequence_index INTO v_seq FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000725' AND deleted_at IS NULL;
  IF v_seq <> 1 THEN
    RAISE EXCEPTION 'TEST 1: expected sequence_index 1 for the first block on a previously-empty route, got %', v_seq;
  END IF;
  RAISE NOTICE '✓ TEST 1 PASSED: an empty-draft route with a scan-adopted order gets its first block via a re-run';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: the ongoing-route case — a route already seeded with 2 blocks
-- gains a 3rd comuna via scan-adopt; re-running the writer APPENDS a block
-- for the new comuna at MAX(sequence_index)+1 (=3) and leaves the first two
-- rows completely untouched (ids, sequence_index, sequence_source).
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  r jsonb; v_route_id uuid;
  v_block1 uuid; v_block2 uuid; v_block3 uuid;
  v_seq1_before INT; v_seq2_before INT;
  v_seq1_after INT; v_seq2_after INT; v_seq3 INT; v_src3 TEXT;
  n_blocks INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000725',
          '66660002-0000-0000-0000-000000000725'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id, sequence_index INTO v_block1, v_seq1_before FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000725' AND deleted_at IS NULL;
  SELECT id, sequence_index INTO v_block2, v_seq2_before FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000725' AND deleted_at IS NULL;

  -- Scan-adopt: order 3 (comuna 3) lands directly on this already-seeded
  -- route, exactly the gap phase 2's migration documented and deferred.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES (v_route_id, '66660003-0000-0000-0000-000000000725',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'pending', 'dispatchtrack');

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_blocks <> 3 THEN
    RAISE EXCEPTION 'TEST 2: expected 3 live blocks after the append (2 original + 1 new), got %', n_blocks;
  END IF;

  SELECT sequence_index INTO v_seq1_after FROM public.route_blocks WHERE id = v_block1;
  SELECT sequence_index INTO v_seq2_after FROM public.route_blocks WHERE id = v_block2;
  IF v_seq1_after <> v_seq1_before OR v_seq2_after <> v_seq2_before THEN
    RAISE EXCEPTION 'TEST 2: the append renumbered an existing row (block1 %->%, block2 %->%)',
      v_seq1_before, v_seq1_after, v_seq2_before, v_seq2_after;
  END IF;

  SELECT id, sequence_index, sequence_source INTO v_block3, v_seq3, v_src3 FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550003-0000-0000-0000-000000000725' AND deleted_at IS NULL;
  IF v_block3 IS NULL THEN
    RAISE EXCEPTION 'TEST 2: expected a new block for comuna 3, found none';
  END IF;
  IF v_seq3 <> 3 THEN
    RAISE EXCEPTION 'TEST 2: expected the new block at sequence_index 3 (MAX+1), got %', v_seq3;
  END IF;
  IF v_src3 <> 'default' THEN
    RAISE EXCEPTION 'TEST 2: expected the newly-appended block to be sequence_source=default, got %', v_src3;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: a scan-adopted comuna on an already-seeded route is appended at MAX(sequence_index)+1, existing rows untouched';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: the case the deferred write-up called out by name — a manager's
-- manual reorder must survive an append. Reorder 2 blocks manually, then
-- scan-adopt a 3rd comuna and re-run the writer: the manual rows keep their
-- exact sequence_index/sequence_source, and the new block still lands after
-- the current max (which is now whatever the manual reorder produced).
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  r jsonb; v_route_id uuid;
  v_block1 uuid; v_block2 uuid; v_block3 uuid;
  v_seq1 INT; v_src1 TEXT; v_seq2 INT; v_src2 TEXT; v_seq3 INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000725',
          '66660002-0000-0000-0000-000000000725'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT id INTO v_block1 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000725' AND deleted_at IS NULL;
  SELECT id INTO v_block2 FROM public.route_blocks WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000725' AND deleted_at IS NULL;

  -- Manager reorders via move_route_block (the real phase-3 writer, not a
  -- hand-rolled UPDATE) so this test exercises the actual production path.
  PERFORM public.move_route_block(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid, v_block1, 'down');

  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES (v_route_id, '66660003-0000-0000-0000-000000000725',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'pending', 'dispatchtrack');

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);

  SELECT sequence_index, sequence_source INTO v_seq1, v_src1 FROM public.route_blocks WHERE id = v_block1;
  SELECT sequence_index, sequence_source INTO v_seq2, v_src2 FROM public.route_blocks WHERE id = v_block2;
  SELECT sequence_index INTO v_seq3 FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550003-0000-0000-0000-000000000725' AND deleted_at IS NULL;

  -- After move_route_block(block1, 'down'): block1 -> 2 (manual), block2 -> 1 (default).
  IF v_seq1 <> 2 OR v_src1 <> 'manual' THEN
    RAISE EXCEPTION 'TEST 3: the manual reorder was disturbed by the append (block1 seq=%, source=%)', v_seq1, v_src1;
  END IF;
  IF v_seq2 <> 1 OR v_src2 <> 'default' THEN
    RAISE EXCEPTION 'TEST 3: block2''s provenance/position was disturbed by the append (seq=%, source=%)', v_seq2, v_src2;
  END IF;
  IF v_seq3 <> 3 THEN
    RAISE EXCEPTION 'TEST 3: expected the new block after the manual reorder''s own max (2), got %', v_seq3;
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: a manual reorder survives an append triggered by a later scan-adopted comuna';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: idempotent append — calling the writer twice in a row with no new
-- comunas in between inserts nothing the second time.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE r jsonb; v_route_id uuid; n_after_first INT; n_after_second INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000725'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES (v_route_id, '66660002-0000-0000-0000-000000000725',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'pending', 'dispatchtrack');

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);
  SELECT COUNT(*) INTO n_after_first FROM public.route_blocks WHERE route_id = v_route_id AND deleted_at IS NULL;

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);
  SELECT COUNT(*) INTO n_after_second FROM public.route_blocks WHERE route_id = v_route_id AND deleted_at IS NULL;

  IF n_after_first <> 2 THEN
    RAISE EXCEPTION 'TEST 4: expected 2 blocks after the first append, got %', n_after_first;
  END IF;
  IF n_after_second <> n_after_first THEN
    RAISE EXCEPTION 'TEST 4: a second call with no new comunas inserted % extra row(s)', n_after_second - n_after_first;
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: a second call with nothing new to append is a true no-op';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5 (review item 1's status window, applied here too): appending to a
-- route past the loading window is refused with ROUTE_SEALED (P0001).
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE r jsonb; v_route_id uuid; raised BOOLEAN; n_blocks INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000725'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES (v_route_id, '66660002-0000-0000-0000-000000000725',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'pending', 'dispatchtrack');

  UPDATE public.routes SET status = 'dispatched' WHERE id = v_route_id;

  raised := false;
  BEGIN
    PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 5: expected ROUTE_SEALED for a dispatched route, got no error';
  END IF;

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_blocks <> 1 THEN
    RAISE EXCEPTION 'TEST 5: expected no new block to have been appended despite ROUTE_SEALED, got % live blocks', n_blocks;
  END IF;
  RAISE NOTICE '✓ TEST 5 PASSED: appending to a dispatched route is refused with ROUTE_SEALED';
END $$;

ROLLBACK TO test_5;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72 phase3 reseed-route-blocks tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
