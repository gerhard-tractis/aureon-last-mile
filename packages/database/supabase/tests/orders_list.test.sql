-- =============================================================================
-- spec-65 Task 2: public.get_orders_list and public.get_nav_counts.orders
-- test suite
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
-- Shared fixtures: two operators, so TEST 1 and TEST 6 can prove tenant
-- isolation.
-- ---------------------------------------------------------------------------

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000065', 'Test Op 65-A', 'test-op-65-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000065', 'Test Op 65-B', 'test-op-65-b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: tenant_isolation — operator A's call never returns operator B's
-- orders, AND operator B's child rows (packages/dispatches/routes) attached
-- to operator A's OWN order never leak into that order's aggregated columns.
-- The second half is the case an operator_id-on-orders-only implementation
-- would still pass.
-- =============================================================================
SAVEPOINT test_1;
DO $$
DECLARE
  v_b_count INT;
  v_own_count INT; v_own_packages INT; v_own_route TEXT; v_own_driver TEXT;
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

  -- Child rows owned by operator B, attached to operator A's OWN order
  -- (e0000001). No FK ties a package's/dispatch's operator_id to the order
  -- it points at, so this is a real shape the RPC must defend against, not
  -- a hypothetical.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data)
  VALUES ('f0000001-0000-0000-0000-000000000065', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000065',
    'e0000001-0000-0000-0000-000000000065', 'PKG-LEAK-B', '{}'::jsonb);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, driver_name, raw_data)
  VALUES ('a0000001-0000-0000-0000-000000000065', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000065',
    'dispatchtrack', 'RUTA-LEAK-B', '2026-08-22'::date, 'Leaked Driver', '{}'::jsonb);

  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, status, raw_data)
  VALUES ('d0000001-0000-0000-0000-000000000065', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000065',
    'e0000001-0000-0000-0000-000000000065', 'a0000001-0000-0000-0000-000000000065',
    'dispatchtrack', 'pending', '{}'::jsonb);

  -- Operator B's own order must not appear at all in A's call.
  SELECT COUNT(*) INTO v_b_count
  FROM public.get_orders_list('aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-B1';
  IF v_b_count != 0 THEN
    RAISE EXCEPTION 'tenant_isolation FAILED: operator A''s call returned operator B''s order';
  END IF;

  -- Operator A's own order must appear (positive assertion — an empty result
  -- set would otherwise satisfy every check below vacuously), and its
  -- package_count/route_label/driver_name must reflect NONE of operator B's
  -- child rows attached to it.
  SELECT COUNT(*), MAX(package_count), MAX(route_label), MAX(driver_name)
    INTO v_own_count, v_own_packages, v_own_route, v_own_driver
  FROM public.get_orders_list('aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-A1';

  IF v_own_count = 1 AND v_own_packages = 0 AND v_own_route IS NULL AND v_own_driver IS NULL THEN
    RAISE NOTICE '✓ tenant_isolation PASSED';
  ELSE
    RAISE EXCEPTION 'tenant_isolation FAILED: operator A''s own order returned count=%, package_count=%, route_label=%, driver_name=% (expected 1, 0, NULL, NULL — operator B''s child rows must not leak in)',
      v_own_count, v_own_packages, v_own_route, v_own_driver;
  END IF;
END $$;
ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: status/comuna/search/date/client filters each narrow the result
-- set, and the date filter follows the SAME effective date order_sla_status
-- uses (rescheduled date only when all three reschedule columns are set).
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

  -- Reschedule-aware date filter: a complete reschedule (all three columns
  -- set) moves which date the filter matches on; a PARTIAL reschedule (one
  -- column only) must be ignored, same rule as order_sla_status.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, rescheduled_delivery_date,
    rescheduled_window_start, rescheduled_window_end, raw_data, imported_via, imported_at)
  VALUES
    -- Original date is outside the filter window; complete reschedule moves
    -- it inside — must be INCLUDED.
    ('e0000012-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-F3-RESCHED', 'Carla Soto', '+56900000012', 'Av. Tres 30', 'Providencia',
      '2026-01-01'::date, '2026-08-25'::date, '10:00:00'::time, '11:00:00'::time,
      '{}'::jsonb, 'MANUAL', now()),
    -- Original date is outside the filter window; PARTIAL reschedule (date
    -- only, no window) must be ignored — stays OUTSIDE, must be EXCLUDED.
    ('e0000013-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
      'T65-ORD-F4-PARTIAL', 'Diego Vera', '+56900000013', 'Av. Cuatro 40', 'Providencia',
      '2026-01-01'::date, '2026-08-25'::date, NULL, NULL,
      '{}'::jsonb, 'MANUAL', now());

  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    '2026-08-24'::date, '2026-08-26'::date, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number IN ('T65-ORD-F3-RESCHED', 'T65-ORD-F4-PARTIAL');
  IF v_count != 1 THEN
    RAISE EXCEPTION 'reschedule_aware_date_filter FAILED: expected only the complete reschedule to match, got % rows', v_count;
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
      '{}'::jsonb, 'MANUAL', now(), NULL);

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
-- narrow correctly against it. T65-ORD-NODISP is given a delivery window in
-- the past so it is genuinely 'late' — without this, both fixtures resolve
-- to sla_status = 'none' and the p_sla assertion would pass even if p_sla
-- were ignored entirely (or if the six order_sla_status window arguments
-- were transposed), because it never narrows anything.
-- =============================================================================
SAVEPOINT test_5;
DO $$
DECLARE
  v_route TEXT; v_driver TEXT; v_has_pod BOOLEAN;
  v_count INT;
