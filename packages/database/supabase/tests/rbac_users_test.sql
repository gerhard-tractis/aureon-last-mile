-- ============================================================================
-- RBAC users table test suite
-- Story 1.3 — Role-Based Authentication (5 roles) + multi-tenant isolation
-- ============================================================================
-- REWRITTEN 2026-08-13. The previous version could not run at all: it inserted
-- straight into public.users, which has users_id_fkey REFERENCES auth.users(id),
-- so the very first statement aborted the transaction and nothing after it ran.
--
-- It had the same second defect as rls_operators_test.sql: no SET ROLE, so the
-- "RLS blocks this" tests executed as the table owner, which Postgres exempts
-- from RLS (public.users is not FORCE ROW LEVEL SECURITY). Every such test was
-- meaningless.
--
-- Fixture note: rows are created by inserting into auth.users and letting the
-- on_auth_user_created trigger run public.handle_new_user(). That function
-- reads operator_id AND role from raw_app_meta_data (NOT raw_user_meta_data,
-- which only supplies full_name) and raises if operator_id is absent.
--
-- Run inside a transaction; ROLLBACK at the end.

BEGIN;

-- ============================================================================
-- FIXTURE
-- ============================================================================

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RBAC Test Operator A', 'rbac-test-op-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'RBAC Test Operator B', 'rbac-test-op-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rbac-admin-a@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"admin"}'::jsonb,
   '{"full_name":"Admin A"}'::jsonb, NOW(), NOW(), '', ''),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rbac-pickup-a@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Pickup A"}'::jsonb, NOW(), NOW(), '', ''),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rbac-manager-a@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"operations_manager"}'::jsonb,
   '{"full_name":"Manager A"}'::jsonb, NOW(), NOW(), '', ''),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rbac-admin-b@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"admin"}'::jsonb,
   '{"full_name":"Admin B"}'::jsonb, NOW(), NOW(), '', ''),
  ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rbac-pickup-b@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Pickup B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- ── TEST 0: the trigger really did create the public.users rows ────────────
-- The old TEST 7 only checked that handle_new_user() and its trigger existed in
-- the catalog, which proves nothing about behaviour. These rows are the
-- fixture, so the assertion is load-bearing for everything below.
DO $$
DECLARE c INT; r TEXT; p TEXT[];
BEGIN
  SELECT COUNT(*) INTO c FROM public.users
   WHERE operator_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  IF c <> 5 THEN
    RAISE EXCEPTION 'TEST 0 FAILED: on_auth_user_created created % of 5 public.users rows', c;
  END IF;

  SELECT role::text, permissions INTO r, p FROM public.users
   WHERE id = '11111111-1111-1111-1111-111111111111';
  IF r <> 'admin' THEN
    RAISE EXCEPTION 'TEST 0 FAILED: raw_app_meta_data.role was not honoured, got %', r;
  END IF;
  IF NOT ('admin' = ANY(p)) THEN
    RAISE EXCEPTION 'TEST 0 FAILED: admin did not receive the admin permission, got %', p;
  END IF;
END $$;

-- ── TEST 0b: operator_id is mandatory (fail-secure signup) ─────────────────
DO $$
DECLARE rejected BOOLEAN := false; msg TEXT;
BEGIN
  BEGIN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token
    ) VALUES (
      '66666666-6666-6666-6666-666666666666','00000000-0000-0000-0000-000000000000',
      'authenticated','authenticated','rbac-noop@test.com', crypt('x', gen_salt('bf')),
      '{}'::jsonb, '{"full_name":"No Operator"}'::jsonb, NOW(), NOW(), '', '');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    rejected := (msg LIKE '%operator_id required%');
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'TEST 0b FAILED: a signup with no operator_id was accepted (msg: %)', msg;
  END IF;
END $$;

-- ── GUARD: the connection role bypasses RLS, so SET ROLE is mandatory ──────
-- If a future edit drops the SET LOCAL role lines below, every isolation
-- assertion in this file silently becomes vacuous. Pin it.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.users
   WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF c <> 2 THEN
    RAISE EXCEPTION
      'owner context saw % of 2 operator-B users — this file assumes the connection role bypasses RLS and therefore MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ============================================================================
