-- =============================================================================
-- spec-37: get_pre_route_snapshot RPC test suite
-- Purpose: Define and verify behaviour of the pre-route planning RPC.
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
--
-- All tests execute inside a transaction that is rolled back at the end so
-- the database is left clean.  Each test raises NOTICE on pass and EXCEPTION
-- (which aborts the current sub-transaction) on fail.  The surrounding
-- SAVEPOINT/ROLLBACK TO pattern lets subsequent tests continue even when one
-- fails.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared test fixtures
-- ---------------------------------------------------------------------------

-- Two operators (A and B)
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000037', 'Test Op 37-A', 'test-op-37-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000037', 'Test Op 37-B', 'test-op-37-b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- Two test communes owned by no real operator (test-only codes)
INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES
  ('cccc0001-0000-0000-0000-000000000037', '99901', 'TestComuna Norte', 'Test Prov', 'Test Region', 99),
  ('cccc0002-0000-0000-0000-000000000037', '99902', 'TestComuna Sur',   'Test Prov', 'Test Region', 99),
  ('cccc0003-0000-0000-0000-000000000037', '99903', 'TestComuna Sin',   'Test Prov', 'Test Region', 99)
ON CONFLICT (codigo_cut) DO NOTHING;

-- Two dock zones for Operator A
INSERT INTO public.dock_zones (id, operator_id, name, code, is_consolidation, is_active)
VALUES
  ('dddd0001-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037', 'Andén Norte', 'AN', false, true),
  ('dddd0002-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037', 'Andén Sur',   'AS', false, true)
ON CONFLICT (id) DO NOTHING;

-- Map communes to zones
INSERT INTO public.dock_zone_comunas (dock_zone_id, comuna_id)
VALUES
  ('dddd0001-0000-0000-0000-000000000037', 'cccc0001-0000-0000-0000-000000000037'), -- Norte → Andén Norte
  ('dddd0002-0000-0000-0000-000000000037', 'cccc0002-0000-0000-0000-000000000037')  -- Sur   → Andén Sur
ON CONFLICT DO NOTHING;
-- Note: cccc0003 (TestComuna Sin) is intentionally left unmapped.

-- Helper: create a minimal order for Operator A
-- Usage: call insert_test_order(<suffix>, <delivery_date>, <comuna_id>, [window_start], [window_end])

-- =============================================================================
-- TEST 1: returns_zero_when_no_orders_match_date
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  -- Insert an order for a DIFFERENT date
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0001-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-001', 'Cliente Uno', '+56900000001',
    'Calle Norte 1', 'TestComuna Norte', '2099-01-01'::date,
    '{}'::jsonb, 'MANUAL', now(),
    'cccc0001-0000-0000-0000-000000000037');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff0001-0000-0000-0000-000000000037',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0001-0000-0000-0000-000000000037',
    'PKG-T37-001', '{}'::jsonb, 'en_bodega',
    'dddd0001-0000-0000-0000-000000000037');

  -- Query for a DIFFERENT date → should return empty andenes
  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    '2099-01-02'::date
  ) INTO v_result;

  IF jsonb_array_length(v_result->'andenes') = 0
     AND (v_result->'totals'->>'order_count')::int = 0
  THEN
    RAISE NOTICE '✓ TEST 1 PASSED: returns empty result when no orders match date';
  ELSE
    RAISE EXCEPTION 'TEST 1 FAILED: expected empty result, got %', v_result;
  END IF;
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: groups_orders_by_dock_zone
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_result    jsonb;
  v_andenes   jsonb;
  v_norte_ord int;
  v_sur_ord   int;
