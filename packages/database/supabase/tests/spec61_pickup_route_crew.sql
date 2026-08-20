-- spec-61 Task 1.2 — pickup_route_crew: shape, RLS, one active seat per person,
-- and removed_at tracking the route's status.
BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000610','Spec61 Crew','spec61-crew')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000611','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Uno"}'::jsonb, NOW(), NOW(), '', ''),
  ('aaaaaaaa-0000-4000-a000-000000000612','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows
-- (same pattern as tests/spec47_single_active_route_per_driver.sql:23).
INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000611','aaaaaaaa-0000-4000-a000-000000000610',
   'pickup_leader','leader@spec61.test','Lider Uno',ARRAY['pickup']),
  ('aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000610',
   'pickup_crew','crew@spec61.test','Ana Perez',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
  ('99999999-0000-4000-9000-000000000611','aaaaaaaa-0000-4000-a000-000000000610','VEH-61-1', true),
  ('99999999-0000-4000-9000-000000000612','aaaaaaaa-0000-4000-a000-000000000610','VEH-61-2', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
  ('77777777-0000-4000-7000-000000000611','aaaaaaaa-0000-4000-a000-000000000610',
   'PR-61-A','aaaaaaaa-0000-4000-a000-000000000611','99999999-0000-4000-9000-000000000611','in_progress');

-- 1. RLS is on and the tenant policy exists (sibling shape: vehicles, pickup_routes).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='pickup_route_crew' AND relrowsecurity) THEN
    RAISE EXCEPTION 'pickup_route_crew does not have RLS enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename='pickup_route_crew'
                    AND policyname='pickup_route_crew_tenant_isolation') THEN
    RAISE EXCEPTION 'pickup_route_crew_tenant_isolation policy missing';
  END IF;
END $$;

-- 2. A crew seat can be taken.
INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000611',
        'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');

-- 3. The same person cannot hold a second active seat, and the named index says so.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('77777777-0000-4000-7000-000000000613','aaaaaaaa-0000-4000-a000-000000000610',
        'PR-61-B','aaaaaaaa-0000-4000-a000-000000000611','99999999-0000-4000-9000-000000000612','received');

DO $$
DECLARE rejected BOOLEAN := FALSE; con TEXT := '';
BEGIN
  BEGIN
    INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000613',
            'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE; GET STACKED DIAGNOSTICS con = CONSTRAINT_NAME;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'a second active crew seat for the same person should have been rejected';
  END IF;
  IF con <> 'uniq_pickup_route_crew_one_active_per_user' THEN
    RAISE EXCEPTION 'expected uniq_pickup_route_crew_one_active_per_user, got %', con;
  END IF;
END $$;

-- 4. Closing the route frees the seat (removed_at stamped by the trigger).
UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
 WHERE id = '77777777-0000-4000-7000-000000000611';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.pickup_route_crew
              WHERE pickup_route_id='77777777-0000-4000-7000-000000000611'
                AND removed_at IS NULL) THEN
    RAISE EXCEPTION 'crew of a closed route should have been stamped removed_at';
  END IF;
END $$;

INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000613',
        'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');

-- 5. Reopening restores only seats whose holder is free (a reopen must never
--    abort on a 23505 -- reopen_pickup_route is the receptionist's undo).
UPDATE public.pickup_routes SET status = 'in_progress'
 WHERE id = '77777777-0000-4000-7000-000000000611';

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM public.pickup_route_crew
   WHERE user_id='aaaaaaaa-0000-4000-a000-000000000612' AND removed_at IS NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'exactly one active seat expected after reopen, found %', n;
  END IF;
END $$;

-- 6. handle_new_user gives a pickup_leader the pickup permission.
DO $$
DECLARE v_perms TEXT[];
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token
  ) VALUES (
    'aaaaaaaa-0000-4000-a000-000000000619','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','fresh-leader@spec61.test',
    crypt('x', gen_salt('bf')), NOW(),
    '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_leader"}'::jsonb,
    '{"full_name":"Lider Nuevo"}'::jsonb, NOW(), NOW(), '', ''
  );
  SELECT permissions INTO v_perms FROM public.users
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000619';
  IF NOT ('pickup' = ANY(v_perms)) THEN
    RAISE EXCEPTION 'a new pickup_leader must get the pickup permission, got %', v_perms;
  END IF;
END $$;

ROLLBACK;
