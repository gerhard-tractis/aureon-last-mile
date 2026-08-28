-- =============================================================================
-- spec-71 phase 5 — get_move_task_snapshot.
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec71_move_task_snapshot.test.sql
--
-- House style, matching spec71_load_position_assignment.test.sql /
-- pre_route_snapshot.test.sql: fixtures inside one transaction, SAVEPOINT
-- per test, each test a DO block that RAISEs on failure, ROLLBACK TO the
-- savepoint so later tests are unaffected by an earlier failure, final
-- ROLLBACK leaves the DB clean.
-- =============================================================================

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_move_task_snapshot'
  ) THEN
    RAISE EXCEPTION 'get_move_task_snapshot function missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 1 user, dock zones, load positions ─────────────
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'Test Op 75-A', 'test-op-75-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000075', 'Test Op 75-B', 'test-op-75-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000175',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec75.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000075"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000175','aaaaaaaa-aaaa-aaaa-aaaa-000000000075','user-a@spec75.test','User A',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

SELECT set_config('request.jwt.claims', '{}', true);

-- Andenes: AN75-1 (fronted by POS-75-1 -> conflict source), AN75-2 (plain),
-- AN75-3 (soft-deleted mid-fixture, in TEST 4, to prove a retired andén
-- neither vanishes its group nor crashes the join).
INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
VALUES
  ('44440101-0000-0000-0000-000000000075', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'Andén 75-1', 'AN75-1', true),
  ('44440102-0000-0000-0000-000000000075', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'Andén 75-2', 'AN75-2', true),
  ('44440103-0000-0000-0000-000000000075', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'Andén 75-3', 'AN75-3', true)
ON CONFLICT (id) DO NOTHING;

