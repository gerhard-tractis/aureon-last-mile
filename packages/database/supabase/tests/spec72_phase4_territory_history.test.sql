-- =============================================================================
-- spec-72 phase 4 — territory stability (get_route_territory_history).
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec72_phase4_territory_history.test.sql
--
-- House style, matching spec72_phase3_reorder_route_block.test.sql: fixtures
-- inside one transaction, SAVEPOINT per test, each test a DO block that
-- RAISEs on failure, ROLLBACK TO the savepoint so later tests are unaffected
-- by an earlier failure, final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema/function existence ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_route_territory_history'
  ) THEN
    RAISE EXCEPTION 'get_route_territory_history function missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators (A, B), 1 user each, 2 comunas, orders ───────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'Test Op 72p4 A', 'test-op-72-p4-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000724', 'Test Op 72p4 B', 'test-op-72-p4-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000174',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec72p4.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000724"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000174',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec72p4.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000724"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000174','aaaaaaaa-aaaa-aaaa-aaaa-000000000724','user-a@spec72p4.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000174','bbbbbbbb-bbbb-bbbb-bbbb-000000000724','user-b@spec72p4.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('55550001-0000-0000-0000-000000000724', '74201', 'Comuna P4 Uno', 'Provincia Test', 'Region Test', 97),
  ('55550002-0000-0000-0000-000000000724', '74202', 'Comuna P4 Dos', 'Provincia Test', 'Region Test', 97)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{}', true);

-- Orders for operator A: 3 in comuna Uno (for 3 separate historical routes +
-- 1 current route), 1 in comuna Dos.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660001-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-1',
   'Cliente Uno', '+56911111111', 'Calle Falsa 1', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660002-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-2',
   'Cliente Dos', '+56922222222', 'Calle Falsa 2', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660003-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-3',
   'Cliente Tres', '+56933333333', 'Calle Falsa 3', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660004-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-4',
   'Cliente Cuatro', '+56944444444', 'Calle Falsa 4', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  -- 6-14: extra orders for phase-4 review tests 13-17 (run_count pinning,
  -- and the four correct-but-previously-untested filters).
  ('66660006-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-6',
   'Cliente Seis', '+56966666606', 'Calle Falsa 6', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660007-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-7',
   'Cliente Siete', '+56966666607', 'Calle Falsa 7', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660008-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-8',
   'Cliente Ocho', '+56966666608', 'Calle Falsa 8', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660009-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-9',
   'Cliente Nueve', '+56966666609', 'Calle Falsa 9', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660010-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-10',
   'Cliente Diez', '+56966666610', 'Calle Falsa 10', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660011-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-11',
   'Cliente Once', '+56966666611', 'Calle Falsa 11', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660012-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-12',
   'Cliente Doce', '+56966666612', 'Calle Falsa 12', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660013-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-13',
   'Cliente Trece', '+56966666613', 'Calle Falsa 13', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
  ('66660014-0000-0000-0000-000000000724', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724', 'ORD-72P4-14',
   'Cliente Catorce', '+56966666614', 'Calle Falsa 14', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- Order for operator B — used only for the cross-tenant leakage test.
INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, comuna_id, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('66660005-0000-0000-0000-000000000724', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000724', 'ORD-72P4-5',
   'Cliente Cinco', '+56955555555', 'Calle Falsa 5', 'Comuna P4 Uno',
   '55550001-0000-0000-0000-000000000724', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: basic case — one historical route driven by "Juan Perez" covering
-- comuna Uno; a new current route also covering comuna Uno gets Juan back,
-- with run_count = 1.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  r_hist jsonb; v_hist_route uuid;
  r_cur  jsonb; v_cur_route  uuid;
  out_driver text; out_count int; out_comuna text;
BEGIN
  r_hist := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 5));
  v_hist_route := (r_hist->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Juan Perez' WHERE id = v_hist_route;

  r_cur := public.create_seeded_route(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur_route := (r_cur->>'id')::uuid;

  SELECT comuna_name, driver_name, run_count INTO out_comuna, out_driver, out_count
    FROM public.get_route_territory_history(v_cur_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);

  IF out_driver <> 'Juan Perez' THEN
    RAISE EXCEPTION 'TEST 1: expected driver_name Juan Perez, got %', out_driver;
  END IF;
  IF out_count <> 1 THEN
    RAISE EXCEPTION 'TEST 1: expected run_count 1, got %', out_count;
  END IF;
  IF out_comuna <> 'Comuna P4 Uno' THEN
    RAISE EXCEPTION 'TEST 1: expected comuna_name Comuna P4 Uno, got %', out_comuna;
  END IF;
  RAISE NOTICE '✓ TEST 1 PASSED: basic territory lookup returns the historical driver and run_count 1';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: two historical routes, same driver, same comuna -> run_count = 2,
-- and the MOST RECENT route_date wins as last_route_date.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  r1 jsonb; v_r1 uuid; r2 jsonb; v_r2 uuid; r_cur jsonb; v_cur uuid;
  out_driver text; out_count int; out_date date;
BEGIN
  r1 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 10));
  v_r1 := (r1->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Ana Soto' WHERE id = v_r1;

  r2 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], (CURRENT_DATE - 2));
  v_r2 := (r2->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Ana Soto' WHERE id = v_r2;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660003-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT driver_name, run_count, last_route_date INTO out_driver, out_count, out_date
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);

  IF out_driver <> 'Ana Soto' OR out_count <> 2 THEN
    RAISE EXCEPTION 'TEST 2: expected Ana Soto / run_count 2, got %/%', out_driver, out_count;
  END IF;
  IF out_date <> (CURRENT_DATE - 2) THEN
    RAISE EXCEPTION 'TEST 2: expected last_route_date % (the more recent route), got %', (CURRENT_DATE - 2), out_date;
  END IF;
  RAISE NOTICE '✓ TEST 2 PASSED: repeated coverage by the same driver aggregates into run_count, most recent route_date wins';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3 (mutation-targeted): a DIFFERENT, more recent driver must win over