-- TEST 1: tenant isolation on SELECT
-- ============================================================================
DO $$
DECLARE c_own INT; c_other INT; c_all INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own   FROM public.users WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT COUNT(*) INTO c_other FROM public.users WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  SELECT COUNT(*) INTO c_all   FROM public.users;
  RESET role;

  IF c_own <> 3 THEN
    RAISE EXCEPTION 'TEST 1A FAILED: expected 3 users from operator A, got %', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'TEST 1B FAILED: cross-tenant leak — saw % operator B users', c_other;
  END IF;
  IF c_all <> 3 THEN
    RAISE EXCEPTION 'TEST 1C FAILED: unqualified SELECT returned % rows, expected 3', c_all;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 2: fail-secure — a sub that maps to no public.users row sees nothing
-- ============================================================================
DO $$
DECLARE c_unknown INT; c_nosub INT;
BEGIN
  SET LOCAL role = 'authenticated';

  PERFORM set_config('request.jwt.claims',
    '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
  SELECT COUNT(*) INTO c_unknown FROM public.users;

  -- No sub at all: auth.uid() is NULL, get_operator_id() is NULL.
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c_nosub FROM public.users;
  RESET role;

  IF c_unknown <> 0 THEN
    RAISE EXCEPTION 'TEST 2A FAILED: unknown sub saw % users', c_unknown;
  END IF;
  IF c_nosub <> 0 THEN
    RAISE EXCEPTION 'TEST 2B FAILED: empty claims saw % users', c_nosub;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 3: admin can update a user's role within its own operator
-- ============================================================================
DO $$
DECLARE n INT; r user_role;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  UPDATE public.users SET role = 'warehouse_staff'
   WHERE id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT role INTO r FROM public.users WHERE id = '22222222-2222-2222-2222-222222222222';
  UPDATE public.users SET role = 'pickup_crew'
   WHERE id = '22222222-2222-2222-2222-222222222222';
  RESET role;

  IF n <> 1 OR r <> 'warehouse_staff' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: admin update affected % rows, role is %', n, r;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 4: pickup_crew cannot update anyone's role
-- ============================================================================
DO $$
DECLARE n INT; before_role user_role; after_role user_role;
BEGIN
  SELECT role INTO before_role FROM public.users
   WHERE id = '11111111-1111-1111-1111-111111111111';

  PERFORM set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
  UPDATE public.users SET role = 'pickup_crew'
   WHERE id = '11111111-1111-1111-1111-111111111111';
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET role;

  SELECT role INTO after_role FROM public.users
   WHERE id = '11111111-1111-1111-1111-111111111111';

  IF n <> 0 OR after_role <> before_role THEN
    RAISE EXCEPTION 'TEST 4 FAILED: pickup_crew changed % row(s); admin role went % -> %',
      n, before_role, after_role;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 5: operations_manager can update roles
-- ============================================================================
DO $$
DECLARE n INT; r user_role;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  UPDATE public.users SET role = 'loading_crew'
   WHERE id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT role INTO r FROM public.users WHERE id = '22222222-2222-2222-2222-222222222222';
  UPDATE public.users SET role = 'pickup_crew'
   WHERE id = '22222222-2222-2222-2222-222222222222';
  RESET role;

  IF n <> 1 OR r <> 'loading_crew' THEN
    RAISE EXCEPTION 'TEST 5 FAILED: operations_manager update affected % rows, role is %', n, r;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 6: WITH CHECK stops an admin planting a user under another operator
-- ============================================================================
DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    UPDATE public.users SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     WHERE id = '22222222-2222-2222-2222-222222222222';
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  RESET role;

  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST 6 FAILED: admin A re-parented a user to operator B';
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 7: soft-deleted users are excluded from users_tenant_isolation_select
-- ============================================================================
-- Soft-delete the operations_manager and look from a plain pickup_crew, i.e.
-- through users_tenant_isolation_select alone — that is the policy carrying the
-- `deleted_at IS NULL` predicate.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  UPDATE public.users SET deleted_at = NOW()
   WHERE id = '33333333-3333-3333-3333-333333333333';

  PERFORM set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
  SELECT COUNT(*) INTO c FROM public.users;
  RESET role;

  IF c <> 2 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: pickup_crew saw % operator A users, expected 2 (the soft-deleted manager must be filtered)', c;
  END IF;
END $$;
RESET role;

-- ── TEST 7b: CHARACTERISATION of a real gap, not an endorsement ────────────
-- users_admin_full_access is FOR ALL with
--   USING (operator_id = get_operator_id() AND get_current_user_role() IN
--          ('admin','operations_manager'))
-- and NO `deleted_at IS NULL` predicate. Policies are permissive and OR
-- together, so for an admin or operations_manager the soft-delete filter in
-- users_tenant_isolation_select is simply bypassed: admins read tombstoned
-- rows. No live leak today — apps/frontend/src/app/api/users/route.ts:69 adds
-- its own .is('deleted_at', null) — but the comment directly above that line
-- claims "RLS policy auto-filters ... AND deleted_at IS NULL", which is untrue
-- for exactly the roles that use that endpoint. Soft-delete filtering here
-- rests on application code alone.
-- ACTION: add `AND deleted_at IS NULL` to users_admin_full_access's USING (a
-- separate policy is needed if admins are meant to restore deleted users).
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
  SELECT COUNT(*) INTO c FROM public.users;
  RESET role;

  IF c <> 3 THEN
    RAISE EXCEPTION
      'TEST 7b: admin saw % operator A users. Expected 3 — i.e. the soft-deleted manager still visible via users_admin_full_access. If this is now 2 the gap was closed: delete this test. Any other value means something else changed.', c;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 8: custom_access_token_hook emits the right claims, and none for a
