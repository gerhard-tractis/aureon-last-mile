-- pgTAP: spec-80 fase 1b — close_manifest ACL is not inherited-and-unrevoked.
--
-- Fase 1 (20260913000002) did `GRANT EXECUTE ... TO authenticated` with no
-- REVOKE at all. Postgres's implicit default ACL on a new function grants
-- EXECUTE to PUBLIC, and Supabase's own default privileges additionally grant
-- EXECUTE directly TO anon (not by inheriting from PUBLIC — a
-- `REVOKE ... FROM PUBLIC` alone does not touch it). The real proacl on
-- close_manifest today is
-- {=X/postgres, postgres=X, anon=X, authenticated=X, service_role=X}.
--
-- Template: spec85_discrepancies_rpcs.test.sql TEST 15/15b (aclexplode, not
-- has_function_privilege() — that always returns true for the postgres
-- superuser regardless of the real ACL, so it cannot prove a REVOKE happened).

BEGIN;
SELECT plan(2);

-- =============================================================================
-- TEST 1 — no PUBLIC EXECUTE grant (explicit or Postgres's implicit default)
-- survives on close_manifest.
-- =============================================================================
DO $$
DECLARE
  v_leaked BOOLEAN;
BEGIN
  -- A NULL proacl means Postgres's implicit default ACL still applies, which
  -- grants EXECUTE to PUBLIC — that counts as leaked too, same as an explicit
  -- PUBLIC grant found via aclexplode.
  SELECT (p.proacl IS NULL OR EXISTS (
            SELECT 1 FROM aclexplode(p.proacl) a
             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
          ))
    INTO v_leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_manifest';

  IF v_leaked THEN
    RAISE EXCEPTION 'TEST 1 FAILED: PUBLIC still has (or implicitly has) EXECUTE on close_manifest';
  END IF;
END $$;

SELECT pass('TEST 1 PASSED: no PUBLIC EXECUTE grant survives on close_manifest');

-- =============================================================================
-- TEST 2 — `anon` has no EXECUTE on close_manifest.
-- REVOKE ... FROM PUBLIC does not touch this — Supabase grants EXECUTE
-- directly TO anon on every new function via default privileges. There is no
-- live exploit today (the v_operator IS NULL guard rejects an unauthenticated
-- caller with 42501 regardless), but the grant is the exposure this repo's
-- convention closes off before it becomes one.
-- =============================================================================
DO $$
DECLARE
  v_leaked BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
      JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'close_manifest'
       AND p.proacl IS NOT NULL
  ) INTO v_leaked;

  IF v_leaked THEN
    RAISE EXCEPTION 'TEST 2 FAILED: anon still has EXECUTE on close_manifest';
  END IF;
END $$;

SELECT pass('TEST 2 PASSED: anon has no EXECUTE grant on close_manifest');

SELECT * FROM finish();
ROLLBACK;