BEGIN
  -- 2 orders in Norte commune, 1 in Sur commune
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES
    ('eeee0002-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'T37-ORD-002A', 'Cliente 2A', '+56900000002', 'Calle Norte 2', 'TestComuna Norte',
      CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037'),
    ('eeee0003-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'T37-ORD-002B', 'Cliente 2B', '+56900000003', 'Calle Norte 3', 'TestComuna Norte',
      CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037'),
    ('eeee0004-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'T37-ORD-002C', 'Cliente 2C', '+56900000004', 'Calle Sur 1', 'TestComuna Sur',
      CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0002-0000-0000-0000-000000000037');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES
    ('ffff0002-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'eeee0002-0000-0000-0000-000000000037', 'PKG-T37-002A', '{}'::jsonb, 'en_bodega',
      'dddd0001-0000-0000-0000-000000000037'),
    ('ffff0003-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'eeee0003-0000-0000-0000-000000000037', 'PKG-T37-002B', '{}'::jsonb, 'asignado',
      'dddd0001-0000-0000-0000-000000000037'),
    ('ffff0004-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'eeee0004-0000-0000-0000-000000000037', 'PKG-T37-002C', '{}'::jsonb, 'listo_para_despacho',
      'dddd0002-0000-0000-0000-000000000037');

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  v_andenes := v_result->'andenes';

  IF jsonb_array_length(v_andenes) != 2 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: expected 2 andenes, got % — result: %',
      jsonb_array_length(v_andenes), v_result;
  END IF;

  -- Find Norte and Sur andén order counts
  SELECT (elem->>'order_count')::int INTO v_norte_ord
  FROM jsonb_array_elements(v_andenes) AS elem
  WHERE elem->>'name' = 'Andén Norte';

  SELECT (elem->>'order_count')::int INTO v_sur_ord
  FROM jsonb_array_elements(v_andenes) AS elem
  WHERE elem->>'name' = 'Andén Sur';

  IF v_norte_ord = 2 AND v_sur_ord = 1
     AND (v_result->'totals'->>'order_count')::int = 3
     AND (v_result->'totals'->>'anden_count')::int = 2
  THEN
    RAISE NOTICE '✓ TEST 2 PASSED: 3 orders grouped into 2 andenes with correct counts';
  ELSE
    RAISE EXCEPTION 'TEST 2 FAILED: Norte=%s, Sur=%s, totals=%s',
      v_norte_ord, v_sur_ord, v_result->'totals';
  END IF;
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: excludes_orders_in_active_routes
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  -- Order with dispatch on draft route → excluded
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES
    ('eeee0005-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'T37-ORD-003A', 'Cliente 3A', '+56900000005', 'Calle Norte 4', 'TestComuna Norte',
      CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037'),
    -- Order with dispatch on completed route → included
    ('eeee0006-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'T37-ORD-003B', 'Cliente 3B', '+56900000006', 'Calle Norte 5', 'TestComuna Norte',
      CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES
    ('ffff0005-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'eeee0005-0000-0000-0000-000000000037', 'PKG-T37-003A', '{}'::jsonb, 'en_bodega',
      'dddd0001-0000-0000-0000-000000000037'),
    ('ffff0006-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'eeee0006-0000-0000-0000-000000000037', 'PKG-T37-003B', '{}'::jsonb, 'en_bodega',
      'dddd0001-0000-0000-0000-000000000037');

  -- Draft route
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, raw_data, status)
  VALUES ('rrrr0001-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'dispatchtrack', 'DRAFT_T37_001', CURRENT_DATE, '{}'::jsonb, 'draft');

  -- Completed route
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, raw_data, status)
  VALUES ('rrrr0002-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'dispatchtrack', 'DONE_T37_001', CURRENT_DATE, '{}'::jsonb, 'completed');

  -- Attach order 003A to the draft route
  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, raw_data, status)
  VALUES ('disp0001-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0005-0000-0000-0000-000000000037', 'rrrr0001-0000-0000-0000-000000000037',
    'dispatchtrack', '{}'::jsonb, 'pending');

  -- Attach order 003B to the completed route
  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, raw_data, status)
  VALUES ('disp0002-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0006-0000-0000-0000-000000000037', 'rrrr0002-0000-0000-0000-000000000037',
    'dispatchtrack', '{}'::jsonb, 'delivered');

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int = 1 THEN
    RAISE NOTICE '✓ TEST 3 PASSED: order on draft route excluded; order on completed route included';
  ELSE
    RAISE EXCEPTION 'TEST 3 FAILED: expected 1 order, got % — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  END IF;
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: excludes_packages_not_ready_state
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0007-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-004', 'Cliente 4', '+56900000007', 'Calle Norte 6', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  -- Only package is in 'ingresado' (not a ready status)
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff0007-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0007-0000-0000-0000-000000000037', 'PKG-T37-004', '{}'::jsonb, 'ingresado',
    'dddd0001-0000-0000-0000-000000000037');

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int = 0 THEN
    RAISE NOTICE '✓ TEST 4 PASSED: order with non-ready packages excluded';
  ELSE
    RAISE EXCEPTION 'TEST 4 FAILED: expected 0 orders, got % — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  END IF;
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: excludes_packages_without_dock_zone
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0008-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-005', 'Cliente 5', '+56900000008', 'Calle Norte 7', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  -- Package has ready status but dock_zone_id IS NULL
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status)
  VALUES ('ffff0008-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0008-0000-0000-0000-000000000037', 'PKG-T37-005', '{}'::jsonb, 'en_bodega');

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int = 0 THEN
    RAISE NOTICE '✓ TEST 5 PASSED: order with null dock_zone_id package excluded';
  ELSE
    RAISE EXCEPTION 'TEST 5 FAILED: expected 0 orders, got % — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  END IF;
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: respects_window_filter
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_manana jsonb;
  v_tarde  jsonb;
BEGIN
  -- Order with delivery window 09:00–11:00 (morning)
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id,
    delivery_window_start, delivery_window_end)
  VALUES ('eeee0009-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-006', 'Cliente 6', '+56900000009', 'Calle Norte 8', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037',
    '09:00'::time, '11:00'::time);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff0009-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0009-0000-0000-0000-000000000037', 'PKG-T37-006', '{}'::jsonb, 'en_bodega',
    'dddd0001-0000-0000-0000-000000000037');

  -- Mañana window [00:00, 12:00) → should include the order
  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE,
    '00:00'::time,
    '12:00'::time
  ) INTO v_manana;

  -- Tarde window [12:00, 17:00) → should exclude the order
  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE,
    '12:00'::time,
    '17:00'::time
  ) INTO v_tarde;

  IF (v_manana->'totals'->>'order_count')::int = 1
     AND (v_tarde->'totals'->>'order_count')::int = 0
  THEN
    RAISE NOTICE '✓ TEST 6 PASSED: window filter includes 09-11h order in mañana, excludes from tarde';
  ELSE
    RAISE EXCEPTION 'TEST 6 FAILED: mañana_count=%, tarde_count=%',
      (v_manana->'totals'->>'order_count')::int,
      (v_tarde->'totals'->>'order_count')::int;
  END IF;
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: operator_isolation
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_result_a jsonb;
  v_result_b jsonb;
