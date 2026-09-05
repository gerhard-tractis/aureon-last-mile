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

-- =============================================================================
-- TEST 4: load_inferred = true (spec-74's own optimistic backfill, no genuine
-- scan evidence) is never backfilled, even for an otherwise-unambiguous order.
-- Fase 1g M-1: mutant "remove AND p.load_inferred = false" survived without
-- this fixture.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_op      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a uuid := '11110005-0000-0000-0000-000000000079';
  v_order   uuid := '22220004-0000-0000-0000-000000000079';
  v_pkg     uuid := '33330004-0000-0000-0000-000000000079';
  v_got     uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-D', CURRENT_DATE, 'loaded');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-4', 'Cliente 79-4', '+56900000004',
    'Calle 79 #4', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d7900005-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-4', '{}'::jsonb, 'listo_para_despacho', NOW(), NULL, true);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'expected load_inferred=true package to stay NULL, got %', v_got;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: load_inferred = true is never backfilled';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: loaded_at IS NULL (never scanned) is never backfilled.
-- Fase 1g M-1: mutant "remove AND p.loaded_at IS NOT NULL" survived without
-- this fixture.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_op      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a uuid := '11110006-0000-0000-0000-000000000079';
  v_order   uuid := '22220005-0000-0000-0000-000000000079';
  v_pkg     uuid := '33330005-0000-0000-0000-000000000079';
  v_got     uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-E', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-5', 'Cliente 79-5', '+56900000005',
    'Calle 79 #5', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d7900006-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'planned', NULL);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-5', '{}'::jsonb, 'sectorizado', NULL, NULL, false);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'expected never-scanned package to stay NULL, got %', v_got;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: loaded_at IS NULL is never backfilled';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: idempotency — a package that already has loaded_route_id set is
-- never overwritten, even when the unambiguous route disagrees.
-- Fase 1g M-1: mutant "remove AND p.loaded_route_id IS NULL" survived without
-- this fixture.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_op        uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a   uuid := '11110007-0000-0000-0000-000000000079';
  v_route_prev uuid := '11110008-0000-0000-0000-000000000079';
  v_order     uuid := '22220006-0000-0000-0000-000000000079';
  v_pkg       uuid := '33330006-0000-0000-0000-000000000079';
  v_got       uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-F', CURRENT_DATE, 'loaded'),
         (v_route_prev, v_op, 'dispatchtrack', 'T79-ROUTE-F-PREV', CURRENT_DATE, 'completed');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-6', 'Cliente 79-6', '+56900000006',
    'Calle 79 #6', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d7900007-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  -- Already backfilled (or re-scanned) onto v_route_prev, a route that no
  -- longer exists in the active set. The function must leave this alone.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred, loaded_route_id)
  VALUES (v_pkg, v_op, v_order, 'CTN-6', '{}'::jsonb, 'en_ruta', NOW(), NULL, false, v_route_prev);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_prev THEN
    RAISE EXCEPTION 'expected loaded_route_id to stay % (already set), got %', v_route_prev, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: an already-set loaded_route_id is never overwritten';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: a live dispatch on the unambiguous route plus a SOFT-DELETED
