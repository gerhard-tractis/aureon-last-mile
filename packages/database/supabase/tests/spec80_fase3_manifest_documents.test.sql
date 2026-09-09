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

-- =============================================================================
-- TEST 6 (M2, ronda 2; corregido en ronda 3 de review del PR #706) —
-- aserción ESTRUCTURAL sobre pg_policy, no una demostración en runtime.
--
-- La ronda 2 de este test hacía un UPDATE en bloque y esperaba 0 filas
-- afectadas sobre la fila de otro operador, razonando que eso ejercitaba el
-- USING del FOR ALL. Es falso: Postgres aplica SIEMPRE las policies de
-- SELECT a las filas que un UPDATE necesita LEER para calcular la fila
-- nueva — así que `manifest_documents_tenant_select` ya tapaba el agujero
-- antes de que el USING del FOR ALL llegara a evaluarse. Re-aplicar la
-- mutación de la ronda 1 (USING(true) sólo en el FOR ALL, WITH CHECK
-- intacto) seguía dando el test en verde: el test no protegía lo que decía
-- proteger.
--
-- (El vector real de la ronda 1 fue un DELETE sin WHERE — un DELETE no LEE
-- la fila vieja, así que escapa a la policy de SELECT. Ya no es explotable:
-- DELETE está revocado de `authenticated` a nivel de GRANT, ver TEST 7/8,
-- así que un DELETE en bloque ni siquiera llega a RLS.)
--
-- Con INSERT cubierto por TEST 2/10, UPDATE cubierto por TEST 3 + la
-- policy de SELECT, y DELETE cerrado por GRANT, la superficie real está
-- cerrada. Lo que faltaba era un test que de verdad falle si alguien
-- debilita el FOR ALL a USING(true) — este lo hace leyendo el catálogo,
-- no ejecutando una sentencia que otra policy podría estar tapando.
-- =============================================================================
SAVEPOINT test_6;

DO $$
DECLARE v_qual TEXT;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
    FROM pg_policy
    WHERE polrelid = 'public.manifest_documents'::regclass
      AND polname = 'manifest_documents_tenant_isolation';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'TEST 6 FAILED: manifest_documents_tenant_isolation policy not found';
  END IF;
  IF v_qual = 'true' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: FOR ALL policy USING clause is unconditionally true (%)', v_qual;
  END IF;
  IF v_qual NOT ILIKE '%get_operator_id%' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: FOR ALL policy USING clause does not reference get_operator_id() (got %)', v_qual;
  END IF;

  RAISE NOTICE '✓ TEST 6 PASSED: FOR ALL policy USING clause is scoped by get_operator_id(), not unconditionally true (%)', v_qual;
END $$;

ROLLBACK TO test_6;

-- =============================================================================
-- TEST 6b (documental, ronda 2) — la demostración en runtime que ronda 2
-- tomó por guardia del USING. Se conserva porque SÍ prueba algo real: que
-- hoy, en la práctica, un UPDATE en bloque de operator A no toca la fila de
-- B. Pero el crédito es de `manifest_documents_tenant_select` (SELECT),
-- no de este policy FOR ALL — ver TEST 6. No se usa como regresión de esa
-- policy: la mutación de ronda 1 la deja en verde igual, por la razón de
-- arriba.
-- =============================================================================
SAVEPOINT test_6b;

INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-000000000080', '44440002-0000-0000-0000-000000000080',
        'bbbbbbbb-bbbb-bbbb-bbbb-000000000080/44440002-0000-0000-0000-000000000080/sheet-1.jpg',
        1, 'bbbbbbbb-0000-4000-b000-000000000280');

DO $$
DECLARE v_rows_updated INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000280","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  UPDATE public.manifest_documents SET captured_at = NOW();
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated <> 0 THEN
    RAISE EXCEPTION 'TEST 6b FAILED: operator A''s blanket UPDATE affected % row(s) — expected 0 (B''s row must stay invisible)', v_rows_updated;
  END IF;

  RESET role;
END $$;
RESET role;

DO $$
DECLARE v_still_there BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.manifest_documents
    WHERE operator_id = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000080'
      AND storage_path = 'bbbbbbbb-bbbb-bbbb-bbbb-000000000080/44440002-0000-0000-0000-000000000080/sheet-1.jpg'
  ) INTO v_still_there;
  IF NOT v_still_there THEN
    RAISE EXCEPTION 'TEST 6b FAILED: operator B''s row is gone after operator A''s blanket UPDATE';
  END IF;
  RAISE NOTICE '✓ TEST 6b PASSED (documental): blanket UPDATE by operator A touches 0 rows of B in practice (credit: the SELECT policy, not this FOR ALL)';
END $$;

ROLLBACK TO test_6b;

-- =============================================================================
-- TEST 7 (Mayor 1, ronda 2) — ACL: DELETE revoked from authenticated at the
-- GRANT layer, independent of RLS. SELECT/INSERT/UPDATE still granted (sanity
-- — the REVOKE must be scoped to DELETE only).
-- =============================================================================
SAVEPOINT test_7;

DO $$
DECLARE
  v_delete BOOLEAN; v_select BOOLEAN; v_insert BOOLEAN; v_update BOOLEAN;
BEGIN
  v_delete := has_table_privilege('authenticated', 'public.manifest_documents', 'DELETE');
  v_select := has_table_privilege('authenticated', 'public.manifest_documents', 'SELECT');
  v_insert := has_table_privilege('authenticated', 'public.manifest_documents', 'INSERT');
  v_update := has_table_privilege('authenticated', 'public.manifest_documents', 'UPDATE');

  IF v_delete THEN
    RAISE EXCEPTION 'TEST 7 FAILED: authenticated still holds DELETE on manifest_documents — evidence table is physically deletable by any client';
  END IF;
  IF NOT (v_select AND v_insert AND v_update) THEN
    RAISE EXCEPTION 'TEST 7 FAILED: REVOKE DELETE also took SELECT/INSERT/UPDATE with it (select=%, insert=%, update=%)', v_select, v_insert, v_update;
  END IF;

  RAISE NOTICE '✓ TEST 7 PASSED: authenticated has no DELETE privilege on manifest_documents; SELECT/INSERT/UPDATE intact';
