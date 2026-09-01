-- =============================================================================
-- spec-72 phase 2 — the default sequencing writer
-- (seed_default_route_blocks, wired into create_seeded_route).
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_phase2_default_route_blocks.test.sql
--
-- House style, matching spec72_route_blocks.test.sql / spec70_seeded_route.test.sql:
-- fixtures inside one transaction, SAVEPOINT per test, each test a DO block
-- that RAISEs on failure, ROLLBACK TO the savepoint so later tests are
-- unaffected by an earlier failure, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema/function existence ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'seed_default_route_blocks'
  ) THEN
    RAISE EXCEPTION 'seed_default_route_blocks function missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators (A, B), 1 user each, 3 comunas, orders (2 with
-- distinct comunas, 1 with NULL comuna, all operator A; operator B gets its
-- own order for the cross-tenant tests) ─────────────────────────────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'Test Op 72p2 A', 'test-op-72-p2-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000722', 'Test Op 72p2 B', 'test-op-72-p2-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000172',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec72p2.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000722"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000172',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec72p2.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000722"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000172','aaaaaaaa-aaaa-aaaa-aaaa-000000000722','user-a@spec72p2.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000172','bbbbbbbb-bbbb-bbbb-bbbb-000000000722','user-b@spec72p2.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('55550001-0000-0000-0000-000000000722', '72201', 'Comuna P2 Uno', 'Provincia Test', 'Region Test', 99),
  ('55550002-0000-0000-0000-000000000722', '72202', 'Comuna P2 Dos', 'Provincia Test', 'Region Test', 99),
  ('55550003-0000-0000-0000-000000000722', '72203', 'Comuna P2 Tres', 'Provincia Test', 'Region Test', 99)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{}', true);

-- Orders: 1 = comuna 1, 2 = comuna 2, 3 = comuna 1 (repeat, same block as 1),
-- 4 = comuna_id NULL (must never get a block).
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660001-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'ORD-72P2-1',
   'Cliente Uno', '+56911111111', 'Calle Falsa 1', 'Comuna P2 Uno',
   '55550001-0000-0000-0000-000000000722', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660002-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'ORD-72P2-2',
   'Cliente Dos', '+56922222222', 'Calle Falsa 2', 'Comuna P2 Dos',
   '55550002-0000-0000-0000-000000000722', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660003-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'ORD-72P2-3',
   'Cliente Tres', '+56933333333', 'Calle Falsa 3', 'Comuna P2 Uno',
   '55550001-0000-0000-0000-000000000722', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660004-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'ORD-72P2-4',
   'Cliente Cuatro', '+56944444444', 'Calle Falsa 4', 'Comuna Sin Match',
   NULL, CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- Order 5: operator B, comuna 3 — used only for the cross-tenant tests below.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660005-0000-0000-0000-000000000722', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000722', 'ORD-72P2-5',
   'Cliente Cinco', '+56955555555', 'Calle Falsa 5', 'Comuna P2 Tres',
   '55550003-0000-0000-0000-000000000722', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: create_seeded_route seeds default blocks — one block per distinct
