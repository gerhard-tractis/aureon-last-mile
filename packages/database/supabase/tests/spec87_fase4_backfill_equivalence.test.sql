-- =============================================================================
-- spec-87 fase 4, round-2 review (Corrección 1) — equivalence assertion
-- between the batched driver (populate() + batch()) and the original
-- single-pass spec79_backfill_loaded_route_id() (20260909000001, fixed by
-- 20260910000001).
--
-- Split out of spec87_fase4_backfill_batching.test.sql to keep both files
-- under this repo's ~300-line guideline (same reasoning as the
-- check-migration-safety*.test.sql split).
--
-- Why this test exists: spec79_populate_loaded_route_backfill_candidates()'s
-- eligibility subquery is a SEPARATE copy of the original function's own
-- subquery (a deliberate choice, not an oversight — see the migration
-- header), which means the two can silently diverge. TESTs 1-5 in the
-- sibling file only exercise the driver in isolation; they cannot catch
-- that divergence — round-2 review found 7 of 10 mutants survived them,
-- including the exact two defects (`r.status IN (...)` and
-- `COUNT(DISTINCT route_id)` vs `COUNT(*)`) spec-79 fase 1g/H-2 spent three
-- review rounds fixing in the ORIGINAL function.
--
-- This test runs BOTH implementations against the SAME 10-case fixture
-- (every edge case spec79_loaded_route_id.test.sql covers, in one place)
-- and requires the resulting loaded_route_id to be byte-identical per
-- package. Verified by hand: removing `r.status IN (...)` from populate(),
-- changing `COUNT(DISTINCT dd.route_id)` to `COUNT(*)`, and removing
-- `p.load_inferred = false` from the batch UPDATE each make this test fail.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply
--   ./scripts/pgtap-local.sh run spec87_fase4_backfill_equivalence
--
-- House style, matching spec79_loaded_route_id.test.sql: fixtures inside one
-- transaction, a single DO block that RAISEs on failure, one SAVEPOINT/
-- ROLLBACK TO around it.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000087', 'Test Op 87', 'test-op-87', 'CL')
ON CONFLICT (id) DO NOTHING;

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
