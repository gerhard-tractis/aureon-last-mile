-- =============================================================================
-- spec-74 phase 1 — per-package load state on `packages`, `partially_staged`
-- added to `dispatches.stage`, and the optimistic backfill.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec74_package_load_state.test.sql
--
-- House style, matching spec71_load_positions.test.sql: fixtures inside one
-- transaction, SAVEPOINT per test, each test a DO block that RAISEs on
-- failure, ROLLBACK TO the savepoint so later tests are unaffected by an
-- earlier failure, final ROLLBACK leaves the DB clean.
--
-- COVERAGE NOTE on the backfill (TESTS 5-7): the pgTAP harness applies every
-- migration to the container BEFORE any test file runs, so a fixture this
-- file inserts can never be seen by the migration's own backfill run — that
-- already ran, against whatever rows existed in the container at
-- migration-apply time. No test file can rewind that; this is a limit of
-- the harness's apply-then-test ordering, not something fixed here.
--
-- What these tests DO instead: call `public.spec74_backfill_package_load_state()`
-- directly — the exact function the migration's own DO block calls (see
-- 20260901000001, section 3) — against fixtures built in this file, rather
-- than pasting a second copy of the UPDATE that the migration's SQL could
-- silently drift away from. That protects the backfill RULE itself (what
-- gets backfilled, what doesn't, and why — including the `adopted`
-- decision): change the function's logic and these tests catch it, because
-- there is only one copy of that logic to change.
--
-- What this does NOT prove: that the migration's own DO block still calls
-- that function on a real `apply`. Deleting that one-line call while leaving
-- the function itself defined would pass every test in this file. The
-- migration's own verification block (20260901000001, section 4) asserts
-- the function exists, which catches "function deleted" but not "function
-- orphaned" — there is no clean way to close that last gap from a test file
-- that necessarily runs after the migration already did its one-time work.
-- =============================================================================

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'loaded_at'
  ) THEN
    RAISE EXCEPTION 'packages.loaded_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'loaded_by'
  ) THEN
    RAISE EXCEPTION 'packages.loaded_by missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'load_inferred'
  ) THEN
    RAISE EXCEPTION 'packages.load_inferred missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users ──────────────────────────────────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'Test Op 74-A', 'test-op-74-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000074', 'Test Op 74-B', 'test-op-74-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000174',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec74.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000074"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000174',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec74.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000074"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000174','aaaaaaaa-aaaa-aaaa-aaaa-000000000074','user-a@spec74.test','User A',ARRAY['admin']),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000174','bbbbbbbb-bbbb-bbbb-bbbb-000000000074','user-b@spec74.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

SELECT set_config('request.jwt.claims', '{}', true);

