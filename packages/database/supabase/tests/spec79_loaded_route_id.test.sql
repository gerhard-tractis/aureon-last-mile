-- =============================================================================
-- spec-79 BLOCKER — packages.loaded_route_id and its backfill.
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
-- or ./scripts/pgtap-local.sh (Docker; not run in CI — see script header).
--
-- House style, matching spec77_force_split.test.sql: fixtures inside one
-- transaction, each test a DO block that RAISEs on failure, SAVEPOINT/
-- ROLLBACK TO around each so one failure does not abort the rest.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000079', 'Test Op 79', 'test-op-79', 'CL')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: an unambiguous order (exactly one live dispatch) backfills its
-- genuinely-loaded package's loaded_route_id to that dispatch's route.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_op        uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a   uuid := '11110001-0000-0000-0000-000000000079';
  v_order     uuid := '22220001-0000-0000-0000-000000000079';
  v_pkg       uuid := '33330001-0000-0000-0000-000000000079';
  v_got       uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-A', CURRENT_DATE, 'loaded');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-1', 'Cliente 79-1', '+56900000001',
    'Calle 79 #1', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d7900001-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-1', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_a THEN
    RAISE EXCEPTION 'expected loaded_route_id % got %', v_route_a, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: unambiguous order backfills loaded_route_id';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: an ambiguous order (two live dispatches — the force-split shape)
-- is left NULL by the backfill, never guessed.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_op        uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a   uuid := '11110002-0000-0000-0000-000000000079';
  v_route_b   uuid := '11110003-0000-0000-0000-000000000079';
  v_order     uuid := '22220002-0000-0000-0000-000000000079';
  v_pkg       uuid := '33330002-0000-0000-0000-000000000079';
  v_got       uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-B1', CURRENT_DATE, 'loaded'),
         (v_route_b, v_op, 'dispatchtrack', 'T79-ROUTE-B2', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-2', 'Cliente 79-2', '+56900000002',
    'Calle 79 #2', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES
    ('d7900002-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'force_split', NOW()),
    ('d7900003-0000-0000-0000-000000000079', v_op, v_route_b, v_order, 'dispatchtrack', 'planned', NULL);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-2', '{}'::jsonb, 'listo_para_despacho', NOW(), NULL, false);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'expected loaded_route_id to stay NULL for an ambiguous order, got %', v_got;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: ambiguous order is left NULL, never guessed';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: a package deleted (deleted_at set) after loading is not backfilled.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_op      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a uuid := '11110004-0000-0000-0000-000000000079';
  v_order   uuid := '22220003-0000-0000-0000-000000000079';
  v_pkg     uuid := '33330003-0000-0000-0000-000000000079';
  v_got     uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-C', CURRENT_DATE, 'loaded');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-3', 'Cliente 79-3', '+56900000003',
    'Calle 79 #3', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d7900004-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred, deleted_at)
  VALUES (v_pkg, v_op, v_order, 'CTN-3', '{}'::jsonb, 'en_carga', NOW(), NULL, false, NOW());

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'expected a soft-deleted package to stay NULL, got %', v_got;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: soft-deleted package is not backfilled';
END $$;

ROLLBACK TO test_3;

ROLLBACK;
