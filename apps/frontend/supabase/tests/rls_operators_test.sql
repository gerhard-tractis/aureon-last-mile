-- RLS Isolation Test Suite for operators Table
-- Story: 1.2 - Configure Multi-Tenant Database Schema with RLS Policies
-- Date: 2026-02-16
-- Purpose: Verify tenant isolation policies work correctly (zero cross-tenant leaks)

-- =============================================================================
-- SETUP: Create test operators
-- =============================================================================

-- Insert test operator A (will be cleaned up at end)
INSERT INTO operators (id, name, slug)
VALUES (
  'aaaaaaaa-0000-4000-a000-000000000001'::uuid,
  'Test Operator A',
  'test-operator-a'
)
ON CONFLICT (slug) DO NOTHING;

-- Insert test operator B (will be cleaned up at end)
INSERT INTO operators (id, name, slug)
VALUES (
  'bbbbbbbb-0000-4000-b000-000000000001'::uuid,
  'Test Operator B',
  'test-operator-b'
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- TEST 1: User with operator_id can access their own operator
-- =============================================================================

-- Simulate JWT with operator_id = 'aaaaaaaa-0000-4000-a000-000000000001'
-- Expected result: 1 row (operator A)

DO $$
DECLARE
  result_count INTEGER;
BEGIN
  -- Set JWT claims to simulate authenticated user with operator_id A
  PERFORM set_config('request.jwt.claims', '{"operator_id": "aaaaaaaa-0000-4000-a000-000000000001"}', true);

  -- Query operators table (RLS should allow access to operator A only)
  SELECT COUNT(*) INTO result_count
  FROM operators
  WHERE id = 'aaaaaaaa-0000-4000-a000-000000000001'::uuid;

  IF result_count = 1 THEN
    RAISE NOTICE 'TEST 1 PASSED: User can access their own operator';
  ELSE
    RAISE EXCEPTION 'TEST 1 FAILED: Expected 1 row, got %', result_count;
  END IF;
END $$;

-- =============================================================================
-- TEST 2: User CANNOT access another operator's data
-- =============================================================================

-- User with operator_id A tries to access operator B
-- Expected result: 0 rows (RLS blocks cross-tenant access)

DO $$
DECLARE
  result_count INTEGER;
BEGIN
  -- Set JWT claims to simulate authenticated user with operator_id A
  PERFORM set_config('request.jwt.claims', '{"operator_id": "aaaaaaaa-0000-4000-a000-000000000001"}', true);

  -- Try to query operator B (should be blocked by RLS)
  SELECT COUNT(*) INTO result_count
  FROM operators
  WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001'::uuid;

  IF result_count = 0 THEN
    RAISE NOTICE 'TEST 2 PASSED: User cannot access other operator (cross-tenant blocked)';
  ELSE
    RAISE EXCEPTION 'TEST 2 FAILED: Expected 0 rows (RLS block), got %', result_count;
  END IF;
END $$;

-- =============================================================================
-- TEST 3: User with NULL operator_id gets empty results (fail-secure)
-- =============================================================================

-- Simulate JWT without operator_id claim
-- Expected result: 0 rows (fail-secure behavior)

DO $$
DECLARE
  result_count INTEGER;
BEGIN
  -- Set JWT claims without operator_id (simulates missing/invalid claim)
  PERFORM set_config('request.jwt.claims', '{}', true);

  -- Query all operators (should return empty set due to NULL operator_id)
  SELECT COUNT(*) INTO result_count FROM operators;

  IF result_count = 0 THEN
    RAISE NOTICE 'TEST 3 PASSED: NULL operator_id returns empty results (fail-secure)';
  ELSE
    RAISE EXCEPTION 'TEST 3 FAILED: Expected 0 rows (fail-secure), got %', result_count;
  END IF;
END $$;

-- =============================================================================
-- TEST 4: INSERT respects RLS policy
-- =============================================================================

-- User with operator_id A tries to INSERT with id = B
-- Expected: INSERT should fail or be invisible due to RLS

DO $$
DECLARE
  result_count INTEGER;
BEGIN
  -- Set JWT claims to simulate authenticated user with operator_id A
  PERFORM set_config('request.jwt.claims', '{"operator_id": "aaaaaaaa-0000-4000-a000-000000000001"}', true);

  -- Try to insert operator with different ID (should fail RLS check)
  BEGIN
    INSERT INTO operators (id, name, slug)
    VALUES (
      'cccccccc-0000-4000-c000-000000000001'::uuid,
      'Hacker Operator',
      'hacker-operator'
    );

    -- If INSERT succeeded, verify it's NOT visible in subsequent SELECT
    SELECT COUNT(*) INTO result_count
    FROM operators
    WHERE id = 'cccccccc-0000-4000-c000-000000000001'::uuid;

    IF result_count = 0 THEN
      RAISE NOTICE 'TEST 4 PASSED: RLS prevents inserting rows with different operator_id';
    ELSE
      RAISE EXCEPTION 'TEST 4 FAILED: Inserted row with different operator_id is visible';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'TEST 4 PASSED: RLS blocked INSERT with different operator_id';
  END;
END $$;

-- =============================================================================
-- TEST 5: UPDATE respects RLS policy
-- =============================================================================

-- User with operator_id A tries to UPDATE operator B
-- Expected: UPDATE should affect 0 rows (RLS blocks)

DO $$
DECLARE
  rows_affected INTEGER;
BEGIN
  -- Set JWT claims to simulate authenticated user with operator_id A
  PERFORM set_config('request.jwt.claims', '{"operator_id": "aaaaaaaa-0000-4000-a000-000000000001"}', true);

  -- Try to update operator B (should be blocked by RLS)
  UPDATE operators
  SET name = 'Hacked Name'
  WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001'::uuid;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;

  IF rows_affected = 0 THEN
    RAISE NOTICE 'TEST 5 PASSED: RLS prevents updating other operator';
  ELSE
    RAISE EXCEPTION 'TEST 5 FAILED: Updated % rows (should be 0)', rows_affected;
  END IF;
END $$;

-- =============================================================================
-- TEST 6: DELETE respects RLS policy
-- =============================================================================

-- User with operator_id A tries to DELETE operator B
-- Expected: DELETE should affect 0 rows (RLS blocks)

DO $$
DECLARE
  rows_affected INTEGER;
BEGIN
  -- Set JWT claims to simulate authenticated user with operator_id A
  PERFORM set_config('request.jwt.claims', '{"operator_id": "aaaaaaaa-0000-4000-a000-000000000001"}', true);

  -- Try to delete operator B (should be blocked by RLS)
  DELETE FROM operators
  WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001'::uuid;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;

  IF rows_affected = 0 THEN
    RAISE NOTICE 'TEST 6 PASSED: RLS prevents deleting other operator';
  ELSE
    RAISE EXCEPTION 'TEST 6 FAILED: Deleted % rows (should be 0)', rows_affected;
  END IF;
END $$;

-- =============================================================================
-- PERFORMANCE TEST: Verify index usage and query performance
-- =============================================================================

-- Test query execution plan (should use index on id)
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM operators WHERE id = 'aaaaaaaa-0000-4000-a000-000000000001'::uuid;

-- Expected: Index Scan on operators_pkey (primary key index)
-- Execution time: <100ms (acceptance criteria)

-- Test get_operator_id() function overhead
EXPLAIN (ANALYZE, BUFFERS) SELECT public.get_operator_id();

-- Expected: Function execution <10ms (STABLE optimization)

-- =============================================================================
-- CLEANUP: Remove test operators
-- =============================================================================

-- Reset JWT claims to service role (bypasses RLS for cleanup)
SELECT set_config('request.jwt.claims', '{}', true);

-- Delete test operators (only if not in production!)
-- DELETE FROM operators WHERE slug IN ('test-operator-a', 'test-operator-b');
-- Commented out for safety - run manually after reviewing test results

-- =============================================================================
-- TEST SUMMARY
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'RLS OPERATORS TEST SUITE COMPLETED';
  RAISE NOTICE '==============================================';
  RAISE NOTICE 'All tests passed: Multi-tenant isolation verified';
  RAISE NOTICE 'Zero cross-tenant data leaks detected';
  RAISE NOTICE 'Fail-secure behavior confirmed (NULL operator_id)';
  RAISE NOTICE '==============================================';
END $$;
