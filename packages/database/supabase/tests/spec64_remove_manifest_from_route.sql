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
-- TWO OPERATORS, deliberately, and operator B owns its OWN route AND its OWN
-- manifest — not just a route. With only a route on B, a caller passing a
-- B-owned manifest against an A route only ever exercises the ROUTE lookup's
-- `operator_id = v_operator`; the MANIFEST lookup's own operator scope
-- (guard 5) would stay unfalsifiable. TEST 12 is what that manifest is for.
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
--   B879 Otro Operador operator B, driver of route B (in_progress)
--
-- MANIFESTS on route 1 (in_progress) unless noted:
--   m1  zero scans                            -> removable; also the "call
--                                                 it twice" case (2nd call
--                                                 hits the not-attached-to-
--                                                 route guard)
--   m2  one VERIFIED scan (real package)       -> refused, stays attached
--   m3  one NOT_FOUND scan (no package_id)     -> removable — the real QA
--                                                 case
--   m4  attached to route 3 (not in_progress)  -> refused
--   m5  zero scans                            -> removed by ACTIVE CREW (872)
--   m6  zero scans                            -> refused by 873, 874, 875 in
--                                                 turn
--   m7  zero scans                            -> removed by
--                                                 operations_manager
--   m8  one VERIFIED scan with package_id NULL -> removable (pins that the
--       `AND package_id IS NOT NULL` conjunct is doing real work — the only
--       other populated scan_result in this fixture, not_found, already has
--       NULL package_id by construction, so without a case like this the
--       conjunct could be deleted and the suite would not notice)
--   m9  status='completed', completed_at + all four signature columns set,
--       one NOT_FOUND scan only, on route 1 -> removable, AND all six
--       columns (pickup_route_id, reception_status, status, started_at,
--       completed_at, every signature_* column) come back cleared — the
--       apps/frontend/.../pickup/complete/[loadId]/page.tsx scenario: a
--       carga closed via the discrepancy path (every scan not_found) while
--       still attached to an in_progress route
--   mB  operator B, unattached                -> exists only so TEST 12 can
--       prove the manifest lookup is scoped to the CALLER's operator, not
--       just the route lookup
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
  ('99999999-0000-4000-9000-000000000873','aaaaaaaa-0000-4000-a000-000000000870','VEH-64R-3', true),
  ('99999999-0000-4000-9000-000000000879','bbbbbbbb-0000-4000-b000-000000000870','VEH-64R-B', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, started_at) VALUES
  ('77777777-0000-4000-7000-000000000871','aaaaaaaa-0000-4000-a000-000000000870',
   'PR-64R-1','aaaaaaaa-0000-4000-a000-000000000871','99999999-0000-4000-9000-000000000871','in_progress', NOW() - INTERVAL '2 hours'),
  ('77777777-0000-4000-7000-000000000872','aaaaaaaa-0000-4000-a000-000000000870',
   'PR-64R-2','aaaaaaaa-0000-4000-a000-000000000878','99999999-0000-4000-9000-000000000872','in_progress', NOW() - INTERVAL '1 hour'),
  ('77777777-0000-4000-7000-000000000873','aaaaaaaa-0000-4000-a000-000000000870',
   'PR-64R-3','aaaaaaaa-0000-4000-a000-000000000877','99999999-0000-4000-9000-000000000873','cancelled', NOW() - INTERVAL '3 hours'),
  ('77777777-0000-4000-7000-000000000879','bbbbbbbb-0000-4000-b000-000000000870',
   'PR-64R-B','bbbbbbbb-0000-4000-b000-000000000879','99999999-0000-4000-9000-000000000879','in_progress', NOW());

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
INSERT INTO public.manifests (
  id, operator_id, external_load_id, status, pickup_route_id, reception_status, started_at,
  completed_at, signature_operator, signature_operator_name, signature_client, signature_client_name
) VALUES
  ('cccc0870-0000-4000-c000-000000000001','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M1','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000002','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M2','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000003','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M3','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000004','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M4','in_progress','77777777-0000-4000-7000-000000000873', NULL, NOW() - INTERVAL '3 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000005','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M5','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000006','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M6','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000007','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M7','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000008','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M8','in_progress','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours', NULL, NULL, NULL, NULL, NULL),
  ('cccc0870-0000-4000-c000-000000000009','aaaaaaaa-0000-4000-a000-000000000870','CARGA-64R-M9','completed','77777777-0000-4000-7000-000000000871', NULL, NOW() - INTERVAL '2 hours',
   NOW() - INTERVAL '10 minutes','https://example.test/sig-operator.png','Firma Operador','https://example.test/sig-cliente.png','Firma Cliente'),
  ('cccc0879-0000-4000-c000-000000000001','bbbbbbbb-0000-4000-b000-000000000870','CARGA-64R-MB','pending', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- m2: a VERIFIED scan (real package_id) — the manifest that must stay
-- attached, refused.
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

-- m8: scan_result = 'verified' but package_id IS NULL. Not a real-world scan
-- (the app never writes verified with no package), but this is exactly the
-- shape that pins the `AND package_id IS NOT NULL` conjunct in guard 7: with
-- ONLY not_found (package_id NULL by construction) as the other populated
-- scan_result in this fixture, the conjunct could be deleted and every other
-- test here would still pass. This manifest must still be removable.
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at) VALUES
  ('dddd0870-0000-4000-d000-000000000003','aaaaaaaa-0000-4000-a000-000000000870',
   'cccc0870-0000-4000-c000-000000000008', NULL,
   'BC-64R-VERIFIED-NO-PKG','verified','aaaaaaaa-0000-4000-a000-000000000871', NOW());

