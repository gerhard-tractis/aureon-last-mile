-- =============================================================================
-- spec-88 fase 1 — REVOKE mecánico sobre 15 funciones SECURITY DEFINER
-- ejecutables por `anon` sin guard efectivo, con ACL que miente, o huérfanas.
-- =============================================================================
-- Auditoría completa: docs/specs/spec-88-anon-security-definer-audit.md.
-- Ningún llamante legítimo del sistema es `anon` sobre estas RPCs — el
-- frontend siempre llama autenticado (createSPAClient()/createSSRClient()
-- adjuntan la sesión del usuario). Patrón: REVOKE ALL ... FROM PUBLIC;
-- GRANT EXECUTE ... TO <rol correcto, si aplica>; REVOKE ALL ... FROM anon;
-- — el mismo que spec-80 fase 1b (20260913000004) y spec-85 fase 2
-- (20260913000003) usaron, citado aquí como plantilla del ACL, no del cuerpo
-- (ningún cuerpo cambia en esta migración — CREATE OR REPLACE no hace falta).
--
-- CADA GRANT se decidió por el consumidor real encontrado en el repo, no por
-- suposición (ver docs/specs/spec-88-anon-security-definer-audit.md y el
-- reporte de esta fase para el detalle función por función):
--
--   Grupo A — 9 sin guard alguno (custom_access_token_hook queda fuera,
--   fase 3, bloqueada — no se toca aquí):
--     archive_old_audit_logs()               -> sin consumidor (frontend/
--       agents/mobile/worker); su cron está comentado
--       (20260217000001:335) — nadie llama esto por PostgREST hoy. Sólo
--       REVOKE, sin GRANT: queda ejecutable únicamente por su dueño
--       (postgres) o quien tenga acceso directo a psql.
--     calculate_daily_metrics(date)          -> ya tenía GRANT TO
--       service_role (20260305000002, n8n dispara el refresco tras cada
--       import XLSX vía PostgREST). Se preserva ese grant, se revoca PUBLIC
--       y anon.
--     calculate_dashboard_monthly_rollup(int,int) -> invocada sólo por
--       pg_cron (20260409000007:47..58), que ejecuta como el rol que
--       corrió cron.schedule (postgres) — no pasa por PostgREST, no
--       necesita ningún GRANT nuevo. Sólo REVOKE.
--     create_audit_logs_partition(date)      -> mismo caso que
--       archive_old_audit_logs: sin cron activo, sin consumidor. Sólo
--       REVOKE.
--     get_active_routes_with_dispatches(uuid,date) -> consumidor real:
--       apps/frontend/src/hooks/useActiveRoutes.ts, vía createSPAClient()
--       (cliente autenticado). GRANT TO authenticated.
--     get_unmatched_comunas(uuid)            -> consumidor real:
--       apps/frontend/src/hooks/distribution/useUnmatchedComunas.ts, vía
--       createSPAClient(). GRANT TO authenticated.
--     map_comuna_alias(text,uuid,text)       -> mismo hook que la anterior.
--       GRANT TO authenticated.
--     set_config(text,text,boolean)          -> consumidor real:
--       apps/frontend/src/lib/utils/ipAddress.ts (setSupabaseSessionIp),
--       llamado desde las rutas API de audit-logs vía createSSRClient()
--       (cliente autenticado, sesión SSR). GRANT TO authenticated.
--     validate_audit_logging()               -> sólo diagnóstico interno,
--       sin consumidor. Sólo REVOKE.
--
--   Grupo B — ACL que miente: `REVOKE ... FROM anon` ya aplicado en su
--   migración original, pero nunca `FROM PUBLIC` — el `=X` implícito de
--   Postgres deja a `anon` heredando EXECUTE igual. El `GRANT ... TO
--   authenticated` de sus migraciones originales sigue vigente y no se
--   repite aquí (repetirlo sería inocuo pero no hace falta):
--     add_dock_zone_adjacency_pair(uuid,uuid)
--     open_route_reception(uuid)
--     remove_dock_zone_adjacency_pair(uuid,uuid)
--     reopen_pickup_route(uuid)
--
--   Grupo C — overload huérfano: start_pickup_route(text). El REVOKE de
--   20260820000003 sólo alcanzó a start_pickup_route(uuid,uuid[]) — Postgres
--   resuelve REVOKE por firma exacta. Sin consumidor en apps/frontend,
--   apps/agents, apps/mobile, apps/worker (grep confirmado — el único
--   caller real usa la firma de 2 argumentos). Cerrado del todo: sin
--   re-GRANT a authenticated.
--
--   assert_operator_access(uuid) -> ningún llamante legítimo la invoca
--   directamente desde PostgREST; las funciones que la usan como guard
--   interno (get_active_routes_with_dispatches, get_unmatched_comunas, y
--   cualquier otra SECURITY DEFINER que la reutilice) la ejecutan con los
--   privilegios de SU PROPIO dueño, no del rol PostgREST del llamante
--   original — SECURITY DEFINER, no SECURITY INVOKER. Confirmado con una
--   prueba (tests/spec88_assert_operator_access_internal_guard.test.sql),
--   no asumido de la prosa de este comentario. Sólo REVOKE, sin GRANT.
--
-- Verificación post-migración de las 4 fugas reproducidas en el spec (las
-- tres de datos + set_config) contra QA: ver reporte de esta fase.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Grupo A — sin guard efectivo
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.archive_old_audit_logs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_old_audit_logs() FROM anon;

REVOKE ALL ON FUNCTION public.calculate_daily_metrics(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_daily_metrics(DATE) TO service_role;
REVOKE ALL ON FUNCTION public.calculate_daily_metrics(DATE) FROM anon;

REVOKE ALL ON FUNCTION public.calculate_dashboard_monthly_rollup(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_dashboard_monthly_rollup(INT, INT) FROM anon;

REVOKE ALL ON FUNCTION public.create_audit_logs_partition(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_audit_logs_partition(DATE) FROM anon;

REVOKE ALL ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) TO authenticated;
REVOKE ALL ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) FROM anon;

REVOKE ALL ON FUNCTION public.get_unmatched_comunas(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unmatched_comunas(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_unmatched_comunas(UUID) FROM anon;

REVOKE ALL ON FUNCTION public.map_comuna_alias(TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.map_comuna_alias(TEXT, UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.map_comuna_alias(TEXT, UUID, TEXT) FROM anon;

REVOKE ALL ON FUNCTION public.set_config(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_config(TEXT, TEXT, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.set_config(TEXT, TEXT, BOOLEAN) FROM anon;

REVOKE ALL ON FUNCTION public.validate_audit_logging() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_audit_logging() FROM anon;

-- -----------------------------------------------------------------------------
-- Grupo B — ACL que miente (anon ya revocado históricamente; PUBLIC no)
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.add_dock_zone_adjacency_pair(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_route_reception(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_dock_zone_adjacency_pair(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_pickup_route(UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Grupo C — overload huérfano
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.start_pickup_route(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_pickup_route(TEXT) FROM anon;

-- -----------------------------------------------------------------------------
-- assert_operator_access — causa raíz de las fugas #1/#2 del spec (guard
-- interno de get_active_routes_with_dispatches / get_unmatched_comunas).
-- Ningún llamante legítimo la invoca directamente desde PostgREST.
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.assert_operator_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_operator_access(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assert_operator_access(UUID) FROM authenticated;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
  ) THEN
    RAISE EXCEPTION 'assert_operator_access not found — migration template mismatch';
  END IF;

  RAISE NOTICE '✓ spec-88 fase 1 REVOKE mecánico complete — 15 functions closed';
END $$;

COMMIT;