BEGIN
  -- Dock zone for Operator B
  INSERT INTO public.dock_zones (id, operator_id, name, code, is_consolidation, is_active)
  VALUES ('dddd0003-0000-0000-0000-000000000037',
    'bbbbbbbb-bbbb-bbbb-bbbb-000000000037', 'Andén B', 'AB', false, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.dock_zone_comunas (dock_zone_id, comuna_id)
  VALUES ('dddd0003-0000-0000-0000-000000000037', 'cccc0001-0000-0000-0000-000000000037')
  ON CONFLICT DO NOTHING;

  -- Order for Operator A
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0010-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-007A', 'Cliente 7A', '+56900000010', 'Calle Norte 9', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  -- Order for Operator B
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0011-0000-0000-0000-000000000037', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000037',
    'T37-ORD-007B', 'Cliente 7B', '+56900000011', 'Calle Norte 10', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES
    ('ffff0010-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
      'eeee0010-0000-0000-0000-000000000037', 'PKG-T37-007A', '{}'::jsonb, 'en_bodega',
      'dddd0001-0000-0000-0000-000000000037'),
    ('ffff0011-0000-0000-0000-000000000037', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000037',
      'eeee0011-0000-0000-0000-000000000037', 'PKG-T37-007B', '{}'::jsonb, 'en_bodega',
      'dddd0003-0000-0000-0000-000000000037');

  SELECT public.get_pre_route_snapshot('aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid, CURRENT_DATE) INTO v_result_a;
  SELECT public.get_pre_route_snapshot('bbbbbbbb-bbbb-bbbb-bbbb-000000000037'::uuid, CURRENT_DATE) INTO v_result_b;

  IF (v_result_a->'totals'->>'order_count')::int = 1
     AND (v_result_b->'totals'->>'order_count')::int = 1
  THEN
    RAISE NOTICE '✓ TEST 7 PASSED: operator isolation — each operator sees only their own orders';
  ELSE
    RAISE EXCEPTION 'TEST 7 FAILED: op_a_count=%, op_b_count=%',
      (v_result_a->'totals'->>'order_count')::int,
      (v_result_b->'totals'->>'order_count')::int;
  END IF;
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: excludes_soft_deleted
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_result jsonb;
BEGIN
  -- Soft-deleted order
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id,
    deleted_at)
  VALUES ('eeee0012-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-008A', 'Cliente 8A', '+56900000012', 'Calle Norte 11', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037',
    now());

  -- Order with soft-deleted package (no other packages)
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0013-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-008B', 'Cliente 8B', '+56900000013', 'Calle Norte 12', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id, deleted_at)
  VALUES ('ffff0013-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0013-0000-0000-0000-000000000037', 'PKG-T37-008B', '{}'::jsonb, 'en_bodega',
    'dddd0001-0000-0000-0000-000000000037', now());

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int = 0 THEN
    RAISE NOTICE '✓ TEST 8 PASSED: soft-deleted orders and packages excluded';
  ELSE
    RAISE EXCEPTION 'TEST 8 FAILED: expected 0 orders, got % — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  END IF;
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: unmapped_comunas_populated
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_result       jsonb;
  v_unmapped     jsonb;
  v_unmapped_len int;
BEGIN
  -- Order in TestComuna Sin (no dock_zone_comunas entry for Op A)
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0014-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-009', 'Cliente 9', '+56900000014', 'Calle Sin 1', 'TestComuna Sin',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0003-0000-0000-0000-000000000037');

  -- Package must have dock_zone_id set (ready to dispatch) but commune is unmapped
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES ('ffff0014-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0014-0000-0000-0000-000000000037', 'PKG-T37-009', '{}'::jsonb, 'en_bodega',
    'dddd0001-0000-0000-0000-000000000037');

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  v_unmapped     := v_result->'unmapped_comunas';
  v_unmapped_len := jsonb_array_length(v_unmapped);

  IF v_unmapped_len = 1
     AND jsonb_array_length(v_result->'andenes') = 0
     AND (v_result->'totals'->>'order_count')::int = 1
  THEN
    RAISE NOTICE '✓ TEST 9 PASSED: unmapped-commune order appears in unmapped_comunas, not andenes';
  ELSE
    RAISE EXCEPTION 'TEST 9 FAILED: unmapped_count=%, andenes_count=%, order_count=% — result: %',
      v_unmapped_len,
      jsonb_array_length(v_result->'andenes'),
      (v_result->'totals'->>'order_count')::int,
      v_result;
  END IF;
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: order_with_split_dock_zones_fails_loudly
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  v_result          jsonb;
  v_andenes         jsonb;
  v_anden_ord_count int;
  v_split_flag      bool;
