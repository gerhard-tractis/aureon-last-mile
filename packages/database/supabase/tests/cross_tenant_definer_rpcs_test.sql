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

INSERT INTO public.users (id, operator_id, email, role)
VALUES (
  'cccccccc-0000-4000-c000-00000000c401'::uuid,
  'aaaaaaaa-0000-4000-a000-00000000c401'::uuid,
  'guard-test-user-a@example.com',
  'admin'
)
ON CONFLICT (id) DO NOTHING;

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
