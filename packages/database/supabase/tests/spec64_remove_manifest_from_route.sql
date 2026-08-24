-- spec-64 Task 1 — remove_manifest_from_route: take a carga off an open
-- pickup route while it has zero verified pickup scans.
--
-- The counterpart to add_manifest_to_route (20260625000001, authz fixed in
-- 20260822000001). Same authorisation shape on purpose: the route's own
-- driver_id, an ACTIVE pickup_route_crew member of THIS route, or an
-- operations_manager/admin/super_admin of the same operator. A bare
-- pickup_leader who is neither gets nothing, same as add.
--
-- RUNS AS `authenticated` VIA `SET LOCAL ROLE`, not as the owner — EXECUTE on
-- this function is granted to `authenticated` specifically, and the refusals
-- below must come from the function's own gates, not from a privilege the
-- test connection happens to lack. Template: spec61_cancel_route_authz.sql.
--
-- TWO OPERATORS, deliberately: with one, `operator_id = v_operator` in the
-- route lookup is unfalsifiable.
--
-- THE FIXTURE:
--   871 Driver Uno     leader + driver of route 1 (in_progress)
--   872 Crew Activa    pickup_route_crew, ACTIVE seat on route 1
--   873 Crew Otra Ruta pickup_route_crew, ACTIVE seat on route 2 (not route 1)
--   874 Crew Removida  pickup_route_crew on route 1, removed_at IS NOT NULL
--   875 Lider Extrano  pickup_leader, neither driver nor crew of route 1
--   876 Jefa Ops       operations_manager, neither driver nor crew of route 1
--   877 Driver Tres    leader + driver of route 3 (status = cancelled)
--   878 Driver Dos     leader + driver of route 2 (in_progress)
--   B879 Otro Operador operator B, unrelated to everything above
--
-- MANIFESTS on route 1 (in_progress) unless noted:
--   m1  zero scans                          -> removable; also the "call it
--                                               twice" case (2nd call hits
--                                               guard 6, not-on-this-route)
--   m2  one VERIFIED scan (real package)     -> refused, stays attached
--   m3  one NOT_FOUND scan (no package_id)   -> removable — the real QA case
--   m4  attached to route 3 (not in_progress)-> refused
--   m5  zero scans                          -> removed by ACTIVE CREW (872)
--   m6  zero scans                          -> refused by 873, 874, 875 in turn
--   m7  zero scans                          -> removed by operations_manager
BEGIN;

