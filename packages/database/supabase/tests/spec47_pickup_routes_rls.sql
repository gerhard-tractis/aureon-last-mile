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

-- operator_id MUST live in raw_app_meta_data: public.handle_new_user()
-- (trigger on_auth_user_created) reads NEW.raw_app_meta_data->>'operator_id'
-- and raises 'operator_id required in signup metadata' without it.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000147',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-a@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000047"}'::jsonb,
   '{"full_name":"Driver A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000147',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'driver-b@spec47.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000047"}'::jsonb,
   '{"full_name":"Driver B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows, and
-- DO NOTHING would silently discard `permissions`.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000147','aaaaaaaa-0000-4000-a000-000000000047','driver-a@spec47.test','Driver A',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000147','bbbbbbbb-0000-4000-b000-000000000047','driver-b@spec47.test','Driver B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- Insert one vehicle + one pickup_route per operator via service-role context
-- (no RLS). pickup_routes.vehicle_id is NOT NULL as of spec-52.
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES
  ('99999999-0000-4000-9000-000000000047','aaaaaaaa-0000-4000-a000-000000000047','VEH-RLS-A', true),
  ('88888888-0000-4000-8000-000000000047','bbbbbbbb-0000-4000-b000-000000000047','VEH-RLS-B', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, status)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000047','PR-TEST-A','aaaaaaaa-0000-4000-a000-000000000147','99999999-0000-4000-9000-000000000047','in_progress'),
  ('bbbbbbbb-0000-4000-b000-000000000047','PR-TEST-B','bbbbbbbb-0000-4000-b000-000000000147','88888888-0000-4000-8000-000000000047','in_progress')
ON CONFLICT DO NOTHING;

-- ─── Operator A's JWT can see only their own ───────────────────────────────
DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  -- `sub` is mandatory, not decoration: public.get_operator_id() is
  -- SELECT operator_id FROM public.users WHERE id = auth.uid(). Without `sub`
  -- auth.uid() is NULL, get_operator_id() is NULL, and RLS fails closed —
  -- the operator sees zero of its OWN rows and this test fails.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000147","operator_id":"aaaaaaaa-0000-4000-a000-000000000047","role":"authenticated"}', true);
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
