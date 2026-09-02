-- =============================================================================
-- spec-73 phase 4 — top-up suggestions and the move task:
-- get_topup_candidates, accept_topup_block.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec73_phase4_topup_suggestions.test.sql
--
-- House style, matching spec72_route_blocks.test.sql /
-- spec73_phase3_adjacency_management.test.sql: fixtures inside one
-- transaction, SAVEPOINT per test, each test a DO block that RAISEs on
-- failure, ROLLBACK TO the savepoint so later tests are unaffected.
-- =============================================================================

BEGIN;

-- ── Schema existence ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'route_blocks' AND column_name = 'donor_route_id'
  ) THEN
    RAISE EXCEPTION 'route_blocks.donor_route_id missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_topup_candidates'
  ) THEN
    RAISE EXCEPTION 'get_topup_candidates missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'accept_topup_block'
  ) THEN
    RAISE EXCEPTION 'accept_topup_block missing';
  END IF;
END $$;

-- ── FIXTURE ──────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug, country_code) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730004', 'Spec73 P4 Operator A', 'spec73-p4-op-a', 'CL'),
  ('bbbbbbbb-0000-4000-a000-000000730004', 'Spec73 P4 Operator B', 'spec73-p4-op-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730041','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec73p4-manager@test.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000730004","role":"ops_leader"}'::jsonb,
   '{"full_name":"Manager P4"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, role, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000730041','aaaaaaaa-0000-4000-a000-000000730004',
   'spec73p4-manager@test.test','Manager P4','ops_leader',
   ARRAY['pickup','reception','distribution','dispatch'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role;

-- Comunas: Uno (receiving route's own), Dos (adjacent donor block), Tres
-- (NOT adjacent — a distractor to prove non-adjacent blocks are excluded).
INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num) VALUES
  ('55550041-0000-0000-0000-000000730004', '73041', 'P4 Comuna Uno',  'Prov Test', 'Reg Test', 98),
  ('55550042-0000-0000-0000-000000730004', '73042', 'P4 Comuna Dos',  'Prov Test', 'Reg Test', 98),
  ('55550043-0000-0000-0000-000000730004', '73043', 'P4 Comuna Tres', 'Prov Test', 'Reg Test', 98)
ON CONFLICT (id) DO NOTHING;

-- Andenes: Z1 (receiving route sources from here), Z2 (adjacent to Z1,
-- donor block Dos sources from here), Z3 (NOT adjacent to Z1, donor block
-- Tres sources from here), Z_RETIRED (soft-deleted; a legacy adjacency row
-- points at it to prove the retired-zone filter).
INSERT INTO public.dock_zones (id, operator_id, name, code, is_active, deleted_at) VALUES
  ('44440041-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'Andén P4-Z1', 'P4-Z1', true, NULL),
  ('44440042-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'Andén P4-Z2', 'P4-Z2', true, NULL),
  ('44440043-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'Andén P4-Z3', 'P4-Z3', true, NULL),
  ('44440044-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'Andén P4-Retired', 'P4-ZR', true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Adjacency: Z1<->Z2 stored ONLY one-directional (legacy row, proves the
-- symmetric OR-read still finds it). Z1<->Z_RETIRED stored both directions
-- (legacy, predates the cascade trigger — proves the retired-zone filter).
-- Z3 is adjacent to NOTHING (the non-adjacent distractor).
INSERT INTO public.dock_zone_adjacency (id, operator_id, dock_zone_id, adjacent_zone_id) VALUES
  ('99990041-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '44440041-0000-0000-0000-000000730004', '44440042-0000-0000-0000-000000730004'),
  ('99990042-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '44440041-0000-0000-0000-000000730004', '44440044-0000-0000-0000-000000730004'),
  ('99990043-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '44440044-0000-0000-0000-000000730004', '44440041-0000-0000-0000-000000730004')
ON CONFLICT (id) DO NOTHING;

-- Routes: R (receiving, planned), D1 (donor of comuna Dos, planned),
-- D2 (donor of comuna Tres — not adjacent, distractor, planned),
-- D3 (donor otherwise-eligible but 'loaded' — proves Decision 5.6),
-- R_ATCAP (receiving route already at max_drops).
INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, max_drops) VALUES
  ('22224001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'dispatchtrack', 'p4-route-r',  CURRENT_DATE, 'planned', NULL),
  ('22224002-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'dispatchtrack', 'p4-route-d1', CURRENT_DATE, 'planned', NULL),
  ('22224003-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'dispatchtrack', 'p4-route-d2', CURRENT_DATE, 'planned', NULL),
  ('22224004-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'dispatchtrack', 'p4-route-d3', CURRENT_DATE, 'loaded',  NULL),
  ('22224005-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'dispatchtrack', 'p4-route-atcap', CURRENT_DATE, 'planned', 1),
  -- Operator B's own route. Review addition: without a route that really
  -- belongs to B, the cross-tenant accept in TEST 9 was refused by the
  -- DONOR lookup and never exercised the receiving-route lookup's own
  -- operator filter — a mutant that dropped that filter survived the suite.
  ('2222400b-0000-0000-0000-000000730004', 'bbbbbbbb-0000-4000-a000-000000730004', 'dispatchtrack', 'p4-route-b1', CURRENT_DATE, 'planned', NULL)
ON CONFLICT (id) DO NOTHING;

-- Orders: one on R (comuna Uno), one on D1 (comuna Dos), one on D2
-- (comuna Tres), one on D3 (comuna Dos again, but D3 is 'loaded').
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66664001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-R1',
   'Cliente R1', '+56911111111', 'Calle R1', 'P4 Comuna Uno',  '55550041-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66664002-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-D1a',
   'Cliente D1a', '+56922222222', 'Calle D1a', 'P4 Comuna Dos',  '55550042-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66664003-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-D2a',
   'Cliente D2a', '+56933333333', 'Calle D2a', 'P4 Comuna Tres', '55550043-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66664004-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-D3a',
   'Cliente D3a', '+56944444444', 'Calle D3a', 'P4 Comuna Dos',  '55550042-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, external_dispatch_id, status)
VALUES
  ('77774001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224001-0000-0000-0000-000000730004', '66664001-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-r1', 'pending'),
  ('77774002-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224002-0000-0000-0000-000000730004', '66664002-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-d1a', 'pending'),
  ('77774003-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224003-0000-0000-0000-000000730004', '66664003-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-d2a', 'pending'),
  ('77774004-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224004-0000-0000-0000-000000730004', '66664004-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-d3a', 'pending')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id) VALUES
  ('ffff4001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '66664001-0000-0000-0000-000000730004', 'PKG-P4-R1', '{}'::jsonb, 'sectorizado', '44440041-0000-0000-0000-000000730004'),
  ('ffff4002-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '66664002-0000-0000-0000-000000730004', 'PKG-P4-D1a', '{}'::jsonb, 'sectorizado', '44440042-0000-0000-0000-000000730004'),
  ('ffff4003-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '66664003-0000-0000-0000-000000730004', 'PKG-P4-D2a', '{}'::jsonb, 'sectorizado', '44440043-0000-0000-0000-000000730004'),
  ('ffff4004-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '66664004-0000-0000-0000-000000730004', 'PKG-P4-D3a', '{}'::jsonb, 'sectorizado', '44440042-0000-0000-0000-000000730004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.route_blocks (id, operator_id, route_id, comuna_id, sequence_index, sequence_source) VALUES
  ('88884001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224001-0000-0000-0000-000000730004', '55550041-0000-0000-0000-000000730004', 1, 'default'),
  ('88884002-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224002-0000-0000-0000-000000730004', '55550042-0000-0000-0000-000000730004', 1, 'default'),
  ('88884003-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224003-0000-0000-0000-000000730004', '55550043-0000-0000-0000-000000730004', 1, 'default'),
  ('88884004-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
   '22224004-0000-0000-0000-000000730004', '55550042-0000-0000-0000-000000730004', 1, 'default')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000730041","operator_id":"aaaaaaaa-0000-4000-a000-000000730004"}', true);

-- =============================================================================
-- TEST 1: get_topup_candidates finds D1's block (Dos), adjacent via a
-- ONE-DIRECTIONAL legacy adjacency row (Z1->Z2 only), and excludes D2's
-- block (Tres, not adjacent to anything).
-- =============================================================================
SAVEPOINT test_1;
DO $$
DECLARE v_result jsonb; v_candidates jsonb; v_count int;
BEGIN
  v_result := public.get_topup_candidates('22224001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004');

  IF (v_result->>'eligible')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expected eligible=true, got %', v_result;
  END IF;

  v_candidates := v_result->'candidates';
  v_count := jsonb_array_length(v_candidates);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 candidate (Dos, via one-directional adjacency), got % : %', v_count, v_candidates;
  END IF;
  IF (v_candidates->0->>'comuna_id') IS DISTINCT FROM '55550042-0000-0000-0000-000000730004' THEN
    RAISE EXCEPTION 'expected candidate comuna Dos, got %', v_candidates;
  END IF;
  IF (v_candidates->0->>'donor_route_id') IS DISTINCT FROM '22224002-0000-0000-0000-000000730004' THEN
    RAISE EXCEPTION 'expected donor route D1, got %', v_candidates;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: one-directional adjacency found, non-adjacent block excluded';
END $$;
ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: a retired andén's adjacency row is never offered as a top-up
-- source, even though the pair predates the soft-delete cascade (both
-- directions exist as live rows pointing at a soft-deleted zone).
-- =============================================================================
SAVEPOINT test_2;
DO $$
DECLARE v_zone_count int;
BEGIN
  -- Sanity: the retired-zone adjacency rows really are still live rows in
  -- the table (this test would be meaningless if the earlier cascade
  -- trigger had already cleaned them up).
  SELECT COUNT(*) INTO v_zone_count FROM public.dock_zone_adjacency
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000730004'
     AND deleted_at IS NULL
     AND (dock_zone_id = '44440044-0000-0000-0000-000000730004' OR adjacent_zone_id = '44440044-0000-0000-0000-000000730004');
  IF v_zone_count <> 2 THEN
    RAISE EXCEPTION 'fixture invariant broken: expected 2 live rows naming the retired zone, got %', v_zone_count;
  END IF;

  -- No donor block sources from the retired zone in this fixture, but the
  -- filter itself is proven directly: neighbor_zones must never include
  -- the retired zone id for route R.
  IF EXISTS (
    SELECT 1 FROM public.route_source_dock_zone_ids('22224001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', NULL) z
     WHERE z.dock_zone_id = '44440044-0000-0000-0000-000000730004'
  ) THEN
    RAISE EXCEPTION 'route_source_dock_zone_ids must never surface a retired andén';
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: retired andén never offered / never surfaced as a source';
END $$;
ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: Decision 5.6 — a donor route past 'loading' (here: 'loaded')
-- never appears as a candidate even if otherwise adjacent+eligible.
-- =============================================================================
SAVEPOINT test_3;
DO $$
DECLARE v_result jsonb;
BEGIN
  -- Move D3's block (comuna Dos, same as D1's) onto neighbour zone Z2 is
  -- already true by fixture; D3 is 'loaded'. Candidates must still show
  -- exactly D1's block, never D3's, even though both donate comuna Dos.
  v_result := public.get_topup_candidates('22224001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004');

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_result->'candidates') c
     WHERE c->>'donor_route_id' = '22224004-0000-0000-0000-000000730004'
  ) THEN
    RAISE EXCEPTION 'a loaded donor route must never be offered as a top-up source: %', v_result;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: loaded donor route excluded (Decision 5.6)';
END $$;
ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: Decision 6 — a receiving route already at max_drops gets zero
-- suggestions, reason AT_MAX_DROPS, even though room exists physically.
-- =============================================================================
SAVEPOINT test_4;
DO $$
DECLARE v_result jsonb;
BEGIN
  -- Give the at-cap route the same source andén (Z1) as R, via its own
  -- dispatch/order/package, so it WOULD otherwise see D1's block.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
  VALUES ('66664005-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-ATCAP',
    'Cliente ATCAP', '+56955555555', 'Calle ATCAP', 'P4 Comuna Uno', '55550041-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, external_dispatch_id, status)
  VALUES ('77774005-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
    '22224005-0000-0000-0000-000000730004', '66664005-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-atcap', 'pending');
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff4005-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
    '66664005-0000-0000-0000-000000730004', 'PKG-P4-ATCAP', '{}'::jsonb, 'sectorizado', '44440041-0000-0000-0000-000000730004');

  -- max_drops=1 on this route (fixture), and it now has exactly 1 live
  -- dispatch — at cap.
  v_result := public.get_topup_candidates('22224005-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004');

  IF (v_result->>'eligible')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expected eligible=false at max_drops, got %', v_result;
  END IF;
  IF (v_result->>'reason') IS DISTINCT FROM 'AT_MAX_DROPS' THEN
    RAISE EXCEPTION 'expected reason=AT_MAX_DROPS, got %', v_result;
  END IF;
  IF jsonb_array_length(v_result->'candidates') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'expected zero candidates at max_drops, got %', v_result;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: max_drops route gets zero suggestions (Decision 6)';
END $$;
ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: accept_topup_block moves the whole block — donor dispatch
-- soft-deleted with removal_reason, receiving route gets a new dispatch +
-- an APPENDED route_blocks row (never interleaved) with donor_route_id set.
-- =============================================================================
SAVEPOINT test_5;
DO $$
DECLARE
  v_result jsonb;
  v_donor_live_count int;
  v_donor_removed_reason text;
  v_receiving_disp_count int;
  v_new_block RECORD;
BEGIN
  v_result := public.accept_topup_block(
    '22224001-0000-0000-0000-000000730004', -- receiving: R
    '22224002-0000-0000-0000-000000730004', -- donor: D1
    '55550042-0000-0000-0000-000000730004', -- comuna Dos
    'aaaaaaaa-0000-4000-a000-000000730004',
    'aaaaaaaa-0000-4000-a000-000000730041',
    'top-up: R under-filled'
  );

  IF (v_result->>'moved_package_count')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected 1 moved package, got %', v_result;
  END IF;

  -- Donor side: dispatch soft-deleted with a reason (spec-70's mechanism).
  SELECT COUNT(*) INTO v_donor_live_count FROM public.dispatches
   WHERE id = '77774002-0000-0000-0000-000000730004' AND deleted_at IS NULL;
  IF v_donor_live_count <> 0 THEN
    RAISE EXCEPTION 'donor dispatch should be soft-deleted, still live';
  END IF;

  SELECT removal_reason INTO v_donor_removed_reason FROM public.dispatches
   WHERE id = '77774002-0000-0000-0000-000000730004';
  IF v_donor_removed_reason IS DISTINCT FROM 'top-up: R under-filled' THEN
    RAISE EXCEPTION 'expected removal_reason set, got %', v_donor_removed_reason;
  END IF;

  -- Donor's block for Dos is now empty and soft-deleted.
  IF EXISTS (
    SELECT 1 FROM public.route_blocks WHERE id = '88884002-0000-0000-0000-000000730004' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'donor block should be soft-deleted once emptied';
  END IF;

  -- Receiving side: a new live dispatch for the same order, on R.
  SELECT COUNT(*) INTO v_receiving_disp_count FROM public.dispatches
   WHERE route_id = '22224001-0000-0000-0000-000000730004'
     AND order_id = '66664002-0000-0000-0000-000000730004'
     AND deleted_at IS NULL;
  IF v_receiving_disp_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 new live dispatch on receiving route, got %', v_receiving_disp_count;
  END IF;

  -- Receiving side: new route_blocks row APPENDED (sequence_index > R's
  -- existing block's 1), sequence_source='topup', donor_route_id=D1.
  SELECT sequence_index, sequence_source, donor_route_id INTO v_new_block
    FROM public.route_blocks
   WHERE route_id = '22224001-0000-0000-0000-000000730004'
     AND comuna_id = '55550042-0000-0000-0000-000000730004'
     AND deleted_at IS NULL;

  IF v_new_block IS NULL THEN
    RAISE EXCEPTION 'expected a new route_blocks row on the receiving route';
  END IF;
  IF v_new_block.sequence_index IS NULL OR v_new_block.sequence_index <= 1 THEN
    RAISE EXCEPTION 'expected the borrowed block appended AFTER R''s own block (seq 1), got %', v_new_block.sequence_index;
  END IF;
  IF v_new_block.sequence_source IS DISTINCT FROM 'topup' THEN
    RAISE EXCEPTION 'expected sequence_source=topup, got %', v_new_block.sequence_source;
  END IF;
  IF v_new_block.donor_route_id IS DISTINCT FROM '22224002-0000-0000-0000-000000730004' THEN
    RAISE EXCEPTION 'expected donor_route_id=D1, got %', v_new_block.donor_route_id;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: whole block moved, donor removal audited, receiving block appended';
END $$;
ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: Decision 5.4a — one borrowed block per route. After accepting
-- one top-up, get_topup_candidates (and a second accept_topup_block call)
-- both refuse a second one for the same receiving route.
-- =============================================================================
SAVEPOINT test_6;
DO $$
DECLARE v_result jsonb; v_raised boolean := false;
BEGIN
  PERFORM public.accept_topup_block(
    '22224001-0000-0000-0000-000000730004',
    '22224002-0000-0000-0000-000000730004',
    '55550042-0000-0000-0000-000000730004',
    'aaaaaaaa-0000-4000-a000-000000730004',
    'aaaaaaaa-0000-4000-a000-000000730041',
    'first top-up'
  );

  v_result := public.get_topup_candidates('22224001-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004');
  IF (v_result->>'reason') IS DISTINCT FROM 'ALREADY_HAS_TOPUP' THEN
    RAISE EXCEPTION 'expected reason=ALREADY_HAS_TOPUP after one accepted top-up, got %', v_result;
  END IF;

  BEGIN
    -- Re-seed D2's block onto a zone adjacent to R so it WOULD otherwise be
    -- eligible, to prove the refusal is the one-block cap, not "no more
    -- candidates exist". D2 sources Tres/Z3 which isn't adjacent, so
    -- instead just attempt accepting the SAME already-consumed pattern
    -- again onto R, which must still be refused.
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004',
      '22224003-0000-0000-0000-000000730004', -- D2 (comuna Tres)
      '55550043-0000-0000-0000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'second top-up attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ALREADY_HAS_TOPUP%' THEN
      v_raised := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected ALREADY_HAS_TOPUP to be raised on a second accept for the same route';
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: one borrowed block per route enforced both ways (Decision 5.4a)';
END $$;
ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: Decision 5.6 (write-time) — accept_topup_block refuses a donor
-- route that is 'loaded' or beyond, even if called directly (not just
-- filtered out of suggestions).
-- =============================================================================
SAVEPOINT test_7;
DO $$
DECLARE v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004', -- receiving: R
      '22224004-0000-0000-0000-000000730004', -- donor: D3, status='loaded'
      '55550042-0000-0000-0000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'raiding a sealed manifest'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'DONOR_ROUTE_NOT_RAIDABLE%' THEN
      v_raised := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected DONOR_ROUTE_NOT_RAIDABLE for a loaded donor route';
  END IF;

  -- And the loaded donor's dispatch must be untouched.
  IF EXISTS (
    SELECT 1 FROM public.dispatches WHERE id = '77774004-0000-0000-0000-000000730004' AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'loaded donor route dispatch must not have been touched';
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: accept_topup_block refuses a loaded donor route (Decision 5.6, write-time)';
END $$;
ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: Decision 5.4b — a block larger than ~25% of the receiving
-- route's own load is refused (OVER_TOPUP_CAP), and nothing it touched is
-- left half-moved (the donor dispatch stays live).
-- =============================================================================
SAVEPOINT test_8;
DO $$
DECLARE v_raised boolean := false;
BEGIN
  -- R has 1 package; cap = CEIL(1*0.25) = 1. Add a second package to D1's
  -- block so it now carries 2 packages — over the cap of 1.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
  VALUES ('66664006-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-D1b',
    'Cliente D1b', '+56966666666', 'Calle D1b', 'P4 Comuna Dos', '55550042-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, external_dispatch_id, status)
  VALUES ('77774006-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
    '22224002-0000-0000-0000-000000730004', '66664006-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-d1b', 'pending');
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff4006-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
    '66664006-0000-0000-0000-000000730004', 'PKG-P4-D1b', '{}'::jsonb, 'sectorizado', '44440042-0000-0000-0000-000000730004');

  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004',
      '22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'too big a top-up'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'OVER_TOPUP_CAP%' THEN
      v_raised := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected OVER_TOPUP_CAP for a block exceeding ~25%% of receiving load';
  END IF;

  -- Nothing left half-moved: BOTH donor dispatches for comuna Dos still
  -- live (the function raised before its own removal loop's effects could
  -- persist, since RAISE inside one plpgsql call aborts that whole call).
  IF EXISTS (
    SELECT 1 FROM public.dispatches
     WHERE id IN ('77774002-0000-0000-0000-000000730004', '77774006-0000-0000-0000-000000730004')
       AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'a refused over-cap top-up must not have removed anything from the donor';
  END IF;

  RAISE NOTICE '✓ TEST 8 PASSED: over-cap block refused atomically, nothing half-moved (Decision 5.4b)';
END $$;
ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: operator isolation — operator B cannot see or touch operator A's
-- routes/blocks via either function.
-- =============================================================================
SAVEPOINT test_9;
DO $$
DECLARE v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.get_topup_candidates('22224001-0000-0000-0000-000000730004', 'bbbbbbbb-0000-4000-a000-000000730004');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ROUTE_NOT_FOUND%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected ROUTE_NOT_FOUND when operator B reads operator A''s route';
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004',
      '22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004',
      'bbbbbbbb-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'cross-tenant attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ROUTE_NOT_FOUND%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected ROUTE_NOT_FOUND when operator B attempts a cross-tenant accept';
  END IF;

  -- Review addition: the RECEIVING lookup's own operator filter, isolated.
  -- Donor is a route operator B really owns, so the donor lookup succeeds;
  -- only the receiving-route filter can refuse this.
  v_raised := false;
  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004',   -- operator A's route
      '2222400b-0000-0000-0000-000000730004',   -- operator B's own route
      '55550042-0000-0000-0000-000000730004',
      'bbbbbbbb-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'cross-tenant');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ROUTE_NOT_FOUND: receiving route%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'the receiving-route lookup must reject a route belonging to another operator';
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: operator isolation on both functions';
END $$;
ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: Decision 6 (write-time) — accept_topup_block itself refuses a
-- receiving route already at max_drops, not just the suggestions read.
-- =============================================================================
SAVEPOINT test_10;
DO $$
DECLARE v_raised boolean := false;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
  VALUES ('66664010-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004', 'ORD-P4-ATCAP2',
    'Cliente ATCAP2', '+56977777777', 'Calle ATCAP2', 'P4 Comuna Uno', '55550041-0000-0000-0000-000000730004', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, external_dispatch_id, status)
  VALUES ('77774010-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
    '22224005-0000-0000-0000-000000730004', '66664010-0000-0000-0000-000000730004', 'dispatchtrack', 'p4-disp-atcap2', 'pending');
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff4010-0000-0000-0000-000000730004', 'aaaaaaaa-0000-4000-a000-000000730004',
    '66664010-0000-0000-0000-000000730004', 'PKG-P4-ATCAP2', '{}'::jsonb, 'sectorizado', '44440041-0000-0000-0000-000000730004');

  -- Route 22224005 has max_drops=1 and now 1 live dispatch — at cap.
  -- Calling accept_topup_block on it directly (bypassing the suggestions
  -- read entirely) must still be refused.
  BEGIN
    PERFORM public.accept_topup_block(
      '22224005-0000-0000-0000-000000730004',
      '22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'max_drops bypass attempt'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'AT_MAX_DROPS%' THEN v_raised := true; ELSE RAISE; END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected AT_MAX_DROPS to be raised by accept_topup_block itself, not just the suggestions read';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: accept_topup_block itself enforces max_drops (Decision 6, write-time)';
END $$;
ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11 (review fix, Decision 5.5) — a block whose packages have ALREADY
-- been physically scanned onto the DONOR's load position cannot be donated.
--
-- RED before the fix: accept_topup_block succeeded, and spec-71's
-- get_move_task_snapshot then reported the receiving route with
-- total_packages 2 / remaining_packages 1 and NO group naming the borrowed
-- andén — the borrowed box was invisible to the move task (dock_scans
-- load_position_id is a per-package, route-agnostic fact), un-rescannable
-- (validateScan -> ALREADY_STAGED, loaded_at set with load_inferred=false)
-- and the receiving route was left permanently unsealable (its new dispatch
-- stays stage='planned', so sealRoute refuses with UNSEALED_STOPS). That is
-- the "only updates route_id in the database without a physical
-- confirmation" shortcut Decision 5.5 refuses by name.
-- =============================================================================
SAVEPOINT test_11;
DO $$
DECLARE v_raised boolean := false; v_cands jsonb;
BEGIN
  INSERT INTO public.load_positions (id, operator_id, code, label, is_active)
  VALUES ('aaaa0002-0000-4000-a000-000000730004','aaaaaaaa-0000-4000-a000-000000730004','P4-LP2','LP2',true);
  UPDATE public.routes
     SET status='loading', load_position_id='aaaa0002-0000-4000-a000-000000730004',
         load_position_assigned_at=NOW()
   WHERE id='22224002-0000-0000-0000-000000730004';

  -- Exactly what stageDispatch + POST /load-positions/scan write.
  UPDATE public.packages
     SET status='en_carga', loaded_at=NOW(),
         loaded_by='aaaaaaaa-0000-4000-a000-000000730041', load_inferred=false
   WHERE id='ffff4002-0000-0000-0000-000000730004';
  UPDATE public.dispatches SET stage='staged', staged_at=NOW()
   WHERE id='77774002-0000-0000-0000-000000730004';
  INSERT INTO public.dock_scans (operator_id, package_id, barcode, scan_result, scanned_by, scanned_at, load_position_id)
  VALUES ('aaaaaaaa-0000-4000-a000-000000730004','ffff4002-0000-0000-0000-000000730004','PKG-P4-D1a',
          'accepted','aaaaaaaa-0000-4000-a000-000000730041', NOW(), 'aaaa0002-0000-4000-a000-000000730004');

  -- Read path: never offered.
  v_cands := (public.get_topup_candidates(
    '22224001-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004'))->'candidates';
  IF jsonb_array_length(v_cands) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'a block already loading onto its donor truck must never be suggested, got %', v_cands;
  END IF;

  -- Write path: refused.
  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004','22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041','raid a truck already being loaded');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'BLOCK_ALREADY_STAGED%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected BLOCK_ALREADY_STAGED for a block already scanned onto its donor position';
  END IF;

  IF EXISTS (SELECT 1 FROM public.dispatches
              WHERE id='77774002-0000-0000-0000-000000730004' AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a refused top-up must not have touched the donor';
  END IF;

  RAISE NOTICE '✓ TEST 11 PASSED: an already-staged block is neither suggested nor movable (Decision 5.5)';
END $$;
ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12 (review fix, Decision 5.5 positive control) — the reuse claim
-- itself. A block that was NEVER staged really does show up as remaining
-- work on the receiving route's spec-71 move task, grouped under the donor's
-- andén. Without this, TEST 11 alone could be satisfied by refusing
-- everything.
-- =============================================================================
SAVEPOINT test_12;
DO $$
DECLARE v_snap jsonb; v_row jsonb; v_grp jsonb;
BEGIN
  INSERT INTO public.load_positions (id, operator_id, code, label, is_active)
  VALUES ('aaaa0001-0000-4000-a000-000000730004','aaaaaaaa-0000-4000-a000-000000730004','P4-LP1','LP1',true);
  UPDATE public.routes
     SET status='loading', load_position_id='aaaa0001-0000-4000-a000-000000730004',
         load_position_assigned_at=NOW()
   WHERE id='22224001-0000-0000-0000-000000730004';

  PERFORM public.accept_topup_block(
    '22224001-0000-0000-0000-000000730004','22224002-0000-0000-0000-000000730004',
    '55550042-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004',
    'aaaaaaaa-0000-4000-a000-000000730041','R under-filled');

  -- The new dispatch must be stage='planned' — that is what makes sealRoute
  -- refuse the receiving route until the box is physically scanned across.
  IF (SELECT stage FROM public.dispatches
       WHERE route_id='22224001-0000-0000-0000-000000730004'
         AND order_id='66664002-0000-0000-0000-000000730004' AND deleted_at IS NULL)
     IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'a borrowed dispatch must arrive stage=planned, not pre-staged';
  END IF;

  v_snap := public.get_move_task_snapshot('aaaaaaaa-0000-4000-a000-000000730004');
  SELECT x INTO v_row FROM jsonb_array_elements(v_snap->'routes') x
   WHERE x->>'route_id' = '22224001-0000-0000-0000-000000730004';
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'the receiving route must appear on the move task after a top-up';
  END IF;
  IF (v_row->>'remaining_packages')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected 2 remaining packages (own + borrowed), got %', v_row;
  END IF;
  SELECT g INTO v_grp FROM jsonb_array_elements(v_row->'groups') g
   WHERE g->>'dock_zone_id' = '44440042-0000-0000-0000-000000730004';
  IF v_grp IS NULL THEN
    RAISE EXCEPTION 'the borrowed block must appear as its own donor-andén group, got %', v_row->'groups';
  END IF;
  IF (v_grp->>'remaining_count')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected 1 package still to move from the donor andén, got %', v_grp;
  END IF;

  RAISE NOTICE '✓ TEST 12 PASSED: an unstaged borrowed block IS a scan-confirmed move task (Decision 5.5)';
END $$;
ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13 (review fix, Decision 5.4b) — the 25% cap must measure the same
-- unit on both sides. RED before the fix: the read path filtered on the
-- block's PACKAGE count while accept_topup_block compared its DISPATCH
-- count, so an 8-package single-order block was (correctly) never suggested
-- and (incorrectly) accepted against a cap of 1.
-- =============================================================================
SAVEPOINT test_13;
DO $$
DECLARE v_raised boolean := false; v_cands jsonb;
BEGIN
  -- One order on D1's block, 8 packages. R holds 1 package -> cap = 1.
  INSERT INTO public.packages (operator_id, order_id, label, raw_data, status, dock_zone_id)
  SELECT 'aaaaaaaa-0000-4000-a000-000000730004','66664002-0000-0000-0000-000000730004',
         'PKG-P4-D1a-'||g, '{}'::jsonb, 'sectorizado', '44440042-0000-0000-0000-000000730004'
    FROM generate_series(2,8) g;

  v_cands := (public.get_topup_candidates(
    '22224001-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004'))->'candidates';
  IF jsonb_array_length(v_cands) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'read path must not offer an 8-package block against a cap of 1, got %', v_cands;
  END IF;

  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004','22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041','one big multi-bulto order');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'OVER_TOPUP_CAP%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'write path must refuse the same 8-package block the read path refused';
  END IF;

  RAISE NOTICE '✓ TEST 13 PASSED: read and write paths measure the 25%% cap in the same unit (Decision 5.4b)';
END $$;
ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14 (review fix, Decision 6) — max_drops is a cap on the POST-move
-- drop count, not merely a gate on the current one. RED before the fix: a
-- route with max_drops = 2 holding 1 drop was offered a 5-order block and
-- accepted it, ending at 6 drops.
-- =============================================================================
SAVEPOINT test_14;
DO $$
DECLARE v_raised boolean := false; v_cands jsonb; i int;
BEGIN
  UPDATE public.routes SET max_drops = 2 WHERE id='22224001-0000-0000-0000-000000730004';
  -- 30 packages on R so the 25% cap (CEIL(30*0.25)=8) cannot be what binds.
  INSERT INTO public.packages (operator_id, order_id, label, raw_data, status, dock_zone_id)
  SELECT 'aaaaaaaa-0000-4000-a000-000000730004','66664001-0000-0000-0000-000000730004',
         'PKG-P4-R1-'||g,'{}'::jsonb,'sectorizado','44440041-0000-0000-0000-000000730004'
    FROM generate_series(2,30) g;
  FOR i IN 1..4 LOOP
    INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
      delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
    VALUES (('6666400a-0000-0000-0000-00000073000'||i)::uuid,'aaaaaaaa-0000-4000-a000-000000730004',
      'ORD-P4-X'||i,'C','+56900000000','Calle','P4 Comuna Dos',
      '55550042-0000-0000-0000-000000730004',CURRENT_DATE,'{}'::jsonb,'MANUAL',NOW());
    INSERT INTO public.dispatches (operator_id, route_id, order_id, provider, external_dispatch_id, status)
    VALUES ('aaaaaaaa-0000-4000-a000-000000730004','22224002-0000-0000-0000-000000730004',
      ('6666400a-0000-0000-0000-00000073000'||i)::uuid,'dispatchtrack','p4-x'||i,'pending');
    INSERT INTO public.packages (operator_id, order_id, label, raw_data, status, dock_zone_id)
    VALUES ('aaaaaaaa-0000-4000-a000-000000730004',('6666400a-0000-0000-0000-00000073000'||i)::uuid,
      'PKG-X'||i,'{}'::jsonb,'sectorizado','44440042-0000-0000-0000-000000730004');
  END LOOP;

  -- R is at 1 of 2 drops, so the OLD gate ("already at cap?") passes.
  v_cands := (public.get_topup_candidates(
    '22224001-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004'))->'candidates';
  IF jsonb_array_length(v_cands) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'a 5-drop block must not be offered to a route with 1 drop of headroom, got %', v_cands;
  END IF;

  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004','22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041','blow past the drop cap');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'AT_MAX_DROPS%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected AT_MAX_DROPS: 1 + 5 drops is past a cap of 2';
  END IF;

  -- NULL max_drops still means NO cap, never a cap of zero.
  UPDATE public.routes SET max_drops = NULL WHERE id='22224001-0000-0000-0000-000000730004';
  IF jsonb_array_length((public.get_topup_candidates(
       '22224001-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004'))->'candidates') = 0 THEN
    RAISE EXCEPTION 'an unconfigured max_drops must mean no cap, not a cap of zero';
  END IF;

  RAISE NOTICE '✓ TEST 14 PASSED: max_drops caps the post-move drop count; NULL means no cap (Decision 6)';
END $$;
ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15 (review fix, security) — the manager gate must live in the
-- database, not only in the Next.js handler. `accept_topup_block` and
-- `route_blocks` are both reachable by any `authenticated` user through
-- PostgREST. RED before the fix: a `loading_crew` user executed a complete
-- top-up (soft-deleting a dispatch off another route's plan) and chose the
-- audit_logs user_id, attributing it to a manager; the same user INSERTed a
-- forged sequence_source='topup' block, which permanently consumed a
-- route's one borrowed-block slot (get_topup_candidates -> ALREADY_HAS_TOPUP).
-- =============================================================================
SAVEPOINT test_15;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token)
VALUES ('aaaaaaaa-0000-4000-a000-000000730049','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','spec73p4-crew@test.test', crypt('x', gen_salt('bf')), NOW(),
  '{"operator_id":"aaaaaaaa-0000-4000-a000-000000730004","role":"loading_crew"}'::jsonb,
  '{"full_name":"Crew P4"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.users (id, operator_id, email, full_name, role, permissions)
VALUES ('aaaaaaaa-0000-4000-a000-000000730049','aaaaaaaa-0000-4000-a000-000000730004',
  'spec73p4-crew@test.test','Crew P4','loading_crew', ARRAY['dispatch'])
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000730049","role":"authenticated","operator_id":"aaaaaaaa-0000-4000-a000-000000730004"}', true);

DO $$
DECLARE v_raised boolean := false;
BEGIN
  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004','22224002-0000-0000-0000-000000730004',
      '55550042-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004',
      -- the loading_crew caller naming the MANAGER as the actor
      'aaaaaaaa-0000-4000-a000-000000730041','crew-initiated raid');
  EXCEPTION WHEN OTHERS THEN
    -- Pinned to accept_topup_block's OWN refusal. The route_blocks
    -- provenance trigger also raises 42501 further down the same call, and
    -- matching on the SQLSTATE alone let a mutant that deleted this gate
    -- pass the suite on the trigger's back.
    IF SQLSTATE = '42501' AND SQLERRM LIKE '%aceptar un relleno%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'loading_crew must not be able to execute accept_topup_block';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dispatches
              WHERE id='77774002-0000-0000-0000-000000730004' AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a refused top-up must not have removed the donor dispatch';
  END IF;

  v_raised := false;
  BEGIN
    INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source, donor_route_id)
    VALUES ('aaaaaaaa-0000-4000-a000-000000730004','22224001-0000-0000-0000-000000730004',
            '55550043-0000-0000-0000-000000730004', 99, 'topup', '22224003-0000-0000-0000-000000730004');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'loading_crew must not be able to forge a borrowed-block row directly';
  END IF;

  v_raised := false;
  BEGIN
    UPDATE public.route_blocks
       SET sequence_source='topup', donor_route_id='22224003-0000-0000-0000-000000730004'
     WHERE id='88884001-0000-0000-0000-000000730004';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42501' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'loading_crew must not be able to rewrite a block''s provenance to topup';
  END IF;

  RAISE NOTICE '✓ TEST 15 PASSED: the manager gate is enforced in the database, not only in the API handler';
END $$;

-- A manager is still allowed, and the audit row now names the ACTUAL actor.
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000730041","role":"authenticated","operator_id":"aaaaaaaa-0000-4000-a000-000000730004"}', true);
DO $$
DECLARE v_res jsonb; v_actor uuid;
BEGIN
  v_res := public.accept_topup_block(
    '22224001-0000-0000-0000-000000730004','22224002-0000-0000-0000-000000730004',
    '55550042-0000-0000-0000-000000730004','aaaaaaaa-0000-4000-a000-000000730004',
    -- the caller LIES about who they are; the JWT must win.
    'aaaaaaaa-0000-4000-a000-000000730049','manager top-up');
  IF (v_res->>'moved_package_count')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'a manager must still be able to accept a top-up, got %', v_res;
  END IF;
  SELECT user_id INTO v_actor FROM public.audit_logs
   WHERE action='topup_block_move' AND operator_id='aaaaaaaa-0000-4000-a000-000000730004'
   ORDER BY id DESC LIMIT 1;
  IF v_actor IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000730041'::uuid THEN
    RAISE EXCEPTION 'audit_logs must name the JWT actor, not the p_user_id argument; got %', v_actor;
  END IF;
  RAISE NOTICE '✓ TEST 15b PASSED: a manager still succeeds, and audit_logs names the real actor';
END $$;
ROLLBACK TO test_15;

-- =============================================================================
-- TEST 16 (review addition, Decision 5.1) — accept_topup_block's own
-- adjacency re-check. The suite proved the READ path excludes a
-- non-adjacent block (TEST 1's distractor) but never that the WRITE path
-- refuses one, so a mutant that deleted the NOT_ADJACENT guard entirely
-- survived: a manager posting straight to the accept endpoint with a stale
-- or hand-made comuna_id could move a block from the far end of the
-- warehouse.
-- =============================================================================
SAVEPOINT test_16;
DO $$
DECLARE v_raised boolean := false;
BEGIN
  -- D2 carries comuna Tres, sourced from Z3, which is adjacent to nothing.
  BEGIN
    PERFORM public.accept_topup_block(
      '22224001-0000-0000-0000-000000730004',
      '22224003-0000-0000-0000-000000730004',
      '55550043-0000-0000-0000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730004',
      'aaaaaaaa-0000-4000-a000-000000730041',
      'reach across the warehouse');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_ADJACENT%' THEN v_raised := true; ELSE RAISE; END IF;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'expected NOT_ADJACENT for a block sourced from a non-adjacent andén';
  END IF;

  IF EXISTS (SELECT 1 FROM public.dispatches
              WHERE id='77774003-0000-0000-0000-000000730004' AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a refused non-adjacent top-up must not have touched the donor';
  END IF;

  RAISE NOTICE '✓ TEST 16 PASSED: accept_topup_block re-checks adjacency itself (Decision 5.1)';
END $$;
ROLLBACK TO test_16;

ROLLBACK;
