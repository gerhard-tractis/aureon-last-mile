-- pgTAP: spec-88 fase 2 — assert_operator_access(uuid) distinguishes a real
-- service_role connection from a plain absence of session (anon, or any
-- caller with auth.uid() IS NULL that is NOT actually service_role).
--
-- Before this fase, the guard's only test for "no end user" was
-- `auth.uid() IS NULL`, which is true for BOTH a legitimate service_role
-- caller AND an anon caller with no JWT at all — the early `RETURN` let both
-- through silently. Fase 1 closed the concrete leak with a REVOKE on the ACL
-- (anon/authenticated/PUBLIC can no longer call this function, or the two
-- RPCs that use it as a guard, at all). This fase closes the underlying
-- CLASS of bug: even a caller that reaches the guard's body with
-- auth.uid() IS NULL must now prove, via the JWT's own `role` claim, that it
-- really is service_role — not merely that it has no end-user session.
--
-- Why the guard calls `auth.role()` rather than reading either JWT GUC
-- directly: PostgREST exposes the JWT's `role` claim through two possible
-- GUCs, and which one is populated depends on `PGRST_DB_USE_LEGACY_GUCS` — a
-- deploy-time setting this repo does not control for a managed Supabase
-- project (production). Legacy mode populates only the singular
-- `request.jwt.claim.role`; non-legacy mode populates only the JSON
-- `request.jwt.claims ->> 'role'`. Reading just one of the two is a real bug,
-- not a stylistic choice: whichever source you skip is exactly the one a
-- managed PostgREST might be using, and the guard would then reject every
-- real service_role caller. `auth.role()` — present in every Supabase
-- project, not new schema surface here — already coalesces both sources
-- (`request.jwt.claim.role` first, falling back to
-- `request.jwt.claims ->> 'role'`), the identical two-source shape
-- `auth.uid()` uses for `sub`. Calling it means the guard is correct under
-- either GUC mode without needing to know, or guess, which one production
-- runs. TEST 3b below exercises the legacy-GUC-only case directly — the case
-- a single-source read would get wrong.
--
-- Fixture style follows spec88_assert_operator_access_internal_guard.test.sql.

