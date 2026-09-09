-- =============================================================================
-- spec-80 fase 3 — Aislamiento por operador: public.manifest_documents
--
-- Run against a local Supabase instance:
--   ./scripts/pgtap-local.sh run spec80_fase3_manifest_documents.test.sql
--
-- House style: fixtures inside one transaction, each test a DO block that
-- RAISEs on failure, SAVEPOINT/ROLLBACK around each so one failure does not
-- abort the rest. RLS tests follow spec85_discrepancies_schema.test.sql: SET
-- LOCAL role = 'authenticated' plus request.jwt.claims, never trusting
-- owner-context SELECTs.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', 'Test Op 80c A', 'test-op-80c-a', 'CL'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-000000000080', 'Test Op 80c B', 'test-op-80c-b', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000280',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec80c-user-a@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080"}'::jsonb,
   '{"full_name":"Spec80c User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000280',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'spec80c-user-b@operators.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000080"}'::jsonb,
   '{"full_name":"Spec80c User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000280','aaaaaaaa-aaaa-aaaa-aaaa-000000000080','spec80c-user-a@operators.test','Spec80c User A',ARRAY['admin']),
  ('bbbbbbbb-0000-4000-b000-000000000280','bbbbbbbb-bbbb-bbbb-bbbb-000000000080','spec80c-user-b@operators.test','Spec80c User B',ARRAY['admin'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

INSERT INTO public.manifests (id, operator_id, external_load_id, status)
VALUES
  ('44440001-0000-0000-0000-000000000080', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000080', 'T80C-LOAD-A', 'in_progress'),
  ('44440002-0000-0000-0000-000000000080', 'bbbbbbbb-bbbb-bbbb-bbbb-000000000080', 'T80C-LOAD-B', 'in_progress');

-- =============================================================================
-- TEST 1: RLS isolation — operator B cannot see operator A's photo rows.
-- =============================================================================
SAVEPOINT test_1;

INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
        'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
        1, 'aaaaaaaa-0000-4000-a000-000000000280');

DO $$
DECLARE c_other INT; c_all INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-0000-4000-b000-000000000280","operator_id":"bbbbbbbb-bbbb-bbbb-bbbb-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_other
    FROM public.manifest_documents WHERE operator_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000080';
  SELECT COUNT(*) INTO c_all FROM public.manifest_documents;

  IF c_other <> 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: cross-tenant read leak — operator B saw operator A''s document (got %)', c_other;
  END IF;
  IF c_all <> 0 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: unqualified SELECT returned % rows, expected 0 (operator B has none)', c_all;
  END IF;
  RESET role;
END $$;
RESET role;

DO $$
DECLARE c_own INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000280","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c_own FROM public.manifest_documents;
  IF c_own <> 1 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: operator A cannot read its own document (got %)', c_own;
  END IF;
  RESET role;
END $$;
RESET role;

DO $$ BEGIN RAISE NOTICE '✓ TEST 1 PASSED: RLS isolates manifest_documents by operator_id'; END $$;

ROLLBACK TO test_1;

-- =============================================================================
-- TEST 2 — cross-tenant INSERT: operator A cannot fabricate a photo row
-- carrying operator B's operator_id.
-- =============================================================================
SAVEPOINT test_2;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000280","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000080', '44440002-0000-0000-0000-000000000080',
            'bbbbbbbb-bbbb-bbbb-bbbb-000000000080/44440002-0000-0000-0000-000000000080/sheet-1.jpg',
            1, 'aaaaaaaa-0000-4000-a000-000000000280');
    RAISE EXCEPTION 'TEST 2 FAILED: operator A inserted a row carrying operator B''s operator_id';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '✓ TEST 2 PASSED: cross-tenant INSERT rejected (%)', SQLSTATE;
  END;
  RESET role;
END $$;
RESET role;

ROLLBACK TO test_2;

-- =============================================================================
-- TEST 3 — cross-tenant UPDATE: operator A cannot move its own row to
-- operator B.
-- =============================================================================
SAVEPOINT test_3;

INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
        'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
        1, 'aaaaaaaa-0000-4000-a000-000000000280');

DO $$
DECLARE v_owner UUID;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000280","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    UPDATE public.manifest_documents SET operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000080'
     WHERE sheet_number = 1;
    RAISE EXCEPTION 'TEST 3 FAILED: operator A moved its own row to operator B';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '✓ TEST 3 PASSED: moving a row to another operator rejected (%)', SQLSTATE;
  END;
  RESET role;
END $$;
RESET role;

DO $$
DECLARE v_owner UUID;
BEGIN
  SELECT operator_id INTO v_owner FROM public.manifest_documents WHERE sheet_number = 1;
  IF v_owner IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-000000000080'::uuid THEN
    RAISE EXCEPTION 'TEST 3 FAILED: row operator_id changed despite the rejected UPDATE (got %)', v_owner;
  END IF;
  RAISE NOTICE '✓ TEST 3 PASSED: row still belongs to operator A after the rejected UPDATE';
END $$;

ROLLBACK TO test_3;

-- =============================================================================
-- TEST 4 — UNIQUE (manifest_id, sheet_number): a second photo for the same
-- sheet number on the same manifest is rejected.
-- =============================================================================
SAVEPOINT test_4;

DO $$
BEGIN
  INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
          1, 'aaaaaaaa-0000-4000-a000-000000000280');

  BEGIN
    INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
            'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1-retry.jpg',
            1, 'aaaaaaaa-0000-4000-a000-000000000280');
    RAISE EXCEPTION 'TEST 4 FAILED: a duplicate sheet_number on the same manifest was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE '✓ TEST 4 PASSED: duplicate (manifest_id, sheet_number) rejected';
  END;
END $$;

ROLLBACK TO test_4;

-- =============================================================================
-- TEST 5 (ACL) — authenticated has no privilege on manifest_documents at all
-- for anon; direct ACL assert independent of RLS.
-- =============================================================================
SAVEPOINT test_5;

DO $$
DECLARE
  v_insert BOOLEAN;
  v_select BOOLEAN;
BEGIN
  v_insert := has_table_privilege('anon', 'public.manifest_documents', 'INSERT');
  v_select := has_table_privilege('anon', 'public.manifest_documents', 'SELECT');

  IF v_insert OR v_select THEN
    RAISE EXCEPTION 'TEST 5 FAILED: anon holds a privilege on manifest_documents (insert=%, select=%)', v_insert, v_select;
  END IF;

  RAISE NOTICE '✓ TEST 5 PASSED: anon has no privilege on manifest_documents';
END $$;

ROLLBACK TO test_5;

ROLLBACK;
