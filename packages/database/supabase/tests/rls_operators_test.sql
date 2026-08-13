-- RLS isolation test suite for the `operators` table
-- Story: 1.2 — Configure Multi-Tenant Database Schema with RLS Policies
--
-- REWRITTEN 2026-08-13. The previous version of this file could not prove
-- anything, for two independent reasons:
--
--   1. It never issued SET ROLE, so it ran as the table OWNER. Postgres exempts
--      a table's owner from RLS unless FORCE ROW LEVEL SECURITY is set, and it
--      is not set on public.operators. Every "RLS blocks this" assertion was
--      therefore evaluated with RLS switched off.
--   2. It put {"operator_id": "..."} into request.jwt.claims but no "sub".
--      The live policy is operators_isolation USING (id = get_operator_id()),
--      and get_operator_id() is `SELECT operator_id FROM public.users WHERE
--      id = auth.uid()`. With no "sub", auth.uid() is NULL and get_operator_id()
--      returns NULL — nothing is granted and nothing is proven.
--
-- It also had no BEGIN/ROLLBACK and left its fixture rows (including a
-- 'hacker-operator' row) behind in whatever database it was pointed at.
--
-- Shape follows spec52_vehicles_rls.sql. Run inside a transaction; ROLLBACK.

BEGIN;

-- ─── Preconditions ─────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.operators'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.operators';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                 WHERE polrelid = 'public.operators'::regclass
                   AND polname  = 'operators_isolation') THEN
    RAISE EXCEPTION 'operators_isolation policy is missing';
  END IF;
END $$;

-- ─── Fixture: two operators, one user in each ──────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000001','RLS Test Operator A','rls-test-operator-a'),
  ('bbbbbbbb-0000-4000-b000-000000000001','RLS Test Operator B','rls-test-operator-b')
ON CONFLICT (slug) DO NOTHING;

-- operator_id MUST live in raw_app_meta_data: the on_auth_user_created trigger
-- runs public.handle_new_user(), which reads raw_app_meta_data->>'operator_id'
-- and raises 'operator_id required in signup metadata' when it is absent.
-- raw_user_meta_data supplies only full_name.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000101',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'rls-user-a@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000001"}'::jsonb,
   '{"full_name":"RLS User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000101',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'rls-user-b@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000001"}'::jsonb,
   '{"full_name":"RLS User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user() has already created these rows,
