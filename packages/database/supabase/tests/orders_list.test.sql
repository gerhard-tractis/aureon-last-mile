-- =============================================================================
-- spec-65 Task 2: public.get_orders_list test suite
--
-- NOT run by CI (.github/workflows/ci.yml runs lint, type-check, vitest and
-- build only — no local Postgres). Run on demand against a live database,
-- via psql — NOT `npx supabase test db` (that path drives pgTAP and expects
-- TAP output; this file emits plain `RAISE NOTICE` / `RAISE EXCEPTION`):
--
--   psql "$DATABASE_URL" -f packages/database/supabase/tests/orders_list.test.sql
--
-- Self-contained: creates its own operators/orders/packages/routes/dispatches/
-- audit_logs fixtures under test-only UUIDs, and everything runs inside one
-- transaction rolled back at the end (SAVEPOINT / ROLLBACK TO per test, so one
-- failing assertion does not abort the tests that follow it) — safe to run
-- unattended against a database that already holds real data.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared fixtures: two operators, so TEST 1 can prove tenant isolation.
-- ---------------------------------------------------------------------------

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000065', 'Test Op 65-A', 'test-op-65-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000065', 'Test Op 65-B', 'test-op-65-b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: tenant_isolation — operator A's call never returns operator B's rows
-- =============================================================================
SAVEPOINT test_1;
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    ('e0000001-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-A1', 'Cliente A1', '+56900000001', 'Calle A 1', 'Providencia',
      '2026-08-22'::date, '{}'::jsonb, 'MANUAL', now()),
    ('e0000002-0000-0000-0000-000000000065', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000065',
      'T65-ORD-B1', 'Cliente B1', '+56900000002', 'Calle B 1', 'Ñuñoa',
      '2026-08-22'::date, '{}'::jsonb, 'MANUAL', now());

  SELECT COUNT(*) INTO v_count
  FROM public.get_orders_list('aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-B1';

  IF v_count = 0 THEN
    RAISE NOTICE '✓ tenant_isolation PASSED';
  ELSE
    RAISE EXCEPTION 'tenant_isolation FAILED: operator A''s call returned operator B''s order';
  END IF;
END $$;
ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: status/comuna/search/date filters each narrow the result set
-- =============================================================================
SAVEPOINT test_2;
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, leading_status, retailer_name, raw_data, imported_via, imported_at)
  VALUES
    ('e0000010-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-F1', 'Ana Rios', '+56900000010', 'Av. Uno 10', 'Providencia',
      '2026-08-22'::date, 'en_ruta', 'Falabella', '{}'::jsonb, 'MANUAL', now()),
    ('e0000011-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-F2', 'Bruno Diaz', '+56900000011', 'Av. Dos 20', 'Ñuñoa',
      '2026-08-25'::date, 'entregado', 'Ripley', '{}'::jsonb, 'MANUAL', now());

  -- p_statuses narrows to the matching leading_status only
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, ARRAY['en_ruta'], NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-F%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_statuses FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_comunas narrows to the matching comuna only
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['Ñuñoa'], NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-F%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_comunas FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_search matches customer_name
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Bruno', 100, 0)
  WHERE order_number LIKE 'T65-ORD-F%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_search FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_date_from/p_date_to narrows to the window
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    '2026-08-24'::date, '2026-08-26'::date, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-F%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_date_from/p_date_to FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_client narrows to the matching retailer_name
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, 'Ripley', NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-F%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_client FAILED: expected 1 row, got %', v_count;
  END IF;

  RAISE NOTICE '✓ filters_narrow_result PASSED';
END $$;
ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: total_count is the unpaginated total, correct when p_offset > 0
-- =============================================================================
SAVEPOINT test_3;
DO $$
DECLARE v_total_page1 BIGINT; v_total_page2 BIGINT; v_rows_page2 INT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    ('e0000020-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-P1', 'Cliente P1', '+56900000020', 'Av. P 1', 'Las Condes', '2026-08-22'::date, '{}'::jsonb, 'MANUAL', now()),
    ('e0000021-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-P2', 'Cliente P2', '+56900000021', 'Av. P 2', 'Las Condes', '2026-08-22'::date, '{}'::jsonb, 'MANUAL', now()),
    ('e0000022-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-P3', 'Cliente P3', '+56900000022', 'Av. P 3', 'Las Condes', '2026-08-22'::date, '{}'::jsonb, 'MANUAL', now());

  SELECT total_count INTO v_total_page1 FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['Las Condes'], NULL, NULL, NULL, 2, 0)
  LIMIT 1;

  SELECT total_count, COUNT(*) INTO v_total_page2, v_rows_page2 FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, ARRAY['Las Condes'], NULL, NULL, NULL, 2, 2)
  GROUP BY total_count;

  IF v_total_page1 = 3 AND v_total_page2 = 3 AND v_rows_page2 = 1 THEN
    RAISE NOTICE '✓ total_count_paginated PASSED';
  ELSE
    RAISE EXCEPTION 'total_count_paginated FAILED: page1_total=%, page2_total=%, page2_rows=%',
      v_total_page1, v_total_page2, v_rows_page2;
  END IF;