-- comuna among the seeded orders, comuna 1 first (orders 1 and 3 both land in
-- it, order 1 arrives first in the array), comuna 2 second, order 4
-- (comuna_id NULL) gets no block at all.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE r jsonb; v_route_id uuid; n_blocks INT; v_seq1 INT; v_seq2 INT; v_comuna1 uuid; v_comuna2 uuid;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722',
          '66660002-0000-0000-0000-000000000722',
          '66660003-0000-0000-0000-000000000722',
          '66660004-0000-0000-0000-000000000722'],
    NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_blocks <> 2 THEN
    RAISE EXCEPTION 'TEST 1: expected 2 blocks (2 distinct comunas among routable orders), got %', n_blocks;
  END IF;

  SELECT sequence_index, comuna_id INTO v_seq1, v_comuna1 FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000722' AND deleted_at IS NULL;
  SELECT sequence_index, comuna_id INTO v_seq2, v_comuna2 FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000722' AND deleted_at IS NULL;

  IF v_seq1 IS NULL OR v_seq2 IS NULL THEN
    RAISE EXCEPTION 'TEST 1: expected blocks for both comuna 1 and comuna 2, got seq1=%, seq2=%', v_seq1, v_seq2;
  END IF;
  IF v_seq1 >= v_seq2 THEN
    RAISE EXCEPTION 'TEST 1: comuna 1 (first order in array) should sequence before comuna 2, got seq1=%, seq2=%', v_seq1, v_seq2;
  END IF;

  -- All rows sequence_source = 'default'.
  IF EXISTS (
    SELECT 1 FROM public.route_blocks
     WHERE route_id = v_route_id AND deleted_at IS NULL AND sequence_source <> 'default'
  ) THEN
    RAISE EXCEPTION 'TEST 1: a seeded block was not sequence_source=default';
  END IF;

  -- order 4 (comuna_id NULL) must not have created a 3rd block, and cannot
  -- join into any block via the comuna_id join (its comuna_id is NULL, so it
  -- structurally can't match any route_blocks.comuna_id row).
  IF EXISTS (
    SELECT 1 FROM public.dispatches d
      JOIN public.orders o ON o.id = d.order_id
      JOIN public.route_blocks rb ON rb.route_id = d.route_id AND rb.comuna_id = o.comuna_id AND rb.deleted_at IS NULL
     WHERE d.order_id = '66660004-0000-0000-0000-000000000722'
  ) THEN
    RAISE EXCEPTION 'TEST 1: the NULL-comuna order unexpectedly joined into a block';
  END IF;
  IF n_blocks <> 2 THEN
    RAISE EXCEPTION 'TEST 1: expected exactly 2 blocks total (no phantom 3rd block for the NULL-comuna order), got %', n_blocks;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: create_seeded_route seeds default blocks in first-appearance comuna order, excludes NULL-comuna order';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: operator_id on every seeded block matches the route's operator.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE r jsonb; v_route_id uuid; bad INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722'], NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT COUNT(*) INTO bad FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL
     AND operator_id <> 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'TEST 2: % seeded block(s) had the wrong operator_id', bad;
  END IF;
  RAISE NOTICE '✓ TEST 2 PASSED: seeded blocks carry the route''s operator_id';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: a route seeded with only a NULL-comuna order gets zero blocks
-- (no block list at all is a valid, expected state — not an error).
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE r jsonb; v_route_id uuid; n_blocks INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660004-0000-0000-0000-000000000722'], NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_blocks <> 0 THEN
    RAISE EXCEPTION 'TEST 3: expected 0 blocks for an all-NULL-comuna route, got %', n_blocks;
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: a route with no comuna-bearing orders gets zero blocks, not an error';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: idempotency — re-running seed_default_route_blocks on a route that
-- already has live blocks is a no-op (no duplicate rows, no renumbering).
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE r jsonb; v_route_id uuid; n_before INT; n_after INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722',
          '66660002-0000-0000-0000-000000000722'], NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT COUNT(*) INTO n_before FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid);

  SELECT COUNT(*) INTO n_after FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;

  IF n_after <> n_before THEN
    RAISE EXCEPTION 'TEST 4: re-running the writer changed block count from % to %', n_before, n_after;
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: re-running the writer on an already-seeded route is a no-op';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: idempotency, the case that matters most — a manager's manual
-- reorder (sequence_source = 'manual') is NOT overwritten by a re-run of the
-- default writer.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE r jsonb; v_route_id uuid; v_source TEXT; v_seq INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722',
          '66660002-0000-0000-0000-000000000722'], NULL);
  v_route_id := (r->>'id')::uuid;

  -- Simulate a manager's manual reorder (phase 3's write shape): swap the
  -- two blocks' sequence_index and mark sequence_source = 'manual'.
  UPDATE public.route_blocks SET sequence_index = 99, sequence_source = 'manual'
   WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000722' AND deleted_at IS NULL;
  UPDATE public.route_blocks SET sequence_index = 1, sequence_source = 'manual'
   WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000722' AND deleted_at IS NULL;
  UPDATE public.route_blocks SET sequence_index = 2
   WHERE route_id = v_route_id AND comuna_id = '55550001-0000-0000-0000-000000000722' AND deleted_at IS NULL;

  PERFORM public.seed_default_route_blocks(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid);

  SELECT sequence_source, sequence_index INTO v_source, v_seq FROM public.route_blocks
   WHERE route_id = v_route_id AND comuna_id = '55550002-0000-0000-0000-000000000722' AND deleted_at IS NULL;

  IF v_source <> 'manual' OR v_seq <> 1 THEN
    RAISE EXCEPTION 'TEST 5: manual reorder was overwritten by the default writer (source=%, seq=%)', v_source, v_seq;
  END IF;
  RAISE NOTICE '✓ TEST 5 PASSED: re-running the writer never overwrites a manual reorder';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6 (M1): ordering follows p_order_ids, NOT physical/ctid insert order.
