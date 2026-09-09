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
-- TEST 6 (added in round-2 review) is the one that matters most:
-- populate()'s eligibility subquery is a deliberate SEPARATE copy of the
-- original function's own subquery, so the two can silently diverge without
-- any of TESTs 1-5 noticing (they only exercise the driver in isolation).
-- TEST 6 runs both implementations against the same 10-case fixture and
-- requires byte-identical loaded_route_id per package.
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
-- call. Round-2 review finding: this used to assert "exactly 3 calls",
-- which only holds if the WHOLE shared database has exactly 3 eligible
-- orders at the moment this runs — false on `spec52-pg` (shared across
-- worktrees; another session's own committed fixtures, or a stale
-- simulation left behind, changes that number without this test's fixtures
-- changing at all). Rewritten to track only THIS test's 3 known packages:
-- assert none of them ever advance by more than 1 per call (the real
-- property p_batch_size=1 guarantees), and that all 3 are eventually
-- drained, however many total calls that took given whatever else is
-- staged.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_op uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000087';
  i    int;
  v_route  uuid;
  v_order  uuid;
  v_pkg    uuid;
  v_pkg1   uuid := '33337004-0000-0000-0000-000000000081';
  v_pkg2   uuid := '33337004-0000-0000-0000-000000000082';
  v_pkg3   uuid := '33337004-0000-0000-0000-000000000083';
  v_updated   bigint;
  v_remaining bigint;
  v_before_ours int;
  v_after_ours  int;
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

  SELECT COUNT(*) INTO v_before_ours
    FROM public.packages
   WHERE id IN (v_pkg1, v_pkg2, v_pkg3) AND loaded_route_id IS NOT NULL;
  IF v_before_ours <> 0 THEN
    RAISE EXCEPTION 'expected all 3 fixture packages to start unset, % already set', v_before_ours;
  END IF;

  LOOP
    v_calls := v_calls + 1;
    -- Bound scaled well above anything a dev/test database should ever
    -- accumulate (unlike production, this is never meant to hold hundreds
    -- of thousands of real candidates) — high enough to tolerate shared-
    -- container noise, low enough to still fail loudly on genuine
    -- non-convergence.
    IF v_calls > 5000 THEN
      RAISE EXCEPTION 'batch loop did not converge after 5000 calls — candidates never drained';
    END IF;

    SELECT * INTO v_updated, v_remaining FROM public.spec79_backfill_loaded_route_id_batch(1);

    SELECT COUNT(*) INTO v_after_ours
      FROM public.packages
     WHERE id IN (v_pkg1, v_pkg2, v_pkg3) AND loaded_route_id IS NOT NULL;

    IF (v_after_ours - v_before_ours) > 1 THEN
      RAISE EXCEPTION 'p_batch_size=1 let more than 1 of our 3 fixture packages advance in a single call (% -> %)', v_before_ours, v_after_ours;
    END IF;
    v_before_ours := v_after_ours;

    EXIT WHEN v_remaining = 0;
  END LOOP;

  IF v_after_ours <> 3 THEN
    RAISE EXCEPTION 'expected all 3 fixture packages eventually updated, got %', v_after_ours;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: p_batch_size=1 never advances more than 1 of our fixtures per call, and all 3 eventually drain';
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

