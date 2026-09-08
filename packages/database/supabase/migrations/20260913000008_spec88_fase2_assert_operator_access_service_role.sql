-- =============================================================================
-- spec-88 fase 2 — assert_operator_access distinguishes real service_role
-- from a plain absence of session (anon, or any caller with auth.uid() IS
-- NULL that is not actually service_role).
-- =============================================================================
-- Auditoría completa y diseño: docs/specs/spec-88-anon-security-definer-audit.md
-- ("El problema de assert_operator_access — la decisión de diseño de este
-- spec"). Templated from 20260821000002's CREATE OR REPLACE — the LATEST
-- definition of this function's body, per CLAUDE.md; 20260913000006 (fase 1
-- of this same spec) only touched the ACL, never the body.
--
-- THE BUG THIS FASE CLOSES (the class, not just the case fase 1 already
-- closed via REVOKE): the guard's only test for "no end-user session" was
-- `auth.uid() IS NULL`, true for BOTH a legitimate service_role caller
-- (worker/cron/backend, cross-tenant intentional) and an anon caller with no
-- JWT at all. The early RETURN let both through silently. Fase 1 revoked
-- PUBLIC/anon/authenticated on this function and on its only two callers
-- (get_active_routes_with_dispatches, get_unmatched_comunas), so the
-- concrete leak is closed today. But any FUTURE SECURITY DEFINER function
-- that reuses this guard and receives a broad grant is exposed again by the
-- same silent RETURN. This fase removes that possibility at the source.
--
-- WHY `request.jwt.claims ->> 'role'`, NOT `request.jwt.claim.role` (a
-- documented deviation from the spec's literal proposed snippet):
-- infra/supabase-qa/docker-compose.yml sets PGRST_DB_USE_LEGACY_GUCS=false
-- for the `rest` (PostgREST) service. With legacy GUCs off, PostgREST never
-- populates the per-claim GUCs (`request.jwt.claim.role`, `.sub`, etc.) —
-- only the single JSON GUC `request.jwt.claims`. auth.uid() itself already
-- reads claims this way (standard Supabase definition:
-- `request.jwt.claims::json->>'sub'`), and this repo's own RLS policies do
-- the same for `role`
-- (20260413000004_spec33_pickup_points_write_rls.sql). Using
-- `request.jwt.claim.role` as the spec's design section literally shows
-- would read a GUC that is NEVER set in this project's real PostgREST
-- config — always NULL, always failing the service_role check, breaking
-- every service_role caller. Using the JSON claims GUC is the same
-- distinction the spec asks for, expressed the way this project's
-- PostgREST actually exposes it.
--
-- INVENTORY OF service_role CALLERS (required before this rewrite lands,
-- per the spec's fase 2 checklist): assert_operator_access is invoked from
-- exactly two places in this repo's SQL —
-- get_active_routes_with_dispatches(uuid,date) and
-- get_unmatched_comunas(uuid) (confirmed:
-- `git grep -n "PERFORM public.assert_operator_access"` across
-- packages/database/supabase/migrations returns only those two call sites,
-- plus this function's own definition). Both RPCs' only real consumers in
-- this repo are apps/frontend/src/hooks/useActiveRoutes.ts and
-- apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts, both via
-- createSPAClient() — an authenticated browser session, never a
-- service_role key. `git grep`/`grep -rl` across apps/agents, apps/worker,
-- apps/frontend/src/app/api, packages/database/supabase/functions,
-- apps/frontend/supabase/functions, and scripts/*.mjs for
-- "get_active_routes_with_dispatches", "get_unmatched_comunas", and
-- "assert_operator_access" returns ZERO hits outside the frontend hooks
-- above and the SQL migrations themselves. Conclusion: there is currently
-- NO real service_role caller of assert_operator_access anywhere in this
-- codebase — the auth.uid() IS NULL branch is reachable today only via
-- direct service_role key use against PostgREST (not exercised by any
-- shipped code path) or via psql as service_role. This rewrite cannot break
-- an existing service_role path because none exists; it only closes the
-- possibility for a FUTURE one to be silently over-trusted. Tested against
-- both roles below and in
-- tests/spec88_fase2_assert_operator_access_service_role.test.sql.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_operator_access(p_operator_id UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- No end-user session. This is legitimate ONLY for a confirmed
    -- service_role connection (worker/cron/backend, cross-tenant
    -- intended) — never inferred merely from the absence of auth.uid().
    -- An anon caller, or any caller whose JWT role claim is not
    -- service_role, reaches this branch with auth.uid() IS NULL too, and
    -- must now be rejected explicitly rather than let through silently.
    IF NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
         IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'operator_id mismatch: caller may not access another tenant''s data'
        USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  IF p_operator_id IS DISTINCT FROM public.get_operator_id() THEN
    RAISE EXCEPTION 'operator_id mismatch: caller may not access another tenant''s data'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_operator_access(UUID) IS
  'Raises 42501 when an authenticated caller passes an operator_id other than their own, and when a caller with no end-user session cannot prove it is a real service_role connection via the request.jwt.claims role claim. Use in any SECURITY DEFINER function that accepts p_operator_id. (spec-88 fase 2)';

-- ACL is untouched by this migration — fase 1 (20260913000006) already
-- revoked PUBLIC/anon/authenticated and left only the pre-existing GRANT TO
-- service_role from 20260729000001. CREATE OR REPLACE preserves the ACL of
-- an existing function; nothing here undoes fase 1's REVOKE.

-- =============================================================================
-- Validation — one-time, proving this migration installed the new branch
-- and did not regress the ACL fase 1 already closed.
-- =============================================================================
DO $validate$
DECLARE
  v_src TEXT;
  v_has_public  BOOLEAN;
  v_has_anon    BOOLEAN;
  v_has_authenticated BOOLEAN;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'assert_operator_access is missing after this migration';
  END IF;
  IF v_src NOT LIKE '%service_role%' THEN
    RAISE EXCEPTION 'assert_operator_access does not check the service_role claim — rewrite did not land';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
    WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
      AND a.grantee = 0 -- PUBLIC
  ) INTO v_has_public;
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
    JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
    WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
  ) INTO v_has_anon;
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
    JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
    WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
  ) INTO v_has_authenticated;

  IF v_has_public THEN
    RAISE EXCEPTION 'assert_operator_access: CREATE OR REPLACE reopened PUBLIC — fase 1''s REVOKE was undone';
  END IF;
  IF v_has_anon THEN
    RAISE EXCEPTION 'assert_operator_access: CREATE OR REPLACE reopened anon — fase 1''s REVOKE was undone';
  END IF;
  IF v_has_authenticated THEN
    RAISE EXCEPTION 'assert_operator_access: CREATE OR REPLACE reopened authenticated — fase 1''s REVOKE was undone';
  END IF;

  RAISE NOTICE '✓ spec-88 fase 2 — assert_operator_access now requires a confirmed service_role claim, ACL from fase 1 intact';
END $validate$;

COMMIT;
