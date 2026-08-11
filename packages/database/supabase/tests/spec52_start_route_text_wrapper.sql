-- spec-52 Task 3 — start_pickup_route(TEXT), the DEPRECATED compat wrapper
--
-- Split out of spec52_vehicle_constraints.sql to keep both files under the
-- 300-line limit. That file covers the real RPC and the indexes.
--
-- The wrapper exists because merging auto-deploys and the frontend still calls
-- start_pickup_route(p_vehicle_label) at useStartPickupRoute.ts:18. .rpc() args
-- are not checked against the generated types, so dropping the signature would
-- break driver route creation with nothing red in CI. Task 8 removes it.
--
-- Asserted here: (1) the overload exists; (2/3/4) a new plate is created active
-- and bound, an existing plate is REUSED not duplicated, '  abc-123  ' and
-- 'ABC-123' normalize equal; (5/6) the reserved SIN-REGISTRO plate and an
-- inactive vehicle are refused with domain errors, never a raw 23505.
--
-- (7) A BLANK label (NULL / '' / '   ') succeeds and binds to the operator's
-- inactive SIN-REGISTRO placeholder. StartRouteButton.tsx:61 calls the field
-- "Vehículo (opcional)" and :32 sends `label.trim() || null`, so this is the
-- common path, not an edge case — raising would hard-error every driver who
-- taps Iniciar without typing a plate.
--
-- (8) Concurrent blank-label routes BOTH succeed, and two drivers typing the
-- same label both succeed sharing one vehicle row — the regression the
-- deferred per-vehicle unique index would have caused.
--
-- Run inside transaction; ROLLBACK at end.

BEGIN;

-- ─── Fixture: 1 operator, 4 drivers, 1 inactive vehicle ───────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000862','Spec52 Wrap','spec52-wrap')
ON CONFLICT (slug) DO NOTHING;

-- operator_id MUST live in raw_app_meta_data: public.handle_new_user() reads
-- NEW.raw_app_meta_data->>'operator_id' and raises without it.
-- Four drivers from one VALUES list, not four copies of the auth.users shape.
CREATE TEMP TABLE spec52_wrap_drivers ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('aaaaaaaa-0000-4000-a000-000000000863'::uuid,'driver-wrap@spec52veh.test','Driver Wrap'),
  ('aaaaaaaa-0000-4000-a000-000000000864'::uuid,'driver-wrap2@spec52veh.test','Driver Wrap 2'),
  ('aaaaaaaa-0000-4000-a000-000000000865'::uuid,'driver-wrap3@spec52veh.test','Driver Wrap 3'),
  ('aaaaaaaa-0000-4000-a000-000000000866'::uuid,'driver-wrap4@spec52veh.test','Driver Wrap 4')
) AS d(id, email, full_name);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
)
SELECT d.id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       d.email, crypt('x', gen_salt('bf')), NOW(),
       '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000862"}'::jsonb,
       jsonb_build_object('full_name', d.full_name), NOW(), NOW(), '', ''
  FROM spec52_wrap_drivers d
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
SELECT d.id, 'aaaaaaaa-0000-4000-a000-000000000862', d.email, d.full_name, ARRAY['pickup']
  FROM spec52_wrap_drivers d
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
  -- match on proargtypes: pg_get_function_identity_arguments prefixes the
  -- parameter name ("p_vehicle_label text") and never equals 'text'.
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
  -- New plate created on the fly, active, route bound. Note the untrimmed,
  -- lower-case input: normalization is the whole point.
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

