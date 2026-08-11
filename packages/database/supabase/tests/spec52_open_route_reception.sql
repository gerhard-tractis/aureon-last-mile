-- spec-52 Task 5 — open_route_reception()
--
-- The receptionist's QR scan is what opens a reception batch from spec-52
-- onwards. This file pins the whole contract:
--   * it creates the batch, stamps in_transit_at, flips the route to
--     in_transit, flips linked manifests to awaiting_reception
--   * expected_count is FROZEN from DISTINCT verified pickup scans only
--   * received_by = auth.uid(), delivered_by = route.driver_id
--   * a second call is a NO-OP that returns the same batch (idempotent)
--   * LEGACY INTEROP: a route the driver already closed through
--     close_pickup_route (whose batch was created by
--     trg_pickup_routes_status_sync) must open cleanly — same batch back, no
--     second insert, no unique_violation on uniq_route_receptions_pickup_route
--   * received / cancelled routes are rejected
--
-- This is the EXPAND half of the expand/contract plan: close_pickup_route and
-- the trigger's -> in_transit branch both still exist and must keep working.

BEGIN;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000521','Spec52 Reception','spec52-open')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000521',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver1@spec52open.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000521"}'::jsonb,
   '{"full_name":"Driver Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000522',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver2@spec52open.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000521"}'::jsonb,
   '{"full_name":"Driver Dos"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000521',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'recepcion@spec52open.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000521"}'::jsonb,
   '{"full_name":"Recepcionista"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000521','aaaaaaaa-0000-4000-a000-000000000521','driver1@spec52open.test','Driver Uno',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000522','aaaaaaaa-0000-4000-a000-000000000521','driver2@spec52open.test','Driver Dos',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000521','aaaaaaaa-0000-4000-a000-000000000521','recepcion@spec52open.test','Recepcionista',ARRAY['reception'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000521','aaaaaaaa-0000-4000-a000-000000000521','VEH-OPEN-1', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone,
                           delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at)
VALUES ('cccccccc-0000-4000-c000-000000000521','aaaaaaaa-0000-4000-a000-000000000521',
        'ORD-OPEN-1','Cust','+56912345678','Addr 1','Santiago', CURRENT_DATE,
        '{}'::jsonb, 'MANUAL', NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('dddddddd-0000-4000-d000-000000000521','aaaaaaaa-0000-4000-a000-000000000521','cccccccc-0000-4000-c000-000000000521','PKG-OPEN-1','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000522','aaaaaaaa-0000-4000-a000-000000000521','cccccccc-0000-4000-c000-000000000521','PKG-OPEN-2','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000523','aaaaaaaa-0000-4000-a000-000000000521','cccccccc-0000-4000-c000-000000000521','PKG-OPEN-3','[]'::jsonb,'{}'::jsonb),
  ('dddddddd-0000-4000-d000-000000000524','aaaaaaaa-0000-4000-a000-000000000521','cccccccc-0000-4000-c000-000000000521','PKG-OPEN-4','[]'::jsonb,'{}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('eeeeeeee-0000-4000-e000-000000000521','aaaaaaaa-0000-4000-a000-000000000521','CARGA-OPEN-1','in_progress'),
  ('eeeeeeee-0000-4000-e000-000000000522','aaaaaaaa-0000-4000-a000-000000000521','CARGA-OPEN-2','in_progress')
ON CONFLICT DO NOTHING;

-- Route A — the spec-52 path (receptionist opens it directly).
-- Route B — the legacy path (driver closes it first). Needs its own driver:
--           uniq_pickup_routes_one_active_per_driver allows one in_progress
--           route per driver.
-- Routes C/D — terminal statuses, must be rejected. They may share driver 1
--           because the index only covers 'in_progress'.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, received_at, cancelled_at)
VALUES
  ('11111111-0000-4000-1000-000000000521','aaaaaaaa-0000-4000-a000-000000000521','PR-OPEN-A',
   'aaaaaaaa-0000-4000-a000-000000000521','99999999-0000-4000-9000-000000000521','in_progress', NULL, NULL),
  ('11111111-0000-4000-1000-000000000522','aaaaaaaa-0000-4000-a000-000000000521','PR-OPEN-B',
   'aaaaaaaa-0000-4000-a000-000000000522','99999999-0000-4000-9000-000000000521','in_progress', NULL, NULL),
  ('11111111-0000-4000-1000-000000000523','aaaaaaaa-0000-4000-a000-000000000521','PR-OPEN-C',
   'aaaaaaaa-0000-4000-a000-000000000521','99999999-0000-4000-9000-000000000521','received', NOW(), NULL),
  ('11111111-0000-4000-1000-000000000524','aaaaaaaa-0000-4000-a000-000000000521','PR-OPEN-D',
   'aaaaaaaa-0000-4000-a000-000000000521','99999999-0000-4000-9000-000000000521','cancelled', NULL, NOW());

UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000521'
 WHERE id = 'eeeeeeee-0000-4000-e000-000000000521';
UPDATE public.manifests SET pickup_route_id = '11111111-0000-4000-1000-000000000522'
 WHERE id = 'eeeeeeee-0000-4000-e000-000000000522';

-- Route A scans: pkg1 verified TWICE (DISTINCT must collapse it to one),
-- pkg2 verified, pkg3 not_found (must NOT count), pkg4 never scanned.
-- => expected_count must be exactly 2.
INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000521','eeeeeeee-0000-4000-e000-000000000521','dddddddd-0000-4000-d000-000000000521','PKG-OPEN-1','verified', NOW()),
  ('aaaaaaaa-0000-4000-a000-000000000521','eeeeeeee-0000-4000-e000-000000000521','dddddddd-0000-4000-d000-000000000521','PKG-OPEN-1','verified', NOW()),
  ('aaaaaaaa-0000-4000-a000-000000000521','eeeeeeee-0000-4000-e000-000000000521','dddddddd-0000-4000-d000-000000000522','PKG-OPEN-2','verified', NOW()),
  ('aaaaaaaa-0000-4000-a000-000000000521','eeeeeeee-0000-4000-e000-000000000521','dddddddd-0000-4000-d000-000000000523','PKG-OPEN-3','not_found', NOW()),
  -- Route B needs one verified scan or close_pickup_route refuses to close it.
  ('aaaaaaaa-0000-4000-a000-000000000521','eeeeeeee-0000-4000-e000-000000000522','dddddddd-0000-4000-d000-000000000524','PKG-OPEN-4','verified', NOW());

-- The receptionist's JWT — auth.uid() must land in route_receptions.received_by.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-4000-b000-000000000521","operator_id":"aaaaaaaa-0000-4000-a000-000000000521","role":"authenticated"}',
  true);