-- One order per operator, plus a package on operator A's order for the
-- operator-isolation read test.
INSERT INTO public.orders
  (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
   comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES
  ('07de0001-0000-0000-0000-000000000074', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074',
   'ORD-74-A', 'Cliente A', '+56911111111', 'Calle 1', 'Providencia', CURRENT_DATE,
   '{}'::jsonb, 'MANUAL', NOW()),
  ('07de0002-0000-0000-0000-000000000074', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000074',
   'ORD-74-B', 'Cliente B', '+56922222222', 'Calle 2', 'Las Condes', CURRENT_DATE,
   '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, raw_data)
VALUES
  ('7ac00001-0000-0000-0000-000000000074', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074',
   '07de0001-0000-0000-0000-000000000074', 'CTN-74-A1', '{}'::jsonb),
  ('7ac00002-0000-0000-0000-000000000074', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000074',
   '07de0002-0000-0000-0000-000000000074', 'CTN-74-B1', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- TEST 1: loaded_at / loaded_by / load_inferred are nullable-as-designed
-- (load_inferred defaults false; loaded_at/loaded_by default NULL)
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE v_loaded_at TIMESTAMPTZ; v_loaded_by UUID; v_inferred BOOLEAN;
BEGIN
  SELECT loaded_at, loaded_by, load_inferred
    INTO v_loaded_at, v_loaded_by, v_inferred
    FROM public.packages
   WHERE id = '7ac00001-0000-0000-0000-000000000074';

  IF v_loaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'loaded_at should default to NULL, got %', v_loaded_at;
  END IF;
  IF v_loaded_by IS NOT NULL THEN
    RAISE EXCEPTION 'loaded_by should default to NULL, got %', v_loaded_by;
  END IF;
  IF v_inferred IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'load_inferred should default to false, got %', v_inferred;
  END IF;

  -- A genuine scan: loaded_at + loaded_by set, load_inferred stays false.
  UPDATE public.packages
     SET loaded_at = NOW(), loaded_by = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000174'
   WHERE id = '7ac00001-0000-0000-0000-000000000074';

  SELECT loaded_at, loaded_by, load_inferred
    INTO v_loaded_at, v_loaded_by, v_inferred
    FROM public.packages
   WHERE id = '7ac00001-0000-0000-0000-000000000074';

  IF v_loaded_at IS NULL OR v_loaded_by IS NULL OR v_inferred <> false THEN
    RAISE EXCEPTION 'genuine scan write did not persist as expected: loaded_at=%, loaded_by=%, inferred=%',
      v_loaded_at, v_loaded_by, v_inferred;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: loaded_at/loaded_by/load_inferred nullable and writable';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: loaded_by FK behaviour — accepts a real public.users(id), rejects a
-- nonexistent one, and ON DELETE SET NULL nulls it rather than blocking the
-- user delete (mirrors dispatches.staged_by).
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE blocked BOOLEAN := false; v_read UUID; v_temp_user UUID := 'cccccccc-cccc-cccc-cccc-000000000174';
BEGIN
  BEGIN
    UPDATE public.packages
       SET loaded_at = NOW(), loaded_by = '99999999-9999-9999-9999-999999999999'
     WHERE id = '7ac00001-0000-0000-0000-000000000074';
  EXCEPTION WHEN foreign_key_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'loaded_by accepted a public.users(id) that does not exist';
  END IF;

  -- A temp user, referenced, then hard-deleted: ON DELETE SET NULL.
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token
  ) VALUES (
    v_temp_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'user-temp@spec74.test', crypt('x', gen_salt('bf')), NOW(),
    '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000074"}'::jsonb,
    '{"full_name":"Temp"}'::jsonb, NOW(), NOW(), '', ''
  );
  INSERT INTO public.users (id, operator_id, email, full_name, permissions)
  VALUES (v_temp_user, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'user-temp@spec74.test', 'Temp', ARRAY['admin'])
  ON CONFLICT (id) DO UPDATE
    SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

  UPDATE public.packages
     SET loaded_at = NOW(), loaded_by = v_temp_user
   WHERE id = '7ac00001-0000-0000-0000-000000000074';

  DELETE FROM public.users WHERE id = v_temp_user;
  DELETE FROM auth.users WHERE id = v_temp_user;

  SELECT loaded_by INTO v_read FROM public.packages WHERE id = '7ac00001-0000-0000-0000-000000000074';
  IF v_read IS NOT NULL THEN
    RAISE EXCEPTION 'loaded_by was not nulled by ON DELETE SET NULL, got %', v_read;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: loaded_by FK rejects unknown user, ON DELETE SET NULL on user delete';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: packages_load_inferred_requires_loaded_at_chk rejects
-- load_inferred = true with loaded_at NULL.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.packages
       SET load_inferred = true, loaded_at = NULL
     WHERE id = '7ac00001-0000-0000-0000-000000000074';
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'load_inferred=true with loaded_at NULL was not rejected';
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: load_inferred requires loaded_at CHECK enforced';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: dispatches.stage accepts 'partially_staged' and still rejects a
-- garbage value.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_route UUID := '74e00001-0000-0000-0000-000000000074';
  v_disp  UUID := 'd15a0001-0000-0000-0000-000000000074';
  v_read  TEXT;
  blocked BOOLEAN := false;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-1', CURRENT_DATE, 'draft');

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (v_disp, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route,
          '07de0001-0000-0000-0000-000000000074', 'dispatchtrack', 'partially_staged', NOW());

  SELECT stage INTO v_read FROM public.dispatches WHERE id = v_disp;
  IF v_read <> 'partially_staged' THEN
    RAISE EXCEPTION 'dispatches.stage did not persist partially_staged, got %', v_read;
  END IF;

  BEGIN
    UPDATE public.dispatches SET stage = 'not_a_real_stage' WHERE id = v_disp;
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'dispatches_stage_check accepted a garbage stage value';
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: dispatches.stage accepts partially_staged, rejects garbage';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: backfill — a `staged` dispatch's live packages come out loaded AND
-- flagged inferred; a `planned` dispatch's packages are untouched.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_route     UUID := '74e00002-0000-0000-0000-000000000074';
  v_ord_s     UUID := '07de0011-0000-0000-0000-000000000074';
  v_ord_p     UUID := '07de0012-0000-0000-0000-000000000074';
  v_disp_s    UUID := 'd15a0002-0000-0000-0000-000000000074';
  v_disp_p    UUID := 'd15a0003-0000-0000-0000-000000000074';
  v_pkg_s     UUID := '7ac00011-0000-0000-0000-000000000074';
  v_pkg_p     UUID := '7ac00012-0000-0000-0000-000000000074';
  v_staged_at TIMESTAMPTZ := NOW() - interval '2 days';
  v_loaded_at TIMESTAMPTZ; v_inferred BOOLEAN;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-2', CURRENT_DATE, 'draft');

  INSERT INTO public.orders
    (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
     comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    (v_ord_s, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-S', 'Cliente S', '+56933333333',
     'Calle 3', 'Ñuñoa', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW()),
    (v_ord_p, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-P', 'Cliente P', '+56944444444',
     'Calle 4', 'Maipú', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES
    (v_disp_s, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord_s, 'dispatchtrack', 'staged', v_staged_at),
    (v_disp_p, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord_p, 'dispatchtrack', 'planned', NULL);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data)
  VALUES
    (v_pkg_s, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord_s, 'CTN-74-S1', '{}'::jsonb),
    (v_pkg_p, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord_p, 'CTN-74-P1', '{}'::jsonb);

  -- Call the migration's own backfill function (not a pasted copy) — see
  -- the COVERAGE NOTE at the top of this file for exactly what that does
  -- and does not prove.
  PERFORM public.spec74_backfill_package_load_state();

  SELECT loaded_at, load_inferred INTO v_loaded_at, v_inferred FROM public.packages WHERE id = v_pkg_s;
  IF v_loaded_at IS DISTINCT FROM v_staged_at THEN
    RAISE EXCEPTION 'staged dispatch package loaded_at should equal dispatches.staged_at (%), got %', v_staged_at, v_loaded_at;
  END IF;
  IF v_inferred IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'staged dispatch package should be flagged load_inferred=true, got %', v_inferred;
  END IF;

  SELECT loaded_at, load_inferred INTO v_loaded_at, v_inferred FROM public.packages WHERE id = v_pkg_p;
  IF v_loaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'planned dispatch package should be untouched (loaded_at NULL), got %', v_loaded_at;
  END IF;
  IF v_inferred IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'planned dispatch package should stay load_inferred=false, got %', v_inferred;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: staged-dispatch packages backfilled+inferred, planned-dispatch packages untouched';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: backfill covers `adopted` dispatches the same way as `staged`
-- (physically present but never planned still means "loaded").
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_route     UUID := '74e00003-0000-0000-0000-000000000074';
  v_ord_a     UUID := '07de0021-0000-0000-0000-000000000074';
  v_disp_a    UUID := 'd15a0004-0000-0000-0000-000000000074';
  v_pkg_a     UUID := '7ac00021-0000-0000-0000-000000000074';
  v_staged_at TIMESTAMPTZ := NOW() - interval '1 day';
  v_loaded_at TIMESTAMPTZ; v_inferred BOOLEAN;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-3', CURRENT_DATE, 'draft');

  INSERT INTO public.orders
    (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
     comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    (v_ord_a, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-ADOPT', 'Cliente Adopt', '+56955555555',
     'Calle 5', 'La Reina', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (v_disp_a, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord_a, 'dispatchtrack', 'adopted', v_staged_at);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data)
  VALUES (v_pkg_a, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord_a, 'CTN-74-ADOPT1', '{}'::jsonb);

  PERFORM public.spec74_backfill_package_load_state();

  SELECT loaded_at, load_inferred INTO v_loaded_at, v_inferred FROM public.packages WHERE id = v_pkg_a;
  IF v_loaded_at IS DISTINCT FROM v_staged_at THEN
    RAISE EXCEPTION 'adopted dispatch package loaded_at should equal dispatches.staged_at (%), got %', v_staged_at, v_loaded_at;
  END IF;
  IF v_inferred IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'adopted dispatch package should be flagged load_inferred=true, got %', v_inferred;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: adopted-dispatch packages backfilled+inferred, same as staged';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7: backfill idempotency — the guard (loaded_at IS NULL) means a
-- genuine scan recorded after the migration ran is never overwritten by a
-- re-run of the same backfill UPDATE.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_route      UUID := '74e00004-0000-0000-0000-000000000074';
  v_ord        UUID := '07de0031-0000-0000-0000-000000000074';
  v_disp       UUID := 'd15a0005-0000-0000-0000-000000000074';
  v_pkg        UUID := '7ac00031-0000-0000-0000-000000000074';
  v_real_scan  TIMESTAMPTZ := NOW();
  v_loaded_at  TIMESTAMPTZ; v_inferred BOOLEAN;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-4', CURRENT_DATE, 'draft');

  INSERT INTO public.orders
    (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
     comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    (v_ord, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-IDEMP', 'Cliente Idemp', '+56966666666',
     'Calle 6', 'Vitacura', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (v_disp, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord, 'dispatchtrack', 'staged', NOW() - interval '3 days');

  -- Package already carries a REAL scan (not inferred) by the time any
  -- backfill re-run happens.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, loaded_at, loaded_by, load_inferred)
  VALUES (v_pkg, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord, 'CTN-74-IDEMP1', '{}'::jsonb,
          v_real_scan, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000174', false);

  PERFORM public.spec74_backfill_package_load_state();

  SELECT loaded_at, load_inferred INTO v_loaded_at, v_inferred FROM public.packages WHERE id = v_pkg;
  IF v_loaded_at IS DISTINCT FROM v_real_scan THEN
    RAISE EXCEPTION 'backfill re-run overwrote a genuine scan''s loaded_at: expected %, got %', v_real_scan, v_loaded_at;
  END IF;
  IF v_inferred IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'backfill re-run flipped a genuine scan to load_inferred=true';
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: backfill re-run never overwrites a genuine (loaded_at IS NOT NULL) scan';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8: operator isolation on packages reads of the new columns — operator
-- A cannot read operator B's package load state under RLS.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  UPDATE public.packages SET loaded_at = NOW(), load_inferred = true
   WHERE id = '7ac00002-0000-0000-0000-000000000074'; -- operator B's package

  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-000000000174","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000074","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.packages
   WHERE id = '7ac00001-0000-0000-0000-000000000074';
  SELECT COUNT(*) INTO c_other FROM public.packages
   WHERE id = '7ac00002-0000-0000-0000-000000000074';

  IF c_own <> 1 THEN
    RAISE EXCEPTION 'operator A should see its own package, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B package (load state included), got %', c_other;
  END IF;

  RESET role;
  RAISE NOTICE '✓ TEST 8 PASSED: operator isolation holds for packages load-state reads';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9: idx_packages_order_unloaded exists and is the partial index it
-- claims to be (order_id, WHERE loaded_at IS NULL AND deleted_at IS NULL).
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE idx_def TEXT;
BEGIN
  SELECT indexdef INTO idx_def
    FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'packages' AND indexname = 'idx_packages_order_unloaded';

  IF idx_def IS NULL THEN
    RAISE EXCEPTION 'idx_packages_order_unloaded missing';
  END IF;
  IF idx_def NOT ILIKE '%loaded_at IS NULL%' OR idx_def NOT ILIKE '%deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'idx_packages_order_unloaded is not the expected partial index, got: %', idx_def;
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: idx_packages_order_unloaded exists with the expected partial predicate';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10: dispatches_stage_check still covers 'planned'/'staged'/'adopted'
-- alongside the new 'partially_staged' — the widen was additive, not a
-- replacement that silently dropped an existing value.
-- =============================================================================
SAVEPOINT test_10;

DO $$
DECLARE v TEXT;
BEGIN
  FOREACH v IN ARRAY ARRAY['planned', 'partially_staged', 'staged', 'adopted']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.dispatches'::regclass
        AND conname = 'dispatches_stage_check'
        AND pg_get_constraintdef(oid) LIKE '%' || v || '%'
    ) THEN
      RAISE EXCEPTION 'dispatches_stage_check no longer mentions %', v;
    END IF;
  END LOOP;
  RAISE NOTICE '✓ TEST 10 PASSED: dispatches_stage_check retains all four stage values';
END $$;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11: packages_loaded_by_requires_loaded_at_chk rejects loaded_by set
-- with loaded_at NULL (an actor recorded for an event that, per loaded_at,
-- never happened).
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE public.packages
       SET loaded_by = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000174', loaded_at = NULL
     WHERE id = '7ac00001-0000-0000-0000-000000000074';
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'loaded_by set with loaded_at NULL was not rejected';
  END IF;
  RAISE NOTICE '✓ TEST 11 PASSED: packages_loaded_by_requires_loaded_at_chk enforced';
END $$;

ROLLBACK TO test_11;

-- =============================================================================
-- TEST 12: dispatches_staged_at_check rejects `partially_staged` with a NULL
-- staged_at — phase 3 must set staged_at on planned -> partially_staged, and
-- this pins that the constraint would actually catch it if phase 3 forgot.
-- =============================================================================
SAVEPOINT test_12;

DO $$
DECLARE
  v_route UUID := '74e00005-0000-0000-0000-000000000074';
  v_disp  UUID := 'd15a0006-0000-0000-0000-000000000074';
  blocked BOOLEAN := false;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-5', CURRENT_DATE, 'draft');

  BEGIN
    INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
    VALUES (v_disp, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route,
            '07de0001-0000-0000-0000-000000000074', 'dispatchtrack', 'partially_staged', NULL);
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'dispatches_staged_at_check accepted partially_staged with staged_at NULL';
  END IF;
  RAISE NOTICE '✓ TEST 12 PASSED: dispatches_staged_at_check rejects partially_staged with staged_at NULL';
END $$;

ROLLBACK TO test_12;

-- =============================================================================
-- TEST 13: backfill soft-delete behaviour, package side — a soft-deleted
-- package of a `staged` dispatch is NOT backfilled.
-- =============================================================================
SAVEPOINT test_13;

DO $$
DECLARE
  v_route  UUID := '74e00006-0000-0000-0000-000000000074';
  v_ord    UUID := '07de0041-0000-0000-0000-000000000074';
  v_disp   UUID := 'd15a0007-0000-0000-0000-000000000074';
  v_pkg    UUID := '7ac00041-0000-0000-0000-000000000074';
  v_loaded_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-6', CURRENT_DATE, 'draft');

  INSERT INTO public.orders
    (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
     comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    (v_ord, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-SOFTPKG', 'Cliente SoftPkg', '+56977777777',
     'Calle 7', 'Ñuñoa', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES (v_disp, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord, 'dispatchtrack', 'staged', NOW());

  -- Package soft-deleted BEFORE the backfill runs.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, deleted_at)
  VALUES (v_pkg, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord, 'CTN-74-SOFTPKG1', '{}'::jsonb, NOW());

  PERFORM public.spec74_backfill_package_load_state();

  SELECT loaded_at INTO v_loaded_at FROM public.packages WHERE id = v_pkg;
  IF v_loaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'a soft-deleted package of a staged dispatch was backfilled, got loaded_at=%', v_loaded_at;
  END IF;

  RAISE NOTICE '✓ TEST 13 PASSED: soft-deleted package of a staged dispatch is not backfilled';
END $$;

ROLLBACK TO test_13;

-- =============================================================================
-- TEST 14: backfill soft-delete behaviour, dispatch side — a package of a
-- soft-deleted `staged` dispatch is NOT backfilled.
-- =============================================================================
SAVEPOINT test_14;

DO $$
DECLARE
  v_route  UUID := '74e00007-0000-0000-0000-000000000074';
  v_ord    UUID := '07de0042-0000-0000-0000-000000000074';
  v_disp   UUID := 'd15a0008-0000-0000-0000-000000000074';
  v_pkg    UUID := '7ac00042-0000-0000-0000-000000000074';
  v_loaded_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-7', CURRENT_DATE, 'draft');

  INSERT INTO public.orders
    (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
     comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    (v_ord, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-SOFTDISP', 'Cliente SoftDisp', '+56988888888',
     'Calle 8', 'La Reina', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());

  -- Dispatch soft-deleted BEFORE the backfill runs.
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at, deleted_at)
  VALUES (v_disp, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord, 'dispatchtrack', 'staged', NOW(), NOW());

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data)
  VALUES (v_pkg, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord, 'CTN-74-SOFTDISP1', '{}'::jsonb);

  PERFORM public.spec74_backfill_package_load_state();

  SELECT loaded_at INTO v_loaded_at FROM public.packages WHERE id = v_pkg;
  IF v_loaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'a package of a soft-deleted staged dispatch was backfilled, got loaded_at=%', v_loaded_at;
  END IF;

  RAISE NOTICE '✓ TEST 14 PASSED: package of a soft-deleted staged dispatch is not backfilled';
END $$;

ROLLBACK TO test_14;

-- =============================================================================
-- TEST 15: backfill determinism — an order with TWO live staged dispatches
-- (no unique constraint forbids this today, 20260828000001:128-134) resolves
-- deterministically to MIN(staged_at) rather than depending on join order.
-- =============================================================================
SAVEPOINT test_15;

DO $$
DECLARE
  v_route      UUID := '74e00008-0000-0000-0000-000000000074';
  v_ord        UUID := '07de0043-0000-0000-0000-000000000074';
  v_disp_1     UUID := 'd15a0009-0000-0000-0000-000000000074';
  v_disp_2     UUID := 'd15a000a-0000-0000-0000-000000000074';
  v_pkg        UUID := '7ac00043-0000-0000-0000-000000000074';
  v_earlier    TIMESTAMPTZ := NOW() - interval '5 days';
  v_later      TIMESTAMPTZ := NOW() - interval '1 day';
  v_loaded_at  TIMESTAMPTZ;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'dispatchtrack', 'spec74-route-8', CURRENT_DATE, 'draft');

  INSERT INTO public.orders
    (id, operator_id, order_number, customer_name, customer_phone, delivery_address,
     comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES
    (v_ord, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', 'ORD-74-DUPDISP', 'Cliente DupDisp', '+56999999999',
     'Calle 9', 'Providencia', CURRENT_DATE, '{}'::jsonb, 'MANUAL', NOW());

  -- Two live 'staged' dispatches on the SAME order_id, different staged_at.
  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, stage, staged_at)
  VALUES
    (v_disp_1, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord, 'dispatchtrack', 'staged', v_later),
    (v_disp_2, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_route, v_ord, 'dispatchtrack', 'staged', v_earlier);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data)
  VALUES (v_pkg, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000074', v_ord, 'CTN-74-DUPDISP1', '{}'::jsonb);

  PERFORM public.spec74_backfill_package_load_state();

  SELECT loaded_at INTO v_loaded_at FROM public.packages WHERE id = v_pkg;
  IF v_loaded_at IS DISTINCT FROM v_earlier THEN
    RAISE EXCEPTION 'backfill with two live staged dispatches on one order should resolve to MIN(staged_at) (%), got %', v_earlier, v_loaded_at;
  END IF;

  RAISE NOTICE '✓ TEST 15 PASSED: backfill resolves multiple live dispatches on one order_id to MIN(staged_at)';
END $$;

ROLLBACK TO test_15;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec74_package_load_state tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