-- m9: closed via the discrepancy path — every scan not_found, nothing to
-- verify against — while still attached to route 1.
INSERT INTO public.pickup_scans (id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at) VALUES
  ('dddd0870-0000-4000-d000-000000000004','aaaaaaaa-0000-4000-a000-000000000870',
   'cccc0870-0000-4000-c000-000000000009', NULL,
   'BC-64R-M9-NOTFOUND','not_found','aaaaaaaa-0000-4000-a000-000000000871', NOW());

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

-- ── TEST 2: calling it again hits the not-attached-to-route guard ──────────
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
  IF msg NOT LIKE '%Esta carga ya no está en la ruta%' THEN
    RAISE EXCEPTION 'expected the "not attached to route" guard, got: %', msg;
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

-- ── TEST 12: a B-owned manifest against an A route is refused by the ───────
-- MANIFEST lookup's own operator scope (guard 5), not just the route lookup.
-- Driver Uno is fully authorised on route 1 -- guards 1-4 all pass -- so a
-- success here would mean the manifest SELECT trusted p_manifest_id without
-- checking `operator_id = v_operator` on that table too.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000871'::uuid,
      'cccc0879-0000-4000-c000-000000000001'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'a fully-authorised A caller must not be able to touch a B-owned manifest via an A route';
  END IF;
  IF msg NOT LIKE '%manifest%not found%' THEN
    RAISE EXCEPTION 'expected the manifest-not-found guard, got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 13: the more dangerous direction -- an ELEVATED user (A) reaching ─
-- for another operator's ROUTE is refused too. If the route lookup's
-- operator scope were ever weakened, an operations_manager's blanket
-- authority would otherwise let them reach across tenants where an ordinary
-- leader (TEST 11) cannot.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000876","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE msg TEXT := ''; succeeded BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.remove_manifest_from_route(
      '77777777-0000-4000-7000-000000000879'::uuid,
      'cccc0879-0000-4000-c000-000000000001'::uuid);
    succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF succeeded THEN
    RAISE EXCEPTION 'an operations_manager from operator A must not be able to reach operator B''s route';
  END IF;
  IF msg NOT LIKE '%not found%' THEN
    RAISE EXCEPTION 'cross-tenant elevated call refused by the wrong check, got: %', msg;
  END IF;
END $$;
RESET ROLE;

-- ── TEST 14: package_id IS NULL verified scan does not block removal ───────
-- Pins the `AND package_id IS NOT NULL` conjunct in guard 7 (see the m8
-- fixture comment for why this is the only case that can catch its removal).
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.manifests;
BEGIN
  r := public.remove_manifest_from_route(
    '77777777-0000-4000-7000-000000000871'::uuid,
    'cccc0870-0000-4000-c000-000000000008'::uuid);
  IF r.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'a verified scan with package_id IS NULL must not block removal';
  END IF;
END $$;
RESET ROLE;

-- ── TEST 15: a completed manifest with signatures set is removable, and ────
-- completed_at + all four signature columns come back cleared, not just the
-- route/reception/status/started_at four.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000871","operator_id":"aaaaaaaa-0000-4000-a000-000000000870","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000870"}}';
SET LOCAL ROLE authenticated;
DO $$
DECLARE r public.manifests;
BEGIN
  r := public.remove_manifest_from_route(
    '77777777-0000-4000-7000-000000000871'::uuid,
    'cccc0870-0000-4000-c000-000000000009'::uuid);
  IF r.pickup_route_id IS NOT NULL THEN
    RAISE EXCEPTION 'm9 (completed, discrepancy-closed) should have been removed';
  END IF;
  IF r.reception_status IS NOT NULL THEN
    RAISE EXCEPTION 'reception_status was not cleared on m9';
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'm9 status should be pending, got %', r.status;
  END IF;
  IF r.started_at IS NOT NULL THEN
    RAISE EXCEPTION 'started_at was not cleared on m9';
  END IF;
  IF r.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'completed_at was not cleared on m9 -- a pending carga must not still read as closed';
  END IF;
  IF r.signature_operator IS NOT NULL OR r.signature_operator_name IS NOT NULL THEN
    RAISE EXCEPTION 'operator signature columns were not cleared on m9';
  END IF;
  IF r.signature_client IS NOT NULL OR r.signature_client_name IS NOT NULL THEN
    RAISE EXCEPTION 'client signature columns were not cleared on m9';
  END IF;
END $$;
RESET ROLE;

-- ── Read back as the OWNER: history rows survived, m9's audit trail exists ─
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

  -- audit_manifests_changes (20260217000001) fires AFTER UPDATE on
  -- public.manifests via audit_trigger_func, which writes
  -- action = TG_OP || '_' || TG_TABLE_NAME (so 'UPDATE_manifests') and
  -- changes_json = {before: row_to_json(OLD), after: row_to_json(NEW)} --
  -- confirms clearing completed_at/signatures on m9 above lost no evidence,
  -- it only moved out of the live row.
  SELECT COUNT(*) INTO c FROM public.audit_logs
   WHERE resource_type = 'manifests'
     AND resource_id = 'cccc0870-0000-4000-c000-000000000009'
     AND action = 'UPDATE_manifests'
     AND changes_json #>> '{before,signature_operator}' IS NOT NULL;
  IF c < 1 THEN
    RAISE EXCEPTION 'm9''s pre-clear signature_operator must be recoverable from audit_logs';
  END IF;
END $$;

ROLLBACK;
