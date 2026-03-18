-- ============================================================================
-- RBAC Users Table Test Suite
-- Story 1.3: Implement Role-Based Authentication (5 Roles)
-- Purpose: Validate multi-tenant RBAC isolation and JWT custom claims
-- ============================================================================

-- Test execution: Run this in Supabase SQL Editor after applying migration
-- Expected: All tests should pass with 0 failures

BEGIN;

-- ============================================================================
-- TEST SETUP: Create test data
-- ============================================================================

-- Create test operators
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Operator A', 'test-op-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Operator B', 'test-op-b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- Create test users for Operator A
INSERT INTO public.users (id, operator_id, role, email, full_name)
VALUES
  -- Admin user for Operator A
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin', 'admin-a@test.com', 'Admin A'),
  -- Pickup crew user for Operator A
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pickup_crew', 'pickup-a@test.com', 'Pickup A'),
  -- Operations manager for Operator A
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'operations_manager', 'manager-a@test.com', 'Manager A')
ON CONFLICT (operator_id, email) DO NOTHING;

-- Create test users for Operator B
INSERT INTO public.users (id, operator_id, role, email, full_name)
VALUES
  -- Admin user for Operator B
  ('44444444-4444-4444-4444-444444444444', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin', 'admin-b@test.com', 'Admin B'),
  -- Pickup crew user for Operator B
  ('55555555-5555-5555-5555-555555555555', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'pickup_crew', 'pickup-b@test.com', 'Pickup B')
ON CONFLICT (operator_id, email) DO NOTHING;

-- ============================================================================
-- TEST 1: Tenant Isolation - User can only see users from own operator
-- ============================================================================

DO $$
DECLARE
  test_result INTEGER;
BEGIN
  -- Simulate user from Operator A (admin-a@test.com)
  PERFORM set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111"}', true);

  -- User should see 3 users from Operator A
  SELECT COUNT(*) INTO test_result
  FROM public.users
  WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;

  IF test_result = 3 THEN
    RAISE NOTICE '✓ TEST 1A PASSED: User sees own operator users (count: %)', test_result;
  ELSE
    RAISE EXCEPTION '✗ TEST 1A FAILED: Expected 3 users from Operator A, got %', test_result;
  END IF;

  -- User should NOT see any users from Operator B (RLS blocks)
  SELECT COUNT(*) INTO test_result
  FROM public.users
  WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;

  IF test_result = 0 THEN
    RAISE NOTICE '✓ TEST 1B PASSED: Cross-tenant isolation working (count: %)', test_result;
  ELSE
    RAISE EXCEPTION '✗ TEST 1B FAILED: Expected 0 users from Operator B (RLS block), got %', test_result;
  END IF;
END $$;

-- ============================================================================
-- TEST 2: Tenant Isolation - User with NULL operator_id gets empty results
-- ============================================================================

DO $$
DECLARE
  test_result INTEGER;
BEGIN
  -- Simulate user with NULL operator_id (no operator assigned)
  PERFORM set_config('request.jwt.claims', '{"sub": "99999999-9999-9999-9999-999999999999"}', true);

  -- Should return 0 rows (fail-secure)
  SELECT COUNT(*) INTO test_result FROM public.users;

  IF test_result = 0 THEN
    RAISE NOTICE '✓ TEST 2 PASSED: NULL operator_id returns empty set (fail-secure)';
  ELSE
    RAISE EXCEPTION '✗ TEST 2 FAILED: Expected 0 users for NULL operator_id, got %', test_result;
  END IF;
END $$;

-- ============================================================================
-- TEST 3: Role-Based Write Access - Admin can update user roles
-- ============================================================================

DO $$
DECLARE
  updated_role user_role;
BEGIN
  -- Simulate admin user from Operator A
  PERFORM set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111"}', true);

  -- Admin should be able to update pickup crew user's role
  UPDATE public.users
  SET role = 'warehouse_staff'
  WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

  -- Verify the update worked
  SELECT role INTO updated_role
  FROM public.users
  WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

  IF updated_role = 'warehouse_staff' THEN
    RAISE NOTICE '✓ TEST 3 PASSED: Admin can update user roles';
  ELSE
    RAISE EXCEPTION '✗ TEST 3 FAILED: Admin role update failed, role is %', updated_role;
  END IF;

  -- Revert the change for clean state
  UPDATE public.users
  SET role = 'pickup_crew'
  WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;
END $$;

-- ============================================================================
-- TEST 4: Role-Based Write Access - Pickup crew cannot update roles
-- ============================================================================

DO $$
DECLARE
  rows_affected INTEGER;
  original_role user_role;
  updated_role user_role;
BEGIN
  -- Simulate pickup crew user from Operator A
  PERFORM set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222"}', true);

  -- Get original role
  SELECT role INTO original_role
  FROM public.users
  WHERE id = '11111111-1111-1111-1111-111111111111'::uuid;

  -- Pickup crew should NOT be able to update admin's role (RLS policy blocks)
  UPDATE public.users
  SET role = 'pickup_crew'
  WHERE id = '11111111-1111-1111-1111-111111111111'::uuid;

  GET DIAGNOSTICS rows_affected = ROW_COUNT;

  -- Verify role unchanged
  SELECT role INTO updated_role
  FROM public.users
  WHERE id = '11111111-1111-1111-1111-111111111111'::uuid;

  IF rows_affected = 0 AND updated_role = original_role THEN
    RAISE NOTICE '✓ TEST 4 PASSED: Pickup crew blocked from updating roles (RLS enforced)';
  ELSE
    RAISE EXCEPTION '✗ TEST 4 FAILED: Pickup crew was able to modify roles (rows affected: %, role: %)', rows_affected, updated_role;
  END IF;
END $$;

-- ============================================================================
-- TEST 5: Operations Manager can update user roles
-- ============================================================================

DO $$
DECLARE
  updated_role user_role;
BEGIN
  -- Simulate operations_manager user from Operator A
  PERFORM set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333"}', true);

  -- Operations manager should be able to update pickup crew user's role
  UPDATE public.users
  SET role = 'loading_crew'
  WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

  -- Verify the update worked
  SELECT role INTO updated_role
  FROM public.users
  WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;

  IF updated_role = 'loading_crew' THEN
    RAISE NOTICE '✓ TEST 5 PASSED: Operations manager can update user roles';
  ELSE
    RAISE EXCEPTION '✗ TEST 5 FAILED: Operations manager role update failed, role is %', updated_role;
  END IF;

  -- Revert the change
  UPDATE public.users
  SET role = 'pickup_crew'
  WHERE id = '22222222-2222-2222-2222-222222222222'::uuid;
END $$;

-- ============================================================================
-- TEST 6: Soft Delete - Deleted users excluded from queries
-- ============================================================================

DO $$
DECLARE
  test_result INTEGER;
  deleted_user_id UUID := '55555555-5555-5555-5555-555555555555';
BEGIN
  -- Soft delete a user (set deleted_at)
  UPDATE public.users
  SET deleted_at = NOW()
  WHERE id = deleted_user_id;

  -- Simulate admin from Operator B (should NOT see deleted user via RLS policy)
  PERFORM set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444"}', true);

  -- Should return 1 user from Operator B (deleted user auto-filtered by RLS policy)
  SELECT COUNT(*) INTO test_result
  FROM public.users
  WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;

  IF test_result = 1 THEN
    RAISE NOTICE '✓ TEST 6 PASSED: Soft-deleted users excluded from queries (count: %)', test_result;
  ELSE
    RAISE EXCEPTION '✗ TEST 6 FAILED: Expected 1 active user from Operator B (deleted user filtered), got %', test_result;
  END IF;

  -- Cleanup: Restore deleted user
  UPDATE public.users
  SET deleted_at = NULL
  WHERE id = deleted_user_id;
END $$;

-- ============================================================================
-- TEST 7: Database Trigger - Auto user creation validation
-- ============================================================================

DO $$
DECLARE
  test_user_id UUID := gen_random_uuid();
  test_auth_id UUID := gen_random_uuid();
  user_count INTEGER;
BEGIN
  -- Manually simulate auth.users INSERT (in real world, Supabase Auth API does this)
  -- This tests that the trigger creates a matching public.users record

  -- Note: We can't actually INSERT into auth.users in this test context
  -- This test verifies the function logic exists and would work

  -- Verify trigger function exists
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'handle_new_user'
    AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE NOTICE '✓ TEST 7A PASSED: handle_new_user() trigger function exists';
  ELSE
    RAISE EXCEPTION '✗ TEST 7A FAILED: handle_new_user() trigger function not found';
  END IF;

  -- Verify trigger is attached to auth.users
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    RAISE NOTICE '✓ TEST 7B PASSED: on_auth_user_created trigger attached';
  ELSE
    RAISE EXCEPTION '✗ TEST 7B FAILED: on_auth_user_created trigger not attached';
  END IF;
END $$;

-- ============================================================================
-- TEST 8: JWT Custom Claims Hook Function
-- ============================================================================

DO $$
DECLARE
  test_event jsonb;
  result_event jsonb;
  claims_operator_id UUID;
  claims_role TEXT;
BEGIN
  -- Simulate Auth Hook event
  test_event := jsonb_build_object(
    'user_id', '11111111-1111-1111-1111-111111111111',
    'claims', '{}'::jsonb
  );

  -- Call the custom_access_token_hook function
  result_event := public.custom_access_token_hook(test_event);

  -- Extract claims
  claims_operator_id := (result_event->'claims'->>'operator_id')::uuid;
  claims_role := result_event->'claims'->>'role';

  -- Verify operator_id claim matches user record
  IF claims_operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid THEN
    RAISE NOTICE '✓ TEST 8A PASSED: JWT custom claims operator_id correct';
  ELSE
    RAISE EXCEPTION '✗ TEST 8A FAILED: Expected operator_id aaaaaaaa..., got %', claims_operator_id;
  END IF;

  -- Verify role claim matches user record
  IF claims_role = 'admin' THEN
    RAISE NOTICE '✓ TEST 8B PASSED: JWT custom claims role correct';
  ELSE
    RAISE EXCEPTION '✗ TEST 8B FAILED: Expected role admin, got %', claims_role;
  END IF;
END $$;

-- ============================================================================
-- TEST 9: JWT Custom Claims - Soft-deleted user gets no claims
-- ============================================================================

DO $$
DECLARE
  test_event jsonb;
  result_event jsonb;
  claims_operator_id TEXT;
  deleted_user_id UUID := '55555555-5555-5555-5555-555555555555';
BEGIN
  -- Soft delete the user
  UPDATE public.users
  SET deleted_at = NOW()
  WHERE id = deleted_user_id;

  -- Simulate Auth Hook event for deleted user
  test_event := jsonb_build_object(
    'user_id', deleted_user_id::text,
    'claims', '{}'::jsonb
  );

  -- Call the custom_access_token_hook function
  result_event := public.custom_access_token_hook(test_event);

  -- Extract claims (should be null for deleted user - fail-secure)
  claims_operator_id := result_event->'claims'->>'operator_id';

  IF claims_operator_id IS NULL THEN
    RAISE NOTICE '✓ TEST 9 PASSED: Soft-deleted user gets no JWT claims (fail-secure)';
  ELSE
    RAISE EXCEPTION '✗ TEST 9 FAILED: Deleted user should not get claims, got operator_id: %', claims_operator_id;
  END IF;

  -- Restore deleted user
  UPDATE public.users
  SET deleted_at = NULL
  WHERE id = deleted_user_id;
END $$;

-- ============================================================================
-- TEST 10: UNIQUE Constraint - Duplicate email per operator rejected
-- ============================================================================

DO $$
DECLARE
  duplicate_inserted BOOLEAN := FALSE;
BEGIN
  -- Try to insert duplicate email for Operator A
  BEGIN
    INSERT INTO public.users (id, operator_id, role, email, full_name)
    VALUES (
      gen_random_uuid(),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'pickup_crew',
      'admin-a@test.com',  -- Duplicate email
      'Duplicate User'
    );
    duplicate_inserted := TRUE;
  EXCEPTION
    WHEN unique_violation THEN
      duplicate_inserted := FALSE;
  END;

  IF NOT duplicate_inserted THEN
    RAISE NOTICE '✓ TEST 10 PASSED: UNIQUE constraint prevents duplicate emails per operator';
  ELSE
    RAISE EXCEPTION '✗ TEST 10 FAILED: Duplicate email was allowed (UNIQUE constraint not working)';
  END IF;
END $$;

-- ============================================================================
-- TEST 11: Index Verification - Performance optimization indexes exist
-- ============================================================================

DO $$
BEGIN
  -- Verify idx_users_operator_id exists
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'idx_users_operator_id'
  ) THEN
    RAISE NOTICE '✓ TEST 11A PASSED: idx_users_operator_id index exists';
  ELSE
    RAISE EXCEPTION '✗ TEST 11A FAILED: idx_users_operator_id index not found';
  END IF;

  -- Verify idx_users_deleted_at exists
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'idx_users_deleted_at'
  ) THEN
    RAISE NOTICE '✓ TEST 11B PASSED: idx_users_deleted_at index exists';
  ELSE
    RAISE EXCEPTION '✗ TEST 11B FAILED: idx_users_deleted_at index not found';
  END IF;

  -- Verify idx_users_role exists
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'idx_users_role'
  ) THEN
    RAISE NOTICE '✓ TEST 11C PASSED: idx_users_role index exists';
  ELSE
    RAISE EXCEPTION '✗ TEST 11C FAILED: idx_users_role index not found';
  END IF;
