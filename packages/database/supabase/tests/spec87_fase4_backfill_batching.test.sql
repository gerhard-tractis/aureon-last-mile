-- =============================================================================
-- spec-87 fase 4 — batched, resumable driver around
-- spec79_backfill_loaded_route_id() (20260909000001, fixed by 20260910000001).
--
-- That function is a single-pass UPDATE over the FULL dispatches table
-- (~112k rows documented in production) with no LIMIT/OFFSET and no way to
-- resume a partial run: the exact shape spec-87 fase 3/4 flags as the one
-- that has already caused two statement_timeout incidents at production
-- scale in this series. This suite covers the two new objects that split the
-- expensive aggregate (paid once) from the repeatable write (paid per batch):
--
--   spec79_loaded_route_backfill_candidates            -- staging table
--   spec79_populate_loaded_route_backfill_candidates() -- one-time INSERT
--   spec79_backfill_loaded_route_id_batch(p_batch_size) -- repeatable UPDATE
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply
--   ./scripts/pgtap-local.sh run spec87_fase4_backfill_batching
--
-- House style, matching spec79_loaded_route_id.test.sql: fixtures inside one
-- transaction, each test a DO block that RAISEs on failure, SAVEPOINT/
-- ROLLBACK TO around each so one failure does not abort the rest.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000087', 'Test Op 87', 'test-op-87', 'CL')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: populate finds the same unambiguous order the original function
-- would, and the batch function then writes loaded_route_id and drains the
-- candidate.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_op      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000087';
  v_route_a uuid := '11117001-0000-0000-0000-000000000087';
  v_order   uuid := '22227001-0000-0000-0000-000000000087';
  v_pkg     uuid := '33337001-0000-0000-0000-000000000087';
  v_got     uuid;
  v_populated bigint;
  v_updated   bigint;
  v_remaining bigint;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T87-ROUTE-A', CURRENT_DATE, 'loaded');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T87-ORD-1', 'Cliente 87-1', '+56900000001',
    'Calle 87 #1', 'TestComuna 87', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d8707001-0000-0000-0000-000000000087', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-1', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  SELECT public.spec79_populate_loaded_route_backfill_candidates() INTO v_populated;
  IF v_populated < 1 THEN
    RAISE EXCEPTION 'expected at least 1 candidate populated, got %', v_populated;
  END IF;

  SELECT * INTO v_updated, v_remaining FROM public.spec79_backfill_loaded_route_id_batch(2000);
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'expected 1 package updated, got %', v_updated;
  END IF;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'expected 0 candidates remaining, got %', v_remaining;
  END IF;

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_a THEN
    RAISE EXCEPTION 'expected loaded_route_id % got %', v_route_a, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: populate + batch backfills an unambiguous order and drains candidates';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: an ambiguous order (two live dispatches on different active
