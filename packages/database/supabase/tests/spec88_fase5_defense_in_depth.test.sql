-- pgTAP: spec-88 fase 5 — Defensa en profundidad del resto: REVOKE sobre 16
-- funciones SECURITY DEFINER con guard efectivo pero cuyo ACL nunca fue
-- revocado de PUBLIC/anon, más MINA 1 (get_operator_id/get_current_user_role
-- deben conservar `authenticated` — 61 políticas RLS las invocan), MINA 2
-- (get_operator_id gana SET search_path), y dos guards que no hacían lo que
-- decían (get_enabled_modules_for_operator(NULL), get_manifest_label_data
-- cross-tenant).
--
-- Pattern (spec88_fase1_revoke_anon.test.sql): has_function() first (a
-- typo'd/dropped function must fail loudly, not vacuously pass an empty
-- aclexplode()), then aclexplode(proacl) directly by exact
-- p.oid = 'public.f(...)'::regprocedure — NUNCA por proname (ronda 2 de
-- review de PR #733: proname-only deja pasar un futuro overload con su
-- propio grant aunque la firma real lo haya perdido, y la aserción de
-- search_path reventaba con "more than one row returned by a subquery" en
-- cuanto existiera un segundo overload — el mismo tipo de bug que
-- start_pickup_route ya causó en fase 1).

BEGIN;
SELECT plan(68);
-- =============================================================================
-- Las 16 — PUBLIC y anon fuera, authenticated SOBREVIVE (61 políticas RLS
-- invocan get_operator_id/get_current_user_role en USING/WITH CHECK; el
-- resto las necesita como su único llamante real). Filtrado por
-- p.oid = 'public.f(...)'::regprocedure, NUNCA por proname (ronda 2 de
-- review: proname-only permite que un futuro overload con grant propio
-- oculte que la firma real lo perdió, y rompe con "more than one row
-- returned by a subquery" en cuanto exista un segundo overload).
-- =============================================================================

SELECT has_function('public', 'get_operator_id', ARRAY[]::text[],
  'get_operator_id() exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.get_operator_id()'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'get_operator_id(): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.get_operator_id()'::regprocedure)), false, 'get_operator_id(): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.get_operator_id()'::regprocedure)), true, 'get_operator_id(): authenticated keeps EXECUTE');
-- MINA 2 — SET search_path added. By exact oid, not proname: a future
-- overload wouldn't share this proconfig, and this must not silently pass it.
SELECT is(
  (SELECT 'search_path=public, pg_temp' = ANY(p.proconfig)
     FROM pg_proc p WHERE p.oid = 'public.get_operator_id()'::regprocedure),
  true, 'get_operator_id: SET search_path = public, pg_temp added');

SELECT has_function('public', 'get_current_user_role', ARRAY[]::text[],
  'get_current_user_role() exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.get_current_user_role()'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'get_current_user_role(): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.get_current_user_role()'::regprocedure)), false, 'get_current_user_role(): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.get_current_user_role()'::regprocedure)), true, 'get_current_user_role(): authenticated keeps EXECUTE');

