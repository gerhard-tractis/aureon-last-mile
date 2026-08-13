-- Cross-tenant guard test for SECURITY DEFINER RPCs that accept p_operator_id
--
-- Regression test for the leak fixed in
-- 20260729000001_fix_cross_tenant_definer_rpcs.sql: get_active_routes_with_dispatches
-- and get_unmatched_comunas filtered on the operator_id the CALLER passed, so any
-- authenticated user could read another tenant's data by passing a different UUID.
--
-- Run against a local stack:
--   supabase db reset
--   psql "$DB_URL" -f supabase/tests/cross_tenant_definer_rpcs_test.sql

BEGIN;

-- =============================================================================
-- SETUP: two operators, one user belonging to operator A
-- =============================================================================

INSERT INTO operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-00000000c401'::uuid, 'Guard Test Operator A', 'guard-test-a')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO operators (id, name, slug)
VALUES ('bbbbbbbb-0000-4000-b000-00000000c401'::uuid, 'Guard Test Operator B', 'guard-test-b')
ON CONFLICT (slug) DO NOTHING;

-- public.users.id is FK -> auth.users(id), so the row has to originate there.
-- The on_auth_user_created trigger runs handle_new_user(), which reads BOTH
-- operator_id and role from raw_app_meta_data (raw_user_meta_data supplies only
-- full_name) and raises if operator_id is absent — inserting straight into
-- public.users, as this file used to, violates users_id_fkey and aborts the
-- whole transaction before a single assertion runs.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES (
  'cccccccc-0000-4000-c000-00000000c401'::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','guard-test-user-a@example.com',
  crypt('x', gen_salt('bf')), NOW(),
  '{"operator_id":"aaaaaaaa-0000-4000-a000-00000000c401","role":"admin"}'::jsonb,
  '{"full_name":"Guard Test User A"}'::jsonb,
  NOW(), NOW(), '', ''
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE op UUID;
BEGIN
  SELECT operator_id INTO op FROM public.users
   WHERE id = 'cccccccc-0000-4000-c000-00000000c401';
  IF op IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-00000000c401'::uuid THEN
    RAISE EXCEPTION 'fixture broken: public.users row for the test user has operator_id %', op;
  END IF;
END $$;

-- Act as that user for the rest of the test.
SELECT set_config(
  'request.jwt.claims',
  '{"sub": "cccccccc-0000-4000-c000-00000000c401", "role": "authenticated"}',
  true
);

-- =============================================================================
-- TEST 1: calling with your OWN operator_id succeeds
-- =============================================================================

DO $$
BEGIN
  PERFORM public.get_active_routes_with_dispatches(
    'aaaaaaaa-0000-4000-a000-00000000c401'::uuid,
    CURRENT_DATE
  );
  PERFORM * FROM public.get_unmatched_comunas('aaaaaaaa-0000-4000-a000-00000000c401'::uuid);
  RAISE NOTICE 'TEST 1 PASS: own-tenant calls succeed';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST 1 FAIL: own-tenant call was rejected (% - %)', SQLSTATE, SQLERRM;
END;
$$;

-- =============================================================================
-- TEST 2: get_active_routes_with_dispatches rejects ANOTHER tenant's operator_id
-- =============================================================================

DO $$
BEGIN
  PERFORM public.get_active_routes_with_dispatches(
    'bbbbbbbb-0000-4000-b000-00000000c401'::uuid,
    CURRENT_DATE
  );
  RAISE EXCEPTION 'TEST 2 FAIL: cross-tenant call was allowed — the leak is back';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 2 PASS: cross-tenant routes call rejected with 42501';
END;
$$;

-- =============================================================================
-- TEST 3: get_unmatched_comunas rejects ANOTHER tenant's operator_id
-- =============================================================================

DO $$
BEGIN
  PERFORM * FROM public.get_unmatched_comunas('bbbbbbbb-0000-4000-b000-00000000c401'::uuid);
  RAISE EXCEPTION 'TEST 3 FAIL: cross-tenant call was allowed — the leak is back';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 3 PASS: cross-tenant comunas call rejected with 42501';
END;
$$;

-- =============================================================================
-- TEST 4: service-role context (no auth.uid()) is still allowed cross-tenant
-- =============================================================================

DO $$
BEGIN
  -- No 'sub' claim => auth.uid() is NULL, which is the service-role shape.
  -- Use '{}' rather than NULL: an empty setting fails the ::json cast.
  PERFORM set_config('request.jwt.claims', '{}', true);

  PERFORM public.get_active_routes_with_dispatches(
    'bbbbbbbb-0000-4000-b000-00000000c401'::uuid,
    CURRENT_DATE
  );
  RAISE NOTICE 'TEST 4 PASS: service-role context may still query any tenant';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'TEST 4 FAIL: guard blocked a legitimate service-role call';
END;
$$;

ROLLBACK;