-- ─── 7. blank label succeeds and lands on the inactive placeholder ─────────
-- NULL, '' and '   ' must all behave identically. This is the path the
-- deployed frontend takes whenever the optional field is left empty.
DO $$
DECLARE
  v_route       public.pickup_routes;
  v_active      BOOLEAN;
  v_drivers     TEXT[] := ARRAY[
    'aaaaaaaa-0000-4000-a000-000000000863',
    'aaaaaaaa-0000-4000-a000-000000000864',
    'aaaaaaaa-0000-4000-a000-000000000865'];
  v_labels      TEXT[] := ARRAY[NULL, '', '   '];
  v_seen        UUID;
  i             INT;
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_drivers[i],
                        'operator_id','aaaaaaaa-0000-4000-a000-000000000862',
                        'role','authenticated')::text, true);

    SELECT * INTO v_route FROM public.start_pickup_route(v_labels[i]::TEXT);
    IF v_route.id IS NULL THEN
      RAISE EXCEPTION 'blank label #% was rejected — every driver who leaves "Vehículo (opcional)" empty would get a hard error', i;
    END IF;

    IF v_route.vehicle_label IS NOT NULL THEN
      RAISE EXCEPTION 'a blank-label route should record vehicle_label NULL, got %', v_route.vehicle_label;
    END IF;

      -- All three must land on the SAME placeholder row...
    IF v_seen IS NULL THEN
      v_seen := v_route.vehicle_id;
    ELSIF v_route.vehicle_id IS DISTINCT FROM v_seen THEN
      RAISE EXCEPTION 'blank labels resolved to different vehicles (% vs %)', v_seen, v_route.vehicle_id;
    END IF;
  END LOOP;

  -- ...which must be the inactive SIN-REGISTRO placeholder, not a real truck.
  SELECT active INTO v_active FROM public.vehicles WHERE id = v_seen;
  IF v_active THEN
    RAISE EXCEPTION 'blank-label routes bound to an ACTIVE vehicle — the placeholder must stay unselectable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = v_seen AND plate = 'SIN-REGISTRO') THEN
    RAISE EXCEPTION 'blank-label routes did not bind to the SIN-REGISTRO placeholder';
  END IF;
END $$;

-- ─── 8a. three drivers now hold concurrent blank-label routes ──────────────
-- The regression guard: with uniq_pickup_routes_one_active_per_vehicle in
-- place, drivers 2 and 3 would have been blocked outright.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.pickup_routes
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000862'
     AND status = 'in_progress' AND deleted_at IS NULL
     AND vehicle_id IN (SELECT id FROM public.vehicles
                         WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000862'
                           AND plate = 'SIN-REGISTRO');
  IF n <> 3 THEN
    RAISE EXCEPTION 'expected 3 concurrent blank-label routes sharing the placeholder, found %', n;
  END IF;
END $$;

-- ─── 8b. the per-DRIVER index still bites, even on the placeholder ─────────
DO $$
DECLARE con TEXT := ''; rejected BOOLEAN := FALSE; v_placeholder UUID;
BEGIN
  SELECT id INTO v_placeholder FROM public.vehicles
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000862' AND plate = 'SIN-REGISTRO';
  BEGIN
    INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, status)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000862','PR-WRAP-DUP',
            'aaaaaaaa-0000-4000-a000-000000000863', v_placeholder, 'in_progress');
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE;
    GET STACKED DIAGNOSTICS con = CONSTRAINT_NAME;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'a second active route for the same driver was accepted on the placeholder';
  END IF;
  IF con <> 'uniq_pickup_routes_one_active_per_driver' THEN
    RAISE EXCEPTION 'expected uniq_pickup_routes_one_active_per_driver to reject it, got %', con;
  END IF;
END $$;

-- ─── 8c. two drivers typing the SAME label both succeed, sharing one row ───
DO $$
DECLARE r_a public.pickup_routes; r_b public.pickup_routes; n_plate INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000866","operator_id":"aaaaaaaa-0000-4000-a000-000000000862","role":"authenticated"}', true);
  SELECT * INTO r_a FROM public.start_pickup_route('camion 1'::TEXT);

  -- Driver Wrap 2's blank route is cancelled so they can take a typed one.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000864","operator_id":"aaaaaaaa-0000-4000-a000-000000000862","role":"authenticated"}', true);
  PERFORM public.cancel_pickup_route(
    (SELECT id FROM public.pickup_routes
      WHERE driver_id = 'aaaaaaaa-0000-4000-a000-000000000864'
        AND status = 'in_progress' AND deleted_at IS NULL), 'cambio de vehículo');
  SELECT * INTO r_b FROM public.start_pickup_route('CAMION 1'::TEXT);

  IF r_b.vehicle_id IS DISTINCT FROM r_a.vehicle_id THEN
    RAISE EXCEPTION 'same typed label produced two vehicles (% vs %)', r_a.vehicle_id, r_b.vehicle_id;
  END IF;
  SELECT COUNT(*) INTO n_plate FROM public.vehicles
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000862'
     AND plate = 'CAMION 1' AND deleted_at IS NULL;
  IF n_plate <> 1 THEN
    RAISE EXCEPTION 'expected one CAMION 1 vehicle row, found %', n_plate;
  END IF;
  IF r_a.vehicle_label IS DISTINCT FROM 'CAMION 1' THEN
    RAISE EXCEPTION 'vehicle_label should carry the normalized plate, got %',
      COALESCE(r_a.vehicle_label,'<NULL>');
  END IF;
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