END $$;

ROLLBACK TO test_7;

-- =============================================================================
-- TEST 8 (Mayor 1, ronda 2) — DELETE is rejected even against the operator's
-- OWN row: the REVOKE bites before RLS ever runs, not just cross-tenant.
-- =============================================================================
SAVEPOINT test_8;

INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
        'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
        1, 'aaaaaaaa-0000-4000-a000-000000000280');

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000280","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    DELETE FROM public.manifest_documents WHERE sheet_number = 1;
    RAISE EXCEPTION 'TEST 8 FAILED: operator A physically deleted its own evidence row';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '✓ TEST 8 PASSED: DELETE on own row rejected at the GRANT layer (%)', SQLSTATE;
  END;
  RESET role;
END $$;
RESET role;

ROLLBACK TO test_8;

-- =============================================================================
-- TEST 9 (Mayor 1, ronda 2) — audit trigger exists and actually fires on
-- INSERT, writing to audit_logs with resource_type = 'manifest_documents'.
-- =============================================================================
SAVEPOINT test_9;

DO $$
DECLARE v_trigger_exists BOOLEAN; v_audit_count INT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger WHERE tgname = 'audit_manifest_documents_changes'
  ) INTO v_trigger_exists;
  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'TEST 9 FAILED: audit_manifest_documents_changes trigger does not exist';
  END IF;

  INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
          1, 'aaaaaaaa-0000-4000-a000-000000000280');

  SELECT COUNT(*) INTO v_audit_count FROM public.audit_logs
    WHERE resource_type = 'manifest_documents' AND action = 'INSERT_manifest_documents';
  IF v_audit_count <> 1 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: expected 1 audit_logs row for the INSERT, got %', v_audit_count;
  END IF;

  RAISE NOTICE '✓ TEST 9 PASSED: audit trigger exists and writes to audit_logs on INSERT';
END $$;

ROLLBACK TO test_9;

-- =============================================================================
-- TEST 10 (Mayor 1, ronda 2 — WITH CHECK uploaded_by) — operator A cannot
-- insert a photo row claiming a DIFFERENT user uploaded it (impersonation).
-- =============================================================================
SAVEPOINT test_10;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000280","operator_id":"aaaaaaaa-aaaa-aaaa-aaaa-000000000080","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    INSERT INTO public.manifest_documents (operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-000000000080', '44440001-0000-0000-0000-000000000080',
            'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
            1, 'bbbbbbbb-0000-4000-b000-000000000280');
    RAISE EXCEPTION 'TEST 10 FAILED: operator A inserted a row claiming a different user uploaded it';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE '✓ TEST 10 PASSED: uploaded_by impersonation rejected by WITH CHECK (%)', SQLSTATE;
  END;
  RESET role;
END $$;
RESET role;

ROLLBACK TO test_10;

-- =============================================================================
-- TEST 11 (seguimiento 2, ronda 3 de review del PR #706) — el índice único
-- PARCIAL (WHERE deleted_at IS NULL) es el motivo real de la corrección de
-- ronda 2 sobre el UNIQUE de tabla que pedía el spec original. TEST 4 sólo
-- comprueba el caso que es IDÉNTICO con las dos formas (dos filas vivas
-- colisionan). Nada cubría el caso por el que existe el índice parcial:
-- volver a un UNIQUE de tabla normal deja este test en rojo, y TEST 4 en
-- verde de todos modos — sin este test, esa regresión no se detecta.
-- =============================================================================
SAVEPOINT test_11;

DO $$
DECLARE v_new_id UUID;
BEGIN
  -- Hoja 1 viva.
  INSERT INTO public.manifest_documents (id, operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
  VALUES ('99990001-0000-0000-0000-000000000080', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000080',
          '44440001-0000-0000-0000-000000000080',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1.jpg',
          1, 'aaaaaaaa-0000-4000-a000-000000000280');

  -- Borrado suave (no DELETE físico — authenticated no tiene ese privilegio
  -- tras Mayor 1; el propio dueño de la tabla sí, para simular lo que la
  -- app hará el día que exista un flujo de borrado).
  UPDATE public.manifest_documents SET deleted_at = NOW()
   WHERE id = '99990001-0000-0000-0000-000000000080';

  -- Reinsertar la MISMA hoja 1 para el MISMO manifiesto debe tener éxito:
  -- la fila muerta no debe bloquear el número que liberó.
  INSERT INTO public.manifest_documents (id, operator_id, manifest_id, storage_path, sheet_number, uploaded_by)
  VALUES ('99990002-0000-0000-0000-000000000080', 'aaaaaaaa-aaaa-aaaa-aaaa-000000000080',
          '44440001-0000-0000-0000-000000000080',
          'aaaaaaaa-aaaa-aaaa-aaaa-000000000080/44440001-0000-0000-0000-000000000080/sheet-1-retake.jpg',
          1, 'aaaaaaaa-0000-4000-a000-000000000280')
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'TEST 11 FAILED: reinsert of sheet_number 1 after soft-delete did not return an id';
  END IF;

  RAISE NOTICE '✓ TEST 11 PASSED: a soft-deleted sheet_number is reusable (partial unique index, not a table-level UNIQUE)';
END $$;

ROLLBACK TO test_11;

ROLLBACK;
