-- pgTAP: spec-84 fase 1 — drivers.user_id usable.
--
-- Round 2 review fix: TESTs 6/7/8 originally targeted driver id …0002 —
-- the SAME id TEST 2 expects to be REJECTED by the unique index. That
-- INSERT lives inside a nested BEGIN/EXCEPTION block (a subtransaction that
-- rolls back on the expected unique_violation), so the row never existed,
-- and TESTs 6/7/8 were asserting UPDATE behaviour against a driver that was
-- never there — TEST 6 failed for the wrong reason, TEST 7 passed
-- vacuously (0 rows affected because 0 rows existed, not because RLS
-- blocked anything). Fixed by adding a fifth driver (…0005) directly in the
-- fixture, untouched by TESTs 2-4, and pointing TESTs 6/7/8 at it. Run for
-- real against the shared spec52-pg container (previously blocked — Docker
-- Desktop was down when this file was first written).
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
--   TEST 8 — USING stops an admin re-parenting a driver to another operator
--            via UPDATE (renamed round 3 — see below).
--   TEST 9 — WITH CHECK stops an admin INSERTing a driver directly into
--            another operator.
--
-- Round 3 review fix: TEST 8 was named "WITH CHECK stops...", but an
-- UPDATE's old-row visibility is gated by USING, not WITH CHECK — the
-- reviewer isolated this by mutating the policy two ways: USING scoped +
-- WITH CHECK (true) still blocks the cross-operator UPDATE (42501); USING
-- (true) + WITH CHECK (true) lets it through. WITH CHECK's operator_id
-- clause is untested by TEST 8 and IS load-bearing — for INSERT, where
-- there is no old row for USING to filter. TEST 9 exercises that: an admin
-- of operator A cannot INSERT a driver with operator_id B. Renamed TEST 8
-- to describe what it actually exercises (USING, not WITH CHECK).
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

-- A fifth driver, operator A, created directly in the fixture (not inside
-- one of the EXCEPTION-guarded DO blocks below) and never touched by
-- TESTs 2-4 — TESTs 6/7/8 (RLS on drivers_admin_write) need a row that
-- actually exists after those run. Round 2 review finding: the driver ids
-- TESTs 6/7/8 originally targeted (…0002) were themselves the ones TEST 2
-- expects to be REJECTED — the INSERT never commits (it's inside a nested
-- BEGIN/EXCEPTION block, i.e. a subtransaction that rolls back), so that row
-- never existed and TESTs 6/7/8 were asserting against nothing.
INSERT INTO public.drivers (id, operator_id, fleet_type, full_name, phone, user_id)
VALUES ('84444444-2222-4000-8000-000000000005', '84444444-0000-4000-8000-00000000000a',
        'own', 'Driver Five A (RLS fixture)', '+56900000005', NULL);

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
-- something other than "sees all three", every test below is meaningless.
-- Three rows exist at this point: 005 (fixture, operator A, unlinked),
-- 001 (TEST 2, operator A, soft-deleted by TEST 4), 004 (TEST 4, operator B).
-- 002/003 never exist — TESTs 2/3 assert their INSERTs are rejected.
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

  -- Driver 005 starts with user_id NULL (fixture) — this is a genuine link,
  -- not a no-op that would pass even under a broken policy.
  UPDATE public.drivers SET user_id = '84444444-1111-4000-8000-000000000002'
   WHERE id = '84444444-2222-4000-8000-000000000005';
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT user_id INTO linked FROM public.drivers WHERE id = '84444444-2222-4000-8000-000000000005';
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
  SELECT user_id INTO before_uid FROM public.drivers WHERE id = '84444444-2222-4000-8000-000000000005';

  PERFORM set_config('request.jwt.claims',
    '{"sub":"84444444-1111-4000-8000-000000000002","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';
  UPDATE public.drivers SET user_id = NULL
   WHERE id = '84444444-2222-4000-8000-000000000005';
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET role;

  SELECT user_id INTO after_uid FROM public.drivers WHERE id = '84444444-2222-4000-8000-000000000005';

  IF n <> 0 OR after_uid IS DISTINCT FROM before_uid THEN
    RAISE EXCEPTION 'TEST 7 FAILED: pickup_crew changed % row(s); user_id went % -> %', n, before_uid, after_uid;
  END IF;
  -- Positive assertion the row still exists and is still linked, so a
  -- version of this test that silently found nothing (n=0 because the row
  -- itself was absent) cannot pass vacuously — round 2 review finding.
  IF before_uid IS NULL OR before_uid <> '84444444-1111-4000-8000-000000000002' THEN
    RAISE EXCEPTION 'TEST 7 INCONCLUSIVE: driver 005 was not in the linked state TEST 6 left it in (before_uid = %)', before_uid;
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 8 — USING stops an admin re-parenting a driver to another operator
-- via UPDATE (renamed round 3: this exercises USING, not WITH CHECK — the
-- old row's operator_id is what USING filters on; the row is invisible to
-- admin A's session once it belongs to operator B, so the UPDATE affects
-- nothing and PostgREST/Postgres raise "no rows" as insufficient_privilege
-- under RLS). WITH CHECK's own operator_id clause is untested here — see
-- TEST 9, which exercises it directly via INSERT.
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
     WHERE id = '84444444-2222-4000-8000-000000000005';
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  RESET role;

  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST 8 FAILED: admin A re-parented a driver to operator B';
  END IF;
END $$;
RESET role;

-- ============================================================================
-- TEST 9 — WITH CHECK stops an admin INSERTing a driver directly into
-- another operator. INSERT has no old row, so USING (TEST 8) cannot be what
-- blocks this — only WITH CHECK's own operator_id = get_operator_id() clause
-- can. Round 3 review: a WITH CHECK narrowed to just the role check (no
-- operator_id clause) lets this INSERT through silently — a live cross-tenant
-- write, the repo's own non-negotiable — while TEST 8 keeps passing, because
-- USING never runs on an INSERT.
-- ============================================================================
DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"84444444-1111-4000-8000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.drivers (id, operator_id, fleet_type, full_name, phone)
    VALUES ('84444444-2222-4000-8000-000000000006', '84444444-0000-4000-8000-00000000000b',
            'own', 'Driver Six B (cross-tenant INSERT attempt)', '+56900000006');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  RESET role;

  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST 9 FAILED: admin A INSERTed a driver directly into operator B';
  END IF;
END $$;
RESET role;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