-- an older, more frequent one — proves ORDER BY route_date DESC actually
-- drives the "most recent" pick, not just a plain COUNT/mode.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  r1 jsonb; v_r1 uuid; r2 jsonb; v_r2 uuid; r3 jsonb; v_r3 uuid;
  r_cur jsonb; v_cur uuid; out_driver text;
BEGIN
  -- Old driver ran it twice, long ago.
  r1 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 40));
  v_r1 := (r1->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Old Driver' WHERE id = v_r1;

  r2 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], (CURRENT_DATE - 30));
  v_r2 := (r2->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Old Driver' WHERE id = v_r2;

  -- New driver ran it once, yesterday — must still win as "most recent".
  r3 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660003-0000-0000-0000-000000000724'], (CURRENT_DATE - 1));
  v_r3 := (r3->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'New Driver' WHERE id = v_r3;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660004-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT driver_name INTO out_driver
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);

  IF out_driver <> 'New Driver' THEN
    RAISE EXCEPTION 'TEST 3: expected the most RECENT driver (New Driver), got %', out_driver;
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: a more recent single run outranks an older driver''s higher frequency';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4 (mutation-targeted): a cancelled route must be excluded — both from
-- being picked as "most recent" and from run_count.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  r1 jsonb; v_r1 uuid; r2 jsonb; v_r2 uuid; r_cur jsonb; v_cur uuid;
  out_driver text; out_count int; row_count int;
BEGIN
  r1 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_r1 := (r1->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Cancelled Carlos', status = 'cancelled' WHERE id = v_r1;

  r2 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], (CURRENT_DATE - 8));
  v_r2 := (r2->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Real Driver' WHERE id = v_r2;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660003-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'TEST 4: expected exactly 1 result row, got %', row_count;
  END IF;

  SELECT driver_name, run_count INTO out_driver, out_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);

  IF out_driver <> 'Real Driver' THEN
    RAISE EXCEPTION 'TEST 4: expected the cancelled route''s driver excluded, most recent NON-cancelled (Real Driver) wins, got %', out_driver;
  END IF;
  IF out_count <> 1 THEN
    RAISE EXCEPTION 'TEST 4: expected run_count 1 (cancelled route must not count), got %', out_count;
  END IF;
  RAISE NOTICE '✓ TEST 4 PASSED: a cancelled route is excluded from both the pick and run_count';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5 (mutation-targeted): a route with driver_name NULL is excluded