INSERT INTO public.operators (id, name, slug) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000870','Spec64 Remove Manifest','spec64-remove-manifest'),
  ('bbbbbbbb-0000-4000-b000-000000000870','Spec64 Remove Manifest Other','spec64-remove-manifest-other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000871','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-driver1@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Driver Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000872','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-crew-active@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Crew Activa"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000873','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-crew-other-route@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Crew Otra Ruta"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000874','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-crew-removed@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Crew Removida"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000875','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-leader-stranger@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Extrano"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000876','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-ops@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"operations_manager"}'::jsonb,
   '{"full_name":"Jefa Ops"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000877','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-driver3@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Driver Tres"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000878','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-driver2@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Driver Dos"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000879','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rm-otro-operador@spec64.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000870","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Otro Operador"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000871','aaaaaaaa-0000-4000-a000-000000000870','pickup_leader','rm-driver1@spec64.test','Driver Uno',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000872','aaaaaaaa-0000-4000-a000-000000000870','pickup_crew','rm-crew-active@spec64.test','Crew Activa',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000873','aaaaaaaa-0000-4000-a000-000000000870','pickup_crew','rm-crew-other-route@spec64.test','Crew Otra Ruta',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000874','aaaaaaaa-0000-4000-a000-000000000870','pickup_crew','rm-crew-removed@spec64.test','Crew Removida',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000875','aaaaaaaa-0000-4000-a000-000000000870','pickup_leader','rm-leader-stranger@spec64.test','Lider Extrano',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000876','aaaaaaaa-0000-4000-a000-000000000870','operations_manager','rm-ops@spec64.test','Jefa Ops',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000877','aaaaaaaa-0000-4000-a000-000000000870','pickup_leader','rm-driver3@spec64.test','Driver Tres',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000878','aaaaaaaa-0000-4000-a000-000000000870','pickup_leader','rm-driver2@spec64.test','Driver Dos',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000879','bbbbbbbb-0000-4000-b000-000000000870','pickup_leader','rm-otro-operador@spec64.test','Otro Operador',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000871','aaaaaaaa-0000-4000-a000-000000000870','VEH-64R-1', true),
  ('99999999-0000-4000-9000-000000000872','aaaaaaaa-0000-4000-a000-000000000870','VEH-64R-2', true),
  ('99999999-0000-4000-9000-000000000873','aaaaaaaa-0000-4000-a000-000000000870','VEH-64R-3', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, started_at) VALUES
  ('77777777-0000-4000-7000-000000000871','aaaaaaaa-0000-4000-a000-000000000870',
   'PR-64R-1','aaaaaaaa-0000-4000-a000-000000000871','99999999-0000-4000-9000-000000000871','in_progress', NOW() - INTERVAL '2 hours'),
  ('77777777-0000-4000-7000-000000000872','aaaaaaaa-0000-4000-a000-000000000870',
   'PR-64R-2','aaaaaaaa-0000-4000-a000-000000000878','99999999-0000-4000-9000-000000000872','in_progress', NOW() - INTERVAL '1 hour'),
  ('77777777-0000-4000-7000-000000000873','aaaaaaaa-0000-4000-a000-000000000870',
   'PR-64R-3','aaaaaaaa-0000-4000-a000-000000000877','99999999-0000-4000-9000-000000000873','cancelled', NOW() - INTERVAL '3 hours');

-- 872 rides route 1 (active). 873 rides route 2 (active, NOT route 1). 874
-- rode route 1 but was removed. uniq_pickup_route_crew_one_active_per_user
-- is why each active person appears on exactly one route.
INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by, removed_at) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000870','77777777-0000-4000-7000-000000000871',
   'aaaaaaaa-0000-4000-a000-000000000872','aaaaaaaa-0000-4000-a000-000000000871', NULL),
  ('aaaaaaaa-0000-4000-a000-000000000870','77777777-0000-4000-7000-000000000872',
   'aaaaaaaa-0000-4000-a000-000000000873','aaaaaaaa-0000-4000-a000-000000000878', NULL),
  ('aaaaaaaa-0000-4000-a000-000000000870','77777777-0000-4000-7000-000000000871',
   'aaaaaaaa-0000-4000-a000-000000000874','aaaaaaaa-0000-4000-a000-000000000871', NOW() - INTERVAL '30 minutes');

-- A real order + package so the VERIFIED scan on m2 has a real package_id.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at
) VALUES (
  'eeee0870-0000-4000-e000-000000000870','aaaaaaaa-0000-4000-a000-000000000870',
  'T870-ORD-001','Cliente 870','+56900000870',
  'Calle 870','TestComuna 870', CURRENT_DATE, '{}'::jsonb,'MANUAL', NOW()
);

INSERT INTO public.packages (id, operator_id, order_id, label, raw_data) VALUES
  ('bbbb0870-0000-4000-b000-000000000001','aaaaaaaa-0000-4000-a000-000000000870',
   'eeee0870-0000-4000-e000-000000000870','T870-ORD-001-CTN-1','{}'::jsonb);

-- Manifests, inserted directly (no order-driven trg_ensure_manifest_for_order
-- here — each has its own external_load_id so unique_manifest_per_operator
-- cannot collide).
INSERT INTO public.manifests (id, operator_id, external_load_id, status, pickup_route_id, reception_status, started_at) VALUES
  ('cccc0870-0000-4000-c000-000000000001','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M1','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours'),
  ('cccc0870-0000-4000-c000-000000000002','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M2','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours'),
  ('cccc0870-0000-4000-c000-000000000003','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M3','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours'),
  ('cccc0870-0000-4000-c000-000000000004','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M4','in_progress','77777777-0000-4000-7000-000000000873', NULL, NOW() - INTERVAL '3 hours'),
  ('cccc0870-0000-4000-c000-000000000005','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M5','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours'),
  ('cccc0870-0000-4000-c000-000000000006','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M6','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours'),
  ('cccc0870-0000-4000-c000-000000000007','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M7','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours');

-- m2: a VERIFIED scan — the manifest that must stay attached, refused.
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at) VALUES
  ('dddd0870-0000-4000-d000-000000000001','aaaaaaaa-0000-4000-a000-000000000870',
   'cccc0870-0000-4000-c000-000000000002','bbbb0870-0000-4000-b000-000000000001',
   'BC-64R-VERIFIED','verified','aaaaaaaa-0000-4000-a000-000000000871', NOW());