-- Positions: POS-75-1 fronts AN75-1 (the conflict source); POS-75-2 and
-- POS-75-3 front nothing.
INSERT INTO public.load_positions (id, operator_id, code, label, fronts_dock_zone_id)
VALUES
  ('11120001-0000-0000-0000-000000000075', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'POS-75-1', 'Zona 1', '44440101-0000-0000-0000-000000000075'),
  ('11120002-0000-0000-0000-000000000075', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'POS-75-2', 'Zona 2', NULL),
  ('11120003-0000-0000-0000-000000000075', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075', 'POS-75-3', 'Zona 3', NULL)
ON CONFLICT (id) DO NOTHING;

-- Small helper: one order + one package, inline, reused by every test below.
CREATE OR REPLACE FUNCTION pg_temp.mk_order_pkg(
  p_order_id uuid, p_pkg_id uuid, p_operator uuid, p_num text,
  p_dock_zone uuid, p_pkg_status package_status_enum
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (p_order_id, p_operator, p_num, 'Cliente', '+56900000000', 'Calle 1', 'TestComuna',
    '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES (p_pkg_id, p_operator, p_order_id, 'PKG-' || p_num, '{}'::jsonb, p_pkg_status, p_dock_zone)
  ON CONFLICT (id) DO NOTHING;
END;
$fn$;

-- =============================================================================
-- TEST 1: a positioned route with remaining packages groups them by andén
-- (Decision 7's point — short andén->position hops), correctly excludes
-- already-staged packages from the remaining count, and reports no
-- offset conflict.
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221001-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_route_json jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-001', CURRENT_DATE, 'planned',
    '11120002-0000-0000-0000-000000000075', now());

  -- pkg1: AN75-1, still planned.
  PERFORM pg_temp.mk_order_pkg('e1750001-0000-0000-0000-000000000075', 'f1750001-0000-0000-0000-000000000075',
    v_op, 'T75-1', '44440101-0000-0000-0000-000000000075', 'sectorizado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'e1750001-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'planned');

  -- pkg2: AN75-2, still planned.
  PERFORM pg_temp.mk_order_pkg('e1750002-0000-0000-0000-000000000075', 'f1750002-0000-0000-0000-000000000075',
    v_op, 'T75-2', '44440102-0000-0000-0000-000000000075', 'sectorizado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'e1750002-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'planned');

  -- pkg3: AN75-2, already staged AND actually moved (a real dock_scans row
  -- carrying load_position_id, matching what stageDispatch's caller writes
  -- transactionally) — must count into total but NOT remaining. Review item
  -- 1: remaining is now gated on this per-package fact, not on
  -- dispatches.stage alone, so this fixture has to carry it explicitly to
  -- keep meaning what it always meant.
  PERFORM pg_temp.mk_order_pkg('e1750003-0000-0000-0000-000000000075', 'f1750003-0000-0000-0000-000000000075',
    v_op, 'T75-3', '44440102-0000-0000-0000-000000000075', 'en_carga');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage, staged_at)
  VALUES (v_route, 'e1750003-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'staged', now());
  INSERT INTO public.dock_scans (operator_id, package_id, barcode, scan_result, scanned_by, load_position_id)
  VALUES (v_op, 'f1750003-0000-0000-0000-000000000075', 'PKG-T75-3', 'accepted',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000175', '11120002-0000-0000-0000-000000000075');

  v_snapshot := public.get_move_task_snapshot(v_op);
  SELECT r INTO v_route_json
    FROM jsonb_array_elements(v_snapshot->'routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_route_json IS NULL THEN
    RAISE EXCEPTION 'route % missing from snapshot routes', v_route;
  END IF;
  IF (v_route_json->>'total_packages')::int <> 3 THEN
    RAISE EXCEPTION 'expected total_packages=3, got %', v_route_json->>'total_packages';
  END IF;
  IF (v_route_json->>'remaining_packages')::int <> 2 THEN
    RAISE EXCEPTION 'expected remaining_packages=2 (staged pkg3 excluded), got %', v_route_json->>'remaining_packages';
  END IF;
  IF (v_route_json->>'offset_conflict')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expected offset_conflict=false (POS-75-2 fronts nothing), got %', v_route_json->>'offset_conflict';
  END IF;
  IF jsonb_array_length(v_route_json->'groups') <> 2 THEN
    RAISE EXCEPTION 'expected 2 andén groups (AN75-1, AN75-2), got %', jsonb_array_length(v_route_json->'groups');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_route_json->'groups') g
     WHERE g->>'dock_zone_code' = 'AN75-1' AND (g->>'remaining_count')::int = 1
  ) THEN
    RAISE EXCEPTION 'AN75-1 group missing or wrong count: %', v_route_json->'groups';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_route_json->'groups') g
     WHERE g->>'dock_zone_code' = 'AN75-2' AND (g->>'remaining_count')::int = 1
  ) THEN
    RAISE EXCEPTION 'AN75-2 group missing or wrong count (staged pkg3 must not inflate it): %', v_route_json->'groups';
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: remaining packages grouped by andén, staged packages excluded from the count';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: a route whose position now fronts an andén it still sources a
-- package from is surfaced with offset_conflict=true, EVEN when nothing is
-- left to stage — Decision 7's "must be visible so someone can reassign it".
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221002-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_route_json jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-002', CURRENT_DATE, 'planned',
    '11120001-0000-0000-0000-000000000075', now());

  -- Fully staged AND actually moved (dock_scans row), but the package still
  -- sits on AN75-1 — the andén POS-75-1 fronts. dock_zone_id is not cleared
  -- by staging (only dispatches.stage moves), so this is a genuine,
  -- currently-invisible conflict.
  PERFORM pg_temp.mk_order_pkg('e1750004-0000-0000-0000-000000000075', 'f1750004-0000-0000-0000-000000000075',
    v_op, 'T75-4', '44440101-0000-0000-0000-000000000075', 'en_carga');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage, staged_at)
  VALUES (v_route, 'e1750004-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'staged', now());
  INSERT INTO public.dock_scans (operator_id, package_id, barcode, scan_result, scanned_by, load_position_id)
  VALUES (v_op, 'f1750004-0000-0000-0000-000000000075', 'PKG-T75-4', 'accepted',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000175', '11120001-0000-0000-0000-000000000075');

  v_snapshot := public.get_move_task_snapshot(v_op);
  SELECT r INTO v_route_json
    FROM jsonb_array_elements(v_snapshot->'routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_route_json IS NULL THEN
    RAISE EXCEPTION 'conflicting route % missing from snapshot even though remaining_packages=0', v_route;
  END IF;
  IF (v_route_json->>'remaining_packages')::int <> 0 THEN
    RAISE EXCEPTION 'expected remaining_packages=0, got %', v_route_json->>'remaining_packages';
  END IF;
  IF (v_route_json->>'offset_conflict')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expected offset_conflict=true (POS-75-1 fronts AN75-1, route still sources from it), got %', v_route_json->>'offset_conflict';
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: offset conflict surfaces the route even with nothing left to stage';
END $$;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3: a fully-staged, non-conflicting positioned route is NOT in the
-- move-task list — nothing left to do, no reason to show it.
-- =============================================================================
SAVEPOINT test_3;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221003-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_found boolean;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-003', CURRENT_DATE, 'planned',
    '11120003-0000-0000-0000-000000000075', now());

  PERFORM pg_temp.mk_order_pkg('e1750005-0000-0000-0000-000000000075', 'f1750005-0000-0000-0000-000000000075',
    v_op, 'T75-5', '44440102-0000-0000-0000-000000000075', 'en_carga');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage, staged_at)
  VALUES (v_route, 'e1750005-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'staged', now());
  INSERT INTO public.dock_scans (operator_id, package_id, barcode, scan_result, scanned_by, load_position_id)
  VALUES (v_op, 'f1750005-0000-0000-0000-000000000075', 'PKG-T75-5', 'accepted',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000175', '11120003-0000-0000-0000-000000000075');

  v_snapshot := public.get_move_task_snapshot(v_op);
  v_found := EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_snapshot->'routes') r WHERE r->>'route_id' = v_route::text
  );

  IF v_found THEN
    RAISE EXCEPTION 'fully-staged, non-conflicting route % should not appear in the move-task list', v_route;
  END IF;

  RAISE NOTICE '✓ TEST 3 PASSED: a fully-staged, non-conflicting route is excluded from the list';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4: a route with no position assigned (Decision 8 best-effort miss)
-- appears in unassigned_routes, blocked, instead of silently vanishing.
-- =============================================================================
SAVEPOINT test_4;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221004-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_row jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-004', CURRENT_DATE, 'planned');

  PERFORM pg_temp.mk_order_pkg('e1750006-0000-0000-0000-000000000075', 'f1750006-0000-0000-0000-000000000075',
    v_op, 'T75-6', '44440101-0000-0000-0000-000000000075', 'sectorizado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'e1750006-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'planned');

  v_snapshot := public.get_move_task_snapshot(v_op);

  -- Must NOT be in `routes` (it has no load_position_id to key a group on).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot->'routes') r WHERE r->>'route_id' = v_route::text) THEN
    RAISE EXCEPTION 'unassigned route % must not appear in routes[]', v_route;
  END IF;

  SELECT r INTO v_row FROM jsonb_array_elements(v_snapshot->'unassigned_routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'unassigned route % missing from unassigned_routes', v_route;
  END IF;
  IF (v_row->>'total_packages')::int <> 1 THEN
    RAISE EXCEPTION 'expected total_packages=1, got %', v_row->>'total_packages';
  END IF;

  RAISE NOTICE '✓ TEST 4 PASSED: a position-less route is surfaced as blocked in unassigned_routes';
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5: a package sectorized onto a since-soft-deleted andén neither
-- vanishes its group nor crashes the join (Decision 7's consumer contract).
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221005-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_route_json jsonb;
  v_group jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-005', CURRENT_DATE, 'planned',
    '11120002-0000-0000-0000-000000000075', now());

  PERFORM pg_temp.mk_order_pkg('e1750007-0000-0000-0000-000000000075', 'f1750007-0000-0000-0000-000000000075',
    v_op, 'T75-7', '44440103-0000-0000-0000-000000000075', 'sectorizado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'e1750007-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'planned');

  UPDATE public.dock_zones SET deleted_at = now() WHERE id = '44440103-0000-0000-0000-000000000075';

  v_snapshot := public.get_move_task_snapshot(v_op);
  SELECT r INTO v_route_json
    FROM jsonb_array_elements(v_snapshot->'routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_route_json IS NULL THEN
    RAISE EXCEPTION 'route % missing (a retired andén must not vanish the whole route)', v_route;
  END IF;
  IF jsonb_array_length(v_route_json->'groups') <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 group (the retired andén, not vanished), got %', v_route_json->'groups';
  END IF;

  v_group := (v_route_json->'groups')->0;
  IF (v_group->>'is_retired')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expected is_retired=true, got %', v_group;
  END IF;
  IF v_group->>'dock_zone_code' IS NOT NULL THEN
    RAISE EXCEPTION 'expected dock_zone_code NULL for a retired andén, got %', v_group->>'dock_zone_code';
  END IF;
  IF (v_group->>'remaining_count')::int <> 1 THEN
    RAISE EXCEPTION 'expected remaining_count=1, got %', v_group->>'remaining_count';
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: a retired andén stays visible as its own group instead of vanishing or crashing';
END $$;

ROLLBACK TO test_5;

-- =============================================================================
-- TEST 6: operator B's positioned route with remaining packages never
-- appears in operator A's snapshot. This runs as the superuser role
-- (pgtap-local.sh), which bypasses RLS entirely — so this proves the
-- function's own `p_operator_id` predicate filters cross-tenant rows, not
-- that RLS holds for an authenticated non-superuser caller. Labelled
-- honestly per review item 8, matching how the phase-3 cross-tenant test
-- (`ROUTE_NOT_FOUND`-style assertions in spec71_load_position_assignment
-- .test.sql) names the actual mechanism it exercises rather than claiming
-- "RLS isolation".
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE
  v_op_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_op_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-000000000075';
  v_route_b UUID := '22229001-0000-0000-0000-000000000075';
  v_snapshot_a jsonb;
BEGIN
  INSERT INTO public.dock_zones (id, operator_id, name, code, is_active)
  VALUES ('44449101-0000-0000-0000-000000000075', v_op_b, 'Andén 75-B1', 'AN75-B1', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.load_positions (id, operator_id, code, label, fronts_dock_zone_id)
  VALUES ('11129001-0000-0000-0000-000000000075', v_op_b, 'POS-75-B1', 'Zona B1', NULL)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route_b, v_op_b, 'dispatchtrack', 'R-75-B001', CURRENT_DATE, 'planned',
    '11129001-0000-0000-0000-000000000075', now());

  PERFORM pg_temp.mk_order_pkg('e1759001-0000-0000-0000-000000000075', 'f1759001-0000-0000-0000-000000000075',
    v_op_b, 'T75-B1', '44449101-0000-0000-0000-000000000075', 'sectorizado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route_b, 'e1759001-0000-0000-0000-000000000075', v_op_b, 'pending', 'dispatchtrack', 'planned');

  v_snapshot_a := public.get_move_task_snapshot(v_op_a);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot_a->'routes') r WHERE r->>'route_id' = v_route_b::text) THEN
    RAISE EXCEPTION 'operator B route % leaked into operator A snapshot', v_route_b;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: the p_operator_id predicate filters out operator B''s route (not a proof RLS holds — see header note above)';
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 7 (review item 1 reproduction) — a 3-bulto order on the andén: scan
-- ONE bulto to its position, and the route MUST stay on the list with
-- remaining_count: 2. Before the fix, dispatches.stage flipped to 'staged'
-- for the whole order on the first package scan, so the other two bultos
-- (still sitting on the andén, unscanned) silently vanished from the count
-- and the route could drop off the list entirely with real work left.
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221007-0000-0000-0000-000000000075';
  v_order UUID := 'e1750010-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_route_json jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-007', CURRENT_DATE, 'planned',
    '11120002-0000-0000-0000-000000000075', now());

  -- One order, three packages (bultos), all on AN75-1.
  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
  VALUES (v_order, v_op, 'T75-10', 'Cliente', '+56900000000', 'Calle 1', 'TestComuna',
    '2099-01-01'::date, '{}'::jsonb, 'MANUAL', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status, dock_zone_id)
  VALUES
    ('f1750010-0000-0000-0000-000000000075', v_op, v_order, 'PKG-T75-10-A', '{}'::jsonb, 'en_carga', '44440101-0000-0000-0000-000000000075'),
    ('f1750011-0000-0000-0000-000000000075', v_op, v_order, 'PKG-T75-10-B', '{}'::jsonb, 'sectorizado', '44440101-0000-0000-0000-000000000075'),
    ('f1750012-0000-0000-0000-000000000075', v_op, v_order, 'PKG-T75-10-C', '{}'::jsonb, 'sectorizado', '44440101-0000-0000-0000-000000000075')
  ON CONFLICT (id) DO NOTHING;

  -- One dispatch row per order (not per package) — the ORDER's dispatch
  -- already flips to 'staged' on the first package scanned, exactly what
  -- stageDispatch (lib/dispatch/stage-dispatch.ts) does.
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage, staged_at)
  VALUES (v_route, v_order, v_op, 'pending', 'dispatchtrack', 'staged', now());

  -- Only bulto A was actually scanned to the position.
  INSERT INTO public.dock_scans (operator_id, package_id, barcode, scan_result, scanned_by, load_position_id)
  VALUES (v_op, 'f1750010-0000-0000-0000-000000000075', 'PKG-T75-10-A', 'accepted',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000175', '11120002-0000-0000-0000-000000000075');

  v_snapshot := public.get_move_task_snapshot(v_op);
  SELECT r INTO v_route_json
    FROM jsonb_array_elements(v_snapshot->'routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_route_json IS NULL THEN
    RAISE EXCEPTION 'TEST 7: route % dropped off the list even though 2 of 3 bultos are unmoved', v_route;
  END IF;
  IF (v_route_json->>'total_packages')::int <> 3 THEN
    RAISE EXCEPTION 'TEST 7: expected total_packages=3, got %', v_route_json->>'total_packages';
  END IF;
  IF (v_route_json->>'remaining_packages')::int <> 2 THEN
    RAISE EXCEPTION 'TEST 7: expected remaining_packages=2 (bultos B and C unmoved despite dispatch.stage=staged), got %', v_route_json->>'remaining_packages';
  END IF;

  -- Per-andén group counts must sum to the headline.
  IF (
    SELECT COALESCE(SUM((g->>'remaining_count')::int), 0)
      FROM jsonb_array_elements(v_route_json->'groups') g
  ) <> (v_route_json->>'remaining_packages')::int THEN
    RAISE EXCEPTION 'TEST 7: group counts (%) do not sum to remaining_packages (%)',
      v_route_json->'groups', v_route_json->>'remaining_packages';
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: a 3-bulto order with 1 bulto moved keeps the route at remaining_packages=2, not hidden';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (review item 3) — a route whose position release failed (best-effort,
-- routes/[id]/dispatch/route.ts:217-294) so it still holds load_position_id,
-- but whose status has moved past the active window (`dispatched`), must NOT
-- appear on the move-task list — there is no way to act on it from here, and
-- it would otherwise linger forever with a phantom conflict.
-- =============================================================================
SAVEPOINT test_8;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221008-0000-0000-0000-000000000075';
  v_snapshot jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-008', CURRENT_DATE, 'dispatched',
    '11120001-0000-0000-0000-000000000075', now());

  -- Still sources from AN75-1, which POS-75-1 fronts — would be a conflict
  -- if this route were still eligible at all.
  PERFORM pg_temp.mk_order_pkg('e1750013-0000-0000-0000-000000000075', 'f1750013-0000-0000-0000-000000000075',
    v_op, 'T75-13', '44440101-0000-0000-0000-000000000075', 'sectorizado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'e1750013-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'planned');

  v_snapshot := public.get_move_task_snapshot(v_op);

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_snapshot->'routes') r WHERE r->>'route_id' = v_route::text) THEN
    RAISE EXCEPTION 'TEST 8: dispatched route % with a failed position release must not appear on the move-task list', v_route;
  END IF;

  RAISE NOTICE '✓ TEST 8 PASSED: a route past the active status window is excluded even though it still holds a position';