-- so DO NOTHING would silently discard the permissions array below.
INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000101','aaaaaaaa-0000-4000-a000-000000000001','rls-user-a@operators.test','RLS User A',ARRAY['admin']),
  ('bbbbbbbb-0000-4000-b000-000000000101','bbbbbbbb-0000-4000-b000-000000000001','rls-user-b@operators.test','RLS User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- ─── GUARD: the connection role bypasses RLS, so SET ROLE is mandatory ─────
-- If a future edit deletes the SET LOCAL role lines below, every assertion in
-- this file silently becomes vacuous again. Pin that fact here: as the owner
-- we must be able to see BOTH operators. Anyone who makes this assertion fail
-- has changed the ownership/FORCE-RLS model and must revisit the whole file.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE slug IN ('rls-test-operator-a','rls-test-operator-b');
  IF c <> 2 THEN
    RAISE EXCEPTION
      'owner context saw % of 2 fixture operators — this file assumes the connection role bypasses RLS and therefore MUST SET ROLE before asserting', c;
  END IF;
END $$;

-- ─── TEST 1: user A sees its own operator, and ONLY its own ────────────────
DO $$
DECLARE c_own INT; c_other INT; c_all INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000101","operator_id":"aaaaaaaa-0000-4000-a000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own   FROM public.operators WHERE id = 'aaaaaaaa-0000-4000-a000-000000000001';
  SELECT COUNT(*) INTO c_other FROM public.operators WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001';
  SELECT COUNT(*) INTO c_all   FROM public.operators;

  IF c_own <> 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: user A cannot read its own operator (got %)', c_own;
  END IF;
  IF c_other <> 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: cross-tenant read leak — user A saw operator B (got %)', c_other;
  END IF;
  IF c_all <> 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: unqualified SELECT returned % rows, expected exactly 1 (the caller''s own operator)', c_all;
  END IF;
  RESET role;
END $$;
RESET role;

-- ─── TEST 2: fail-secure when the JWT carries no `sub` ─────────────────────
-- This is the exact defect that made the old version of this file vacuous: it
-- set operator_id into request.jwt.claims and no sub, so get_operator_id()
-- returned NULL for every assertion. A claim alone must never grant a row —
-- the operator has to be resolved through public.users via auth.uid().
DO $$
DECLARE c_flat INT; c_empty INT;
BEGIN
  SET LOCAL role = 'authenticated';

  PERFORM set_config('request.jwt.claims',
    '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000001","role":"authenticated"}', true);
  SELECT COUNT(*) INTO c_flat FROM public.operators;

  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c_empty FROM public.operators;

  IF c_flat <> 0 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: a claims object with operator_id but no sub returned % rows — a policy is trusting the raw claim instead of public.users', c_flat;
  END IF;
  IF c_empty <> 0 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: empty claims returned % rows, expected fail-secure 0', c_empty;
  END IF;
  RESET role;
END $$;
RESET role;

-- ─── TEST 2b: CHARACTERISATION of a latent gap, not an endorsement ─────────
-- public.operators carries a SECOND, permissive SELECT policy:
--
--   operators_read_own  FOR SELECT
--     USING (id = (current_setting('request.jwt.claims',true)::jsonb
--                  -> 'claims' ->> 'operator_id')::uuid)
--     -- 20260304000001_operator_branding_and_rls.sql:8
--
-- It grants purely on a claim, with no public.users lookup and no `sub`. It is
-- unreachable in production only by accident: request.jwt.claims IS the token
-- payload, and public.custom_access_token_hook
-- (20260312190110_fix_hook_role_overwrite.sql) writes operator_id at the TOP
-- level of that payload and a copy under app_metadata.claims — never under a
-- bare `claims` key. The extra -> 'claims' hop therefore always dereferences a
-- key that does not exist and the policy yields NULL.
--
-- So today operators_isolation is the only thing enforcing tenancy here. The
-- assertion below pins the inert policy's real behaviour so that the day the
-- token shape changes — or someone "fixes" the extra hop — this file fails
-- loudly instead of quietly turning into a claim-trusting read grant.
-- ACTION: operators_read_own should be dropped or rewritten against
-- get_operator_id(). Until then, this is a known gap, recorded not accepted.
DO $$
DECLARE c_nested INT;
BEGIN
  SET LOCAL role = 'authenticated';
  PERFORM set_config('request.jwt.claims',
    '{"claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000001"},"role":"authenticated"}', true);
  SELECT COUNT(*) INTO c_nested FROM public.operators;
  RESET role;

  IF c_nested <> 1 THEN
    RAISE EXCEPTION
      'TEST 2b: operators_read_own no longer grants on a bare nested claims.operator_id (got % rows). If it was dropped or rewritten, DELETE this test. If the JWT shape changed so that claims.claims is now populated, this policy has become a live claim-trusting read grant — fix it before touching this test.',
      c_nested;
  END IF;
END $$;
RESET role;

-- ─── TEST 3: WITH CHECK blocks planting a new operator row ─────────────────
-- operators_isolation is FOR ALL with no explicit WITH CHECK, so its USING
-- expression doubles as the check: a row whose id is not the caller's own
-- operator must be rejected outright, not merely hidden afterwards.
DO $$
DECLARE blocked BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000101","operator_id":"aaaaaaaa-0000-4000-a000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.operators (id, name, slug)
    VALUES ('cccccccc-0000-4000-c000-000000000001','Hacker Operator','rls-test-hacker');
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;

  IF NOT blocked THEN
    RAISE EXCEPTION 'TEST 3 FAILED: user A inserted an operator row it does not own';
  END IF;
  RESET role;
END $$;
RESET role;

-- ─── TEST 4: UPDATE of another tenant's operator is blocked ────────────────
DO $$
DECLARE rows_affected INT; leaked_name TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000101","operator_id":"aaaaaaaa-0000-4000-a000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  UPDATE public.operators SET name = 'Hacked Name'
   WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001';
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RESET role;

  IF rows_affected <> 0 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: user A updated % row(s) of operator B', rows_affected;
  END IF;

  -- Confirm from the owner context that B really is untouched: a zero ROW_COUNT
  -- alone would also be produced by a policy that merely hid the row from the
  -- UPDATE's own RETURNING.
  SELECT name INTO leaked_name FROM public.operators
   WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001';
  IF leaked_name <> 'RLS Test Operator B' THEN
    RAISE EXCEPTION 'TEST 4 FAILED: operator B name is now %', leaked_name;
  END IF;
END $$;
RESET role;

-- ─── TEST 5: DELETE of another tenant's operator is blocked ────────────────
DO $$
DECLARE rows_affected INT; still_there INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000101","operator_id":"aaaaaaaa-0000-4000-a000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  DELETE FROM public.operators WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001';
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RESET role;

  IF rows_affected <> 0 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: user A deleted % row(s) of operator B', rows_affected;
  END IF;

  SELECT COUNT(*) INTO still_there FROM public.operators
   WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001';
  IF still_there <> 1 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: operator B row is gone';
  END IF;
END $$;
RESET role;

-- ─── TEST 6: positive control — the caller CAN write its own operator ──────
-- Without this, every assertion above would also pass if `authenticated` had
-- simply been stripped of all privileges on the table.
DO $$
DECLARE rows_affected INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-b000-000000000101","operator_id":"bbbbbbbb-0000-4000-b000-000000000001","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  UPDATE public.operators SET name = 'RLS Test Operator B (renamed by its own user)'
   WHERE id = 'bbbbbbbb-0000-4000-b000-000000000001';
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  RESET role;

  IF rows_affected <> 1 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: user B could not update its OWN operator (% rows) — the policy is blocking legitimate writes, or authenticated lacks UPDATE', rows_affected;
  END IF;
END $$;
RESET role;

SELECT set_config('request.jwt.claims', '{}', true);

ROLLBACK;
