-- pgTAP: spec-88 fase 3 — custom_access_token_hook cierra `anon`/PUBLIC y
-- gana un GRANT explícito para `supabase_auth_admin` (el rol con el que
-- GoTrue invoca el hook en producción — confirmado
-- hook_custom_access_token_enabled=true vía la Management API, ver spec).
--
-- Mismo patrón que 20260913000006 (fase 1): has_function() primero (para
-- que un nombre mal escrito o una función borrada falle ruidoso, no
-- vacío), luego aclexplode(proacl) en vez de has_function_privilege() —
-- has_function_privilege() siempre da true para el superusuario que corre
-- este test, sin importar el ACL real.
--
-- El criterio de aceptación de esta fase NO es que el RPC rechace a `anon`
-- (aunque este test también lo comprueba) — es que GoTrue, que llama como
-- `supabase_auth_admin`, nunca deje de poder invocarlo. Ese GRANT explícito
-- es lo que hace la diferencia entre "cerrar la fuga" y "romper el login de
-- producción para todos" — antes de esta migración, supabase_auth_admin
-- sólo tenía EXECUTE por heredar el grant implícito de PUBLIC.

BEGIN;
SELECT plan(6);

SELECT has_function('public', 'custom_access_token_hook', ARRAY['jsonb'],
  'custom_access_token_hook(jsonb) exists');

-- No PUBLIC EXECUTE grant survives (grantee = 0 is the PUBLIC pseudo-role).
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'custom_access_token_hook: no PUBLIC EXECUTE grant survives');

-- anon has no EXECUTE grant.
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
       AND p.proacl IS NOT NULL)),
  false, 'custom_access_token_hook: anon has no EXECUTE grant');

-- authenticated has no EXECUTE grant either — no legitimate caller invokes
-- this RPC directly; the frontend never calls it, and any authenticated
-- session could otherwise pass an arbitrary user_id and read that user's
-- operator_id/role/permissions (fuga #2 del spec, reproducible también como
-- `authenticated`, no sólo como `anon`).
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
       AND p.proacl IS NOT NULL)),
  false, 'custom_access_token_hook: authenticated has no EXECUTE grant either');

-- The one grant that MUST exist: supabase_auth_admin, the role GoTrue uses
-- to call this hook in production. Losing this grant breaks login for
-- every user in production.
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'supabase_auth_admin'
     WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook')),
  true, 'custom_access_token_hook: supabase_auth_admin keeps EXECUTE');

-- Behavioural proof, not just ACL: a session with role=anon must be denied
-- at the Postgres privilege layer (permission denied), not merely fail
-- internally. This is the mutation-test guard — CREATE OR REPLACE alone
-- preserves the ACL, so a test that never actually exercises anon's denial
-- would pass vacuously against an unrelated CREATE OR REPLACE with no REVOKE
-- behind it.
SELECT throws_ok(
  $$ SET LOCAL ROLE anon;
     SELECT public.custom_access_token_hook(
       jsonb_build_object('user_id', '00000000-0000-4000-8000-000000000208', 'claims', '{}'::jsonb)); $$,
  '42501',
  NULL,
  'custom_access_token_hook: anon is denied at the ACL layer (permission denied)'
);

SELECT * FROM finish();
ROLLBACK;
