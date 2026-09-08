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
-- Why `request.jwt.claims ->> 'role'`, not `request.jwt.claim.role`: this
-- project's PostgREST runs with PGRST_DB_USE_LEGACY_GUCS=false
-- (infra/supabase-qa/docker-compose.yml), so PostgREST never populates the
-- legacy per-claim GUCs (`request.jwt.claim.role` et al) — only the single
-- JSON GUC `request.jwt.claims`. auth.uid() itself already reads claims this
-- way (`request.jwt.claims::json->>'sub'`), and this repo's own RLS
-- policies do the same for `role` (see
-- 20260413000004_spec33_pickup_points_write_rls.sql). The spec's own text
-- proposes `request.jwt.claim.role`; this test (and the migration it drives)
-- deliberately deviates from that literal wording because it would read an
-- unset GUC and always be NULL in this project's real PostgREST config —
-- silently reproducing the exact bug this fase exists to close, just one
-- layer further down.
--
-- Fixture style follows spec88_assert_operator_access_internal_guard.test.sql.

BEGIN;
SELECT plan(6);

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

SELECT * FROM finish();
ROLLBACK;
