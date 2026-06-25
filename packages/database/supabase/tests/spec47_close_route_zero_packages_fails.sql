-- spec-47 — close_pickup_route raises when route has zero verified scans

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000447','Spec47 Zero','spec47-zero')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000447',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-zero@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000447','aaaaaaaa-0000-4000-a000-000000000447','driver-zero@spec47.test','Driver Zero',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, status)
VALUES ('22222222-0000-4000-2000-000000000447','aaaaaaaa-0000-4000-a000-000000000447','PR-ZERO-1',
        'aaaaaaaa-0000-4000-a000-000000000447','in_progress');

-- Simulate the driver's JWT
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000447","operator_id":"aaaaaaaa-0000-4000-a000-000000000447","role":"authenticated"}',
  true);

DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.close_pickup_route('22222222-0000-4000-2000-000000000447'::UUID);
  EXCEPTION WHEN OTHERS THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'close_pickup_route should reject route with zero verified scans';
  END IF;
END $$;

ROLLBACK;