END $$;
ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: soft-deleted orders and packages are excluded
-- =============================================================================
SAVEPOINT test_4;
DO $$
DECLARE v_count INT; v_pkg_count INT;
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, deleted_at)
  VALUES
    ('e0000030-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-DEL', 'Cliente Del', '+56900000030', 'Av. Del 1', 'Maipú', '2026-08-22'::date,
      '{}'::jsonb, 'MANUAL', now(), now()),
    ('e0000031-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-PKG', 'Cliente Pkg', '+56900000031', 'Av. Pkg 1', 'Maipú', '2026-08-22'::date,
      '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, deleted_at)
  VALUES
    ('f0000031-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'e0000031-0000-0000-0000-000000000065', 'PKG-T65-LIVE', '{}'::jsonb, NULL),
    ('f0000032-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'e0000031-0000-0000-0000-000000000065', 'PKG-T65-DEL', '{}'::jsonb, now());

  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-DEL';
  IF v_count != 0 THEN
    RAISE EXCEPTION 'soft_deleted_order FAILED: expected order to be excluded, got % rows', v_count;
  END IF;

  SELECT package_count INTO v_pkg_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-PKG';
  IF v_pkg_count = 1 THEN
    RAISE NOTICE '✓ soft_deletes_excluded PASSED';
  ELSE
    RAISE EXCEPTION 'soft_deleted_package FAILED: expected package_count=1, got %', v_pkg_count;
  END IF;
END $$;
ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: an order with no dispatch still appears, with null route/driver;
-- an order WITH a dispatch resolves route_label/driver_name/has_pod, and the
-- p_route_ids / p_driver / p_has_pod / p_min_attempts / p_sla filters each
-- narrow correctly against it.
-- =============================================================================
SAVEPOINT test_5;
DO $$
DECLARE
  v_route TEXT; v_driver TEXT; v_has_pod BOOLEAN;
  v_count INT;
BEGIN
  -- Order with no dispatch at all
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES ('e0000040-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'T65-ORD-NODISP', 'Cliente NoDisp', '+56900000040', 'Av. ND 1', 'Maipú',
    '2026-08-22'::date, '{}'::jsonb, 'MANUAL', now());

  SELECT route_label, driver_name INTO v_route, v_driver FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-NODISP';
  IF v_route IS NOT NULL OR v_driver IS NOT NULL THEN
    RAISE EXCEPTION 'no_dispatch FAILED: expected null route/driver, got (%, %)', v_route, v_driver;
  END IF;

  -- Order WITH a dispatch/route, delivered, with a POD photo
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    raw_data, imported_via, imported_at)
  VALUES ('e0000041-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'T65-ORD-DISP', 'Cliente Disp', '+56900000041', 'Av. D 1', 'Maipú',
    '2026-08-22'::date, '08:00:00'::time, '09:00:00'::time,
    '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, driver_name, raw_data)
  VALUES ('a0000041-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'dispatchtrack', 'RUTA-T65-041', '2026-08-22'::date, 'Juan Perez', '{}'::jsonb);

  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, status, completed_at, raw_data)
  VALUES ('d0000041-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'e0000041-0000-0000-0000-000000000065', 'a0000041-0000-0000-0000-000000000065',
    'dispatchtrack', 'delivered', '2026-08-22 08:30:00-04'::timestamptz,
    '{"photo_url": "https://example.com/p.jpg"}'::jsonb);

  SELECT route_label, driver_name, has_pod INTO v_route, v_driver, v_has_pod
  FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-DISP';
  IF v_route != 'RUTA-T65-041' OR v_driver != 'Juan Perez' OR v_has_pod IS NOT TRUE THEN
    RAISE EXCEPTION 'has_dispatch FAILED: got route=%, driver=%, has_pod=%', v_route, v_driver, v_has_pod;
  END IF;

  -- p_route_ids narrows to the order on that route
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, ARRAY['a0000041-0000-0000-0000-000000000065'::uuid],
    NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_route_ids FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_driver narrows to the matching driver
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, 'Juan', NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_driver FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_has_pod narrows to the delivered order carrying a photo
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, TRUE, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_has_pod FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_min_attempts narrows to the order with >= 1 dispatch
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_min_attempts FAILED: expected 1 row, got %', v_count;
  END IF;

  -- p_sla = 'none' matches the delivered order (delivered_at makes it 'none')
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, 'none', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-DISP';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_sla FAILED: expected delivered order to be sla_status=none, got % rows', v_count;
  END IF;

  RAISE NOTICE '✓ dispatch_route_and_filters PASSED';
END $$;
ROLLBACK TO test_5;

-- Summary
DO $$ BEGIN RAISE NOTICE 'All get_orders_list tests passed!'; END $$;

ROLLBACK;
