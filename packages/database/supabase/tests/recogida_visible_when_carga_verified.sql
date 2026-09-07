-- Recogida (get_ops_control_snapshot -> 'manifests') must show a carga as soon
-- as the crew has finished verifying it, NOT when the route is closed.
--
-- QA 2026-09-07 (Musan): every package of PARIS-002 was verified and the
-- control tower showed nothing until the leader pressed "Cerrar ruta y
-- entregar". reception_status — the only thing the manifests key looked at —
-- is written by close_pickup_route()/open_route_reception(), both ROUTE-level
-- events at the end of the trip. See 20260912000001 for the full trace.
--
-- "Finished verifying" is the crew's own definition, taken from the Revisión
-- screen: no package left at 'ingresado' without a discrepancy note. And only
-- what was actually collected reaches the tower — an order with zero verified
-- packages is not listed at all.
--
-- THE FIXTURE (operator 880, route PR-880-1 in_progress):
--   CARGA-A  A1: 2 packages, both verificado          -> visible, 2 packages
--   CARGA-B  B1: 1 verificado + 1 ingresado, NO note  -> carga unfinished,
--                                                        NOTHING visible
--   CARGA-C  C1: 1 verificado + 1 ingresado WITH note -> visible, 1 package
--            C2: 1 ingresado WITH note (nothing        -> NOT visible
--                collected)
--   CARGA-D  D1: 1 verificado, no route, manifest      -> visible (the
--                completed -> awaiting_reception          pre-existing
--                                                         handoff branch)
--   CARGA-E  E1: 1 ingresado, no route, manifest       -> NOT visible: handed
--                completed -> awaiting_reception          off with nothing
--                                                         collected

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000880','Recogida Verified','recogida-verified-880')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000881','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rv-driver@spec880.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000880","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider 880"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000881','aaaaaaaa-0000-4000-a000-000000000880',
   'pickup_leader','rv-driver@spec880.test','Lider 880',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000881','aaaaaaaa-0000-4000-a000-000000000880','VEH-880-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, started_at) VALUES
  ('77777777-0000-4000-7000-000000000881','aaaaaaaa-0000-4000-a000-000000000880',
   'PR-880-1','aaaaaaaa-0000-4000-a000-000000000881','99999999-0000-4000-9000-000000000881',
   'in_progress', NOW() - INTERVAL '2 hours');

-- Orders carry external_load_id, so trg_ensure_manifest_for_order creates one
-- manifest per carga for us — the same way the webhooks do it in production.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  external_load_id
) VALUES
  ('eeee0880-0000-4000-e000-00000000000a','aaaaaaaa-0000-4000-a000-000000000880',
   'T880-A1','Cliente A1','+56900000881','Calle A1','TestComuna 880', CURRENT_DATE,
   '{}'::jsonb,'MANUAL', NOW(), 'CARGA-880-A'),
  ('eeee0880-0000-4000-e000-00000000000b','aaaaaaaa-0000-4000-a000-000000000880',
   'T880-B1','Cliente B1','+56900000882','Calle B1','TestComuna 880', CURRENT_DATE,
   '{}'::jsonb,'MANUAL', NOW(), 'CARGA-880-B'),
  ('eeee0880-0000-4000-e000-00000000000c','aaaaaaaa-0000-4000-a000-000000000880',
   'T880-C1','Cliente C1','+56900000883','Calle C1','TestComuna 880', CURRENT_DATE,
   '{}'::jsonb,'MANUAL', NOW(), 'CARGA-880-C'),
  ('eeee0880-0000-4000-e000-00000000000d','aaaaaaaa-0000-4000-a000-000000000880',
   'T880-C2','Cliente C2','+56900000884','Calle C2','TestComuna 880', CURRENT_DATE,
   '{}'::jsonb,'MANUAL', NOW(), 'CARGA-880-C'),
  ('eeee0880-0000-4000-e000-00000000000e','aaaaaaaa-0000-4000-a000-000000000880',
   'T880-D1','Cliente D1','+56900000885','Calle D1','TestComuna 880', CURRENT_DATE,
   '{}'::jsonb,'MANUAL', NOW(), 'CARGA-880-D'),
  ('eeee0880-0000-4000-e000-00000000000f','aaaaaaaa-0000-4000-a000-000000000880',
   'T880-E1','Cliente E1','+56900000886','Calle E1','TestComuna 880', CURRENT_DATE,
   '{}'::jsonb,'MANUAL', NOW(), 'CARGA-880-E');

-- Package statuses are written directly: trg_pickup_scan_advance_package_status
-- (20260812000002) is the only thing a verified pickup_scan would add here, and
-- 'verificado' is exactly what the snapshot reads. Same shortcut as
-- recogida_counts_only_verified_packages.sql.
INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status) VALUES
  -- CARGA-A — fully verified
  ('bbbb0880-0000-4000-b000-00000000a001','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000a','T880-A1-CTN-1','{}'::jsonb,'verificado'),
  ('bbbb0880-0000-4000-b000-00000000a002','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000a','T880-A1-CTN-2','{}'::jsonb,'verificado'),
  -- CARGA-B — one box still un-scanned and un-noted: the crew is mid-carga
  ('bbbb0880-0000-4000-b000-00000000b001','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000b','T880-B1-CTN-1','{}'::jsonb,'verificado'),
  ('bbbb0880-0000-4000-b000-00000000b002','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000b','T880-B1-CTN-2','{}'::jsonb,'ingresado'),
  -- CARGA-C — closed out with discrepancies
  ('bbbb0880-0000-4000-b000-00000000c001','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000c','T880-C1-CTN-1','{}'::jsonb,'verificado'),
  ('bbbb0880-0000-4000-b000-00000000c002','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000c','T880-C1-CTN-2','{}'::jsonb,'ingresado'),
  ('bbbb0880-0000-4000-b000-00000000c003','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000d','T880-C2-CTN-1','{}'::jsonb,'ingresado'),
  -- CARGA-D / CARGA-E — the pre-existing handoff branch
  ('bbbb0880-0000-4000-b000-00000000d001','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000e','T880-D1-CTN-1','{}'::jsonb,'verificado'),
  ('bbbb0880-0000-4000-b000-00000000e001','aaaaaaaa-0000-4000-a000-000000000880',
   'eeee0880-0000-4000-e000-00000000000f','T880-E1-CTN-1','{}'::jsonb,'ingresado');

