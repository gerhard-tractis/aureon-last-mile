-- =============================================================================
-- spec-74 phase 3 — SQL half of the blocker checklist: route_stop_counts'
-- new partially_staged_stops bucket, and get_move_task_snapshot's widened
-- plan-membership filter.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec74_phase3_partially_staged.test.sql
--
-- House style, matching spec74_package_load_state.test.sql /
-- spec71_move_task_snapshot.test.sql: fixtures inside one transaction,
-- SAVEPOINT per test, each test a DO block that RAISEs on failure, ROLLBACK
-- TO the savepoint so later tests are unaffected by an earlier failure,
-- final ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'route_stop_counts'
      AND column_name = 'partially_staged_stops'
  ) THEN
    RAISE EXCEPTION 'route_stop_counts.partially_staged_stops missing';
  END IF;
END $$;

-- ─── Fixture: 1 operator, 1 user, 1 dock zone, 1 load position ─────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000076', 'Test Op 76-A', 'test-op-76-a', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000176',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec76.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000076"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000176','aaaaaaaa-aaaa-aaaa-aaaa-000000000076','user-a@spec76.test','User A',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

SELECT set_config('request.jwt.claims', '{}', true);

INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
VALUES ('44440101-0000-0000-0000-000000000076', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076', 'Andén 76-1', 'AN76-1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.load_positions (id, operator_id, code, label, fronts_dock_zone_id)
VALUES ('11120001-0000-0000-0000-000000000076', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076', 'POS-76-1', 'Zona 1', NULL)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.mk_order_pkg76(
  p_order_id uuid, p_pkg_id uuid, p_num text, p_dock_zone uuid, p_loaded_at timestamptz
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (p_order_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076', p_num, 'Cliente', '+56900000000',
    'Calle 1', 'TestComuna', '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id, loaded_at)
  VALUES (p_pkg_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076', p_order_id, 'PKG-' || p_num, '{}'::jsonb,
    CASE WHEN p_loaded_at IS NULL THEN 'sectorizado' ELSE 'en_carga' END::package_status_enum,
    p_dock_zone, p_loaded_at)
  ON CONFLICT (id) DO NOTHING;
END;
$fn$;

-- =============================================================================
-- TEST 1: route_stop_counts gives partially_staged its own bucket — counted
-- in total_stops, but in NEITHER pending_stops NOR staged_stops (the exact
-- gap the migration header describes: before this, such a row counted
-- nowhere a caller could act on).
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_route UUID := '22221001-0000-0000-0000-000000000076';
  r RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-001', CURRENT_DATE, 'loading');

  INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
  VALUES
    ('d1600001-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'planned', NULL),
    ('d1600002-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'partially_staged', NOW()),
    ('d1600003-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'staged', NOW()),
    ('d1600004-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'adopted', NOW());

  SELECT * INTO r FROM public.route_stop_counts WHERE route_id = v_route;

  IF r IS NULL THEN
    RAISE EXCEPTION 'TEST 1: route_stop_counts returned no row';
  END IF;
  IF r.total_stops <> 4 THEN
    RAISE EXCEPTION 'TEST 1: total_stops=%, want 4', r.total_stops;
  END IF;
  IF r.pending_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 1: pending_stops=%, want 1 (only the planned row)', r.pending_stops;
  END IF;
  IF r.partially_staged_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 1: partially_staged_stops=%, want 1', r.partially_staged_stops;
  END IF;
  IF r.staged_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 1: staged_stops=%, want 1 (partially_staged must not leak in)', r.staged_stops;
  END IF;
  IF r.adopted_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 1: adopted_stops=%, want 1', r.adopted_stops;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: partially_staged_stops is its own bucket, not folded into pending or staged';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: get_move_task_snapshot's plan-membership filter now admits
-- partially_staged. A route with one partially_staged order (one package
-- loaded, one still on the andén) must still show the outstanding package as
-- remaining — before this widening it fell out of `route_totals`/
-- `remaining_by_zone` entirely, the exact "drops off the move list with work
-- still outstanding" bug the blocker checklist names.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_route UUID := '22221002-0000-0000-0000-000000000076';
  v_snapshot jsonb;
  v_route_json jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-002', CURRENT_DATE, 'planned',
    '11120001-0000-0000-0000-000000000076', now());

  -- Order A: partially_staged dispatch — bulto 1 loaded (dock_scans + loaded_at),
  -- bulto 2 still on the andén (neither). This is the fact under test.
  PERFORM pg_temp.mk_order_pkg76('e1760001-0000-0000-0000-000000000076', 'f1760001-0000-0000-0000-000000000076',
    'T76-1', '44440101-0000-0000-0000-000000000076', NOW());
  INSERT INTO public.dock_scans (operator_id, package_id, barcode, scan_result, scanned_by, load_position_id)
  VALUES (v_op, 'f1760001-0000-0000-0000-000000000076', 'PKG-T76-1', 'accepted',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000176', '11120001-0000-0000-0000-000000000076');
  PERFORM pg_temp.mk_order_pkg76('e1760001-0000-0000-0000-000000000076', 'f1760002-0000-0000-0000-000000000076',
    'T76-2', '44440101-0000-0000-0000-000000000076', NULL);
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage, staged_at)
  VALUES (v_route, 'e1760001-0000-0000-0000-000000000076', v_op, 'pending', 'dispatchtrack', 'partially_staged', now());

  -- Order B: adopted dispatch with an unloaded package — must stay OUT of
  -- scope here (unchanged from 20260828000001; adoption completeness is the
  -- app layer's job, see seal-route.ts), so it must not inflate the count.
  PERFORM pg_temp.mk_order_pkg76('e1760002-0000-0000-0000-000000000076', 'f1760003-0000-0000-0000-000000000076',
    'T76-3', '44440101-0000-0000-0000-000000000076', NULL);
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage, staged_at)
  VALUES (v_route, 'e1760002-0000-0000-0000-000000000076', v_op, 'pending', 'dispatchtrack', 'adopted', now());

  v_snapshot := public.get_move_task_snapshot(v_op);
  SELECT r INTO v_route_json
    FROM jsonb_array_elements(v_snapshot->'routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_route_json IS NULL THEN
    RAISE EXCEPTION 'TEST 2: route % missing from snapshot — the partially_staged order''s outstanding package vanished', v_route;
  END IF;
  -- total_packages: only order A's 2 packages count (route_dispatches only
  -- includes planned/partially_staged/staged/adopted live dispatches, and
  -- route_packages joins on ALL of them — but remaining_packages below is
  -- what actually gates visibility and what this test is about).
  IF (v_route_json->>'remaining_packages')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 2: remaining_packages=%, want 1 (order A''s unloaded bulto only; order B (adopted) excluded by design)',
      v_route_json->>'remaining_packages';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_route_json->'groups') g
     WHERE g->>'dock_zone_code' = 'AN76-1' AND (g->>'remaining_count')::int = 1
  ) THEN
    RAISE EXCEPTION 'TEST 2: AN76-1 group missing or wrong count: %', v_route_json->'groups';
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: a partially_staged order''s outstanding package still shows on the move-task list';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3 (review Fix 1, BLOCKER): recompute_dispatch_stage — a `dañado`
-- sibling does NOT block the seal. `dañado` sits outside
-- DISPATCHABLE_STATUSES (scan-validator.ts:28-33): the scanner will never
-- accept it, so it must never count as "outstanding" either — otherwise
-- the dispatch is stuck at partially_staged forever with no way to clear
-- it. One package already loaded (the just-scanned box), one sibling at
-- `dañado`: the recompute must still report `staged`.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_op       UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_user     UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000176';
  v_route    UUID := '22221003-0000-0000-0000-000000000076';
  v_order    UUID := 'e1760010-0000-0000-0000-000000000076';
  v_dispatch UUID := 'd1600010-0000-0000-0000-000000000076';
  v_result   text;
  v_row      RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-010', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T76-10', 'Cliente', '+56900000000', 'Calle 1', 'TestComuna',
    '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, status, stage, staged_at)
  VALUES (v_dispatch, v_op, v_route, v_order, 'dispatchtrack', 'pending', 'planned', NULL);

  -- The package just scanned: already loaded.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by)
  VALUES ('f1760010-0000-0000-0000-000000000076', v_op, v_order, 'PKG-T76-10A', '{}'::jsonb,
    'en_carga', NOW(), v_user);

  -- The sibling: dañado, never loaded, and never scannable again.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at)
  VALUES ('f1760011-0000-0000-0000-000000000076', v_op, v_order, 'PKG-T76-10B', '{}'::jsonb,
    'dañado', NULL);

  v_result := public.recompute_dispatch_stage(v_dispatch, v_op, v_order, v_user);

  IF v_result <> 'staged' THEN
    RAISE EXCEPTION 'TEST 3: recompute_dispatch_stage returned %, want staged (a dañado sibling must not block)', v_result;
  END IF;

  SELECT * INTO v_row FROM public.dispatches WHERE id = v_dispatch;
  IF v_row.stage <> 'staged' THEN
    RAISE EXCEPTION 'TEST 3: dispatches.stage=%, want staged', v_row.stage;
  END IF;
  IF v_row.staged_by <> v_user THEN
    RAISE EXCEPTION 'TEST 3: staged_by=%, want %', v_row.staged_by, v_user;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: a dañado sibling does not block the seal (Fix 1)';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4 (review Fix 1, BLOCKER counterpart): recompute_dispatch_stage — a
-- `sectorizado` sibling (a real, scannable box still on the andén) DOES
-- block: the recompute must report `partially_staged`, not `staged`.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_op       UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_user     UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000176';
  v_route    UUID := '22221004-0000-0000-0000-000000000076';
  v_order    UUID := 'e1760020-0000-0000-0000-000000000076';
  v_dispatch UUID := 'd1600020-0000-0000-0000-000000000076';
  v_result   text;
  v_row      RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-020', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T76-20', 'Cliente', '+56900000000', 'Calle 1', 'TestComuna',
    '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, status, stage, staged_at)
  VALUES (v_dispatch, v_op, v_route, v_order, 'dispatchtrack', 'pending', 'planned', NULL);

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at, loaded_by)
  VALUES ('f1760020-0000-0000-0000-000000000076', v_op, v_order, 'PKG-T76-20A', '{}'::jsonb,
    'en_carga', NOW(), v_user);

  -- The sibling: sectorizado — a real box, still scannable, still on the andén.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at)
  VALUES ('f1760021-0000-0000-0000-000000000076', v_op, v_order, 'PKG-T76-20B', '{}'::jsonb,
    'sectorizado', NULL);

  v_result := public.recompute_dispatch_stage(v_dispatch, v_op, v_order, v_user);

  IF v_result <> 'partially_staged' THEN
    RAISE EXCEPTION 'TEST 4: recompute_dispatch_stage returned %, want partially_staged (a sectorizado sibling must block)', v_result;
  END IF;

  SELECT * INTO v_row FROM public.dispatches WHERE id = v_dispatch;
  IF v_row.stage <> 'partially_staged' THEN
    RAISE EXCEPTION 'TEST 4: dispatches.stage=%, want partially_staged', v_row.stage;
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: a sectorizado sibling blocks the seal (Fix 1)';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: recompute_dispatch_stage preserves `adopted` and spends no
-- recompute at all (mirrors stage-dispatch.test.ts's TS-side assertion,
-- proven here against the real function).
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_op       UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_user     UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000176';
  v_route    UUID := '22221005-0000-0000-0000-000000000076';
  v_order    UUID := 'e1760030-0000-0000-0000-000000000076';
  v_dispatch UUID := 'd1600030-0000-0000-0000-000000000076';
  v_result   text;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-030', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T76-30', 'Cliente', '+56900000000', 'Calle 1', 'TestComuna',
    '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, status, stage, staged_at, adopted_reason)
  VALUES (v_dispatch, v_op, v_route, v_order, 'dispatchtrack', 'pending', 'adopted', now(), 'test fixture');

  -- An outstanding sibling that WOULD flip a planned/partially_staged row —
  -- proves adopted is preserved regardless, no recompute spent deciding.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, loaded_at)
  VALUES ('f1760030-0000-0000-0000-000000000076', v_op, v_order, 'PKG-T76-30A', '{}'::jsonb,
    'sectorizado', NULL);

  v_result := public.recompute_dispatch_stage(v_dispatch, v_op, v_order, v_user);

  IF v_result <> 'adopted' THEN
    RAISE EXCEPTION 'TEST 5: recompute_dispatch_stage returned %, want adopted (must never be rewritten)', v_result;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: recompute_dispatch_stage preserves adopted';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6 (review Fix 8): sum-of-parts invariant. Every dispatch on a route
