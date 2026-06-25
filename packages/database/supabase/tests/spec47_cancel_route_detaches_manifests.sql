-- spec-47 — cancelling a route detaches its manifests (pickup_route_id → NULL)
-- and clears any reception_status that this route set.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000747','Spec47 Cancel','spec47-cancel')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000747',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-cancel@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000747','aaaaaaaa-0000-4000-a000-000000000747','driver-cancel@spec47.test','Driver Cancel',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('eeeeeeee-0000-4000-e000-000000000747','aaaaaaaa-0000-4000-a000-000000000747','CARGA-CANCEL-A','in_progress'),
  ('ffffffff-0000-4000-f000-000000000747','aaaaaaaa-0000-4000-a000-000000000747','CARGA-CANCEL-B','in_progress')
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, status)
VALUES ('55555555-0000-4000-5000-000000000747','aaaaaaaa-0000-4000-a000-000000000747','PR-CANCEL-1',
        'aaaaaaaa-0000-4000-a000-000000000747','in_progress');

UPDATE public.manifests SET pickup_route_id = '55555555-0000-4000-5000-000000000747'
 WHERE id IN ('eeeeeeee-0000-4000-e000-000000000747','ffffffff-0000-4000-f000-000000000747');

-- Cancel the route
UPDATE public.pickup_routes
   SET status = 'cancelled', cancelled_at = NOW()
 WHERE id = '55555555-0000-4000-5000-000000000747';

DO $$
DECLARE attached INT; not_cleared INT;
BEGIN
  SELECT COUNT(*) INTO attached FROM public.manifests
   WHERE pickup_route_id = '55555555-0000-4000-5000-000000000747';
  IF attached <> 0 THEN
    RAISE EXCEPTION 'manifests should detach on cancel, % still attached', attached;
  END IF;

  SELECT COUNT(*) INTO not_cleared FROM public.manifests
   WHERE id IN ('eeeeeeee-0000-4000-e000-000000000747','ffffffff-0000-4000-f000-000000000747')
     AND reception_status IS NOT NULL;
  IF not_cleared <> 0 THEN
    RAISE EXCEPTION 'reception_status should be cleared on cancel, % not cleared', not_cleared;
  END IF;
END $$;

ROLLBACK;
