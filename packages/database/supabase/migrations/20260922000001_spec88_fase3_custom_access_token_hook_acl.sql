-- =============================================================================
-- spec-88 fase 3 — custom_access_token_hook: cierra la fuga #2 (invocable
-- por `anon` sin guard, filtrando operator_id/role/permissions de cualquier
-- usuario dado su UUID) sin romper el login de producción.
-- =============================================================================
-- Auditoría completa y confirmación de producción:
-- docs/specs/spec-88-anon-security-definer-audit.md (fase 3).
--
-- Confirmado vía la Management API de Supabase (workflow_dispatch,
-- run 34240504022, 2026-09-08T14:47:08Z): producción tiene el hook activo
-- (hook_custom_access_token_enabled=true). GoTrue invoca esta función con
-- su propio rol de conexión, `supabase_auth_admin` — nunca `anon` ni
-- `authenticated`. Hasta esta migración, `supabase_auth_admin` sólo tenía
-- EXECUTE por heredar el grant implícito de PUBLIC (`=X`) y el default
-- privilege que Supabase concede a todo rol de PostgREST en funciones
-- nuevas de `public` — nunca por un GRANT propio.
--
-- ORDEN NO NEGOCIABLE: el GRANT explícito a supabase_auth_admin va ANTES de
-- cualquier REVOKE. Si el REVOKE FROM PUBLIC llegara primero, la ventana
-- entre ambas sentencias dejaría a supabase_auth_admin sin EXECUTE alguno —
-- dentro de la misma transacción no hay ventana real (todo corre en un solo
-- COMMIT), pero el orden se mantiene también documentalmente: nunca debe
-- reordenarse en un futuro REPLACE de esta migración.
--
-- authenticated se cierra también, no sólo anon/PUBLIC: no hay ningún
-- llamante legítimo autenticado (el frontend nunca invoca este RPC — lo
-- llama únicamente GoTrue). Dejar `authenticated` abierto habría dejado
-- viva la misma fuga para cualquier sesión de usuario válida: el hook
-- acepta cualquier `user_id` en su argumento, no sólo el del llamante, así
-- que una sesión `authenticated` cualquiera podría seguir leyendo el
-- operator_id/role/permissions de otra cuenta. Mismo criterio que el Grupo A
-- de la fase 1 (20260913000006) para funciones sin consumidor legítimo.
--
-- service_role no se toca aquí — mismo criterio que la fase 1: es el rol de
-- confianza de este repo (n8n, cron, agentes de backend) y closing it no es
-- parte del alcance de esta fuga.
-- =============================================================================

BEGIN;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
  ) THEN
    RAISE EXCEPTION 'custom_access_token_hook not found — migration template mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
    JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'supabase_auth_admin'
    WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
  ) THEN
    RAISE EXCEPTION 'supabase_auth_admin lost EXECUTE on custom_access_token_hook — this would break production login for every user';
  END IF;

  RAISE NOTICE '✓ spec-88 fase 3 — custom_access_token_hook closed to PUBLIC/anon/authenticated, supabase_auth_admin confirmed';
END $$;

COMMIT;