-- lands in exactly one of route_stop_counts' four stage buckets, so they
-- must sum to total_stops.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_route UUID := '22221006-0000-0000-0000-000000000076';
  r RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-040', CURRENT_DATE, 'loading');

  INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
  VALUES
    ('d1600041-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'planned', NULL),
    ('d1600042-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'planned', NULL),
    ('d1600043-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'partially_staged', NOW()),
    ('d1600044-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'staged', NOW()),
    ('d1600045-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'staged', NOW()),
    ('d1600046-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'adopted', NOW());

  SELECT * INTO r FROM public.route_stop_counts WHERE route_id = v_route;

  IF r.total_stops <> (r.pending_stops + r.partially_staged_stops + r.staged_stops + r.adopted_stops) THEN
    RAISE EXCEPTION 'TEST 6: sum-of-parts broken — total=%, pending=%, partially_staged=%, staged=%, adopted=%',
      r.total_stops, r.pending_stops, r.partially_staged_stops, r.staged_stops, r.adopted_stops;
  END IF;
  IF r.total_stops <> 6 THEN
    RAISE EXCEPTION 'TEST 6: total_stops=%, want 6', r.total_stops;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: pending + partially_staged + staged + adopted = total_stops';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 (review Fix 8): operator isolation. A second operator's dispatches
-- on their own route must never leak into the first operator's counts.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_op1    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_op2    UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000076';
  v_route1 UUID := '22221007-0000-0000-0000-000000000076';
  v_route2 UUID := '22221008-0000-0000-0000-000000000076';
  r1 RECORD;
  r2 RECORD;
BEGIN
  INSERT INTO public.operators (id, name, slug, country_code)
  VALUES (v_op2, 'Test Op 76-B', 'test-op-76-b', 'CL')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES
    (v_route1, v_op1, 'dispatchtrack', 'R-76-050', CURRENT_DATE, 'loading'),
    (v_route2, v_op2, 'dispatchtrack', 'R-76-051', CURRENT_DATE, 'loading');

  INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at)
  VALUES
    ('d1600051-0000-0000-0000-000000000076', v_op1, v_route1, 'dispatchtrack', 'partially_staged', NOW()),
    ('d1600052-0000-0000-0000-000000000076', v_op2, v_route2, 'dispatchtrack', 'partially_staged', NOW()),
    ('d1600053-0000-0000-0000-000000000076', v_op2, v_route2, 'dispatchtrack', 'partially_staged', NOW());

  SELECT * INTO r1 FROM public.route_stop_counts WHERE route_id = v_route1 AND operator_id = v_op1;
  SELECT * INTO r2 FROM public.route_stop_counts WHERE route_id = v_route2 AND operator_id = v_op2;

  IF r1.partially_staged_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 7: operator 1 partially_staged_stops=%, want 1 (must not include operator 2''s rows)', r1.partially_staged_stops;
  END IF;
  IF r2.partially_staged_stops <> 2 THEN
    RAISE EXCEPTION 'TEST 7: operator 2 partially_staged_stops=%, want 2', r2.partially_staged_stops;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: partially_staged_stops is operator-isolated';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (review Fix 8): soft-delete behaviour. A soft-deleted
-- partially_staged dispatch must not be counted in ANY bucket.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_route UUID := '22221009-0000-0000-0000-000000000076';
  r RECORD;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-060', CURRENT_DATE, 'loading');

  INSERT INTO public.dispatches (id, operator_id, route_id, provider, stage, staged_at, deleted_at)
  VALUES
    ('d1600061-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'staged', NOW(), NULL),
    ('d1600062-0000-0000-0000-000000000076', v_op, v_route, 'dispatchtrack', 'partially_staged', NOW(), NOW());

  SELECT * INTO r FROM public.route_stop_counts WHERE route_id = v_route;

  IF r.total_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 8: total_stops=%, want 1 (the soft-deleted row must not count)', r.total_stops;
  END IF;
  IF r.partially_staged_stops <> 0 THEN
    RAISE EXCEPTION 'TEST 8: partially_staged_stops=%, want 0 (soft-deleted, must not leak into any bucket)', r.partially_staged_stops;
  END IF;
  IF r.staged_stops <> 1 THEN
    RAISE EXCEPTION 'TEST 8: staged_stops=%, want 1', r.staged_stops;
  END IF;

  RAISE NOTICE '✓ TEST 8 PASSED: a soft-deleted dispatch is excluded from every bucket';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 (review Fix 4): expand_carton refuses to mint a new sibling once
-- the order already has real dispatch progress (stage <> 'planned').
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_op       UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000076';
  v_user     UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000176';
  v_route    UUID := '22221010-0000-0000-0000-000000000076';
  v_order    UUID := 'e1760040-0000-0000-0000-000000000076';
  v_parent   UUID := 'f1760040-0000-0000-0000-000000000076';
  v_raised   BOOLEAN := FALSE;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'operator_id', v_op::text)::text, true);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-76-070', CURRENT_DATE, 'loading');

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T76-40', 'Cliente', '+56900000000', 'Calle 1', 'TestComuna',
    '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now());

  INSERT INTO public.dispatches (id, operator_id, route_id, order_id, provider, status, stage, staged_at)
  VALUES ('d1600070-0000-0000-0000-000000000076', v_op, v_route, v_order, 'dispatchtrack', 'pending', 'staged', now());

  -- The root carton is still ingresado (never received) even though the
  -- order's dispatch already shows real scan progress — plausible: this is
  -- a DIFFERENT bulto of the same order from whichever one was scanned.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, is_generated_label)
  VALUES (v_parent, v_op, v_order, 'CTN-T76-40', '{}'::jsonb, 'ingresado', FALSE);

  BEGIN
    PERFORM public.expand_carton(v_parent, 1, 'test: should be refused');
  EXCEPTION WHEN OTHERS THEN
    v_raised := TRUE;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST 9: expand_carton did not refuse a carton for an order already staged';
  END IF;

  RESET request.jwt.claims;

  RAISE NOTICE '✓ TEST 9 PASSED: expand_carton refuses once the order has real dispatch progress (Fix 4)';
END $$;

ROLLBACK TO test_9;

ROLLBACK;
