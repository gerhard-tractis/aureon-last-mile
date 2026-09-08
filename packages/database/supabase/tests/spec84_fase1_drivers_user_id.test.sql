-- pgTAP: spec-84 fase 1 — drivers.user_id usable.
--
-- NOT RUN as part of this commit — Docker Desktop was down on the machine
-- that wrote this file (500 on every `docker` command), so
-- scripts/pgtap-local.sh could not build/apply/run it. Written test-first per
-- TDD, but the RED step ("watch it fail for the right reason") could not be
-- observed. Run `bash scripts/pgtap-local.sh sync && bash scripts/pgtap-local.sh apply
-- && bash scripts/pgtap-local.sh run spec84_fase1_drivers_user_id.test.sql`
-- once Docker is back, before trusting this file.
--
-- Covers:
--   TEST 1 — idx_drivers_user_id is UNIQUE (schema-level, not just present).
--   TEST 2 — two drivers, SAME operator, same user_id -> unique_violation.
--   TEST 3 — two drivers, DIFFERENT operators, same user_id -> ALSO
--            unique_violation. This is the scope decision the migration
--            argues for (global, not per-operator) — if a future edit
--            narrows the index to (operator_id, user_id), this test starts
--            failing and should prompt re-reading that argument, not a
--            silent tightening back to the checklist's suggested shape.
--   TEST 4 — soft-deleting the first driver frees its user_id for reuse.
--   TEST 5 — GUARD: connection role bypasses RLS, so SET ROLE is mandatory
--            for every test below it (pattern: rbac_users_test.sql).
--   TEST 6 — admin can UPDATE drivers.user_id within its own operator.
--   TEST 7 — pickup_crew cannot UPDATE drivers.user_id at all.
--   TEST 8 — WITH CHECK stops an admin re-parenting a driver to another
--            operator via the same UPDATE that sets user_id.
--
-- Run inside a transaction; ROLLBACK at the end.

BEGIN;

-- ============================================================================
-- FIXTURE
-- ============================================================================

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('84444444-0000-4000-8000-00000000000a', 'spec84 Test Operator A', 'spec84-test-op-a', 'CL'),
  ('84444444-0000-4000-8000-00000000000b', 'spec84 Test Operator B', 'spec84-test-op-b', 'CL')
ON CONFLICT (id) DO NOTHING;

-- auth.users + public.users (via handle_new_user trigger), one admin and one
-- pickup_crew under operator A, one admin under operator B.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('84444444-1111-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec84-admin-a@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"84444444-0000-4000-8000-00000000000a","role":"admin"}'::jsonb,
   '{"full_name":"Spec84 Admin A"}'::jsonb, NOW(), NOW(), '', ''),
  ('84444444-1111-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec84-pickup-a@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"84444444-0000-4000-8000-00000000000a","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Spec84 Pickup A"}'::jsonb, NOW(), NOW(), '', ''),
  ('84444444-1111-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec84-admin-b@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"84444444-0000-4000-8000-00000000000b","role":"admin"}'::jsonb,
   '{"full_name":"Spec84 Admin B"}'::jsonb, NOW(), NOW(), '', ''),
  -- A fourth user, never linked to a driver at fixture time — the "candidate
  -- to link" in TEST 6.
  ('84444444-1111-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','spec84-driver-user-a@test.com', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"84444444-0000-4000-8000-00000000000a","role":"pickup_crew"}'::jsonb,
   '{"full_name":"Spec84 Driver User A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TEST 1 — idx_drivers_user_id is UNIQUE, not merely present
-- ============================================================================
DO $$
DECLARE is_unique BOOLEAN;
BEGIN
  SELECT ix.indisunique INTO is_unique
    FROM pg_index ix
    JOIN pg_class c ON c.oid = ix.indexrelid
   WHERE c.relname = 'idx_drivers_user_id';

  IF is_unique IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST 1 FAILED: idx_drivers_user_id is not UNIQUE (indisunique = %)', is_unique;
  END IF;
END $$;

-- ============================================================================
-- TEST 2 — same operator, same user_id -> unique_violation
-- ============================================================================
DO $$
DECLARE rejected BOOLEAN := false;
BEGIN
  INSERT INTO public.drivers (id, operator_id, fleet_type, full_name, phone, user_id)
  VALUES ('84444444-2222-4000-8000-000000000001', '84444444-0000-4000-8000-00000000000a',
          'own', 'Driver One A', '+56900000001', '84444444-1111-4000-8000-000000000004');

  BEGIN
    INSERT INTO public.drivers (id, operator_id, fleet_type, full_name, phone, user_id)
    VALUES ('84444444-2222-4000-8000-000000000002', '84444444-0000-4000-8000-00000000000a',
            'own', 'Driver Two A', '+56900000002', '84444444-1111-4000-8000-000000000004');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'TEST 2 FAILED: a second driver in the SAME operator with the same user_id was accepted';
  END IF;