-- Dispatches are inserted DIRECTLY (bypassing create_seeded_route) in the
-- order [comuna 1, comuna 2] -- so ctid/physical order favours comuna 1
-- first, exactly what the old MIN(ctid) tiebreak would have picked. The
-- writer is then called with p_order_ids REVERSED ([comuna 2's order,
-- comuna 1's order]). Asserts EXACT sequence_index values (not just
-- seq1 < seq2): if the ordering tiebreak is dropped (reverting to
-- first_seen/ctid), comuna 1 comes out first (matching physical insert
-- order) and this test goes red.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE v_route_id uuid; v_seq_c1 INT; v_seq_c2 INT;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
  VALUES ('99990001-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722',
          'dispatchtrack', 'spec72p2-test6', CURRENT_DATE, 'planned', 2, 0);

  -- Physical insert order: comuna 1's order (66660001) row FIRST, comuna 2's
  -- order (66660002) row SECOND -- so ctid/heap order favours comuna 1.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES
    ('99990001-0000-0000-0000-000000000722', '66660001-0000-0000-0000-000000000722',
     'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'pending', 'dispatchtrack'),
    ('99990001-0000-0000-0000-000000000722', '66660002-0000-0000-0000-000000000722',
     'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'pending', 'dispatchtrack');

  -- Requested array order is the REVERSE: comuna 2's order first.
  PERFORM public.seed_default_route_blocks(
    '99990001-0000-0000-0000-000000000722'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000722', '66660001-0000-0000-0000-000000000722']::uuid[]);

  SELECT sequence_index INTO v_seq_c1 FROM public.route_blocks
   WHERE route_id = '99990001-0000-0000-0000-000000000722' AND comuna_id = '55550001-0000-0000-0000-000000000722' AND deleted_at IS NULL;
  SELECT sequence_index INTO v_seq_c2 FROM public.route_blocks
   WHERE route_id = '99990001-0000-0000-0000-000000000722' AND comuna_id = '55550002-0000-0000-0000-000000000722' AND deleted_at IS NULL;

  IF v_seq_c2 <> 1 OR v_seq_c1 <> 2 THEN
    RAISE EXCEPTION 'TEST 6: expected comuna 2 (requested first) seq=1 and comuna 1 (requested second, inserted first physically) seq=2, got c1=%, c2=%', v_seq_c1, v_seq_c2;
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: sequence follows p_order_ids, not physical insert/ctid order';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 (M5 / item 4 decision): a route whose blocks were ALL soft-deleted
-- has zero LIVE blocks, so the no-op guard (deleted_at IS NULL) does not
-- protect it -- the writer re-seeds it as 'default' on the next call. This is
-- the documented, deliberate contract (see migration header "DECISION"),
-- not a bug: there is nothing manual live to clobber in the zero-live-blocks
-- state.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE r jsonb; v_route_id uuid; n_live_before INT; n_live_after INT;
BEGIN
  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722',
          '66660002-0000-0000-0000-000000000722'], NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT COUNT(*) INTO n_live_before FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;
  IF n_live_before <> 2 THEN
    RAISE EXCEPTION 'TEST 7 setup: expected 2 live blocks before soft-delete, got %', n_live_before;
  END IF;

  -- Soft-delete ALL of this route's blocks.
  UPDATE public.route_blocks SET deleted_at = now()
   WHERE route_id = v_route_id AND deleted_at IS NULL;

  PERFORM public.seed_default_route_blocks(
    v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722',
          '66660002-0000-0000-0000-000000000722']::uuid[]);

  SELECT COUNT(*) INTO n_live_after FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;

  IF n_live_after <> 2 THEN
    RAISE EXCEPTION 'TEST 7: expected the writer to re-seed 2 live blocks after all blocks were soft-deleted, got %', n_live_after;
  END IF;
  RAISE NOTICE '✓ TEST 7 PASSED: a route with zero live blocks (all soft-deleted) is re-seeded, per the documented decision';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (M6): dispatches.operator_id must be filtered against p_operator_id
-- on the orders join. A "rogue" dispatch row references operator A's route
-- but is stamped with operator B's operator_id (and operator B's order) --
-- dispatches.route_id carries no FK-level cross-check against the route's
-- own operator_id, so this is a real, reachable data shape, not a
-- constraint violation. Dropping `d.operator_id = p_operator_id` would pull
-- operator B's comuna into operator A's route.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE v_route_id uuid; n_blocks INT; leaked BOOLEAN;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
  VALUES ('99990002-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722',
          'dispatchtrack', 'spec72p2-test8', CURRENT_DATE, 'planned', 1, 0);

  -- Legitimate dispatch: operator A's route, operator A's order (comuna 1).
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES ('99990002-0000-0000-0000-000000000722', '66660001-0000-0000-0000-000000000722',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'pending', 'dispatchtrack');

  -- Rogue dispatch: same route_id, but operator_id/order_id both belong to
  -- operator B (comuna 3).
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES ('99990002-0000-0000-0000-000000000722', '66660005-0000-0000-0000-000000000722',
          'bbbbbbbb-bbbb-bbbb-bbbb-000000000722', 'pending', 'dispatchtrack');

  PERFORM public.seed_default_route_blocks(
    '99990002-0000-0000-0000-000000000722'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722', '66660005-0000-0000-0000-000000000722']::uuid[]);

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks
   WHERE route_id = '99990002-0000-0000-0000-000000000722' AND deleted_at IS NULL;
  SELECT EXISTS (
    SELECT 1 FROM public.route_blocks
     WHERE route_id = '99990002-0000-0000-0000-000000000722' AND comuna_id = '55550003-0000-0000-0000-000000000722' AND deleted_at IS NULL
  ) INTO leaked;

  IF n_blocks <> 1 THEN
    RAISE EXCEPTION 'TEST 8: expected exactly 1 block (operator A''s comuna only), got %', n_blocks;
  END IF;
  IF leaked THEN
    RAISE EXCEPTION 'TEST 8: operator B''s rogue dispatch (comuna 3) leaked into operator A''s route blocks';
  END IF;
  RAISE NOTICE '✓ TEST 8 PASSED: a dispatch row stamped with a different operator_id is excluded, even sharing the route_id';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 (M7): a soft-deleted dispatch (deleted_at NOT NULL) must not
-- produce a block.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE n_blocks INT; has_c1 BOOLEAN; has_c2 BOOLEAN;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
  VALUES ('99990003-0000-0000-0000-000000000722', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000722',
          'dispatchtrack', 'spec72p2-test9', CURRENT_DATE, 'planned', 2, 0);

  -- Live dispatch: comuna 1.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  VALUES ('99990003-0000-0000-0000-000000000722', '66660001-0000-0000-0000-000000000722',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'pending', 'dispatchtrack');

  -- Soft-deleted dispatch: comuna 2 -- must be excluded.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, deleted_at)
  VALUES ('99990003-0000-0000-0000-000000000722', '66660002-0000-0000-0000-000000000722',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000722', 'pending', 'dispatchtrack', now());

  PERFORM public.seed_default_route_blocks(
    '99990003-0000-0000-0000-000000000722'::uuid,
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722', '66660002-0000-0000-0000-000000000722']::uuid[]);

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks
   WHERE route_id = '99990003-0000-0000-0000-000000000722' AND deleted_at IS NULL;
  SELECT EXISTS (SELECT 1 FROM public.route_blocks WHERE route_id = '99990003-0000-0000-0000-000000000722' AND comuna_id = '55550001-0000-0000-0000-000000000722' AND deleted_at IS NULL) INTO has_c1;
  SELECT EXISTS (SELECT 1 FROM public.route_blocks WHERE route_id = '99990003-0000-0000-0000-000000000722' AND comuna_id = '55550002-0000-0000-0000-000000000722' AND deleted_at IS NULL) INTO has_c2;

  IF n_blocks <> 1 OR NOT has_c1 OR has_c2 THEN
    RAISE EXCEPTION 'TEST 9: expected only comuna 1''s block (comuna 2''s dispatch is soft-deleted), got n_blocks=%, has_c1=%, has_c2=%', n_blocks, has_c1, has_c2;
  END IF;
  RAISE NOTICE '✓ TEST 9 PASSED: a soft-deleted dispatch does not produce a block';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 (item 3): ROUTE_NOT_FOUND (P0002) is raised, not a silent no-op,
-- for (a) a route id that does not exist at all, and (b) a route that
-- exists but belongs to a different operator.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE raised BOOLEAN;
BEGIN
  raised := false;
  BEGIN
    PERFORM public.seed_default_route_blocks(
      '00000000-0000-0000-0000-000000000000'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 10a: expected ROUTE_NOT_FOUND (P0002) for a nonexistent route, got no error';
  END IF;

  -- Insert operator B's own route, then call as operator A -- foreign route.
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
  VALUES ('99990004-0000-0000-0000-000000000722', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000722',
          'dispatchtrack', 'spec72p2-test10', CURRENT_DATE, 'planned', 0, 0);

  raised := false;
  BEGIN
    PERFORM public.seed_default_route_blocks(
      '99990004-0000-0000-0000-000000000722'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 10b: expected ROUTE_NOT_FOUND (P0002) for a route belonging to a different operator, got no error';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: ROUTE_NOT_FOUND raised for a nonexistent/foreign route, never a silent no-op';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11: end-to-end under RLS as 'authenticated' (not postgres). Every
-- earlier test in this file runs as postgres, which bypasses RLS entirely --
-- this is the only test proving create_seeded_route -> seed_default_route_blocks
-- actually works for the real caller (SECURITY INVOKER, WITH CHECK on
-- routes/dispatches/route_blocks all enforced).
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE r jsonb; v_route_id uuid; n_blocks INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000172","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000722","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  r := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000722'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000722',
          '66660002-0000-0000-0000-000000000722'], NULL);
  v_route_id := (r->>'id')::uuid;

  SELECT COUNT(*) INTO n_blocks FROM public.route_blocks
   WHERE route_id = v_route_id AND deleted_at IS NULL;

  RESET role;

  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'TEST 11: create_seeded_route returned no route id under RLS';
  END IF;
  IF n_blocks <> 2 THEN
    RAISE EXCEPTION 'TEST 11: expected 2 blocks seeded under RLS as authenticated, got %', n_blocks;
  END IF;
  RAISE NOTICE '✓ TEST 11 PASSED: create_seeded_route OK, blocks=% under RLS as authenticated', n_blocks;
END $$;

ROLLBACK TO test_11;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72 phase2 default-route-blocks tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