-- m3: only a NOT_FOUND scan (no package_id) — this is the real QA case: a
-- not_found scan advanced nothing and must NOT block removal.
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at) VALUES
  ('dddd0870-0000-4000-d000-000000000002','aaaaaaaa-0000-4000-a000-000000000870',
   'cccc0870-0000-4000-c000-000000000003', NULL,
   'BC-64R-NOTFOUND','not_found','aaaaaaaa-0000-4000-a000-000000000871', NOW());

-- A discrepancy note on m1 that must survive m1's removal (removal detaches
-- the manifest from the route; it must not touch scan/discrepancy history).
INSERT INTO public.discrepancy_notes (id, operator_id, manifest_id, package_id, note, created_by_user_id) VALUES
  ('ffff0870-0000-4000-f000-000000000001','aaaaaaaa-0000-4000-a000-000000000870',
   'cccc0870-0000-4000-c000-000000000001','bbbb0870-0000-4000-b000-000000000001',
   'Nota de discrepancia spec-64','aaaaaaaa-0000-4000-a000-000000000871');

-- ─── GUARD: the connection role bypasses RLS, so SET ROLE is mandatory ─────
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE slug IN ('spec64-remove-manifest','spec64-remove-manifest-other');
  IF c <> 2 THEN
    RAISE EXCEPTION
      'owner context saw % of 2 fixture operators — this file assumes the connection role bypasses RLS and therefore MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ── TEST 1: zero verified scans -> removal succeeds and clears the route ───
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.manifests;
BEGIN
  r := public.remove_manifest_from_route(
    '77777777-0000-4000-7000-000000000871'::uuid,
    'cccc0870-0000-4000-c000-000000000001'::uuid);
  IF r.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'pickup_route_id was not cleared, got %', r.pickup_route_id;
  END IF;
  IF r.reception_status IS NOT NULL THEN
    RAISE EXCEPTION 'reception_status was not cleared, got %', r.reception_status;
  END IF;
  IF r.started_at IS NOT NULL THEN
    RAISE EXCEPTION 'started_at was not cleared';
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'status should be pending, got %', r.status;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 2: calling it again hits guard 6 (not on this route) ──────────────
-- m1 is now detached; a second call by the same driver must not silently
-- succeed a second time — it is a caller bug, not a no-op.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0870-0000-4000-c000-000000000001'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'removing an already-detached manifest a second time must not silently succeed';
  END IF;
  IF msg NOT LIKE '%not%route%' THEN
    RAISE EXCEPTION 'expected the "not on this route" guard, got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 3: a manifest with one VERIFIED scan is refused and stays put ─────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0870-0000-4000-c000-000000000002'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a manifest with a verified scan must not be removable';
  END IF;
  IF msg NOT LIKE '%verified scans%' THEN
    RAISE EXCEPTION 'expected the verified-scan guard, got: %', msg;
  END IF;
END $$;
RESET ROLE;

DO $$
DECLARE rid UUID;
BEGIN
  SELECT pickup_route_id INTO rid FROM public.manifests
   WHERE id = 'cccc0870-0000-4000-c000-000000000002';
  IF rid IS DISTINCT FROM '77777777-0000-4000-7000-000000000871'::uuid THEN
    RAISE EXCEPTION 'm2 should still be attached to route 1, got %', rid;
  END IF;
END $$;

-- ── TEST 4: a manifest with only a NOT_FOUND scan IS removable ─────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.manifests;
BEGIN
  r := public.remove_manifest_from_route(
    '77777777-0000-4000-7000-000000000871'::uuid,
    'cccc0870-0000-4000-c000-000000000003'::uuid);
  IF r.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'm3 (not_found scan only) should have been removed';
  END IF;
END $$;
RESET ROLE;

DO $$
DECLARE c INT;
BEGIN
  SELECT COUNT(*) INTO c FROM public.pickup_scans
   WHERE id = 'dddd0870-0000-4000-d000-000000000002' AND deleted_at IS NULL;
  IF c <> 1 THEN
    RAISE EXCEPTION 'the not_found pickup_scan row must survive manifest removal';
  END IF;
END $$;