-- dispatch on a different route for the same order still backfills — the
-- soft-deleted row must not count toward ambiguity.
-- Fase 1g M-1: mutant "remove WHERE deleted_at IS NULL on dispatches"
-- survived without this fixture.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_op        uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a   uuid := '11110009-0000-0000-0000-000000000079';
  v_route_old uuid := '1111000a-0000-0000-0000-000000000079';
  v_order     uuid := '22220007-0000-0000-0000-000000000079';
  v_pkg       uuid := '33330007-0000-0000-0000-000000000079';
  v_got       uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-G', CURRENT_DATE, 'loaded'),
         (v_route_old, v_op, 'dispatchtrack', 'T79-ROUTE-G-OLD', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-7', 'Cliente 79-7', '+56900000007',
    'Calle 79 #7', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at, deleted_at)
  VALUES
    ('d7900008-0000-0000-0000-000000000079', v_op, v_route_a,   v_order, 'dispatchtrack', 'staged', NOW(), NULL),
    ('d7900009-0000-0000-0000-000000000079', v_op, v_route_old, v_order, 'dispatchtrack', 'staged', NOW(), NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-7', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_a THEN
    RAISE EXCEPTION 'expected loaded_route_id % (soft-deleted dispatch on another route ignored), got %', v_route_a, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: a soft-deleted dispatch on another route is not ambiguity';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (H-2 defect 1): two LIVE dispatch rows for the same order on the
-- SAME route are unambiguous (COUNT(*) = 2, COUNT(DISTINCT route_id) = 1) and
-- must still backfill. Fase 1g M-1: mutant "COUNT(*) instead of
-- COUNT(DISTINCT route_id)" survived without this fixture.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_op      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_a uuid := '1111000b-0000-0000-0000-000000000079';
  v_order   uuid := '22220008-0000-0000-0000-000000000079';
  v_pkg     uuid := '33330008-0000-0000-0000-000000000079';
  v_got     uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T79-ROUTE-H', CURRENT_DATE, 'loaded');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-8', 'Cliente 79-8', '+56900000008',
    'Calle 79 #8', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  -- Two live dispatch rows, same order, same route — explicitly permitted
  -- (20260901000001:181-183), the same shape loadedPackageIds' dedupe exists
  -- for.
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES
    ('d790000a-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW()),
    ('d790000b-0000-0000-0000-000000000079', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-8', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_a THEN
    RAISE EXCEPTION 'expected loaded_route_id % (two live rows, same route = unambiguous), got %', v_route_a, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 8 PASSED: two live dispatch rows on the same route still backfills';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 (H-2 defect 2): a dispatch on a route COMPLETED weeks ago plus the
-- current dispatch on an active route must backfill against the active
-- route — the completed route's dispatch must not count as a live competing
-- claim. Fixes the missing route-status filter.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_op           uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000079';
  v_route_active uuid := '1111000c-0000-0000-0000-000000000079';
  v_route_done   uuid := '1111000d-0000-0000-0000-000000000079';
  v_order        uuid := '22220009-0000-0000-0000-000000000079';
  v_pkg          uuid := '33330009-0000-0000-0000-000000000079';
  v_got          uuid;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_active, v_op, 'dispatchtrack', 'T79-ROUTE-I',      CURRENT_DATE,     'loaded'),
         (v_route_done,   v_op, 'dispatchtrack', 'T79-ROUTE-I-DONE', CURRENT_DATE - 21, 'completed');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T79-ORD-9', 'Cliente 79-9', '+56900000009',
    'Calle 79 #9', 'TestComuna 79', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  -- Both dispatches are non-deleted (routes/dispatches are never hard-
  -- deleted); the old one just points at a route that finished weeks ago.
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES
    ('d790000c-0000-0000-0000-000000000079', v_op, v_route_done,   v_order, 'dispatchtrack', 'adopted', NOW() - INTERVAL '21 days'),
    ('d790000d-0000-0000-0000-000000000079', v_op, v_route_active, v_order, 'dispatchtrack', 'staged',  NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-9', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  PERFORM public.spec79_backfill_loaded_route_id();

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_active THEN
    RAISE EXCEPTION 'expected loaded_route_id % (completed route does not compete), got %', v_route_active, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: a dispatch on a completed route is not a live competing claim';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: column, FK, and index existence — the schema-level guarantees
-- Fase 1f claimed but never actually asserted.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE
  v_col_exists   boolean;
  v_fk_exists    boolean;
  v_index_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'loaded_route_id'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'expected public.packages.loaded_route_id to exist';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name   = 'packages'
      AND kcu.column_name = 'loaded_route_id'
      AND ccu.table_name  = 'routes'
  ) INTO v_fk_exists;
  IF NOT v_fk_exists THEN
    RAISE EXCEPTION 'expected packages.loaded_route_id to be a FK to routes(id)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'packages' AND indexname = 'idx_packages_loaded_route_id'
  ) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'expected idx_packages_loaded_route_id to exist';
  END IF;

  RAISE NOTICE '✓ TEST 10 PASSED: column/FK/index for loaded_route_id exist';
END $$;

ROLLBACK TO test_10;

ROLLBACK;