-- =============================================================================
-- TEST 6 (round-2 review, Corrección 1): equivalence assertion between the
-- batched driver (populate() + batch()) and the original single-pass
-- spec79_backfill_loaded_route_id(). populate()'s eligibility subquery is a
-- SEPARATE copy of the original function's own subquery (a deliberate
-- choice, not an oversight — see the migration header), which means the two
-- can silently diverge. TEST 1-5 above only exercise the driver in
-- isolation; they cannot catch that divergence. This test can: it runs BOTH
-- implementations against the SAME 10-case fixture (every edge case
-- spec79_loaded_route_id.test.sql covers, in one place) and requires the
-- resulting loaded_route_id to be byte-identical per package.
--
-- Round-2 review ran the mutation suite that motivated this test: with it
-- in place, removing `r.status IN (...)` from populate()'s subquery, or
-- changing `COUNT(DISTINCT dd.route_id)` back to `COUNT(*)` (the two exact
-- defects spec-79 fase 1g/H-2 spent three review rounds fixing in the
-- ORIGINAL function), both make THIS test fail — case C and case D below
-- respectively.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_op uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000087';

  -- Case A: unambiguous, single active route -> included.
  v_route_a  uuid := '11117006-0000-0000-0000-000000000000';
  v_order_a  uuid := '22227006-0000-0000-0000-000000000000';
  v_pkg_a    uuid := '33337006-0000-0000-0000-000000000000';

  -- Case B: ambiguous, two live active routes -> excluded by both.
  v_route_b1 uuid := '11117006-0000-0000-0000-000000000001';
  v_route_b2 uuid := '11117006-0000-0000-0000-000000000011';
  v_order_b  uuid := '22227006-0000-0000-0000-000000000001';
  v_pkg_b    uuid := '33337006-0000-0000-0000-000000000001';

  -- Case C: one live active route + one dispatch on a COMPLETED route ->
  -- unambiguous -> included. Catches removing `r.status IN (...)`.
  v_route_c_active uuid := '11117006-0000-0000-0000-000000000002';
  v_route_c_done   uuid := '11117006-0000-0000-0000-000000000012';
  v_order_c        uuid := '22227006-0000-0000-0000-000000000002';
  v_pkg_c          uuid := '33337006-0000-0000-0000-000000000002';

  -- Case D: TWO live dispatch rows on the SAME active route -> unambiguous
  -- -> included. Catches COUNT(DISTINCT route_id) -> COUNT(*).
  v_route_d uuid := '11117006-0000-0000-0000-000000000003';
  v_order_d uuid := '22227006-0000-0000-0000-000000000003';
  v_pkg_d   uuid := '33337006-0000-0000-0000-000000000003';

  -- Case E: live dispatch on an active route + a SOFT-DELETED dispatch on a
  -- different active route -> unambiguous -> included. Catches removing
  -- `dd.deleted_at IS NULL`.
  v_route_e_active  uuid := '11117006-0000-0000-0000-000000000004';
  v_route_e_ignored uuid := '11117006-0000-0000-0000-000000000014';
  v_order_e         uuid := '22227006-0000-0000-0000-000000000004';
  v_pkg_e           uuid := '33337006-0000-0000-0000-000000000004';

  -- Case F: live dispatch on an active route + a live dispatch pointing at
  -- a SOFT-DELETED route -> unambiguous -> included. Catches removing
  -- `r.deleted_at IS NULL`.
  v_route_f_active  uuid := '11117006-0000-0000-0000-000000000005';
  v_route_f_deleted uuid := '11117006-0000-0000-0000-000000000015';
  v_order_f         uuid := '22227006-0000-0000-0000-000000000005';
  v_pkg_f           uuid := '33337006-0000-0000-0000-000000000005';

  -- Case G: unambiguous order, package load_inferred = true -> stays NULL
  -- in both.
  v_route_g uuid := '11117006-0000-0000-0000-000000000006';
  v_order_g uuid := '22227006-0000-0000-0000-000000000006';
  v_pkg_g   uuid := '33337006-0000-0000-0000-000000000006';

  -- Case H: unambiguous order, package loaded_at IS NULL -> stays NULL in
  -- both.
  v_route_h uuid := '11117006-0000-0000-0000-000000000007';
  v_order_h uuid := '22227006-0000-0000-0000-000000000007';
  v_pkg_h   uuid := '33337006-0000-0000-0000-000000000007';

  -- Case I: unambiguous order, package soft-deleted -> stays NULL in both.
  v_route_i uuid := '11117006-0000-0000-0000-000000000008';
  v_order_i uuid := '22227006-0000-0000-0000-000000000008';
  v_pkg_i   uuid := '33337006-0000-0000-0000-000000000008';

  -- Case J: unambiguous order, package ALREADY has loaded_route_id set to a
  -- route that is no longer the computed one -> neither implementation may
  -- overwrite it.
  v_route_j_computed uuid := '11117006-0000-0000-0000-000000000009';
  v_route_j_preset   uuid := '11117006-0000-0000-0000-000000000019';
  v_order_j          uuid := '22227006-0000-0000-0000-000000000009';
  v_pkg_j            uuid := '33337006-0000-0000-0000-000000000009';

  v_mismatch int;
  v_updated   bigint;
  v_remaining bigint;
  v_calls     int := 0;
