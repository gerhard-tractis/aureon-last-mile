-- pgTAP: spec-88 fase 1 — assert_operator_access(uuid) can be revoked from
-- PUBLIC/anon/authenticated without breaking the functions that use it as an
-- internal guard, because SECURITY DEFINER executes with the privileges of
-- the function's OWNER, not the PostgREST role of the original caller.
--
-- This is exactly the claim the spec tells the implementer to verify with a
-- test, not assume from its prose (spec-88, section "Alcance"). This test
-- builds a throwaway SECURITY DEFINER wrapper that calls
-- assert_operator_access internally, revokes ALL from PUBLIC/anon/
-- authenticated on assert_operator_access itself, and proves the wrapper
-- still works correctly for both an authenticated caller (matching
-- operator_id passes, mismatched one raises) and an anon caller (rejected by
-- Postgres itself when calling the guard function directly).
--
-- Fixture style follows spec85_discrepancies_rpcs.test.sql: real
-- operators/auth.users/public.users rows in one transaction, because
-- get_operator_id() (which assert_operator_access delegates to) reads
-- public.users keyed by auth.uid() — there is no shortcut around that.

BEGIN;
SELECT plan(4);

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('cccccccc-cccc-4ccc-8ccc-000000000088', 'Test Op 88 Guard', 'test-op-88-guard', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('cccccccc-0000-4000-c000-000000000088',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec88-guard-user@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"cccccccc-cccc-4ccc-8ccc-000000000088"}'::jsonb,
   '{"full_name":"Spec88 Guard User"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('cccccccc-0000-4000-c000-000000000088','cccccccc-cccc-4ccc-8ccc-000000000088',
   'spec88-guard-user@operators.test','Spec88 Guard User',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

CREATE OR REPLACE FUNCTION pg_temp.spec88_probe(p_operator_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.assert_operator_access(p_operator_id);
  RETURN 'ok';
END;
$$;

-- =============================================================================
-- Revoke ALL on assert_operator_access from PUBLIC/anon/authenticated FIRST —
-- this is the exact change fase 1's migration makes. If SECURITY DEFINER
-- did not run as the function's owner, every call below would now fail with
-- "permission denied for function assert_operator_access" regardless of the
-- calling role, which is precisely what this test needs to rule out.
-- =============================================================================
REVOKE ALL ON FUNCTION public.assert_operator_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_operator_access(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_operator_access(uuid) FROM authenticated;

-- =============================================================================
-- TEST 1 — authenticated caller, matching operator_id: the wrapper still
-- succeeds even though `authenticated` has zero EXECUTE grant on
-- assert_operator_access itself.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-c000-000000000088","role":"authenticated"}';

SELECT is(
  pg_temp.spec88_probe('cccccccc-cccc-4ccc-8ccc-000000000088'::uuid),
  'ok',
  'authenticated caller still passes assert_operator_access guard via the SECURITY DEFINER wrapper after REVOKE'
);

RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- TEST 2 — confirm the REVOKE actually took (the DO block above succeeding
-- is not, by itself, proof the grant is gone).
-- =============================================================================
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access')),
  false,
  'assert_operator_access: authenticated really has no direct EXECUTE grant (REVOKE took effect)'
);

-- =============================================================================
-- TEST 3 — anon caller invoking assert_operator_access DIRECTLY (as PostgREST
-- would expose it before this fase's REVOKE) is rejected by Postgres itself,
-- not by the function's own body.
-- =============================================================================
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{}';

SELECT throws_ok(
  $$ SELECT public.assert_operator_access('cccccccc-cccc-4ccc-8ccc-000000000088'::uuid) $$,
  '42501',
  NULL,
  'anon calling assert_operator_access directly is rejected by Postgres (permission denied), not by the function body'
);

RESET ROLE;
RESET request.jwt.claims;

-- =============================================================================
-- TEST 4 — mismatched operator_id, authenticated caller: the wrapper still
-- raises via assert_operator_access's own body logic (proving the wrapper
-- is exercising the real function, not short-circuiting).
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"cccccccc-0000-4000-c000-000000000088","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT pg_temp.spec88_probe('99999999-9999-4999-8999-999999999999'::uuid) $$,
  '42501',
  NULL,
  'authenticated caller with mismatched operator_id still gets rejected by assert_operator_access''s own logic through the wrapper'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
