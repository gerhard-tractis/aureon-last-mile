-- =============================================================================
-- spec-77 fix — retorno_hub blocker: a package that failed delivery, came
-- back, and was re-received/re-dock-scanned must not carry a stale
-- `loaded_at` fact that hides it from Pre-Ruta forever.
--
-- 20260908000001's `ready_pkgs` predicate (`NOT (loaded_at IS NOT NULL AND
-- load_inferred = false)`) is correct in isolation, but nothing on the
-- return path ever cleared `loaded_at`/`loaded_by`/`load_inferred` — only
-- the two "remove from plan" endpoints did. A box that travelled on a route
-- that later `completed`, failed delivery, and was re-dock-scanned back to
-- `sectorizado` keeps its original `loaded_at` from the completed route,
-- and the new predicate excludes it — permanently, because nothing ever
-- clears it. This reproduces the reviewer's fixture directly against the
-- live `get_pre_route_snapshot` body.
--
-- Run against a local Supabase instance:
--   npx supabase test db   (from packages/database/)
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'Test Op 78-A', 'test-op-78-a', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chile_comunas (id, codigo_cut, nombre, provincia, region, region_num)
VALUES ('cccc0001-0000-0000-0000-000000000078', '99978', 'TestComuna 78', 'Test Prov', 'Test Region', 99)
ON CONFLICT (codigo_cut) DO NOTHING;

INSERT INTO public.dock_zones (id, operator_id, name, code, is_consolidation, is_active)
VALUES ('dddd0001-0000-0000-0000-000000000078', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'Andén 78', 'A78', false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dock_zone_comunas (dock_zone_id, comuna_id)
VALUES ('dddd0001-0000-0000-0000-000000000078', 'cccc0001-0000-0000-0000-000000000078')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- TEST 1: the reviewer's exact fixture (completed route, dispatch
-- stage='staged'/status='failed', package sectorizado with
-- loaded_at = now() - 1 day, load_inferred = false), reached by driving the
-- REAL return path end to end — process_failed_delivery, then
-- complete_return_reception_scan, then a real dock-scan trigger firing —
-- rather than hand-seeding the terminal row. Before the fix this leaves a
-- stale loaded_at on the re-dock-scanned package and get_pre_route_snapshot
-- hides the order forever; after the fix, complete_return_reception_scan
-- clears the fact so the trigger's later sectorizado write carries no
-- stale loaded_at, and the order surfaces (spec-43's re-route flow).
-- =============================================================================
SAVEPOINT test_1;

DO $$
DECLARE
  v_route_id     uuid := '11110001-0000-0000-0000-000000000078';
  v_order_id     uuid := 'eeee0001-0000-0000-0000-000000000078';
  v_package_id   uuid := 'ffff0001-0000-0000-0000-000000000078';
  v_reception_id uuid := '22220001-0000-0000-0000-000000000078';
  v_batch_id     uuid := '44440001-0000-0000-0000-000000000078';
  v_user_id      uuid := '33330001-0000-0000-0000-000000000078';
  v_result       jsonb;
  v_failed       jsonb;
  v_received     jsonb;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token
  ) VALUES
    (v_user_id,
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'crew78b@example.com', crypt('x', gen_salt('bf')), NOW(),
     '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000078"}'::jsonb,
     '{"full_name":"Crew 78b"}'::jsonb, NOW(), NOW(), '', '')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, operator_id, email, full_name, permissions)
  VALUES (v_user_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'crew78b@example.com', 'Crew 78b', ARRAY['admin'])
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES (v_order_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078',
    'T78-ORD-001', 'Cliente 1', '+56900000001', 'Calle 78 #1', 'TestComuna 78',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000078');

  -- Went out on a route that later completed. loaded_at/load_inferred are
  -- the fact the original loading pass wrote; nothing has cleared them yet.
  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status,
    loaded_at, load_inferred)
  VALUES (v_package_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078',
    v_order_id, 'PKG-T78-001', '{}'::jsonb, 'en_ruta', NOW() - INTERVAL '1 day', false);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, raw_data, status)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'dispatchtrack', 'T78-ROUTE-001',
    CURRENT_DATE, '{}'::jsonb, 'completed');

  INSERT INTO public.dispatches (id, operator_id, order_id, route_id, provider, raw_data, status, stage, staged_at)
  VALUES ('d7800001-0000-0000-0000-000000000078', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078',
    v_order_id, v_route_id, 'dispatchtrack', '{}'::jsonb, 'failed', 'staged', NOW() - INTERVAL '1 day');

  -- 1. DT reports the failed delivery.
  SELECT public.process_failed_delivery(
    'T78-ORD-001', 3, 'no_answer', 'NA', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078'::uuid
  ) INTO v_failed;
  IF (v_failed->>'returning_count')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 1 setup: process_failed_delivery did not move the package — result: %', v_failed;
  END IF;

  -- 2. Reception hub receives it back.
  INSERT INTO public.return_receptions (id, operator_id, external_route_id, status)
  VALUES (v_reception_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'T78-ROUTE-001', 'in_progress');

  SELECT public.complete_return_reception_scan(
    v_package_id, v_reception_id, v_user_id, 'PKG-T78-001',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000078'::uuid
  ) INTO v_received;
  IF (v_received->>'remaining')::int <> 0 THEN
    RAISE EXCEPTION 'TEST 1 setup: complete_return_reception_scan did not clear the return — result: %', v_received;
  END IF;

  -- 3. Dock-scan trigger fires for real, advancing en_bodega -> sectorizado.
  INSERT INTO public.dock_batches (id, operator_id, dock_zone_id, status, created_by)
  VALUES (v_batch_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078',
    'dddd0001-0000-0000-0000-000000000078', 'open', v_user_id);

  INSERT INTO public.dock_scans (id, operator_id, batch_id, package_id, barcode, scan_result, scanned_by)
  VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', v_batch_id, v_package_id,
    'PKG-T78-001', 'accepted', v_user_id);

  -- Sanity: the trigger really did advance the package, same state the
  -- reviewer's fixture describes (sectorizado + stale loaded_at, pre-fix).
  PERFORM 1 FROM public.packages
  WHERE id = v_package_id AND status = 'sectorizado' AND dock_zone_id = 'dddd0001-0000-0000-0000-000000000078';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 1 setup: dock-scan trigger did not advance the package to sectorizado';
  END IF;

  SELECT public.get_pre_route_snapshot(
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000078'::uuid,
    CURRENT_DATE
  ) INTO v_result;

  IF (v_result->'totals'->>'order_count')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 1: order_count=%, want 1 (a re-received, re-dock-scanned retorno_hub package must not be hidden by a stale loaded_at) — result: %',
      (v_result->'totals'->>'order_count')::int, v_result;
  END IF;

  RAISE NOTICE '✓ TEST 1 PASSED: a re-dock-scanned retorno_hub package surfaces in Pre-Ruta';
END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2: complete_return_reception_scan clears loaded_at/loaded_by/
-- load_inferred on the package it moves back to en_bodega.
-- =============================================================================
SAVEPOINT test_2;

DO $$
DECLARE
  v_order_id     uuid := 'eeee0002-0000-0000-0000-000000000078';
  v_route_id     uuid := '11110002-0000-0000-0000-000000000078';
  v_reception_id uuid := '22220001-0000-0000-0000-000000000078';
  v_user_id      uuid := '33330001-0000-0000-0000-000000000078';
  v_result       jsonb;
  v_loaded_at    timestamptz;
  v_loaded_by    uuid;
  v_inferred     boolean;
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token
  ) VALUES
    (v_user_id,
     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'crew78@example.com', crypt('x', gen_salt('bf')), NOW(),
     '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000078"}'::jsonb,
     '{"full_name":"Crew 78"}'::jsonb, NOW(), NOW(), '', '')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, operator_id, email, full_name, permissions)
  VALUES (v_user_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'crew78@example.com', 'Crew 78', ARRAY['admin'])
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
    delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at, comuna_id)
  VALUES (v_order_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078',
    'T78-ORD-002', 'Cliente 2', '+56900000002', 'Calle 78 #2', 'TestComuna 78',
    CURRENT_DATE, '{}'::jsonb, 'MANUAL', now(), 'cccc0001-0000-0000-0000-000000000078');

  INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status,
    loaded_at, loaded_by, load_inferred)
  VALUES ('ffff0002-0000-0000-0000-000000000078', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078',
    v_order_id, 'PKG-T78-002', '{}'::jsonb, 'retorno_hub',
    NOW() - INTERVAL '1 day', v_user_id, false);

  INSERT INTO public.routes (id, operator_id, provider, external_route_id, route_date, raw_data, status)
  VALUES (v_route_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'dispatchtrack', 'T78-ROUTE-002',
    CURRENT_DATE, '{}'::jsonb, 'completed');

  INSERT INTO public.return_receptions (id, operator_id, external_route_id, status)
  VALUES (v_reception_id, 'aaaaaaaa-aaaa-aaaa-aaaa-000000000078', 'T78-ROUTE-002', 'in_progress');

  SELECT public.complete_return_reception_scan(
    'ffff0002-0000-0000-0000-000000000078'::uuid,
    v_reception_id,
    v_user_id,
    'PKG-T78-002',
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000078'::uuid
  ) INTO v_result;

  SELECT loaded_at, loaded_by, load_inferred
  INTO v_loaded_at, v_loaded_by, v_inferred
  FROM public.packages
  WHERE id = 'ffff0002-0000-0000-0000-000000000078';

  IF v_loaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 2: loaded_at=%, want NULL (a box coming back must not carry a stale load fact)', v_loaded_at;
  ELSIF v_loaded_by IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 2: loaded_by=%, want NULL', v_loaded_by;
  ELSIF v_inferred IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST 2: load_inferred=%, want false', v_inferred;
  END IF;

  RAISE NOTICE '✓ TEST 2 PASSED: complete_return_reception_scan clears the load fact';
END $$;

ROLLBACK TO test_2;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec-77 retorno_hub load-fact tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