END $$;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 (review item 7) — a package with dock_zone_id IS NULL ("Sin andén")
-- still renders as its own group (dock_zone_code/name NULL, is_retired
-- false — distinct from a retired andén), and the group counts still sum to
-- the headline. Pinning this so a future edit cannot silently drop it.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE
  v_op    UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000075';
  v_route UUID := '22221009-0000-0000-0000-000000000075';
  v_snapshot jsonb;
  v_route_json jsonb;
  v_group jsonb;
BEGIN
  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, status,
    load_position_id, load_position_assigned_at)
  VALUES (v_route, v_op, 'dispatchtrack', 'R-75-009', CURRENT_DATE, 'planned',
    '11120002-0000-0000-0000-000000000075', now());

  -- No dock_zone_id at all — never sectorized onto an andén.
  PERFORM pg_temp.mk_order_pkg('e1750014-0000-0000-0000-000000000075', 'f1750014-0000-0000-0000-000000000075',
    v_op, 'T75-14', NULL, 'ingresado');
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider, stage)
  VALUES (v_route, 'e1750014-0000-0000-0000-000000000075', v_op, 'pending', 'dispatchtrack', 'planned');

  v_snapshot := public.get_move_task_snapshot(v_op);
  SELECT r INTO v_route_json
    FROM jsonb_array_elements(v_snapshot->'routes') r
   WHERE r->>'route_id' = v_route::text;

  IF v_route_json IS NULL THEN
    RAISE EXCEPTION 'TEST 9: route % missing (a NULL dock_zone_id must not vanish the route)', v_route;
  END IF;
  IF jsonb_array_length(v_route_json->'groups') <> 1 THEN
    RAISE EXCEPTION 'TEST 9: expected exactly 1 group (Sin andén), got %', v_route_json->'groups';
  END IF;

  v_group := (v_route_json->'groups')->0;
  IF v_group->>'dock_zone_id' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 9: expected dock_zone_id NULL, got %', v_group->>'dock_zone_id';
  END IF;
  IF (v_group->>'is_retired')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST 9: expected is_retired=false for Sin andén (distinct from a retired andén), got %', v_group;
  END IF;
  IF (v_group->>'remaining_count')::int <> (v_route_json->>'remaining_packages')::int THEN
    RAISE EXCEPTION 'TEST 9: the single group''s count (%) must sum to remaining_packages (%)',
      v_group->>'remaining_count', v_route_json->>'remaining_packages';
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: a package with no andén at all renders as its own Sin andén group and still sums correctly';
END $$;

ROLLBACK TO test_9;

DROP FUNCTION IF EXISTS pg_temp.mk_order_pkg(uuid, uuid, uuid, text, uuid, package_status_enum);

ROLLBACK;