-- The two boxes nobody could find at the pickup point, each with its note —
-- what the Revisión screen forces before it lets the crew leave the carga.
INSERT INTO public.discrepancy_notes (operator_id, manifest_id, package_id, note, created_by_user_id)
SELECT 'aaaaaaaa-0000-4000-a000-000000000880', m.id, p.package_id, p.note,
       'aaaaaaaa-0000-4000-a000-000000000881'
  FROM (VALUES
    ('bbbb0880-0000-4000-b000-00000000c002'::uuid,'No estaba en el andén'),
    ('bbbb0880-0000-4000-b000-00000000c003'::uuid,'Pedido completo ausente')
  ) AS p(package_id, note)
  JOIN public.manifests m
    ON m.operator_id = 'aaaaaaaa-0000-4000-a000-000000000880'
   AND m.external_load_id = 'CARGA-880-C';

-- A, B, C are on the open route. D and E take the legacy standalone path: Firma
-- sets status = 'completed' and trg_manifest_reception_status then writes
-- awaiting_reception.
UPDATE public.manifests
   SET pickup_route_id = '77777777-0000-4000-7000-000000000881'
 WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000880'
   AND external_load_id IN ('CARGA-880-A','CARGA-880-B','CARGA-880-C');

UPDATE public.manifests
   SET status = 'completed', completed_at = NOW()
 WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000880'
   AND external_load_id IN ('CARGA-880-D','CARGA-880-E');

DO $$
DECLARE routed INT; handed INT;
BEGIN
  SELECT COUNT(*) INTO routed FROM public.manifests
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000880'
     AND pickup_route_id = '77777777-0000-4000-7000-000000000881'
     AND reception_status IS NULL;
  IF routed <> 3 THEN
    RAISE EXCEPTION 'fixture precondition failed: expected 3 routed cargas with no reception_status, got %', routed;
  END IF;

  SELECT COUNT(*) INTO handed FROM public.manifests
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000880'
     AND external_load_id IN ('CARGA-880-D','CARGA-880-E')
     AND reception_status = 'awaiting_reception';
  IF handed <> 2 THEN
    RAISE EXCEPTION 'fixture precondition failed: expected 2 handed-off cargas, got %', handed;
  END IF;
END $$;

DO $$
DECLARE
  snap  JSONB;
  n     INT;
  pkgs  INT;
BEGIN
  snap := public.get_ops_control_snapshot('aaaaaaaa-0000-4000-a000-000000000880');

  -- 1. The reported bug: a fully verified carga on an OPEN route is visible.
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-A1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'a fully verified carga must reach Recogida before the route closes, found % row(s)', n;
  END IF;

  SELECT jsonb_array_length(x->'packages') INTO pkgs
    FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-A1';
  IF pkgs <> 2 THEN
    RAISE EXCEPTION 'T880-A1 should report 2 collected packages, got %', pkgs;
  END IF;

  -- 2. A carga still being scanned stays out — one un-noted box is enough.
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-B1';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a half-scanned carga must not appear in Recogida, found % row(s)', n;
  END IF;

  -- 3. Closed out with discrepancies: the collected order appears, and only
  --    its collected box.
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-C1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'a carga closed out with notes must reach Recogida, found % row(s)', n;
  END IF;

  SELECT jsonb_array_length(x->'packages') INTO pkgs
    FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-C1';
  IF pkgs <> 1 THEN
    RAISE EXCEPTION 'T880-C1 should report only the 1 collected package, got %', pkgs;
  END IF;

  -- 4. An order nobody could collect is not "in transit toward reception".
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-C2';
  IF n <> 0 THEN
    RAISE EXCEPTION 'an order with zero collected packages must not appear, found % row(s)', n;
  END IF;

  -- 5. Regression guard: the handoff branch (spec-47) still lists its orders.
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-D1';
  IF n <> 1 THEN
    RAISE EXCEPTION 'an awaiting_reception carga must still appear in Recogida, found % row(s)', n;
  END IF;

  -- 6. ...but not when nothing on it was collected.
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T880-E1';
  IF n <> 0 THEN
    RAISE EXCEPTION 'a handed-off order with zero collected packages must not appear, found % row(s)', n;
  END IF;

  -- 7. The orders key is untouched: every order, every package.
  SELECT COUNT(*) INTO n FROM jsonb_array_elements(snap->'orders') x
   WHERE x->>'order_number' LIKE 'T880-%';
  IF n <> 6 THEN
    RAISE EXCEPTION 'the orders key must still list all 6 orders, got %', n;
  END IF;

  SELECT jsonb_array_length(x->'packages') INTO pkgs
    FROM jsonb_array_elements(snap->'orders') x
   WHERE x->>'order_number' = 'T880-C1';
  IF pkgs <> 2 THEN
    RAISE EXCEPTION 'the orders key must keep every package of T880-C1, got %', pkgs;
  END IF;

  RAISE NOTICE '✓ recogida_visible_when_carga_verified: 7 assertions passed';
END $$;

ROLLBACK;
