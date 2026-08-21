-- Every SECURITY DEFINER RPC that accepts a caller-supplied p_operator_id must
-- authorise the caller. If it does not, any authenticated user reads or writes
-- another tenant's data simply by passing that tenant's UUID.
--
-- This is a CLASS check, deliberately. cross_tenant_definer_rpcs_test.sql pins
-- two specific functions by calling them; it says nothing about the sixth one
-- somebody adds next month. This file needs no fixture and no role switching:
-- it reads the catalogue, so a new unguarded function fails it the first time
-- it is deployed.
--
-- It exists because get_active_routes_with_dispatches silently lost its guard
-- (20260310000004's pre-fix body was re-applied over 20260729000001's) and sat
-- open on QA until the SQL suite was switched on.
--
-- Two accepted authorisation shapes:
--   * public.assert_operator_access(p_operator_id) — raises 42501 unless the
--     id is the caller's own, resolved from public.users via auth.uid().
--   * public.is_super_admin() — the spec-45 module RPCs, which deliberately
--     let a super_admin act across tenants and otherwise compare the caller's
--     own operator claim to p_operator_id.
--
-- Adding a third shape is fine. Add it here in the same breath, with a comment
-- saying why it is sound — do not widen this to "contains the word RAISE".

BEGIN;

DO $$
DECLARE
  v_bad TEXT;
  v_n   INT;
BEGIN
  SELECT count(*), string_agg(sig, ', ' ORDER BY sig)
    INTO v_n, v_bad
    FROM (
      SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef                                    -- SECURITY DEFINER
         AND pg_get_function_identity_arguments(p.oid) LIKE '%p_operator_id%'
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND p.proname <> 'assert_operator_access'           -- it IS the guard
         AND p.prosrc NOT LIKE '%assert_operator_access%'
         AND p.prosrc NOT LIKE '%is_super_admin%'
    ) unguarded;

  IF v_n <> 0 THEN
    RAISE EXCEPTION
      '% SECURITY DEFINER RPC(s) take a caller-supplied p_operator_id with no tenant guard: %',
      v_n, v_bad;
  END IF;
END $$;

-- The check above is only meaningful if the catalogue query actually matches
-- the functions it is supposed to police. A predicate typo (wrong nspname, a
-- LIKE that never hits) would make it vacuously green forever, which is the
-- failure mode this repo has hit repeatedly. So assert the population is
-- non-empty and contains the two functions the original leak was found in.
DO $$
DECLARE v_total INT; v_have_routes BOOL; v_have_comunas BOOL;
BEGIN
  SELECT count(*),
         bool_or(p.proname = 'get_active_routes_with_dispatches'),
         bool_or(p.proname = 'get_unmatched_comunas')
    INTO v_total, v_have_routes, v_have_comunas
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND pg_get_function_identity_arguments(p.oid) LIKE '%p_operator_id%'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_total = 0 THEN
    RAISE EXCEPTION 'guard check matched no functions at all — the predicate is broken, not the schema';
  END IF;
  IF NOT v_have_routes OR NOT v_have_comunas THEN
    RAISE EXCEPTION
      'guard check no longer sees the two RPCs the original leak was found in (routes=%, comunas=%)',
      v_have_routes, v_have_comunas;
  END IF;

  RAISE NOTICE 'definer p_operator_id RPCs checked: %', v_total;
END $$;

ROLLBACK;