BEGIN
  -- Order with two packages in DIFFERENT dock zones (invariant violation)
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES ('eeee0015-0000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'T37-ORD-010', 'Cliente 10', '+56900000015', 'Calle Norte 13', 'TestComuna Norte',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000037');

  -- First package → Andén Norte (earlier created_at)
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id, created_at)
  VALUES ('ffff0015a-000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0015-0000-0000-0000-000000000037', 'PKG-T37-010A', '{}'::jsonb, 'en_bodega',
    'dddd0001-0000-0000-0000-000000000037',
    now() - interval '1 hour');

  -- Second package → Andén Sur (later created_at — invariant violation)
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id, created_at)
  VALUES ('ffff0015b-000-0000-0000-000000000037', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000037',
    'eeee0015-0000-0000-0000-000000000037', 'PKG-T37-010B', '{}'::jsonb, 'en_bodega',
    'dddd0002-0000-0000-0000-000000000037',
    now());

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000037'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  v_andenes := v_result->'andenes';

  -- Order should appear under exactly one andén (the one with the earliest package)
  SELECT SUM((elem->>'order_count')::int) INTO v_anden_ord_count
  FROM jsonb_array_elements(v_andenes) AS elem;

  -- The home andén (Norte) should have has_split_dock_zone_warnings = true
  SELECT (elem->>'has_split_dock_zone_warnings')::bool INTO v_split_flag
  FROM jsonb_array_elements(v_andenes) AS elem
  WHERE elem->>'name' = 'Andén Norte';

  IF v_anden_ord_count = 1
     AND v_split_flag IS TRUE
     AND (v_result->'totals'->>'split_dock_zone_order_count')::int = 1
  THEN
    RAISE NOTICE '✓ TEST 10 PASSED: split-zone order appears once under earliest-package andén with warning flag';
  ELSE
    RAISE EXCEPTION 'TEST 10 FAILED: total_andén_orders=%, norte_split_flag=%, split_count=% — result: %',
      v_anden_ord_count, v_split_flag,
      (v_result->'totals'->>'split_dock_zone_order_count')::int,
      v_result;
  END IF;
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- Summary
-- =============================================================================
RAISE NOTICE '========================================';
RAISE NOTICE 'All get_pre_route_snapshot tests passed!';
RAISE NOTICE '========================================';

ROLLBACK;