-- entirely — never surfaces as a comuna's history, never inflates run_count.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE r jsonb; v_route uuid; r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_route := (r->>'id')::uuid;
  -- driver_name stays NULL (create_seeded_route never sets it).

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 5: expected zero rows (only historical route has no driver_name), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 5 PASSED: a route with NULL driver_name contributes no territory history';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6 (mutation-targeted): the CURRENT route itself is excluded from its
-- own history, even if it already carries a driver_name.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Self Driver' WHERE id = v_cur;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 6: expected zero rows (the route must not be its own history), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 6 PASSED: the current route never counts as its own territory history';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 (mutation-targeted, cross-tenant): operator B's route for the SAME
-- global comuna_id must never leak into operator A's territory lookup.
-- chile_comunas is a shared reference table, so both rb.operator_id and
-- r.operator_id scope the candidate CTE to it independently (defense in
-- depth, same double-scoping seed_default_route_blocks/move_route_block
-- use). Phase-4 review item 6 correction: this test only proves the PAIR is
-- sufficient — dropping EITHER filter alone still leaks, per this migration
-- header's own "defense in depth" language, but mutation-tested individually
-- each one SURVIVES on its own (the other still blocks the leak via the
-- join). Only removing BOTH at once is caught by this test. The scoping is
-- genuinely correct; this comment used to overstate what a single-mutation
-- run of this test establishes.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  r_b jsonb; v_route_b uuid; r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r_b := public.create_seeded_route('bbbbbbbb-bbbb-bbbb-bbbb-000000000724'::uuid,
    ARRAY['66660005-0000-0000-0000-000000000724'], (CURRENT_DATE - 1));
  v_route_b := (r_b->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Operator B Driver' WHERE id = v_route_b;

  -- Operator A has NO history at all for this comuna — only B does.
  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 7: expected zero rows (operator B''s driver must never leak into operator A''s lookup), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 7 PASSED: a foreign operator''s route for the same global comuna never leaks in';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (mutation-targeted): a soft-deleted route_blocks row on a
-- HISTORICAL route must not count as coverage.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE r jsonb; v_route uuid; r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_route := (r->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Ghost Driver' WHERE id = v_route;
  UPDATE public.route_blocks SET deleted_at = now() WHERE route_id = v_route;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 8: expected zero rows (the historical route''s only block is soft-deleted), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 8 PASSED: a soft-deleted historical block does not count as territory coverage';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: a route with zero live blocks (e.g. an empty-draft route, or one
-- whose only comuna is an orphan) returns an empty set, not an error.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE v_route_id uuid; row_count int;
BEGIN
  INSERT INTO public.routes (operator_id, provider, external_route_id, route_date, status, planned_stops, completed_stops)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid, 'dispatchtrack', 'draft_p4_empty', CURRENT_DATE, 'draft', 0, 0)
  RETURNING id INTO v_route_id;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 9: expected zero rows for a route with no live blocks, got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 9 PASSED: a route with no live blocks returns an empty set, not an error';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: ROUTE_NOT_FOUND (P0002) for a nonexistent route id.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE raised BOOLEAN;