--         soft-deleted user (TEST 7 left 3333... deleted on purpose)
-- ============================================================================
-- Claim layout, per 20260312190110_fix_hook_role_overwrite.sql:
--   claims.operator_id            the tenant, at the token root
--   claims.role                   forced back to 'authenticated' — PostgREST
--                                 picks the Postgres role from this field, so
--                                 leaking 'admin' into it 401s every REST call
--   claims.app_metadata.claims.*  where the application role actually lives
DO $$
DECLARE ev jsonb; op TEXT; app_role TEXT; pgrst_role TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);

  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id','11111111-1111-1111-1111-111111111111','claims','{}'::jsonb));
  op         := ev->'claims'->>'operator_id';
  app_role   := ev->'claims'->'app_metadata'->'claims'->>'role';
  pgrst_role := ev->'claims'->>'role';

  IF op <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'TEST 8A FAILED: claims.operator_id was %', op;
  END IF;
  IF app_role <> 'admin' THEN
    RAISE EXCEPTION 'TEST 8A FAILED: app_metadata.claims.role was %, expected admin', app_role;
  END IF;
  IF pgrst_role <> 'authenticated' THEN
    RAISE EXCEPTION 'TEST 8A FAILED: claims.role is %, not authenticated — PostgREST will 401 every request', pgrst_role;
  END IF;

  ev := public.custom_access_token_hook(jsonb_build_object(
          'user_id','33333333-3333-3333-3333-333333333333','claims','{}'::jsonb));
  IF ev->'claims'->>'operator_id' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 8B FAILED: soft-deleted user still got operator_id %',
      ev->'claims'->>'operator_id';
  END IF;
END $$;

-- ============================================================================
-- TEST 9: schema guarantees — unique email per operator, role enum, indexes
-- ============================================================================
DO $$
DECLARE dup BOOLEAN := false; bad BOOLEAN := false; missing TEXT;
BEGIN
  BEGIN
    INSERT INTO public.users (id, operator_id, role, email, full_name)
    VALUES (gen_random_uuid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','pickup_crew',
            'rbac-admin-a@test.com','Duplicate User');
    dup := true;
  EXCEPTION
    WHEN unique_violation THEN dup := false;
    -- users_id_fkey fires first if the unique check ever stops applying; treat
    -- that as a failure rather than a pass, hence the explicit re-raise.
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'TEST 9A INCONCLUSIVE: FK fired before the unique constraint';
  END;
  IF dup THEN
    RAISE EXCEPTION 'TEST 9A FAILED: duplicate email per operator was accepted';
  END IF;

  BEGIN
    PERFORM 'invalid_role'::user_role;
    bad := true;
  EXCEPTION WHEN invalid_text_representation THEN bad := false;
  END;
  IF bad THEN
    RAISE EXCEPTION 'TEST 9B FAILED: user_role accepted an invalid value';
  END IF;

  SELECT string_agg(x, ', ') INTO missing
  FROM unnest(ARRAY['idx_users_operator_id','idx_users_deleted_at','idx_users_role']) AS x
  WHERE NOT EXISTS (SELECT 1 FROM pg_indexes
                    WHERE tablename = 'users' AND indexname = x);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 9C FAILED: missing indexes: %', missing;
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