BEGIN
  -- Case A
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_a, v_op, 'dispatchtrack', 'T87-6A', CURRENT_DATE, 'loaded');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_a, v_op, 'T87-6A', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_a, v_order_a, 'dispatchtrack', 'staged', NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_a, v_op, v_order_a, 'CTN-A', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  -- Case B
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_b1, v_op, 'dispatchtrack', 'T87-6B1', CURRENT_DATE, 'loaded'),
         (v_route_b2, v_op, 'dispatchtrack', 'T87-6B2', CURRENT_DATE, 'loading');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_b, v_op, 'T87-6B', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_b1, v_order_b, 'dispatchtrack', 'force_split', NOW()),
         (gen_random_uuid(), v_op, v_route_b2, v_order_b, 'dispatchtrack', 'planned', NULL);
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_b, v_op, v_order_b, 'CTN-B', '{}'::jsonb, 'listo_para_despacho', NOW(), NULL, false);

  -- Case C
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_c_active, v_op, 'dispatchtrack', 'T87-6C-ACT', CURRENT_DATE, 'loaded'),
         (v_route_c_done,   v_op, 'dispatchtrack', 'T87-6C-DONE', CURRENT_DATE - 21, 'completed');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_c, v_op, 'T87-6C', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_c_done,   v_order_c, 'dispatchtrack', 'adopted', NOW() - INTERVAL '21 days'),
         (gen_random_uuid(), v_op, v_route_c_active, v_order_c, 'dispatchtrack', 'staged',  NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_c, v_op, v_order_c, 'CTN-C', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  -- Case D
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_d, v_op, 'dispatchtrack', 'T87-6D', CURRENT_DATE, 'loaded');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_d, v_op, 'T87-6D', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_d, v_order_d, 'dispatchtrack', 'staged', NOW()),
         (gen_random_uuid(), v_op, v_route_d, v_order_d, 'dispatchtrack', 'staged', NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_d, v_op, v_order_d, 'CTN-D', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  -- Case E
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_e_active,  v_op, 'dispatchtrack', 'T87-6E-ACT', CURRENT_DATE, 'loaded'),
         (v_route_e_ignored, v_op, 'dispatchtrack', 'T87-6E-IGN', CURRENT_DATE, 'loading');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_e, v_op, 'T87-6E', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at, deleted_at)
  VALUES (gen_random_uuid(), v_op, v_route_e_active,  v_order_e, 'dispatchtrack', 'staged', NOW(), NULL),
         (gen_random_uuid(), v_op, v_route_e_ignored, v_order_e, 'dispatchtrack', 'staged', NOW(), NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_e, v_op, v_order_e, 'CTN-E', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  -- Case F
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status, deleted_at)
  VALUES (v_route_f_active,  v_op, 'dispatchtrack', 'T87-6F-ACT', CURRENT_DATE, 'loaded', NULL),
         (v_route_f_deleted, v_op, 'dispatchtrack', 'T87-6F-DEL', CURRENT_DATE, 'loaded', NOW());
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_f, v_op, 'T87-6F', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_f_active,  v_order_f, 'dispatchtrack', 'staged', NOW()),
         (gen_random_uuid(), v_op, v_route_f_deleted, v_order_f, 'dispatchtrack', 'staged', NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_f, v_op, v_order_f, 'CTN-F', '{}'::jsonb, 'en_carga', NOW(), NULL, false);

  -- Case G (load_inferred = true)
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_g, v_op, 'dispatchtrack', 'T87-6G', CURRENT_DATE, 'loaded');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_g, v_op, 'T87-6G', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_g, v_order_g, 'dispatchtrack', 'staged', NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_g, v_op, v_order_g, 'CTN-G', '{}'::jsonb, 'listo_para_despacho', NOW(), NULL, true);

  -- Case H (loaded_at IS NULL)
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_h, v_op, 'dispatchtrack', 'T87-6H', CURRENT_DATE, 'loading');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_h, v_op, 'T87-6H', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_h, v_order_h, 'dispatchtrack', 'planned', NULL);
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg_h, v_op, v_order_h, 'CTN-H', '{}'::jsonb, 'sectorizado', NULL, NULL, false);

  -- Case I (soft-deleted package)
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_i, v_op, 'dispatchtrack', 'T87-6I', CURRENT_DATE, 'loaded');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_i, v_op, 'T87-6I', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_i, v_order_i, 'dispatchtrack', 'staged', NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred, deleted_at)
  VALUES (v_pkg_i, v_op, v_order_i, 'CTN-I', '{}'::jsonb, 'en_carga', NOW(), NULL, false, NOW());

  -- Case J (already set, must not be overwritten by either implementation)
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route_j_computed, v_op, 'dispatchtrack', 'T87-6J', CURRENT_DATE, 'loaded'),
         (v_route_j_preset,   v_op, 'dispatchtrack', 'T87-6J-PRE', CURRENT_DATE, 'completed');
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order_j, v_op, 'T87-6J', 'C', '+56900000000', 'Calle', 'Comuna', CURRENT_DATE, '{}'::jsonb, 'MANUAL', now());
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (gen_random_uuid(), v_op, v_route_j_computed, v_order_j, 'dispatchtrack', 'staged', NOW());
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by, load_inferred, loaded_route_id)
  VALUES (v_pkg_j, v_op, v_order_j, 'CTN-J', '{}'::jsonb, 'en_ruta', NOW(), NULL, false, v_route_j_preset);

  -- ---- Run the DRIVER (populate + drain fully) ----
  PERFORM public.spec79_populate_loaded_route_backfill_candidates();
  LOOP
    v_calls := v_calls + 1;
    IF v_calls > 100 THEN
      RAISE EXCEPTION 'TEST 6 driver loop did not converge';
    END IF;
    SELECT * INTO v_updated, v_remaining FROM public.spec79_backfill_loaded_route_id_batch(2000);
    EXIT WHEN v_remaining = 0;
  END LOOP;

  -- Snapshot the driver's result for our 10 packages.
  CREATE TEMP TABLE _test6_driver_result (package_id uuid PRIMARY KEY, loaded_route_id uuid) ON COMMIT DROP;
  INSERT INTO _test6_driver_result
  SELECT id, loaded_route_id FROM public.packages
   WHERE id IN (v_pkg_a, v_pkg_b, v_pkg_c, v_pkg_d, v_pkg_e, v_pkg_f, v_pkg_g, v_pkg_h, v_pkg_i, v_pkg_j);

  -- Reset every package the driver was allowed to write (everything except
  -- J, which must stay untouched so both implementations are tested against
  -- the SAME "already set" precondition, not a cleared one).
  UPDATE public.packages
     SET loaded_route_id = NULL
   WHERE id IN (v_pkg_a, v_pkg_b, v_pkg_c, v_pkg_d, v_pkg_e, v_pkg_f, v_pkg_g, v_pkg_h, v_pkg_i);

  -- ---- Run the ORIGINAL single-pass function ----
  PERFORM public.spec79_backfill_loaded_route_id();

  -- ---- Compare ----
  SELECT COUNT(*) INTO v_mismatch
    FROM _test6_driver_result d
    JOIN public.packages p ON p.id = d.package_id
   WHERE p.loaded_route_id IS DISTINCT FROM d.loaded_route_id;

  IF v_mismatch <> 0 THEN
    RAISE EXCEPTION 'driver and original function diverge on % of 10 packages — see per-case comments above for which case', v_mismatch;
  END IF;

  -- Sanity: confirm the fixture actually exercised both outcomes (not a
  -- vacuously-true comparison where nothing got backfilled by either side).
  IF (SELECT loaded_route_id FROM public.packages WHERE id = v_pkg_a) IS DISTINCT FROM v_route_a THEN
    RAISE EXCEPTION 'sanity check failed: case A (unambiguous) should have backfilled to %', v_route_a;
  END IF;
  IF (SELECT loaded_route_id FROM public.packages WHERE id = v_pkg_b) IS NOT NULL THEN
    RAISE EXCEPTION 'sanity check failed: case B (ambiguous) should have stayed NULL';
  END IF;
  IF (SELECT loaded_route_id FROM public.packages WHERE id = v_pkg_c) IS DISTINCT FROM v_route_c_active THEN
    RAISE EXCEPTION 'sanity check failed: case C (completed route does not compete) should have backfilled to %', v_route_c_active;
  END IF;
  IF (SELECT loaded_route_id FROM public.packages WHERE id = v_pkg_d) IS DISTINCT FROM v_route_d THEN
    RAISE EXCEPTION 'sanity check failed: case D (two rows, same route) should have backfilled to %', v_route_d;
  END IF;
  IF (SELECT loaded_route_id FROM public.packages WHERE id = v_pkg_j) IS DISTINCT FROM v_route_j_preset THEN
    RAISE EXCEPTION 'sanity check failed: case J (already set) must remain %', v_route_j_preset;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: driver and original function produce identical loaded_route_id across all 10 edge cases';
END $$;

ROLLBACK TO test_6;

ROLLBACK;
