-- =============================================================================
-- spec-72 phase 5 (FINAL) — actual-sequence capture
-- (compute_route_actual_sequence, sync_actual_sequence_on_route_completed).
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_phase5_actual_sequence.test.sql
--
-- House style, matching spec72_phase3_reorder_route_block.test.sql /
-- spec72_phase4_territory_history.test.sql: fixtures inside one transaction,
-- SAVEPOINT per test, each test a DO block that RAISEs on failure, ROLLBACK
-- TO the savepoint so later tests are unaffected by an earlier failure,
-- final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema/function/trigger existence ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'compute_route_actual_sequence'
  ) THEN
    RAISE EXCEPTION 'compute_route_actual_sequence function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.routes'::regclass
       AND tgname  = 'sync_actual_sequence_on_route_completed'
  ) THEN
    RAISE EXCEPTION 'sync_actual_sequence_on_route_completed trigger missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators (A, B), 1 user each, 1 comuna, orders ────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'Test Op 72p5 A', 'test-op-72-p5-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000725', 'Test Op 72p5 B', 'test-op-72-p5-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000175',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec72p5.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000725"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000175',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec72p5.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000725"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000175','aaaaaaaa-aaaa-aaaa-aaaa-000000000725','user-a@spec72p5.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000175','bbbbbbbb-bbbb-bbbb-bbbb-000000000725','user-b@spec72p5.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('55550001-0000-0000-0000-000000000725', '74301', 'Comuna P5 Uno', 'Provincia Test', 'Region Test', 98)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{}', true);