-- ---------------------------------------------------------------------------
-- CASE 1 — the happy path
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rr    public.route_receptions;
  v_route public.pickup_routes;
  v_mrs   reception_status_enum;
BEGIN
  v_rr := public.open_route_reception('11111111-0000-4000-1000-000000000521'::UUID);

  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'open_route_reception returned no route_receptions row';
  END IF;
  IF v_rr.expected_count <> 2 THEN
    RAISE EXCEPTION 'expected_count should be 2 (DISTINCT verified only), got %', v_rr.expected_count;
  END IF;
  IF v_rr.received_by IS DISTINCT FROM 'bbbbbbbb-0000-4000-b000-000000000521'::UUID THEN
    RAISE EXCEPTION 'received_by should be auth.uid() (the receptionist), got %', v_rr.received_by;
  END IF;
  IF v_rr.delivered_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000521'::UUID THEN
    RAISE EXCEPTION 'delivered_by should be the route driver, got %', v_rr.delivered_by;
  END IF;
  IF v_rr.status <> 'pending' THEN
    RAISE EXCEPTION 'batch status should be pending, got %', v_rr.status;
  END IF;
  IF v_rr.started_at IS NULL THEN
    RAISE EXCEPTION 'batch started_at should be stamped';
  END IF;
  IF v_rr.operator_id IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000521'::UUID THEN
    RAISE EXCEPTION 'batch operator_id wrong: %', v_rr.operator_id;
  END IF;

  SELECT * INTO v_route FROM public.pickup_routes
   WHERE id = '11111111-0000-4000-1000-000000000521';
  IF v_route.status <> 'in_transit' THEN
    RAISE EXCEPTION 'route should be in_transit, got %', v_route.status;
  END IF;
  IF v_route.in_transit_at IS NULL THEN
    RAISE EXCEPTION 'route in_transit_at should be stamped';
  END IF;

  SELECT reception_status INTO v_mrs FROM public.manifests
   WHERE id = 'eeeeeeee-0000-4000-e000-000000000521';
  IF v_mrs IS DISTINCT FROM 'awaiting_reception' THEN
    RAISE EXCEPTION 'manifest reception_status should be awaiting_reception, got %', v_mrs;
  END IF;

  -- exactly one live batch
  IF (SELECT COUNT(*) FROM public.route_receptions
       WHERE pickup_route_id = '11111111-0000-4000-1000-000000000521'
         AND deleted_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one live batch for route A';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — idempotency: second scan is a no-op
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_first_id   UUID;
  v_first_at   TIMESTAMPTZ;
  v_first_exp  INT;
  v_rr         public.route_receptions;
  v_route_at   TIMESTAMPTZ;
BEGIN
  SELECT id, started_at, expected_count INTO v_first_id, v_first_at, v_first_exp
    FROM public.route_receptions
   WHERE pickup_route_id = '11111111-0000-4000-1000-000000000521' AND deleted_at IS NULL;
  SELECT in_transit_at INTO v_route_at FROM public.pickup_routes
   WHERE id = '11111111-0000-4000-1000-000000000521';

  -- Plant a third verified scan on the route. The route lock forbids this at
  -- runtime (that is its job), so disable it for one statement — the point
  -- here is to prove open_route_reception does NOT recompute expected_count,
  -- and a frozen count is only observable if the underlying tally moved.
  ALTER TABLE public.pickup_scans DISABLE TRIGGER trg_pickup_scans_route_lock;
  INSERT INTO public.pickup_scans (operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
  VALUES ('aaaaaaaa-0000-4000-a000-000000000521','eeeeeeee-0000-4000-e000-000000000521',
          'dddddddd-0000-4000-d000-000000000524','PKG-OPEN-4','verified', NOW());
  ALTER TABLE public.pickup_scans ENABLE TRIGGER trg_pickup_scans_route_lock;

  PERFORM pg_sleep(0.01);
  v_rr := public.open_route_reception('11111111-0000-4000-1000-000000000521'::UUID);

  IF v_rr.id IS DISTINCT FROM v_first_id THEN
    RAISE EXCEPTION 'second open must return the SAME batch (% vs %)', v_rr.id, v_first_id;
  END IF;
  IF v_rr.started_at IS DISTINCT FROM v_first_at THEN
    RAISE EXCEPTION 'second open must not re-stamp started_at';
  END IF;
  IF v_rr.expected_count IS DISTINCT FROM v_first_exp THEN
    RAISE EXCEPTION 'second open must not recompute expected_count';
  END IF;
  IF (SELECT in_transit_at FROM public.pickup_routes
       WHERE id = '11111111-0000-4000-1000-000000000521') IS DISTINCT FROM v_route_at THEN
    RAISE EXCEPTION 'second open must not re-stamp route.in_transit_at';
  END IF;
  IF (SELECT COUNT(*) FROM public.route_receptions
       WHERE pickup_route_id = '11111111-0000-4000-1000-000000000521') <> 1 THEN
    RAISE EXCEPTION 'second open inserted a duplicate batch row';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — LEGACY INTEROP: driver closed the route first (expand phase)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_closed  public.route_receptions;
  v_opened  public.route_receptions;
  v_rows    INT;
BEGIN
  -- close_pickup_route still exists during expand and MUST still work.
  v_closed := public.close_pickup_route('11111111-0000-4000-1000-000000000522'::UUID);
  IF v_closed.id IS NULL THEN
    RAISE EXCEPTION 'close_pickup_route returned no batch — the expand-phase path is broken';
  END IF;
  IF (SELECT status FROM public.pickup_routes
       WHERE id = '11111111-0000-4000-1000-000000000522') <> 'in_transit' THEN
    RAISE EXCEPTION 'close_pickup_route did not move the route to in_transit';
  END IF;

  -- Now the receptionist scans it. Must return the SAME batch, not raise.
  v_opened := public.open_route_reception('11111111-0000-4000-1000-000000000522'::UUID);
  IF v_opened.id IS DISTINCT FROM v_closed.id THEN
    RAISE EXCEPTION 'receptionist must get the batch the driver-close created (% vs %)',
      v_opened.id, v_closed.id;
  END IF;

  SELECT COUNT(*) INTO v_rows FROM public.route_receptions
   WHERE pickup_route_id = '11111111-0000-4000-1000-000000000522';
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'double-insert on the legacy path: % batch rows', v_rows;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- CASE 4/5 — terminal routes are rejected
-- ---------------------------------------------------------------------------
DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.open_route_reception('11111111-0000-4000-1000-000000000523'::UUID);
  EXCEPTION WHEN OTHERS THEN rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'open_route_reception must reject a received route';
  END IF;

  rejected := FALSE;
  BEGIN
    PERFORM public.open_route_reception('11111111-0000-4000-1000-000000000524'::UUID);
  EXCEPTION WHEN OTHERS THEN rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'open_route_reception must reject a cancelled route';
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
