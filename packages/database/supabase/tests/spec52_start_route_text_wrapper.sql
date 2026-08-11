-- spec-52 Task 3 — start_pickup_route(TEXT), the DEPRECATED compat wrapper
--
-- Split out of spec52_vehicle_constraints.sql to keep both files under the
-- 300-line limit. That file covers the real RPC and the indexes; this one
-- covers only the expand-phase shim.
--
-- The wrapper exists because merging this repo auto-deploys and the frontend
-- still calls start_pickup_route(p_vehicle_label) at useStartPickupRoute.ts:18.
-- .rpc() arguments are not checked against the generated types, so dropping the
-- signature would break driver route creation in production with nothing red in
-- CI. spec-52 Task 8 removes it once the frontend passes p_vehicle_id.
--
-- Asserted here:
--   1. the overload still exists
--   2. a new plate is created active, and the route binds to it
--   3. an existing plate is REUSED, not duplicated
--   4. '  abc-123  ' and 'ABC-123' normalize to the same vehicle
--   5. the reserved SIN-REGISTRO plate is refused with a domain error
--   6. an inactive vehicle is refused — never a raw 23505 from
--      uniq_vehicles_operator_plate
--
-- Run inside transaction; ROLLBACK at end.

BEGIN;

-- ─── Fixture: 1 operator, 1 driver, 1 inactive vehicle ─────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000862','Spec52 Wrap','spec52-wrap')
ON CONFLICT (slug) DO NOTHING;

-- operator_id MUST live in raw_app_meta_data: public.handle_new_user() reads
-- NEW.raw_app_meta_data->>'operator_id' and raises without it.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000863',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-wrap@spec52veh.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000862"}'::jsonb,
   '{"full_name":"Driver Wrap"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created this row.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES ('aaaaaaaa-0000-4000-a000-000000000863','aaaaaaaa-0000-4000-a000-000000000862',
        'driver-wrap@spec52veh.test','Driver Wrap',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, vehicle_type, active)
VALUES ('66666666-0000-4000-6000-000000000862','aaaaaaaa-0000-4000-a000-000000000862',
        'VEH-INACTIVE','camion', false)
ON CONFLICT DO NOTHING;

-- ─── 1. the overload still exists ──────────────────────────────────────────
DO $$
DECLARE n_text INT;
BEGIN
  -- match on proargtypes, not pg_get_function_identity_arguments — the latter
  -- prefixes the parameter name ("p_vehicle_label text") and never equals 'text'.
  SELECT COUNT(*) INTO n_text FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
     AND p.pronargs = 1 AND p.proargtypes[0] = 'text'::regtype;
  IF n_text <> 1 THEN
    RAISE EXCEPTION 'expected exactly one start_pickup_route(TEXT) compatibility wrapper, found % — the deployed frontend would break', n_text;
  END IF;
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000863","operator_id":"aaaaaaaa-0000-4000-a000-000000000862","role":"authenticated"}',
  true);

-- ─── 2/3/4. find-or-create + normalization ─────────────────────────────────
DO $$
DECLARE
  r1 public.pickup_routes;
  r2 public.pickup_routes;
  n_plate INT;
  is_active BOOLEAN;
BEGIN
  -- A new plate is created on the fly, active, and the route binds to it.
  -- Note the untrimmed, lower-case input: normalization is the whole point.
  SELECT * INTO r1 FROM public.start_pickup_route('  abc-123  '::TEXT);
  IF r1.vehicle_id IS NULL THEN
    RAISE EXCEPTION 'TEXT wrapper returned a route with no vehicle_id';
  END IF;

  SELECT COUNT(*), bool_and(v.active) INTO n_plate, is_active
    FROM public.vehicles v
   WHERE v.operator_id = 'aaaaaaaa-0000-4000-a000-000000000862'
     AND v.plate = 'ABC-123' AND v.deleted_at IS NULL;
  IF n_plate <> 1 THEN
    RAISE EXCEPTION 'wrapper should have created exactly one ABC-123 vehicle, found %', n_plate;
  END IF;
  IF NOT is_active THEN
    RAISE EXCEPTION 'wrapper created ABC-123 inactive — the route it just started could never be repeated';
  END IF;

  PERFORM public.cancel_pickup_route(r1.id, 'fin de prueba');

  -- Second call, differently formatted, must REUSE the vehicle, not clone it.
  SELECT * INTO r2 FROM public.start_pickup_route('ABC-123'::TEXT);
  IF r2.vehicle_id IS DISTINCT FROM r1.vehicle_id THEN
    RAISE EXCEPTION 'wrapper did not normalize: "  abc-123  " and "ABC-123" resolved to different vehicles (% vs %)',
      r1.vehicle_id, r2.vehicle_id;
  END IF;

  SELECT COUNT(*) INTO n_plate FROM public.vehicles v
   WHERE v.operator_id = 'aaaaaaaa-0000-4000-a000-000000000862'
     AND v.plate = 'ABC-123' AND v.deleted_at IS NULL;
  IF n_plate <> 1 THEN
    RAISE EXCEPTION 'wrapper duplicated the vehicle on the second call, found % rows', n_plate;
  END IF;

  PERFORM public.cancel_pickup_route(r2.id, 'fin de prueba');
END $$;

-- ─── 5/6. reserved plate and inactive vehicle are refused cleanly ──────────
-- Both must be domain errors, never a raw 23505 escaping from
-- uniq_vehicles_operator_plate.
DO $$
DECLARE
  v_case    RECORD;
  rejected  BOOLEAN;
  err_msg   TEXT;
  err_state TEXT;
BEGIN
  FOR v_case IN
    SELECT * FROM (VALUES
      ('SIN-REGISTRO',  'the backfill placeholder plate'),
      ('sin-registro',  'the placeholder plate, lower-case'),
      ('VEH-INACTIVE',  'an existing but inactive vehicle')
    ) AS t(plate, label)
  LOOP
    rejected := FALSE; err_msg := 'no error raised'; err_state := '';
    BEGIN
      PERFORM public.start_pickup_route(v_case.plate::TEXT);
    EXCEPTION WHEN OTHERS THEN
      rejected := TRUE;
      GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT, err_state = RETURNED_SQLSTATE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'TEXT wrapper accepted % (%)', v_case.label, v_case.plate;
    END IF;
    IF err_state = '23505' THEN
      RAISE EXCEPTION 'TEXT wrapper leaked a raw unique violation for % (%): %',
        v_case.label, v_case.plate, err_msg;
    END IF;
    RAISE NOTICE 'wrapper rejected % → %', v_case.label, err_msg;
  END LOOP;
END $$;

-- ─── the wrapper never resurrects the placeholder ──────────────────────────
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM public.vehicles
   WHERE plate = 'SIN-REGISTRO' AND active;
  IF bad <> 0 THEN
    RAISE EXCEPTION '% SIN-REGISTRO placeholder vehicles are active — the wrapper created one', bad;
  END IF;
END $$;

ROLLBACK;
