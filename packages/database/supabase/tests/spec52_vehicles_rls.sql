-- spec-52 Task 1 — vehicles table RLS + uniqueness isolation
-- Operator A cannot see operator B's vehicles. Partial unique index on
-- (operator_id, plate) WHERE deleted_at IS NULL rejects live duplicates but
-- allows re-use of a plate once the prior row is soft-deleted.
-- Run inside transaction; ROLLBACK at end.

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicles'
  ) THEN
    RAISE EXCEPTION 'vehicles table missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vehicles'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on vehicles';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users ──────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000052','Spec52 Op A','spec52-op-a'),
  ('bbbbbbbb-0000-4000-b000-000000000052','Spec52 Op B','spec52-op-b')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000152',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec52.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000152',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec52.test', crypt('x', gen_salt('bf')), NOW(),
   '{}'::jsonb,'{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- NOTE: unlike spec47_pickup_routes_rls.sql, we set `sub` to a real
-- public.users.id below — public.get_operator_id() resolves via
-- auth.uid() -> public.users, so a claims object without `sub` never
-- resolves to an operator and every RLS check silently fails-closed.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000152','aaaaaaaa-0000-4000-a000-000000000052','user-a@spec52.test','User A',ARRAY['admin']),
  ('bbbbbbbb-0000-4000-b000-000000000152','bbbbbbbb-0000-4000-b000-000000000052','user-b@spec52.test','User B',ARRAY['admin'])
ON CONFLICT (id) DO NOTHING;

-- Insert one vehicle per operator via service-role context (no RLS)
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO public.vehicles (operator_id, plate, vehicle_type)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000052','SPEC52-A','van'),
  ('bbbbbbbb-0000-4000-b000-000000000052','SPEC52-B','van')
ON CONFLICT DO NOTHING;

-- ─── Operator A's JWT can see only their own vehicle ───────────────────────
DO $$
DECLARE c_own INT; c_other INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000152","operator_id":"aaaaaaaa-0000-4000-a000-000000000052","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.vehicles
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000052';
  SELECT COUNT(*) INTO c_other FROM public.vehicles
   WHERE operator_id = 'bbbbbbbb-0000-4000-b000-000000000052';

  IF c_own < 1 THEN
    RAISE EXCEPTION 'operator A should see its own vehicle, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'operator A leaked operator B vehicle, got %', c_other;
  END IF;
  RESET role;
END $$;

-- ─── Partial unique index rejects a live duplicate (operator_id, plate) ────
DO $$
DECLARE dup_rejected BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    INSERT INTO public.vehicles (operator_id, plate, vehicle_type)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000052','SPEC52-A','truck');
  EXCEPTION WHEN unique_violation THEN
    dup_rejected := true;
  END;

  IF NOT dup_rejected THEN
    RAISE EXCEPTION 'duplicate (operator_id, plate) was not rejected while deleted_at IS NULL';
  END IF;
END $$;

-- ─── Same plate allowed again once the first row is soft-deleted ──────────
DO $$
DECLARE reinsert_ok BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  UPDATE public.vehicles SET deleted_at = NOW()
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000052' AND plate = 'SPEC52-A';

  BEGIN
    INSERT INTO public.vehicles (operator_id, plate, vehicle_type)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000052','SPEC52-A','truck');
    reinsert_ok := true;
  EXCEPTION WHEN unique_violation THEN
    reinsert_ok := false;
  END;

  IF NOT reinsert_ok THEN
    RAISE EXCEPTION 'plate reuse after soft-delete was wrongly rejected';
  END IF;
END $$;

ROLLBACK;
