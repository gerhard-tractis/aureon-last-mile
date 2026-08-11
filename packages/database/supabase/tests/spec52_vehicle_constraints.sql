-- spec-52 Task 3 — pickup_routes.vehicle_id constraints
--
-- 1. start_pickup_route(UUID) rejects an inactive / soft-deleted / foreign vehicle.
-- 2. uniq_pickup_routes_one_active_per_vehicle blocks a second active route on
--    the same truck (even with a different driver).
-- 3. uniq_pickup_routes_one_active_per_driver still blocks a second active route
--    for the same driver (even in a different truck) — useActivePickupRoute.ts
--    does `.order('started_at', desc).limit(1)`, so a driver with two active
--    routes silently gets the newest one with no error. The index is the only
--    thing that makes that impossible.
-- 4. cancel_pickup_route persists p_reason into cancellation_reason.
-- 5. The old start_pickup_route(TEXT) overload is gone (Postgres would otherwise
--    keep both, and a NULL-label call would be ambiguous).
--
-- Run inside transaction; ROLLBACK at end.

BEGIN;

-- ─── Fixture: 2 operators, 3 users, 5 vehicles ─────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000852','Spec52 Veh A','spec52-veh-a'),
  ('bbbbbbbb-0000-4000-b000-000000000852','Spec52 Veh B','spec52-veh-b')
ON CONFLICT (slug) DO NOTHING;

-- operator_id MUST live in raw_app_meta_data: public.handle_new_user() reads
-- NEW.raw_app_meta_data->>'operator_id' and raises without it.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000853',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-a1@spec52veh.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000852"}'::jsonb,
   '{"full_name":"Driver A1"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000854',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-a2@spec52veh.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000852"}'::jsonb,
   '{"full_name":"Driver A2"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000853',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-b1@spec52veh.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000852"}'::jsonb,
   '{"full_name":"Driver B1"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: with the signup trigger enabled handle_new_user()
-- already created these rows, and DO NOTHING would silently drop `permissions`.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000853','aaaaaaaa-0000-4000-a000-000000000852','driver-a1@spec52veh.test','Driver A1',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000854','aaaaaaaa-0000-4000-a000-000000000852','driver-a2@spec52veh.test','Driver A2',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000853','bbbbbbbb-0000-4000-b000-000000000852','driver-b1@spec52veh.test','Driver B1',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, vehicle_type, active, deleted_at)
VALUES
  ('11111111-0000-4000-1000-000000000852','aaaaaaaa-0000-4000-a000-000000000852','VEH-OK-1','camion', true,  NULL),
  ('22222222-0000-4000-2000-000000000852','aaaaaaaa-0000-4000-a000-000000000852','VEH-OK-2','camion', true,  NULL),
  ('33333333-0000-4000-3000-000000000852','aaaaaaaa-0000-4000-a000-000000000852','VEH-INACTIVE','camion', false, NULL),
  ('44444444-0000-4000-4000-000000000852','aaaaaaaa-0000-4000-a000-000000000852','VEH-DELETED','camion', true,  NOW()),
  ('55555555-0000-4000-5000-000000000852','bbbbbbbb-0000-4000-b000-000000000852','VEH-OTHER-OP','camion', true,  NULL)
ON CONFLICT DO NOTHING;

-- ─── 5. the TEXT overload is gone, the UUID one exists ─────────────────────
DO $$
DECLARE n_text INT; n_uuid INT;
BEGIN
  -- match on proargtypes, not pg_get_function_identity_arguments — the latter
  -- prefixes the parameter name ("p_vehicle_label text") and never equals 'text'.
  SELECT COUNT(*) INTO n_text FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
     AND p.pronargs = 1 AND p.proargtypes[0] = 'text'::regtype;
  IF n_text <> 0 THEN
    RAISE EXCEPTION 'start_pickup_route(TEXT) overload still exists — a label-only call would still be accepted';
  END IF;

  SELECT COUNT(*) INTO n_uuid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
     AND p.pronargs = 1 AND p.proargtypes[0] = 'uuid'::regtype;
  IF n_uuid <> 1 THEN
    RAISE EXCEPTION 'expected exactly one start_pickup_route(UUID), found %', n_uuid;
  END IF;
END $$;

-- ─── vehicle_id is NOT NULL ────────────────────────────────────────────────
DO $$
DECLARE is_nullable TEXT;
BEGIN
  SELECT c.is_nullable INTO is_nullable
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'pickup_routes'
     AND c.column_name = 'vehicle_id';
  IF is_nullable IS NULL THEN
    RAISE EXCEPTION 'pickup_routes.vehicle_id column missing';
  END IF;
  IF is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'pickup_routes.vehicle_id should be NOT NULL, is_nullable=%', is_nullable;
  END IF;
END $$;

-- ─── 1. start_pickup_route rejects unusable vehicles ───────────────────────
-- Driver A1's JWT for all three.
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000853","operator_id":"aaaaaaaa-0000-4000-a000-000000000852","role":"authenticated"}',
  true);

