-- spec-47 — single-active-route partial unique index
-- A second in_progress (or draft) route for the same (operator_id, driver_id) is rejected.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000247','Spec47 Single','spec47-single')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000247',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-single@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000247','aaaaaaaa-0000-4000-a000-000000000247','driver-single@spec47.test','Driver Single',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pickup_routes (operator_id, code, driver_id, status)
VALUES ('aaaaaaaa-0000-4000-a000-000000000247','PR-SINGLE-1','aaaaaaaa-0000-4000-a000-000000000247','in_progress');

-- Second active route attempt should be rejected by partial unique index
DO $$
DECLARE rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.pickup_routes (operator_id, code, driver_id, status)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000247','PR-SINGLE-2','aaaaaaaa-0000-4000-a000-000000000247','in_progress');
  EXCEPTION WHEN unique_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'second in_progress route for same driver should have been rejected';
  END IF;
END $$;

-- But a route in non-active terminal status is fine
INSERT INTO public.pickup_routes (operator_id, code, driver_id, status, received_at)
VALUES ('aaaaaaaa-0000-4000-a000-000000000247','PR-SINGLE-3','aaaaaaaa-0000-4000-a000-000000000247','received', NOW());

-- And after the active row is soft-deleted, a new in_progress one is allowed
UPDATE public.pickup_routes SET deleted_at = NOW() WHERE code = 'PR-SINGLE-1';

INSERT INTO public.pickup_routes (operator_id, code, driver_id, status)
VALUES ('aaaaaaaa-0000-4000-a000-000000000247','PR-SINGLE-4','aaaaaaaa-0000-4000-a000-000000000247','in_progress');

ROLLBACK;
