-- =============================================================================
-- spec-77 phase 1b — force-seal splits a `partially_staged` stop.
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
--
-- House style, matching pre_route_snapshot.test.sql / spec70_dispatch_stage
-- .test.sql: fixtures inside one transaction, each test a DO block that
-- RAISEs on failure, SAVEPOINT/ROLLBACK TO around each so one failure does
-- not abort the rest.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000077', 'Test Op 77-A', 'test-op-77-a', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES ('cccc0001-0000-0000-0000-000000000077', '99977', 'TestComuna 77', 'Test Prov', 'Test Region', 99)
ON CONFLICT (codigo_cut) DO NOTHING;

INSERT INTO public.dock_zones (id, operator_id, name, code, is_consolidation, is_active)
VALUES ('dddd0001-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077', 'Andén 77', 'A77', false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dock_zone_comunas (dock_zone_id, comuna_id)
VALUES ('dddd0001-0000-0000-0000-000000000077', 'cccc0001-0000-0000-0000-000000000077')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- TEST 1: dispatches_stage_check accepts 'force_split'
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_route_id uuid := '11110001-0000-0000-0000-000000000077';
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077', 'dispatchtrack', 'T77-ROUTE-001', CURRENT_DATE, 'loaded');

  INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
  VALUES ('d7500001-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    v_route_id, 'dispatchtrack', 'force_split', NOW());

  RAISE NOTICE '✓ TEST 1 PASSED: dispatches_stage_check accepts force_split';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: route_stop_counts gives force_split its own bucket, folded into
-- neither pending_stops nor staged_stops
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_route_id uuid := '11110002-0000-0000-0000-000000000077';
  r public.route_stop_counts%ROWTYPE;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077', 'dispatchtrack', 'T77-ROUTE-002', CURRENT_DATE, 'loaded');

  INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
  VALUES
    ('d7500002-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
      v_route_id, 'dispatchtrack', 'force_split', NOW()),
    ('d7500003-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
      v_route_id, 'dispatchtrack', 'staged', NOW());

  SELECT * INTO r FROM public.route_stop_counts WHERE route_id = v_route_id;

  IF r.total_stops <> 2 THEN
    RAISE EXCEPTION 'TEST 2: total_stops=%, want 2', r.total_stops;
  ELSIF r.force_split_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 2: force_split_stops=%, want 1', r.force_split_stops;
  ELSIF r.staged_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 2: staged_stops=%, want 1 (force_split must not leak in)', r.staged_stops;
  ELSIF r.pending_stops <> 0 THEN
    RAISE EXCEPTION 'TEST 2: pending_stops=%, want 0 (force_split must not leak in)', r.pending_stops;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: force_split_stops is its own bucket';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: get_pre_route_snapshot shows a force_split order's released
-- package, never the one that already shipped
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_route_id uuid := '11110003-0000-0000-0000-000000000077';
  v_order_id uuid := 'eeee0001-0000-0000-0000-000000000077';
  v_result jsonb;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES (v_order_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    'T77-ORD-003', 'Cliente 3', '+56900000003', 'Calle 77 #3', 'TestComuna 77',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000077');

  -- One package genuinely loaded (travelled with the route) — must NOT
  -- reappear as available.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id,
    loaded_at, load_inferred)
  VALUES ('ffff0001-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    v_order_id, 'PKG-T77-003A', '{}'::jsonb, 'listo_para_despacho',
    'dddd0001-0000-0000-0000-000000000077', NOW(), false);

  -- One package released back to the dock — must appear.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id,
    loaded_at, load_inferred)
  VALUES ('ffff0002-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    v_order_id, 'PKG-T77-003B', '{}'::jsonb, 'sectorizado',
    'dddd0001-0000-0000-0000-000000000077', NULL, false);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, raw_data, status)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077', 'dispatchtrack', 'T77-ROUTE-003',
    CURRENT_DATE, '{}'::jsonb, 'loaded');

  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, raw_data, status, stage, staged_at)
  VALUES ('d7500004-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    v_order_id, v_route_id, 'dispatchtrack', '{}'::jsonb, 'pending', 'force_split', NOW());

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000077'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 3: order_count=%, want 1 (the split order must reappear) — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  ELSIF (v_result->'totals'->>'package_count')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 3: package_count=%, want 1 (only the released package, never the shipped one) — result: %',
      (v_result->'totals'->>'package_count')::int, v_result;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: a force_split order surfaces only its released package';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: regression — a normal, fully-committed order on an active route
-- (no force_split dispatch) is still excluded wholesale, exactly as before
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_route_id uuid := '11110004-0000-0000-0000-000000000077';
  v_order_id uuid := 'eeee0002-0000-0000-0000-000000000077';
  v_result jsonb;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES (v_order_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    'T77-ORD-004', 'Cliente 4', '+56900000004', 'Calle 77 #4', 'TestComuna 77',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000077');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff0003-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    v_order_id, 'PKG-T77-004', '{}'::jsonb, 'sectorizado', 'dddd0001-0000-0000-0000-000000000077');

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, raw_data, status)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077', 'dispatchtrack', 'T77-ROUTE-004',
    CURRENT_DATE, '{}'::jsonb, 'loading');

  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, raw_data, status, stage)
  VALUES ('d7500005-0000-0000-0000-000000000077', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000077',
    v_order_id, v_route_id, 'dispatchtrack', '{}'::jsonb, 'pending', 'planned');

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000077'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int <> 0 THEN
    RAISE EXCEPTION 'TEST 4: order_count=%, want 0 (a normal active-route order must stay excluded) — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: a non-force_split dispatch still excludes the whole order';
END $$;

ROLLBACK TO test_4;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec-77 force-split tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