-- routes) is never inserted into the candidates table — same exclusion as
-- the original function, verified at the populate step this time.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_op        uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000087';
  v_route_a   uuid := '11117002-0000-0000-0000-000000000087';
  v_route_b   uuid := '11117003-0000-0000-0000-000000000087';
  v_order     uuid := '22227002-0000-0000-0000-000000000087';
  v_pkg       uuid := '33337002-0000-0000-0000-000000000087';
  v_got       uuid;
  v_candidate_count bigint;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T87-ROUTE-B1', CURRENT_DATE, 'loaded'),
         (v_route_b, v_op, 'dispatchtrack', 'T87-ROUTE-B2', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T87-ORD-2', 'Cliente 87-2', '+56900000002',
    'Calle 87 #2', 'TestComuna 87', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES
    ('d8707002-0000-0000-0000-000000000087', v_op, v_route_a, v_order, 'dispatchtrack', 'force_split', NOW()),
    ('d8707003-0000-0000-0000-000000000087', v_op, v_route_b, v_order, 'dispatchtrack', 'planned', NULL);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-2', '{}'::jsonb, 'listo_para_despacho', NOW(), NULL, false);

  PERFORM public.spec79_populate_loaded_route_backfill_candidates();

  SELECT COUNT(*) INTO v_candidate_count
    FROM public.spec79_loaded_route_backfill_candidates
   WHERE order_id = v_order;
  IF v_candidate_count <> 0 THEN
    RAISE EXCEPTION 'expected ambiguous order to never be a candidate, got % rows', v_candidate_count;
  END IF;

  PERFORM public.spec79_backfill_loaded_route_id_batch(2000);

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS NOT NULL THEN
    RAISE EXCEPTION 'expected loaded_route_id to stay NULL for an ambiguous order, got %', v_got;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: ambiguous order never becomes a candidate';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: p_batch_size actually limits how many order_ids are drained per
-- call — three eligible orders, batch size 1, requires three calls, each
-- one draining exactly one candidate.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_op uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000087';
  i    int;
  v_route  uuid;
  v_order  uuid;
  v_pkg    uuid;
  v_updated   bigint;
  v_remaining bigint;
  v_total_updated bigint := 0;
  v_calls int := 0;
BEGIN
  FOR i IN 1..3 LOOP
    v_route := ('11117004-0000-0000-0000-00000000008' || i)::uuid;
    v_order := ('22227004-0000-0000-0000-00000000008' || i)::uuid;
    v_pkg   := ('33337004-0000-0000-0000-00000000008' || i)::uuid;

    INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
    VALUES (v_route, v_op, 'dispatchtrack', 'T87-ROUTE-C' || i, CURRENT_DATE, 'loaded');

    INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
      delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
    VALUES (v_order, v_op, 'T87-ORD-3-' || i, 'Cliente 87-3-' || i, '+5690000000' || i,
      'Calle 87 #3-' || i, 'TestComuna 87', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

    INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
    VALUES (('d8707004-0000-0000-0000-00000000008' || i)::uuid, v_op, v_route, v_order, 'dispatchtrack', 'staged', NOW());

    INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
    VALUES (v_pkg, v_op, v_order, 'CTN-3-' || i, '{}'::jsonb, 'en_carga', NOW(), NULL, false);
  END LOOP;

  PERFORM public.spec79_populate_loaded_route_backfill_candidates();

  LOOP
    v_calls := v_calls + 1;
    IF v_calls > 10 THEN
      RAISE EXCEPTION 'batch loop did not converge — candidates never drained';
    END IF;

    SELECT * INTO v_updated, v_remaining FROM public.spec79_backfill_loaded_route_id_batch(1);
    v_total_updated := v_total_updated + v_updated;

    IF v_calls <= 3 AND v_updated <> 1 THEN
      RAISE EXCEPTION 'expected each of the first 3 calls to update exactly 1 row, call % updated %', v_calls, v_updated;
    END IF;

    EXIT WHEN v_remaining = 0;
  END LOOP;

  IF v_calls <> 3 THEN
    RAISE EXCEPTION 'expected exactly 3 calls to drain 3 candidates at batch size 1, took %', v_calls;
  END IF;
  IF v_total_updated <> 3 THEN
    RAISE EXCEPTION 'expected 3 total packages updated across all batches, got %', v_total_updated;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: p_batch_size=1 drains 3 candidates in exactly 3 calls';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: resumability — calling populate again after some batches have
-- already run does not duplicate work (ON CONFLICT DO NOTHING) and does not
-- resurrect an already-drained candidate whose package was already updated.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_op      uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000087';
  v_route_a uuid := '11117005-0000-0000-0000-000000000087';
  v_order   uuid := '22227005-0000-0000-0000-000000000087';
  v_pkg     uuid := '33337005-0000-0000-0000-000000000087';
  v_got     uuid;
  v_updated   bigint;
  v_remaining bigint;
  v_second_populated bigint;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T87-ROUTE-D', CURRENT_DATE, 'loaded');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T87-ORD-4', 'Cliente 87-4', '+56900000004',
    'Calle 87 #4', 'TestComuna 87', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES ('d8707005-0000-0000-0000-000000000087', v_op, v_route_a, v_order, 'dispatchtrack', 'staged', NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, v_op, v_order, 'CTN-4', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  -- First run: populate, drain fully.
  PERFORM public.spec79_populate_loaded_route_backfill_candidates();
  SELECT * INTO v_updated, v_remaining FROM public.spec79_backfill_loaded_route_id_batch(2000);
  IF v_updated <> 1 OR v_remaining <> 0 THEN
    RAISE EXCEPTION 'expected first run to update 1 and drain to 0, got updated=% remaining=%', v_updated, v_remaining;
  END IF;

  -- Simulate re-running the whole driver from scratch (e.g. the workflow is
  -- re-dispatched after a partial failure elsewhere): populate again.
  SELECT public.spec79_populate_loaded_route_backfill_candidates() INTO v_second_populated;

  -- The order still has exactly one live route, so populate is free to
  -- re-insert it (ON CONFLICT DO NOTHING is about not duplicating the ROW,
  -- not about skipping eligible orders) — but the batch function's own
  -- `p.loaded_route_id IS NULL` guard must still make a second pass a no-op
  -- against the package, which is what actually matters here.
  SELECT * INTO v_updated, v_remaining FROM public.spec79_backfill_loaded_route_id_batch(2000);
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'expected second pass to update 0 rows (already set), got %', v_updated;
  END IF;

  SELECT loaded_route_id INTO v_got FROM public.packages WHERE id = v_pkg;
  IF v_got IS DISTINCT FROM v_route_a THEN
    RAISE EXCEPTION 'expected loaded_route_id to remain % after a second pass, got %', v_route_a, v_got;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: re-running populate + batch after a full drain does not duplicate work';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: schema existence — staging table and both functions.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_table_exists boolean;
  v_pk_exists    boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'spec79_loaded_route_backfill_candidates'
  ) INTO v_table_exists;
  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'expected public.spec79_loaded_route_backfill_candidates to exist';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'spec79_loaded_route_backfill_candidates'
      AND constraint_type = 'PRIMARY KEY'
  ) INTO v_pk_exists;
  IF NOT v_pk_exists THEN
    RAISE EXCEPTION 'expected spec79_loaded_route_backfill_candidates to have a primary key';
  END IF;

  PERFORM 1 FROM pg_proc WHERE proname = 'spec79_populate_loaded_route_backfill_candidates';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expected function spec79_populate_loaded_route_backfill_candidates to exist';
  END IF;

  PERFORM 1 FROM pg_proc WHERE proname = 'spec79_backfill_loaded_route_id_batch';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expected function spec79_backfill_loaded_route_id_batch to exist';
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: staging table + both driver functions exist';
END $$;

ROLLBACK TO test_5;

ROLLBACK;