DO $$
DECLARE
  v_case  RECORD;
  rejected BOOLEAN;
  err_msg  TEXT;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('33333333-0000-4000-3000-000000000852'::UUID, 'inactive vehicle'),
      ('44444444-0000-4000-4000-000000000852'::UUID, 'soft-deleted vehicle'),
      ('55555555-0000-4000-5000-000000000852'::UUID, 'another operator''s vehicle')
    ) AS t(vehicle_id, label)
  LOOP
    rejected := FALSE;
    err_msg  := 'no error raised';
    BEGIN
      PERFORM public.start_pickup_route(v_case.vehicle_id);
    EXCEPTION WHEN OTHERS THEN
      rejected := TRUE;
      GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'start_pickup_route accepted % (%) — the SIN-REGISTRO placeholder would be selectable',
        v_case.label, v_case.vehicle_id;
    END IF;
    RAISE NOTICE 'rejected % → %', v_case.label, err_msg;
  END LOOP;
END $$;

-- ─── happy path: an active, own, live vehicle starts a route ───────────────
DO $$
DECLARE v_row public.pickup_routes;
BEGIN
  SELECT * INTO v_row FROM public.start_pickup_route('11111111-0000-4000-1000-000000000852'::UUID);
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'start_pickup_route returned no row for a valid vehicle';
  END IF;
  IF v_row.vehicle_id IS DISTINCT FROM '11111111-0000-4000-1000-000000000852'::UUID THEN
    RAISE EXCEPTION 'route vehicle_id should be the requested vehicle, got %', v_row.vehicle_id;
  END IF;
  IF v_row.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'new route should be in_progress, got %', v_row.status;
  END IF;
  IF v_row.code !~ '^PR-[0-9]{4}-[0-9]{4}$' THEN
    RAISE EXCEPTION 'route code should match PR-YYYY-NNNN, got %', v_row.code;
  END IF;
END $$;

-- ─── 2. same vehicle, DIFFERENT driver → per-vehicle index must reject ─────
DO $$
DECLARE con TEXT := ''; rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, status)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000852','PR-VEH-DUP',
            'aaaaaaaa-0000-4000-a000-000000000854',
            '11111111-0000-4000-1000-000000000852','in_progress');
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE;
    GET STACKED DIAGNOSTICS con = CONSTRAINT_NAME;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'a second active route on the same vehicle was accepted (one truck, two trips)';
  END IF;
  IF con <> 'uniq_pickup_routes_one_active_per_vehicle' THEN
    RAISE EXCEPTION 'expected uniq_pickup_routes_one_active_per_vehicle to reject it, got %', con;
  END IF;
END $$;

-- ─── 3. same driver, DIFFERENT vehicle → per-driver index must still reject ─
DO $$
DECLARE con TEXT := ''; rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, status)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000852','PR-DRV-DUP',
            'aaaaaaaa-0000-4000-a000-000000000853',
            '22222222-0000-4000-2000-000000000852','in_progress');
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE;
    GET STACKED DIAGNOSTICS con = CONSTRAINT_NAME;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'a second active route for the same driver was accepted — useActivePickupRoute would silently pick the newest';
  END IF;
  IF con <> 'uniq_pickup_routes_one_active_per_driver' THEN
    RAISE EXCEPTION 'expected uniq_pickup_routes_one_active_per_driver to reject it, got %', con;
  END IF;
END $$;

-- ─── 4. cancel_pickup_route persists p_reason ──────────────────────────────
DO $$
DECLARE v_id UUID; v_reason TEXT; v_status pickup_route_status_enum;
BEGIN
  SELECT id INTO v_id FROM public.pickup_routes
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000852'
     AND vehicle_id  = '11111111-0000-4000-1000-000000000852'
     AND status = 'in_progress' AND deleted_at IS NULL;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'no active route to cancel — fixture broken';
  END IF;

  PERFORM public.cancel_pickup_route(v_id, 'Camión averiado en ruta');

  SELECT cancellation_reason, status INTO v_reason, v_status
    FROM public.pickup_routes WHERE id = v_id;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'route should be cancelled, got %', v_status;
  END IF;
  IF v_reason IS DISTINCT FROM 'Camión averiado en ruta' THEN
    RAISE EXCEPTION 'cancellation_reason should persist p_reason, got %', COALESCE(v_reason,'<NULL>');
  END IF;
END $$;

-- ─── once cancelled, the same vehicle and driver are free again ────────────
DO $$
DECLARE v_row public.pickup_routes;
BEGIN
  SELECT * INTO v_row FROM public.start_pickup_route('11111111-0000-4000-1000-000000000852'::UUID);
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'vehicle/driver still locked after the previous route was cancelled';
  END IF;
END $$;

-- ─── the SIN-REGISTRO backfill placeholder is unselectable by construction ──
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM public.vehicles
   WHERE plate = 'SIN-REGISTRO' AND active;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% SIN-REGISTRO placeholder vehicles are active — they must be unselectable', bad;
  END IF;
END $$;

ROLLBACK;