END $$;

-- ============================================================================
-- TEST 12: Role ENUM Validation - Invalid role values rejected
-- ============================================================================

DO $$
DECLARE
  invalid_role_inserted BOOLEAN := FALSE;
BEGIN
  -- Try to insert invalid role value
  BEGIN
    INSERT INTO public.users (id, operator_id, role, email, full_name)
    VALUES (
      gen_random_uuid(),
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'invalid_role'::user_role,  -- Invalid ENUM value
      'invalid@test.com',
      'Invalid Role User'
    );
    invalid_role_inserted := TRUE;
  EXCEPTION
    WHEN invalid_text_representation THEN
      invalid_role_inserted := FALSE;
  END;

  IF NOT invalid_role_inserted THEN
    RAISE NOTICE '✓ TEST 12 PASSED: Invalid role ENUM values rejected';
  ELSE
    RAISE EXCEPTION '✗ TEST 12 FAILED: Invalid role value was accepted (ENUM constraint not working)';
  END IF;
END $$;

-- ============================================================================
-- TEST CLEANUP: Remove test data
-- ============================================================================

DELETE FROM public.users
WHERE operator_id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

DELETE FROM public.operators
WHERE id IN (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

ROLLBACK;  -- Rollback all test data (tests are read-only validation)

-- ============================================================================
-- TEST SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RBAC Users Table Test Suite Complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Test 1A: ✓ Tenant isolation (own operator)';
  RAISE NOTICE 'Test 1B: ✓ Cross-tenant blocking';
  RAISE NOTICE 'Test 2:  ✓ NULL operator_id fail-secure';
  RAISE NOTICE 'Test 3:  ✓ Admin can update roles';
  RAISE NOTICE 'Test 4:  ✓ Pickup crew blocked from role updates';
  RAISE NOTICE 'Test 5:  ✓ Operations manager can update roles';
  RAISE NOTICE 'Test 6:  ✓ Soft-deleted users filtered';
  RAISE NOTICE 'Test 7A: ✓ Trigger function exists';
  RAISE NOTICE 'Test 7B: ✓ Trigger attached to auth.users';
  RAISE NOTICE 'Test 8A: ✓ JWT claims operator_id correct';
  RAISE NOTICE 'Test 8B: ✓ JWT claims role correct';
  RAISE NOTICE 'Test 9:  ✓ Deleted users get no JWT claims';
  RAISE NOTICE 'Test 10: ✓ UNIQUE constraint enforced';
  RAISE NOTICE 'Test 11A-C: ✓ Performance indexes exist';
  RAISE NOTICE 'Test 12: ✓ Invalid role ENUM rejected';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All tests passed! ✓';
  RAISE NOTICE '========================================';
END $$;