END $$;

-- ============================================================================
-- TEST 3 — DIFFERENT operators, same user_id -> STILL unique_violation
-- (the deliberate global-scope decision, not the checklist's per-operator one)
-- ============================================================================
DO $$
DECLARE rejected BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO public.drivers (id, operator_id, fleet_type, full_name, phone, user_id)
    VALUES ('84444444-2222-4000-8000-000000000003', '84444444-0000-4000-8000-00000000000b',
            'own', 'Driver One B', '+56900000003', '84444444-1111-4000-8000-000000000004');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'TEST 3 FAILED: a driver in a DIFFERENT operator with the same user_id was accepted — index is scoped per-operator, not global';
  END IF;
END $$;

-- ============================================================================
-- TEST 4 — soft-deleting the holder frees the user_id for reuse
-- ============================================================================
DO $$
DECLARE reused BOOLEAN := false;
BEGIN
  UPDATE public.drivers SET deleted_at = NOW()
   WHERE id = '84444444-2222-4000-8000-000000000001';

  BEGIN
    INSERT INTO public.drivers (id, operator_id, fleet_type, full_name, phone, user_id)
    VALUES ('84444444-2222-4000-8000-000000000004', '84444444-0000-4000-8000-00000000000b',
            'own', 'Driver One B (reuse)', '+56900000004', '84444444-1111-4000-8000-000000000004');
    reused := true;
  EXCEPTION WHEN unique_violation THEN
    reused := false;
  END;

  IF NOT reused THEN
    RAISE EXCEPTION 'TEST 4 FAILED: a soft-deleted driver still blocks reuse of its user_id';
  END IF;
END $$;

-- ============================================================================
-- TEST 5 — GUARD: the connection role bypasses RLS. If this ever reports
-- something other than "sees both", every test below is meaningless.
-- ============================================================================
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.drivers
   WHERE operator_id IN ('84444444-0000-4000-8000-00000000000a', '84444444-0000-4000-8000-00000000000b');
  IF c <> 3 THEN
    RAISE EXCEPTION
      'owner context saw % of 3 spec84 drivers — this file assumes the connection role bypasses RLS and therefore MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ============================================================================
-- TEST 6 — admin can UPDATE drivers.user_id within its own operator
-- ============================================================================
DO $$
DECLARE n INT; linked UUID;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"84444444-1111-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  -- Drop the existing link first so this UPDATE is a genuine re-link, not a
  -- no-op that would pass even under a broken policy.
  UPDATE public.drivers SET user_id = NULL
   WHERE id = '84444444-2222-4000-8000-000000000002';
  UPDATE public.drivers SET user_id = '84444444-1111-4000-8000-000000000002'
   WHERE id = '84444444-2222-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT user_id INTO linked FROM public.drivers WHERE id = '84444444-2222-4000-8000-000000000002';
  RESET role;

  IF n <> 1 OR linked <> '84444444-1111-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: admin UPDATE affected % row(s), user_id is %', n, linked;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 7 — pickup_crew cannot UPDATE drivers.user_id at all
-- ============================================================================
DO $$
DECLARE n INT; before_uid UUID; after_uid UUID;
BEGIN
  SELECT user_id INTO before_uid FROM public.drivers WHERE id = '84444444-2222-4000-8000-000000000002';

  PERFORM set_config('request.jwt.claims',
    '{"sub":"84444444-1111-4000-8000-000000000002","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
  UPDATE public.drivers SET user_id = NULL
   WHERE id = '84444444-2222-4000-8000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET role;

  SELECT user_id INTO after_uid FROM public.drivers WHERE id = '84444444-2222-4000-8000-000000000002';

  IF n <> 0 OR after_uid IS DISTINCT FROM before_uid THEN
    RAISE EXCEPTION 'TEST 7 FAILED: pickup_crew changed % row(s); user_id went % -> %', n, before_uid, after_uid;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 8 — WITH CHECK stops an admin re-parenting a driver to another
-- operator via the same UPDATE that touches user_id.
-- ============================================================================
DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"84444444-1111-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    UPDATE public.drivers
       SET operator_id = '84444444-0000-4000-8000-00000000000b'
     WHERE id = '84444444-2222-4000-8000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  RESET role;

  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST 8 FAILED: admin A re-parented a driver to operator B';
  END IF;
END $$;
RESET role;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