SELECT has_function('public', 'get_enabled_modules_for_operator', ARRAY['uuid']::text[],
  'get_enabled_modules_for_operator(uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.get_enabled_modules_for_operator(uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'get_enabled_modules_for_operator(uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.get_enabled_modules_for_operator(uuid)'::regprocedure)), false, 'get_enabled_modules_for_operator(uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.get_enabled_modules_for_operator(uuid)'::regprocedure)), true, 'get_enabled_modules_for_operator(uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'enable_module_for_operator', ARRAY['uuid','text','text']::text[],
  'enable_module_for_operator(uuid,text,text) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.enable_module_for_operator(uuid,text,text)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'enable_module_for_operator(uuid,text,text): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.enable_module_for_operator(uuid,text,text)'::regprocedure)), false, 'enable_module_for_operator(uuid,text,text): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.enable_module_for_operator(uuid,text,text)'::regprocedure)), true, 'enable_module_for_operator(uuid,text,text): authenticated keeps EXECUTE');

SELECT has_function('public', 'disable_module_for_operator', ARRAY['uuid','text','text']::text[],
  'disable_module_for_operator(uuid,text,text) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.disable_module_for_operator(uuid,text,text)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'disable_module_for_operator(uuid,text,text): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.disable_module_for_operator(uuid,text,text)'::regprocedure)), false, 'disable_module_for_operator(uuid,text,text): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.disable_module_for_operator(uuid,text,text)'::regprocedure)), true, 'disable_module_for_operator(uuid,text,text): authenticated keeps EXECUTE');

SELECT has_function('public', 'list_operators_with_module_state', ARRAY[]::text[],
  'list_operators_with_module_state() exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.list_operators_with_module_state()'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'list_operators_with_module_state(): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.list_operators_with_module_state()'::regprocedure)), false, 'list_operators_with_module_state(): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.list_operators_with_module_state()'::regprocedure)), true, 'list_operators_with_module_state(): authenticated keeps EXECUTE');

SELECT has_function('public', 'get_module_audit_for_operator', ARRAY['uuid']::text[],
  'get_module_audit_for_operator(uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.get_module_audit_for_operator(uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'get_module_audit_for_operator(uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.get_module_audit_for_operator(uuid)'::regprocedure)), false, 'get_module_audit_for_operator(uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.get_module_audit_for_operator(uuid)'::regprocedure)), true, 'get_module_audit_for_operator(uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'add_manifest_to_route', ARRAY['uuid','uuid']::text[],
  'add_manifest_to_route(uuid,uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.add_manifest_to_route(uuid,uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'add_manifest_to_route(uuid,uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.add_manifest_to_route(uuid,uuid)'::regprocedure)), false, 'add_manifest_to_route(uuid,uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.add_manifest_to_route(uuid,uuid)'::regprocedure)), true, 'add_manifest_to_route(uuid,uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'close_pickup_route', ARRAY['uuid']::text[],
  'close_pickup_route(uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.close_pickup_route(uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'close_pickup_route(uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.close_pickup_route(uuid)'::regprocedure)), false, 'close_pickup_route(uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.close_pickup_route(uuid)'::regprocedure)), true, 'close_pickup_route(uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'cancel_pickup_route', ARRAY['uuid','text']::text[],
  'cancel_pickup_route(uuid,text) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.cancel_pickup_route(uuid,text)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'cancel_pickup_route(uuid,text): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.cancel_pickup_route(uuid,text)'::regprocedure)), false, 'cancel_pickup_route(uuid,text): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.cancel_pickup_route(uuid,text)'::regprocedure)), true, 'cancel_pickup_route(uuid,text): authenticated keeps EXECUTE');

SELECT has_function('public', 'get_route_reception_snapshot', ARRAY['uuid']::text[],
  'get_route_reception_snapshot(uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.get_route_reception_snapshot(uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'get_route_reception_snapshot(uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.get_route_reception_snapshot(uuid)'::regprocedure)), false, 'get_route_reception_snapshot(uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.get_route_reception_snapshot(uuid)'::regprocedure)), true, 'get_route_reception_snapshot(uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'mark_manifest_labels_printed', ARRAY['uuid']::text[],
  'mark_manifest_labels_printed(uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.mark_manifest_labels_printed(uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'mark_manifest_labels_printed(uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.mark_manifest_labels_printed(uuid)'::regprocedure)), false, 'mark_manifest_labels_printed(uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.mark_manifest_labels_printed(uuid)'::regprocedure)), true, 'mark_manifest_labels_printed(uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'get_manifest_label_data', ARRAY['uuid','uuid']::text[],
  'get_manifest_label_data(uuid,uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.get_manifest_label_data(uuid,uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'get_manifest_label_data(uuid,uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.get_manifest_label_data(uuid,uuid)'::regprocedure)), false, 'get_manifest_label_data(uuid,uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.get_manifest_label_data(uuid,uuid)'::regprocedure)), true, 'get_manifest_label_data(uuid,uuid): authenticated keeps EXECUTE');

SELECT has_function('public', 'expand_carton', ARRAY['uuid','int4','text']::text[],
  'expand_carton(uuid,int,text) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.expand_carton(uuid,int,text)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'expand_carton(uuid,int,text): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.expand_carton(uuid,int,text)'::regprocedure)), false, 'expand_carton(uuid,int,text): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.expand_carton(uuid,int,text)'::regprocedure)), true, 'expand_carton(uuid,int,text): authenticated keeps EXECUTE');

SELECT has_function('public', 'delete_minted_carton', ARRAY['uuid','text']::text[],
  'delete_minted_carton(uuid,text) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.delete_minted_carton(uuid,text)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'delete_minted_carton(uuid,text): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.delete_minted_carton(uuid,text)'::regprocedure)), false, 'delete_minted_carton(uuid,text): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.delete_minted_carton(uuid,text)'::regprocedure)), true, 'delete_minted_carton(uuid,text): authenticated keeps EXECUTE');

SELECT has_function('public', 'remove_manifest_from_route', ARRAY['uuid','uuid']::text[],
  'remove_manifest_from_route(uuid,uuid) exists');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.remove_manifest_from_route(uuid,uuid)'::regprocedure AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))), false, 'remove_manifest_from_route(uuid,uuid): no PUBLIC EXECUTE grant survives');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='anon' WHERE p.oid = 'public.remove_manifest_from_route(uuid,uuid)'::regprocedure)), false, 'remove_manifest_from_route(uuid,uuid): anon has no EXECUTE grant');
SELECT is((SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN aclexplode(p.proacl) a ON a.privilege_type='EXECUTE' JOIN pg_roles r ON r.oid=a.grantee AND r.rolname='authenticated' WHERE p.oid = 'public.remove_manifest_from_route(uuid,uuid)'::regprocedure)), true, 'remove_manifest_from_route(uuid,uuid): authenticated keeps EXECUTE');

-- =============================================================================
-- Behavioral fix #1 — get_enabled_modules_for_operator(NULL) must now RAISE
-- 42501 instead of dodging its own guard and returning '{}'. No public.users
-- row needed: spec45_caller_operator_id()/is_super_admin() read the JWT
-- directly, never public.users.
-- =============================================================================

DO $$
DECLARE
  raised BOOLEAN := false;
  sqlstate_got TEXT := 'none';
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_enabled_modules_for_operator(NULL);
  EXCEPTION WHEN OTHERS THEN
    raised := true;
    GET STACKED DIAGNOSTICS sqlstate_got = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF NOT raised THEN
    RAISE EXCEPTION 'get_enabled_modules_for_operator(NULL) did not raise — bypass not fixed';
  END IF;
  IF sqlstate_got <> '42501' THEN
    RAISE EXCEPTION 'get_enabled_modules_for_operator(NULL) raised %, expected 42501', sqlstate_got;
  END IF;
END $$;
SELECT pass('get_enabled_modules_for_operator(NULL) raises 42501 instead of dodging its own RAISE');

-- =============================================================================
-- Behavioral fix #2 — get_manifest_label_data raises 42501 for a manifest
-- that exists but belongs to another operator (was: 0 rows). A nonexistent
-- manifest still returns 0 rows — that's genuinely "no data".
-- =============================================================================

INSERT INTO public.operators (id, name, slug)
VALUES
  ('a0000000-f5f5-4000-a000-000000000088', 'Spec88F5 Op A', 'spec88f5-op-a'),
  ('b0000000-f5f5-4000-b000-000000000088', 'Spec88F5 Op B', 'spec88f5-op-b')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('a1000000-f5f5-4000-a000-000000000088',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec88f5.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"a0000000-f5f5-4000-a000-000000000088"}'::jsonb,
   '{"full_name":"F5 User A"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('a1000000-f5f5-4000-a000-000000000088','a0000000-f5f5-4000-a000-000000000088','user-a@spec88f5.test','F5 User A',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE SET operator_id = EXCLUDED.operator_id;

SELECT set_config('request.jwt.claims', '{}', true);

INSERT INTO public.manifests (id, operator_id, external_load_id, retailer_name, status)
VALUES
  ('c1000000-f5f5-4000-c000-000000000088','b0000000-f5f5-4000-b000-000000000088','CARGA-SPEC88F5-B','Easy','in_progress')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  raised BOOLEAN := false;
  sqlstate_got TEXT := 'none';
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a1000000-f5f5-4000-a000-000000000088","operator_id":"a0000000-f5f5-4000-a000-000000000088","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_manifest_label_data('c1000000-f5f5-4000-c000-000000000088');
  EXCEPTION WHEN OTHERS THEN
    raised := true;
    GET STACKED DIAGNOSTICS sqlstate_got = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  IF NOT raised THEN
    RAISE EXCEPTION 'get_manifest_label_data did not raise for a cross-tenant manifest — still returning 0 rows silently';
  END IF;
  IF sqlstate_got <> '42501' THEN
    RAISE EXCEPTION 'get_manifest_label_data raised %, expected 42501', sqlstate_got;
  END IF;
END $$;
SELECT pass('get_manifest_label_data raises 42501 for a manifest belonging to another operator');

DO $$
DECLARE
  c INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a1000000-f5f5-4000-a000-000000000088","operator_id":"a0000000-f5f5-4000-a000-000000000088","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO c FROM public.get_manifest_label_data('d0000000-f5f5-4000-d000-000000000088');
  RESET ROLE;
  IF c <> 0 THEN
    RAISE EXCEPTION 'a genuinely nonexistent manifest should still return 0 rows, got %', c;
  END IF;
END $$;
SELECT pass('get_manifest_label_data still returns 0 rows (not an error) for a manifest that does not exist at all');

SELECT * FROM finish();
ROLLBACK;