BEGIN
  -- Order with no dispatch at all, and a delivery window well in the past —
  -- genuinely 'late'.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    raw_data, imported_via, imported_at)
  VALUES ('e0000040-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'T65-ORD-NODISP', 'Cliente NoDisp', '+56900000040', 'Av. ND 1', 'Maipú',
    '2020-01-01'::date, '08:00:00'::time, '09:00:00'::time,
    '{}'::jsonb, 'MANUAL', now());

  SELECT route_label, driver_name INTO v_route, v_driver FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number = 'T65-ORD-NODISP';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_dispatch FAILED: get_orders_list returned no row for T65-ORD-NODISP';
  END IF;
  IF v_route IS NOT NULL OR v_driver IS NOT NULL THEN
    RAISE EXCEPTION 'no_dispatch FAILED: expected null route/driver, got (%, %)', v_route, v_driver;
  END IF;

  -- Order WITH a dispatch/route, delivered, with a POD photo — sla_status
  -- resolves to 'none' regardless of its (also past) window, because it has
  -- a delivered_at.
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'has_dispatch FAILED: get_orders_list returned no row for T65-ORD-DISP';
  END IF;
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

  -- p_sla = ARRAY['late'] matches only the never-dispatched, past-window
  -- order; the delivered order (sla_status = 'none') must be excluded.
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, ARRAY['late'], NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_sla=late FAILED: expected 1 row (T65-ORD-NODISP only), got %', v_count;
  END IF;

  -- p_sla = ARRAY['none'] is the reverse: only the delivered order.
  SELECT COUNT(*) INTO v_count FROM public.get_orders_list(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid,
    NULL, NULL, NULL, ARRAY['none'], NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, 0)
  WHERE order_number LIKE 'T65-ORD-%';
  IF v_count != 1 THEN
    RAISE EXCEPTION 'p_sla=none FAILED: expected 1 row (T65-ORD-DISP only), got %', v_count;
  END IF;

  RAISE NOTICE '✓ dispatch_route_and_filters PASSED';
END $$;
ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: get_nav_counts.orders — parity with get_orders_list's default "SLA
-- en riesgo" view, and specifically a regression test for a completed PICKUP
-- dispatch (status = 'delivered', is_pickup = TRUE) NOT being mistaken for an
-- actual delivery. Also checked for tenant isolation on the counter itself.
-- =============================================================================
SAVEPOINT test_6;
DO $$
DECLARE v_orders_a BIGINT; v_orders_b BIGINT;
BEGIN
  -- O1 (operator A): late, no dispatch at all — must count.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    raw_data, imported_via, imported_at)
  VALUES ('e0000060-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'T65-ORD-NAV-LATE', 'Cliente NavLate', '+56900000060', 'Av. NL 1', 'Maipú',
    '2020-01-01'::date, '08:00:00'::time, '09:00:00'::time,
    '{}'::jsonb, 'MANUAL', now());

  -- O2 (operator A): late window, but its only dispatch is a completed
  -- PICKUP movement — must still count. This is the exact bug the review
  -- caught: status = 'delivered' on a pickup must not read as "delivered".
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    raw_data, imported_via, imported_at)
  VALUES ('e0000061-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'T65-ORD-NAV-PICKUP', 'Cliente NavPickup', '+56900000061', 'Av. NP 1', 'Maipú',
    '2020-01-01'::date, '08:00:00'::time, '09:00:00'::time,
    '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, order_id, provider, status, is_pickup, completed_at, raw_data)
  VALUES ('d0000061-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'e0000061-0000-0000-0000-000000000065', 'dispatchtrack', 'delivered', TRUE,
    '2020-01-01 08:30:00-04'::timestamptz, '{}'::jsonb);

  -- O3 (operator A): genuinely delivered via a non-pickup dispatch — must
  -- NOT count.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    raw_data, imported_via, imported_at)
  VALUES ('e0000062-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'T65-ORD-NAV-DELIVERED', 'Cliente NavDelivered', '+56900000062', 'Av. NDv 1', 'Maipú',
    '2020-01-01'::date, '08:00:00'::time, '09:00:00'::time,
    '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, order_id, provider, status, is_pickup, completed_at, raw_data)
  VALUES ('d0000062-0000-0000-0000-000000000065', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000065',
    'e0000062-0000-0000-0000-000000000065', 'dispatchtrack', 'delivered', FALSE,
    '2020-01-01 08:30:00-04'::timestamptz, '{}'::jsonb);

  -- Operator B: one late order of its own, to prove the counter is
  -- tenant-scoped (not just summed globally).
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end,
    raw_data, imported_via, imported_at)
  VALUES ('e0000063-0000-0000-0000-000000000065', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000065',
    'T65-ORD-NAV-B-LATE', 'Cliente NavB', '+56900000063', 'Av. NB 1', 'Maipú',
    '2020-01-01'::date, '08:00:00'::time, '09:00:00'::time,
    '{}'::jsonb, 'MANUAL', now());

  SELECT orders INTO v_orders_a FROM public.get_nav_counts('aaaaaaaa-aaaa-aaaa-aaaa-000000000065'::uuid);
  SELECT orders INTO v_orders_b FROM public.get_nav_counts('bbbbbbbb-bbbb-bbbb-bbbb-000000000065'::uuid);

  IF v_orders_a = 2 AND v_orders_b = 1 THEN
    RAISE NOTICE '✓ nav_counts_orders PASSED';
  ELSE
    RAISE EXCEPTION 'nav_counts_orders FAILED: expected operator A orders=2 (late + pickup-delivered-but-not-really) and operator B orders=1, got A=%, B=%',
      v_orders_a, v_orders_b;
  END IF;
END $$;
ROLLBACK TO test_6;

-- Summary
DO $$ BEGIN RAISE NOTICE 'All get_orders_list / get_nav_counts.orders tests passed!'; END $$;

ROLLBACK;