-- ── TEST 5: refused when the route is not in_progress ──────────────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000877","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000873'::uuid,
      'cccc0870-0000-4000-c000-000000000004'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a route that is not in_progress must refuse removal';
  END IF;
  IF msg NOT LIKE '%in_progress%' THEN
    RAISE EXCEPTION 'expected the not-in_progress guard, got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 6: an ACTIVE crew member of the route CAN remove — the decision ───
-- this spec turns on.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000872","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.manifests;
BEGIN
  r := public.remove_manifest_from_route(
    '77777777-0000-4000-7000-000000000871'::uuid,
    'cccc0870-0000-4000-c000-000000000005'::uuid);
  IF r.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'an active crew member of this route must be able to remove a manifest';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 7: a crew member seated on a DIFFERENT route is refused ───────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000873","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0870-0000-4000-c000-000000000006'::uuid);
    RAISE EXCEPTION 'a crew member of a DIFFERENT route must not be able to remove from this one';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE '%Solo la tripulación de esta ruta puede quitarle cargas.%' THEN
    RAISE EXCEPTION 'refusal message is not the Spanish one the UI shows: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 8: a crew member whose removed_at IS SET is refused ───────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000874","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0870-0000-4000-c000-000000000006'::uuid);
    RAISE EXCEPTION 'a REMOVED crew member must not be able to remove a manifest';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE '%Solo la tripulación de esta ruta puede quitarle cargas.%' THEN
    RAISE EXCEPTION 'refusal message unexpected: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 9: a bare pickup_leader who is neither driver nor crew is refused ─
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000875","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := '';
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0870-0000-4000-c000-000000000006'::uuid);
    RAISE EXCEPTION 'a pickup_leader with no seat on this route must not be able to remove a manifest';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE '%Solo la tripulación de esta ruta puede quitarle cargas.%' THEN
    RAISE EXCEPTION 'refusal message unexpected: %', msg;
  END IF;
END $$;
RESET ROLE;

DO $$
DECLARE rid UUID;
BEGIN
  SELECT pickup_route_id INTO rid FROM public.manifests
   WHERE id = 'cccc0870-0000-4000-c000-000000000006';
  IF rid IS DISTINCT FROM '77777777-0000-4000-7000-000000000871'::uuid THEN
    RAISE EXCEPTION 'm6 must still be attached to route 1 after three refused attempts, got %', rid;
  END IF;
END $$;

-- ── TEST 10: an operations_manager who is neither driver nor crew CAN ──────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000876","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.manifests;
BEGIN
  r := public.remove_manifest_from_route(
    '77777777-0000-4000-7000-000000000871'::uuid,
    'cccc0870-0000-4000-c000-000000000007'::uuid);
  IF r.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'an operations_manager must be able to remove a manifest from any route in the operator';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 11: cross-tenant is refused by the route lookup, BEFORE the role ──
-- check -- so the message must be the English "not found", not the Spanish
-- authorisation sentence. Otro Operador (operator B) reaches for route 1
-- (operator A).
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-b000-000000000879","operator_id":"bbbbbbbb-0000-4000-b000-000000000870","claims":{"operator_id":"bbbbbbbb-0000-4000-b000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0870-0000-4000-c000-000000000007'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a caller from another operator must not be able to reach this route at all';
  END IF;
  IF msg NOT LIKE '%not found%' THEN
    RAISE EXCEPTION 'cross-tenant call was refused by the wrong check (expected the route lookup), got: %', msg;
  END IF;
  IF msg LIKE '%tripulación%' THEN
    RAISE EXCEPTION 'cross-tenant call leaked into the Spanish authorisation branch: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── Read back as the OWNER: the discrepancy note on m1 survived removal ────
DO $$
DECLARE c INT;
BEGIN
  SELECT COUNT(*) INTO c FROM public.discrepancy_notes
   WHERE id = 'ffff0870-0000-4000-f000-000000000001' AND deleted_at IS NULL;
  IF c <> 1 THEN
    RAISE EXCEPTION 'the discrepancy_notes row on m1 must survive its removal from the route';
  END IF;

  SELECT COUNT(*) INTO c FROM public.pickup_scans
   WHERE id = 'dddd0870-0000-4000-d000-000000000001' AND deleted_at IS NULL;
  IF c <> 1 THEN
    RAISE EXCEPTION 'the verified pickup_scans row on m2 must survive (m2 was refused, not removed)';
  END IF;
END $$;

ROLLBACK;
