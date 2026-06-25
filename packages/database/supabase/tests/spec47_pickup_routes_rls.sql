-- spec-47 — pickup_routes RLS isolation
-- Operator A cannot see operator B's pickup_routes / route_receptions.
-- Run inside transaction; ROLLBACK at end.

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pickup_routes'
  ) THEN
    RAISE EXCEPTION 'pickup_routes table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'route_receptions'
  ) THEN
    RAISE EXCEPTION 'route_receptions table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pickup_route_status_enum') THEN
    RAISE EXCEPTION 'pickup_route_status_enum missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.pickup_routes'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on pickup_routes';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.route_receptions'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on route_receptions';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 drivers ───────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000047','Spec47 Op A','spec47-op-a'),
  ('bbbbbbbb-0000-4000-b000-000000000047','Spec47 Op B','spec47-op-b')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000147',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-a@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000147',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-b@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000147','aaaaaaaa-0000-4000-a000-000000000047','driver-a@spec47.test','Driver A',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000147','bbbbbbbb-0000-4000-b000-000000000047','driver-b@spec47.test','Driver B',ARRAY['pickup'])
ON CONFLICT (id) DO NOTHING;

-- Insert one pickup_route per operator via service-role context (no RLS)
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.pickup_routes (operator_id, code, driver_id, status)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000047','PR-TEST-A','aaaaaaaa-0000-4000-a000-000000000147','in_progress'),
  ('bbbbbbbb-0000-4000-b000-000000000047','PR-TEST-B','bbbbbbbb-0000-4000-b000-000000000147','in_progress')
ON CONFLICT DO NOTHING;

-- ─── Operator A's JWT can see only their own ───────────────────────────────
DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000047","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.pickup_routes
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000047';
  SELECT COUNT(*) INTO c_other FROM public.pickup_routes
   WHERE operator_id = 'bbbbbbbb-0000-4000-b000-000000000047';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own route, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B routes, got %', c_other;
  END IF;
  RESET role;
END $$;

ROLLBACK;