BEGIN;
SELECT plan(8);

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('dddddddd-dddd-4ddd-8ddd-000000000088', 'Test Op 88 Fase2', 'test-op-88-fase2', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('dddddddd-0000-4000-d000-000000000088',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec88-fase2-user@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"dddddddd-dddd-4ddd-8ddd-000000000088"}'::jsonb,
   '{"full_name":"Spec88 Fase2 User"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('dddddddd-0000-4000-d000-000000000088','dddddddd-dddd-4ddd-8ddd-000000000088',
   'spec88-fase2-user@operators.test','Spec88 Fase2 User',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- =============================================================================
-- TEST 1 — no session at all (no request.jwt.claims set, GUC entirely
-- unset): must be rejected with 42501, NOT the old silent RETURN.
-- =============================================================================
SET LOCAL ROLE service_role;
RESET request.jwt.claims;

SELECT throws_ok(
  $$ SELECT public.assert_operator_access('dddddddd-dddd-4ddd-8ddd-000000000088'::uuid) $$,
  '42501',
  NULL,
  'no request.jwt.claims GUC at all (auth.uid() NULL, no role claim) is rejected, not silently allowed'
);

RESET ROLE;

-- =============================================================================
-- TEST 2 — anon-shaped session: auth.uid() IS NULL, role claim is 'anon' (or
-- claims is an empty object, PostgREST's shape for an anon request with no
-- Authorization header): must be rejected with 42501.
-- =============================================================================
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{}';

SELECT throws_ok(
  $$ SELECT public.assert_operator_access('dddddddd-dddd-4ddd-8ddd-000000000088'::uuid) $$,
  '42501',
  NULL,
  'empty claims object (anon shape) is rejected, not silently allowed'
);

RESET request.jwt.claims;
RESET ROLE;

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

SELECT throws_ok(
  $$ SELECT public.assert_operator_access('dddddddd-dddd-4ddd-8ddd-000000000088'::uuid) $$,
  '42501',
  NULL,
  'explicit role=anon claim (auth.uid() NULL) is rejected, not silently allowed'
);

RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- TEST 3 — genuine service_role: role claim IS 'service_role', auth.uid() IS
-- NULL (service keys carry no 'sub'). Cross-tenant is the intended behavior
-- — the call must succeed for ANY p_operator_id, including one that matches
-- no real operator, because service_role legitimately bypasses tenant
-- scoping.
-- =============================================================================
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';

SELECT lives_ok(
  $$ SELECT public.assert_operator_access('dddddddd-dddd-4ddd-8ddd-000000000088'::uuid) $$,
  'confirmed service_role (role claim = service_role) still passes for its own tenant'
);

SELECT lives_ok(
  $$ SELECT public.assert_operator_access('99999999-9999-4999-8999-999999999999'::uuid) $$,
  'confirmed service_role (role claim = service_role) still passes cross-tenant — intentional bypass preserved'
);

RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- TEST 3b — legacy-GUC-mode service_role: PostgREST with
-- PGRST_DB_USE_LEGACY_GUCS=true (or any managed Supabase project running in
-- that mode, including possibly production — see spec-88 fase 2's review)
-- populates ONLY the singular `request.jwt.claim.role` GUC, never the JSON
-- `request.jwt.claims` object. A discriminator that reads only the JSON GUC
-- sees NULL here and wrongly rejects a real service_role connection. The
-- guard must read both sources, exactly like `auth.role()` already does.
-- =============================================================================
SET LOCAL ROLE service_role;
RESET request.jwt.claims;
SET LOCAL request.jwt.claim.role = 'service_role';

SELECT lives_ok(
  $$ SELECT public.assert_operator_access('dddddddd-dddd-4ddd-8ddd-000000000088'::uuid) $$,
  'confirmed service_role via legacy request.jwt.claim.role GUC (request.jwt.claims unset) still passes'
);

RESET request.jwt.claim.role;
RESET ROLE;

-- =============================================================================
-- TEST 4 — regression: an authenticated caller with a MATCHING operator_id
-- must still pass. This fase only changes the auth.uid() IS NULL branch;
-- the authenticated branch's own logic must be untouched. Calls through a
-- SECURITY DEFINER wrapper (same technique as
-- spec88_assert_operator_access_internal_guard.test.sql) because
-- `authenticated` has no direct EXECUTE grant on assert_operator_access
-- itself since fase 1's REVOKE — a direct call would fail on the ACL, not
-- on the branch this test targets.
-- =============================================================================
CREATE OR REPLACE FUNCTION pg_temp.spec88_fase2_probe(p_operator_id uuid)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM public.assert_operator_access(p_operator_id);
  RETURN 'ok';
END;
$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dddddddd-0000-4000-d000-000000000088","role":"authenticated"}';

SELECT is(
  pg_temp.spec88_fase2_probe('dddddddd-dddd-4ddd-8ddd-000000000088'::uuid),
  'ok',
  'authenticated caller with matching operator_id still passes (unchanged by this fase)'
);

RESET request.jwt.claims;
RESET ROLE;

-- =============================================================================
-- TEST 4b — regression, other branch: an authenticated caller with a
-- MISMATCHED operator_id must still be rejected with 42501. Anchors the
-- `p_operator_id IS DISTINCT FROM get_operator_id()` check itself — TEST 4
-- alone only proves the matching case still works and would not notice that
-- check being deleted outright.
-- =============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"dddddddd-0000-4000-d000-000000000088","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT pg_temp.spec88_fase2_probe('99999999-9999-4999-8999-999999999999'::uuid) $$,
  '42501',
  NULL,
  'authenticated caller with a MISMATCHED operator_id is still rejected (unchanged by this fase)'
);

RESET request.jwt.claims;
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