-- 6 orders for operator A, 1 for operator B (cross-tenant leakage test).
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('77770001-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P5-1',
   'Cliente Uno', '+56911111101', 'Calle Falsa 1', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('77770002-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P5-2',
   'Cliente Dos', '+56911111102', 'Calle Falsa 2', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('77770003-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P5-3',
   'Cliente Tres', '+56911111103', 'Calle Falsa 3', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('77770004-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P5-4',
   'Cliente Cuatro', '+56911111104', 'Calle Falsa 4', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('77770005-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P5-5',
   'Cliente Cinco', '+56911111105', 'Calle Falsa 5', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('77770006-0000-0000-0000-000000000725', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'ORD-72P5-6',
   'Cliente Seis', '+56911111106', 'Calle Falsa 6', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('77770007-0000-0000-0000-000000000725', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000725', 'ORD-72P5-7',
   'Cliente Siete', '+56911111107', 'Calle Falsa 7', 'Comuna P5 Uno',
   '55550001-0000-0000-0000-000000000725', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: route completes -> the trigger fires -> dispatches ranked by
-- arrived_at ascending, earliest = 1.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  r jsonb; v_route uuid;
  d1 uuid; d2 uuid; d3 uuid;
  seq1 int; seq2 int; seq3 int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725',
          '77770003-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;

  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';
  SELECT id INTO d3 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770003-0000-0000-0000-000000000725';

  -- Arrival order: d2 first, then d3, then d1 last — deliberately not the
  -- planned/insertion order, so a passing test proves ranking by arrived_at,
  -- not by row/insertion order.
  UPDATE public.dispatches SET arrived_at = NOW() + interval '20 minutes' WHERE id = d1;
  UPDATE public.dispatches SET arrived_at = NOW() + interval '5 minutes'  WHERE id = d2;
  UPDATE public.dispatches SET arrived_at = NOW() + interval '10 minutes' WHERE id = d3;

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  SELECT actual_sequence INTO seq1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO seq2 FROM public.dispatches WHERE id = d2;
  SELECT actual_sequence INTO seq3 FROM public.dispatches WHERE id = d3;

  IF seq2 IS DISTINCT FROM 1 OR seq3 IS DISTINCT FROM 2 OR seq1 IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST 1: expected d2=1,d3=2,d1=3, got d1=%,d2=%,d3=%', seq1, seq2, seq3;
  END IF;
  RAISE NOTICE '✓ TEST 1 PASSED: completing a route ranks its dispatches by arrived_at ascending';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: completed_at fallback when arrived_at is absent; a dispatch with
-- NEITHER timestamp gets actual_sequence = NULL, never a trailing rank.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  r jsonb; v_route uuid;
  d1 uuid; d2 uuid; d3 uuid;
  seq1 int; seq2 int; seq3 int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725',
          '77770003-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;

  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';
  SELECT id INTO d3 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770003-0000-0000-0000-000000000725';

  -- d1: arrived_at only. d2: completed_at only (fallback). d3: neither.
  UPDATE public.dispatches SET arrived_at  = NOW() + interval '1 minute'  WHERE id = d1;
  UPDATE public.dispatches SET completed_at = NOW() + interval '30 seconds' WHERE id = d2;
  -- d3 left untouched: no arrived_at, no completed_at.

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  SELECT actual_sequence INTO seq1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO seq2 FROM public.dispatches WHERE id = d2;
  SELECT actual_sequence INTO seq3 FROM public.dispatches WHERE id = d3;

  IF seq2 IS DISTINCT FROM 1 OR seq1 IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST 2: expected d2=1 (completed_at fallback, earlier), d1=2, got d1=%,d2=%', seq1, seq2;
  END IF;
  IF seq3 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 2: expected d3 (no timestamp at all) to stay NULL, got %', seq3;
  END IF;
  RAISE NOTICE '✓ TEST 2 PASSED: completed_at fallback ranks correctly, a dispatch with no timestamp stays NULL (never a fabricated trailing rank)';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: no-op transitions — flipping to any status OTHER than 'completed'
-- (or re-saving an already-completed route) must never touch actual_sequence.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; seq int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route;
  UPDATE public.dispatches SET arrived_at = NOW() WHERE id = d1;

  UPDATE public.routes SET status = 'in_progress' WHERE id = v_route;
  SELECT actual_sequence INTO seq FROM public.dispatches WHERE id = d1;
  IF seq IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 3a: expected actual_sequence to stay NULL on a non-completed transition, got %', seq;
  END IF;

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;
  SELECT actual_sequence INTO seq FROM public.dispatches WHERE id = d1;
  IF seq IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST 3b: expected actual_sequence = 1 after completing, got %', seq;
  END IF;

  -- Manually poison the rank, then re-save status='completed' (no real
  -- transition — OLD.status is already 'completed') and prove the trigger
  -- does NOT refire and does NOT overwrite the poisoned value.
  UPDATE public.dispatches SET actual_sequence = 999 WHERE id = d1;
  UPDATE public.routes SET total_km = 42 WHERE id = v_route;
  SELECT actual_sequence INTO seq FROM public.dispatches WHERE id = d1;
  IF seq IS DISTINCT FROM 999 THEN
    RAISE EXCEPTION 'TEST 3c: an unrelated UPDATE on an already-completed route must not refire the trigger, got %', seq;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: only the transition INTO completed fires the writer';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: idempotent re-run — calling compute_route_actual_sequence again
-- (a) is stable when nothing changed, and (b) reverts a dispatch that lost
-- its only timestamp back to NULL rather than keeping a stale rank.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; d2 uuid; seq1 int; seq2 int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';
  UPDATE public.dispatches SET arrived_at = NOW() WHERE id = d1;
  UPDATE public.dispatches SET arrived_at = NOW() + interval '1 minute' WHERE id = d2;

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  -- (a) stable re-run
  PERFORM public.compute_route_actual_sequence(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);
  SELECT actual_sequence INTO seq1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO seq2 FROM public.dispatches WHERE id = d2;
  IF seq1 IS DISTINCT FROM 1 OR seq2 IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST 4a: expected stable ranks 1/2 on re-run, got %/%', seq1, seq2;
  END IF;

  -- (b) d2 loses its timestamp -> re-run reverts it to NULL, d1 unaffected.
  UPDATE public.dispatches SET arrived_at = NULL WHERE id = d2;
  PERFORM public.compute_route_actual_sequence(v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);
  SELECT actual_sequence INTO seq1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO seq2 FROM public.dispatches WHERE id = d2;
  IF seq1 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST 4b: expected d1 to stay at rank 1, got %', seq1;
  END IF;
  IF seq2 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 4b: expected d2 to revert to NULL after losing its timestamp, got %', seq2;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: compute_route_actual_sequence is idempotent and reverts corrected rows to NULL';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: operator isolation — operator B cannot compute (or leak into)
-- operator A's route, and a foreign-operator dispatch is never touched by
-- operator A's own completion either.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  r jsonb; v_route_a uuid; d_a uuid;
  caught boolean := false;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725'], NULL);
  v_route_a := (r->>'id')::uuid;
  SELECT id INTO d_a FROM public.dispatches WHERE route_id = v_route_a;
  UPDATE public.dispatches SET arrived_at = NOW() WHERE id = d_a;

  BEGIN
    PERFORM public.compute_route_actual_sequence(v_route_a, 'bbbbbbbb-bbbb-bbbb-bbbb-000000000725'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0002' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'TEST 5: expected ROUTE_NOT_FOUND (P0002) when operator B computes operator A''s route, got no error';
  END IF;

  IF EXISTS (SELECT 1 FROM public.dispatches WHERE id = d_a AND actual_sequence IS NOT NULL) THEN
    RAISE EXCEPTION 'TEST 5: operator A''s dispatch was ranked by operator B''s rejected call';
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: a foreign operator_id is refused with ROUTE_NOT_FOUND and never ranks the route';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: nonexistent route raises ROUTE_NOT_FOUND.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  caught boolean := false;
BEGIN
  BEGIN
    PERFORM public.compute_route_actual_sequence('00000000-0000-0000-0000-000000000000'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0002' THEN
      caught := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT caught THEN
    RAISE EXCEPTION 'TEST 6: expected ROUTE_NOT_FOUND for a nonexistent route, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: ROUTE_NOT_FOUND raised for a nonexistent route';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 (mutation-targeted, soft-delete filter): a soft-deleted dispatch,
-- even with an arrived_at, must never be ranked or counted against its live
-- siblings' ranks.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; d2 uuid; seq1 int; seq2 int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';

  -- d1 "arrives" earliest but is soft-deleted before the route completes.
  UPDATE public.dispatches SET arrived_at = NOW(), deleted_at = NOW() WHERE id = d1;
  UPDATE public.dispatches SET arrived_at = NOW() + interval '5 minutes' WHERE id = d2;

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  SELECT actual_sequence INTO seq1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO seq2 FROM public.dispatches WHERE id = d2;

  IF seq1 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 7: expected the soft-deleted dispatch to stay NULL (excluded), got %', seq1;
  END IF;
  IF seq2 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST 7: expected the live dispatch to rank 1 (soft-deleted sibling excluded from ranking), got %', seq2;
  END IF;
  RAISE NOTICE '✓ TEST 7 PASSED: a soft-deleted dispatch is excluded from ranking and never occupies a rank slot';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: RLS end-to-end as authenticated — the trigger path (not the direct
-- RPC call) also works correctly under a real operator JWT context.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; seq int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000175","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;

  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route;
  UPDATE public.dispatches SET arrived_at = NOW() WHERE id = d1;
  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  SELECT actual_sequence INTO seq FROM public.dispatches WHERE id = d1;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);

  IF seq IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST 8: expected actual_sequence = 1 under RLS as authenticated, got %', seq;
  END IF;
  RAISE NOTICE '✓ TEST 8 PASSED: the completed-transition trigger works end-to-end under RLS as authenticated';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 (mutation-targeted, tenancy filter): a dispatch row stamped with a
-- FOREIGN operator_id, sharing route_id with operator A's OWN route (a data
-- inconsistency that should never happen via the app, but the RPC must not
-- trust route_id alone — same "rogue row" precedent as
-- spec72_phase3_reorder_route_block.test.sql TEST 10), must never be ranked
-- by operator A's own completion. route_id already uniquely identifies one
-- operator's route (routes.id is globally unique), so this is the ONLY way
-- to exercise the `d.operator_id = p_operator_id` filter in the ranking
-- CTE at all -- TEST 5 above only proves the earlier routes-table ownership
-- check, which is a different line entirely.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; d2 uuid; seq1 int; seq2 int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';

  -- Rogue stamp: d2 claims operator B, despite sharing operator A's route_id.
  UPDATE public.dispatches SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000725'::uuid WHERE id = d2;

  -- d2 (rogue) "arrives" first; d1 (legitimately operator A's) arrives second.
  UPDATE public.dispatches SET arrived_at = NOW() + interval '5 minutes' WHERE id = d1;
  UPDATE public.dispatches SET arrived_at = NOW()                       WHERE id = d2;

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  SELECT actual_sequence INTO seq1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO seq2 FROM public.dispatches WHERE id = d2;

  IF seq2 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 9: expected the rogue-operator_id dispatch to stay NULL (excluded from operator A''s ranking), got %', seq2;
  END IF;
  IF seq1 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST 9: expected operator A''s own dispatch to rank 1 (the rogue row must not occupy a rank slot), got %', seq1;
  END IF;
  RAISE NOTICE '✓ TEST 9 PASSED: a dispatch row stamped with a foreign operator_id is excluded even though it shares route_id with this operator''s own route';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 (review): an EXACT arrived_at tie must still produce two distinct,
-- consecutive ranks, deterministically ordered by dispatch id. The ranking is
-- ROW_NUMBER, not DENSE_RANK/RANK: two blocks sharing a rank number would make
-- "actual rank N" ambiguous downstream, and RANK would additionally leave a
-- hole (1,1,3) that reads as a missing stop. Pins the window function choice.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; d2 uuid; d3 uuid;
  s1 int; s2 int; s3 int; v_t timestamptz := NOW();
  lo uuid; hi uuid;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725',
          '77770003-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';
  SELECT id INTO d3 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770003-0000-0000-0000-000000000725';

  -- d1 and d2 arrive at the EXACT same instant; d3 strictly later.
  UPDATE public.dispatches SET arrived_at = v_t                        WHERE id IN (d1, d2);
  UPDATE public.dispatches SET arrived_at = v_t + interval '5 minutes' WHERE id = d3;

  UPDATE public.routes SET status = 'completed' WHERE id = v_route;

  SELECT actual_sequence INTO s1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO s2 FROM public.dispatches WHERE id = d2;
  SELECT actual_sequence INTO s3 FROM public.dispatches WHERE id = d3;

  IF s1 IS NULL OR s2 IS NULL OR s1 = s2 THEN
    RAISE EXCEPTION 'TEST 10: tied dispatches must not share a rank (got %/%) — ROW_NUMBER, not DENSE_RANK', s1, s2;
  END IF;
  IF s3 IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST 10: the strictly-later dispatch must rank 3 with no hole and no shared slot, got %', s3;
  END IF;
  IF NOT COALESCE((s1 = 1 AND s2 = 2) OR (s1 = 2 AND s2 = 1), false) THEN
    RAISE EXCEPTION 'TEST 10: tied dispatches must occupy ranks 1 and 2, got %/%', s1, s2;
  END IF;

  -- Deterministic: the tiebreak is `d.id ASC`, so the lower uuid ranks first.
  lo := LEAST(d1, d2); hi := GREATEST(d1, d2);
  IF (SELECT actual_sequence FROM public.dispatches WHERE id = lo) IS DISTINCT FROM 1
     OR (SELECT actual_sequence FROM public.dispatches WHERE id = hi) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST 10: a tie must break deterministically on d.id ASC (lower uuid first)';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: an exact arrived_at tie yields distinct consecutive ranks, broken deterministically by dispatch id';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11 (review): completing a route that has NO dispatches at all, and one
-- whose dispatches all lack any timestamp, must be a clean no-op — the trigger
-- fires unconditionally on the transition, so it has to survive an empty
-- ranking set rather than raising into the caller's UPDATE (which would make
-- the DispatchTrack webhook's PATCH fail on a legitimately empty route).
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE
  v_empty uuid; r jsonb; v_route uuid; n bigint;
BEGIN
  INSERT INTO public.routes (operator_id, provider, external_route_id, route_date, status)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000725', 'dispatchtrack', 'RT-72P5-EMPTY', CURRENT_DATE, 'planned')
  RETURNING id INTO v_empty;

  UPDATE public.routes SET status = 'completed' WHERE id = v_empty;  -- must not raise

  -- A route whose dispatches exist but have no arrival signal at all.
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  UPDATE public.routes SET status = 'completed' WHERE id = v_route;  -- must not raise

  SELECT count(*) INTO n FROM public.dispatches
   WHERE route_id = v_route AND actual_sequence IS NOT NULL;
  IF n <> 0 THEN
    RAISE EXCEPTION 'TEST 11: dispatches with no timestamp must stay unranked on completion, got % ranked', n;
  END IF;

  RAISE NOTICE '✓ TEST 11 PASSED: completing a route with no dispatches (or no arrival signals) is a clean no-op';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12 (review): the PRODUCTION writer path. The DispatchTrack n8n webhook
-- PATCHes routes.status as service_role with NO JWT claims set, so
-- public.get_operator_id() is NULL for it. compute_route_actual_sequence is
-- SECURITY INVOKER, which means that call runs as service_role and relies on
-- service_role's RLS bypass (plus the explicit p_operator_id argument) rather
-- than on any session operator context. TEST 8 proves the authenticated path;
-- this proves the one production actually uses. A future change that made the
-- function depend on get_operator_id() -- or that ran it as a role without
-- RLS bypass -- would silently rank nothing here while TEST 8 still passed.
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE
  r jsonb; v_route uuid; d1 uuid; d2 uuid; s1 int; s2 int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000725'::uuid,
    ARRAY['77770001-0000-0000-0000-000000000725','77770002-0000-0000-0000-000000000725'], NULL);
  v_route := (r->>'id')::uuid;
  SELECT id INTO d1 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770001-0000-0000-0000-000000000725';
  SELECT id INTO d2 FROM public.dispatches WHERE route_id = v_route AND order_id = '77770002-0000-0000-0000-000000000725';
  UPDATE public.dispatches SET arrived_at = NOW() + interval '10 minutes' WHERE id = d1;
  UPDATE public.dispatches SET arrived_at = NOW()                         WHERE id = d2;

  -- No JWT context at all — exactly the webhook's. Both GUC spellings are
  -- cleared (auth.uid() reads either), and the absence is ASSERTED rather
  -- than assumed: without this guard an inherited claim from an earlier test
  -- would silently turn this into a second copy of TEST 8.
  PERFORM set_config('request.jwt.claims',    '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF public.get_operator_id() IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 12: setup failed — session still has an operator context (%), this must run with none',
      public.get_operator_id();
  END IF;
  SET LOCAL ROLE service_role;
  UPDATE public.routes SET status = 'completed' WHERE id = v_route;
  RESET ROLE;

  SELECT actual_sequence INTO s1 FROM public.dispatches WHERE id = d1;
  SELECT actual_sequence INTO s2 FROM public.dispatches WHERE id = d2;

  IF s2 IS DISTINCT FROM 1 OR s1 IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST 12: expected d2=1,d1=2 for a service_role completion with no JWT claims, got d1=%,d2=%', s1, s2;
  END IF;
  RAISE NOTICE '✓ TEST 12 PASSED: the completed-transition trigger ranks correctly as service_role with no JWT claims (the n8n webhook path)';
END $$;

ROLLBACK TO test_12;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72 phase5 actual-sequence tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