BEGIN
  raised := false;
  BEGIN
    PERFORM * FROM public.get_route_territory_history(
      '00000000-0000-0000-0000-000000000000'::uuid,
      'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 10: expected ROUTE_NOT_FOUND for a nonexistent route, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 10 PASSED: ROUTE_NOT_FOUND raised for a nonexistent route';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11 (mutation-targeted): ROUTE_NOT_FOUND for a route that DOES exist
-- but belongs to a different operator — proves the operator_id filter on
-- the ownership check itself, not just on the candidate CTE (TEST 7).
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE r jsonb; v_route uuid; raised BOOLEAN;
BEGIN
  r := public.create_seeded_route('bbbbbbbb-bbbb-bbbb-bbbb-000000000724'::uuid,
    ARRAY['66660005-0000-0000-0000-000000000724'], NULL);
  v_route := (r->>'id')::uuid;

  raised := false;
  BEGIN
    PERFORM * FROM public.get_route_territory_history(
      v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 11: expected ROUTE_NOT_FOUND when operator A looks up operator B''s route, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 11 PASSED: a foreign route_id is refused with ROUTE_NOT_FOUND';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12: end-to-end under RLS as 'authenticated' (not postgres). Every
-- earlier test in this file runs as postgres, which bypasses RLS entirely.
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE
  r_hist jsonb; v_hist uuid; r_cur jsonb; v_cur uuid; out_driver text;
BEGIN
  r_hist := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_hist := (r_hist->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'RLS Driver' WHERE id = v_hist;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000174","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000724","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT driver_name INTO out_driver
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);

  RESET role;

  IF out_driver <> 'RLS Driver' THEN
    RAISE EXCEPTION 'TEST 12: expected RLS Driver under authenticated role, got %', out_driver;
  END IF;
  RAISE NOTICE '✓ TEST 12 PASSED: get_route_territory_history works end-to-end under RLS as authenticated';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13 (mutation-targeted, review item 2): run_count must count ONLY the
-- winning driver's own routes, not every candidate route covering the
-- comuna. Old Driver ran the comuna 3 times (dates -20,-15,-10); New Driver
-- ran it 2 times, more recently (dates -5,-3) and so wins the "most recent"
-- pick. run_count must pin to exactly 2 (New Driver's own routes), not 5
-- (all candidate routes for the comuna) — mutating
-- `AND cr.driver_name = ld.last_driver_name` to `AND TRUE` in the run_count
-- subquery survives every other test in this file but is caught here.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  r1 jsonb; v_r1 uuid; r2 jsonb; v_r2 uuid; r3 jsonb; v_r3 uuid;
  r4 jsonb; v_r4 uuid; r5 jsonb; v_r5 uuid;
  r_cur jsonb; v_cur uuid; out_driver text; out_count int;
BEGIN
  r1 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 20));
  v_r1 := (r1->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Old Driver' WHERE id = v_r1;

  r2 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], (CURRENT_DATE - 15));
  v_r2 := (r2->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Old Driver' WHERE id = v_r2;

  r3 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660003-0000-0000-0000-000000000724'], (CURRENT_DATE - 10));
  v_r3 := (r3->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Old Driver' WHERE id = v_r3;

  r4 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660004-0000-0000-0000-000000000724'], (CURRENT_DATE - 5));
  v_r4 := (r4->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'New Driver' WHERE id = v_r4;

  r5 := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660006-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_r5 := (r5->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'New Driver' WHERE id = v_r5;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660007-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT driver_name, run_count INTO out_driver, out_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);

  IF out_driver <> 'New Driver' THEN
    RAISE EXCEPTION 'TEST 13: expected New Driver (most recent) to win, got %', out_driver;
  END IF;
  IF out_count <> 2 THEN
    RAISE EXCEPTION 'TEST 13: expected run_count 2 (New Driver''s own 2 routes only, not all 5 candidates), got %', out_count;
  END IF;
  RAISE NOTICE '✓ TEST 13 PASSED: run_count pins to exactly the winning driver''s own routes';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14 (mutation-targeted, review item 5): a soft-deleted HISTORICAL
-- route (routes.deleted_at set, its route_blocks row still live) must not
-- supply territory history. Distinct from TEST 8, which soft-deletes the
-- BLOCK, not the route.
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE r jsonb; v_route uuid; r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_route := (r->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'Deleted Route Driver', deleted_at = now() WHERE id = v_route;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 14: expected zero rows (the historical route itself is soft-deleted), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 14 PASSED: a soft-deleted historical route contributes no territory history';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15 (mutation-targeted, review item 5): the CURRENT route's own
-- soft-deleted block must not trigger a lookup for a comuna it no longer
-- covers. History exists for the comuna from ANOTHER route; the current
-- route's only block for it is soft-deleted, so this_route_comunas must be
-- empty and the function must return zero rows.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  r_hist jsonb; v_hist uuid; r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r_hist := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_hist := (r_hist->>'id')::uuid;
  UPDATE public.routes SET driver_name = 'History Driver' WHERE id = v_hist;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;
  -- The current route's own block for comuna Uno is soft-deleted — it no
  -- longer covers this comuna, so no lookup should fire for it at all.
  UPDATE public.route_blocks SET deleted_at = now() WHERE route_id = v_cur;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 15: expected zero rows (current route''s only block for this comuna is soft-deleted), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 15 PASSED: a soft-deleted block on the CURRENT route excludes that comuna from the lookup';
END $$;

ROLLBACK TO test_15;

-- =============================================================================
-- TEST 16 (mutation-targeted, review item 5): the ownership check itself
-- must respect deleted_at — a soft-deleted p_route_id must raise
-- ROUTE_NOT_FOUND, never silently return whatever history it can still find.
-- =============================================================================
SAVEPOINT test_16;

DO $$
DECLARE r_cur jsonb; v_cur uuid; raised BOOLEAN;
BEGIN
  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;
  UPDATE public.routes SET deleted_at = now() WHERE id = v_cur;

  raised := false;
  BEGIN
    PERFORM * FROM public.get_route_territory_history(
      v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST 16: expected ROUTE_NOT_FOUND for a soft-deleted route, got no error';
  END IF;
  RAISE NOTICE '✓ TEST 16 PASSED: a soft-deleted route is refused with ROUTE_NOT_FOUND, not silently served';
END $$;

ROLLBACK TO test_16;

-- =============================================================================
-- TEST 17 (mutation-targeted, review item 5): a whitespace-only
-- driver_name must never surface as a "driver" — btrim(...) <> '' must
-- catch it, not just a plain IS NOT NULL / <> '' check.
-- =============================================================================
SAVEPOINT test_17;

DO $$
DECLARE r jsonb; v_route uuid; r_cur jsonb; v_cur uuid; row_count int;
BEGIN
  r := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660001-0000-0000-0000-000000000724'], (CURRENT_DATE - 3));
  v_route := (r->>'id')::uuid;
  UPDATE public.routes SET driver_name = '   ' WHERE id = v_route;

  r_cur := public.create_seeded_route('aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid,
    ARRAY['66660002-0000-0000-0000-000000000724'], NULL);
  v_cur := (r_cur->>'id')::uuid;

  SELECT COUNT(*) INTO row_count
    FROM public.get_route_territory_history(v_cur, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000724'::uuid);
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'TEST 17: expected zero rows (whitespace-only driver_name must not surface as a driver), got %', row_count;
  END IF;
  RAISE NOTICE '✓ TEST 17 PASSED: a whitespace-only driver_name contributes no territory history';
END $$;

ROLLBACK TO test_17;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec72 phase4 territory-history tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
