-- pgTAP: spec-88 fase 1 — REVOKE mecánico sobre las 15 funciones SECURITY
-- DEFINER sin guard efectivo, ACL-que-miente, o overload huérfano.
--
-- Two traps this test guards against, both found during spec-80 fase 1b /
-- spec-85 fase 2 review:
--
--   1. has_function_privilege() always returns true when called by the
--      postgres superuser regardless of the real ACL — it would pass even
--      with the REVOKE deleted. Use aclexplode(proacl) instead.
--   2. A test that only checks aclexplode() silently PASSES if the target
--      function does not exist at all (the aggregate/EXISTS over zero rows
--      is empty/false, not a failure). Every function below gets its own
--      has_function() check first, so a typo'd name or a dropped function
--      fails loudly instead of vacuously.
--
-- 16 functions, three groups:
--   A. 9 confirmed with no guard at all (excl. custom_access_token_hook,
--      fase 3, blocked): archive_old_audit_logs, calculate_daily_metrics,
--      calculate_dashboard_monthly_rollup, create_audit_logs_partition,
--      get_active_routes_with_dispatches, get_unmatched_comunas,
--      map_comuna_alias, set_config, validate_audit_logging. Five of these
--      (archive_old_audit_logs, calculate_dashboard_monthly_rollup,
--      create_audit_logs_partition, validate_audit_logging, and Group C's
--      start_pickup_route(text) below) never had an explicit re-GRANT to
--      authenticated in this migration, but the schema-default grant every
--      new function gets survives a `REVOKE FROM PUBLIC`/`FROM anon` pair —
--      so they get their own `REVOKE FROM authenticated` too, closing them
--      to everyone but postgres/service_role, not just anon.
--   B. 4 with a lying ACL — REVOKE ... FROM anon exists in their original
--      migration, but never REVOKE ... FROM PUBLIC, so anon still inherits
--      via the implicit `=X` grant: add_dock_zone_adjacency_pair,
--      open_route_reception, remove_dock_zone_adjacency_pair,
--      reopen_pickup_route. This migration revokes PUBLIC on all four AND
--      re-revokes anon explicitly (redundant with the original migration,
--      but makes the test not depend on undocumented QA-only history).
--   C. Two overloads of start_pickup_route, both closed here:
--      start_pickup_route(text) — never revoked at all, no re-GRANT to
--      authenticated (truly closed, no legitimate caller found); and
--      start_pickup_route(uuid,uuid[]) — the *live* signature. Its original
--      migration (20260820000003) revoked FROM anon but never FROM PUBLIC,
--      so anon inherited via `=X` exactly like Group B. Closed the same way,
--      keeping the GRANT TO authenticated its real caller needs.
--
-- assert_operator_access(uuid) is verified separately, in
-- spec88_assert_operator_access_internal_guard.test.sql — it needs a second
-- SECURITY DEFINER function that calls it, exercised as authenticated AND as
-- anon, to prove the REVOKE here does not break its internal callers.

BEGIN;
SELECT plan(64);

-- =============================================================================
-- Group A — no guard at all
-- =============================================================================

SELECT has_function('public', 'archive_old_audit_logs', ARRAY[]::text[],
  'archive_old_audit_logs() exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'archive_old_audit_logs'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'archive_old_audit_logs: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'archive_old_audit_logs'
       AND p.proacl IS NOT NULL)),
  false, 'archive_old_audit_logs: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'archive_old_audit_logs'
       AND p.proacl IS NOT NULL)),
  false, 'archive_old_audit_logs: authenticated has no EXECUTE grant either');

SELECT has_function('public', 'calculate_daily_metrics', ARRAY['date'],
  'calculate_daily_metrics(date) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'calculate_daily_metrics'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'calculate_daily_metrics: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'calculate_daily_metrics'
       AND p.proacl IS NOT NULL)),
  false, 'calculate_daily_metrics: anon has no EXECUTE grant');
-- n8n triggers this via service_role/PostgREST after every XLSX import
-- (20260305000002). Losing this grant in a rebase would silently stop
-- dashboard metrics from refreshing.
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'service_role'
     WHERE n.nspname = 'public' AND p.proname = 'calculate_daily_metrics')),
  true, 'calculate_daily_metrics: service_role keeps EXECUTE');

SELECT has_function('public', 'calculate_dashboard_monthly_rollup', ARRAY['int4', 'int4'],
  'calculate_dashboard_monthly_rollup(int,int) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'calculate_dashboard_monthly_rollup'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'calculate_dashboard_monthly_rollup: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'calculate_dashboard_monthly_rollup'
       AND p.proacl IS NOT NULL)),
  false, 'calculate_dashboard_monthly_rollup: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'calculate_dashboard_monthly_rollup'
       AND p.proacl IS NOT NULL)),
  false, 'calculate_dashboard_monthly_rollup: authenticated has no EXECUTE grant either');

SELECT has_function('public', 'create_audit_logs_partition', ARRAY['date'],
  'create_audit_logs_partition(date) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_audit_logs_partition'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'create_audit_logs_partition: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'create_audit_logs_partition'
       AND p.proacl IS NOT NULL)),
  false, 'create_audit_logs_partition: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'create_audit_logs_partition'
       AND p.proacl IS NOT NULL)),
  false, 'create_audit_logs_partition: authenticated has no EXECUTE grant either');

SELECT has_function('public', 'get_active_routes_with_dispatches', ARRAY['uuid', 'date'],
  'get_active_routes_with_dispatches(uuid,date) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_active_routes_with_dispatches'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'get_active_routes_with_dispatches: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'get_active_routes_with_dispatches'
       AND p.proacl IS NOT NULL)),
  false, 'get_active_routes_with_dispatches: anon has no EXECUTE grant');
-- This one must remain callable by authenticated — it is the frontend's
-- real consumer (apps/frontend/src/hooks/useActiveRoutes.ts).
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'get_active_routes_with_dispatches')),
  true, 'get_active_routes_with_dispatches: authenticated keeps EXECUTE');

SELECT has_function('public', 'get_unmatched_comunas', ARRAY['uuid'],
  'get_unmatched_comunas(uuid) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_unmatched_comunas'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'get_unmatched_comunas: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'get_unmatched_comunas'
       AND p.proacl IS NOT NULL)),
  false, 'get_unmatched_comunas: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'get_unmatched_comunas')),
  true, 'get_unmatched_comunas: authenticated keeps EXECUTE');

SELECT has_function('public', 'map_comuna_alias', ARRAY['text', 'uuid', 'text'],
  'map_comuna_alias(text,uuid,text) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'map_comuna_alias'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'map_comuna_alias: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'map_comuna_alias'
       AND p.proacl IS NOT NULL)),
  false, 'map_comuna_alias: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'map_comuna_alias')),
  true, 'map_comuna_alias: authenticated keeps EXECUTE');

SELECT has_function('public', 'set_config', ARRAY['text', 'text', 'bool'],
  'set_config(text,text,boolean) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'set_config'
       AND p.pronargs = 3
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'set_config: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'set_config' AND p.pronargs = 3
       AND p.proacl IS NOT NULL)),
  false, 'set_config: anon has no EXECUTE grant');
-- setSupabaseSessionIp (apps/frontend/src/lib/utils/ipAddress.ts) calls this
-- via an SSR client (authenticated session) from the audit-logs API routes.
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'set_config' AND p.pronargs = 3)),
  true, 'set_config: authenticated keeps EXECUTE');

SELECT has_function('public', 'validate_audit_logging', ARRAY[]::text[],
  'validate_audit_logging() exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'validate_audit_logging'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'validate_audit_logging: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'validate_audit_logging'
       AND p.proacl IS NOT NULL)),
  false, 'validate_audit_logging: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'validate_audit_logging'
       AND p.proacl IS NOT NULL)),
  false, 'validate_audit_logging: authenticated has no EXECUTE grant either');

-- =============================================================================
-- Group B — lying ACL (anon already revoked historically, PUBLIC never was)
-- =============================================================================

SELECT has_function('public', 'add_dock_zone_adjacency_pair', ARRAY['uuid', 'uuid'],
  'add_dock_zone_adjacency_pair(uuid,uuid) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'add_dock_zone_adjacency_pair'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'add_dock_zone_adjacency_pair: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'add_dock_zone_adjacency_pair'
       AND p.proacl IS NOT NULL)),
  false, 'add_dock_zone_adjacency_pair: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'add_dock_zone_adjacency_pair')),
  true, 'add_dock_zone_adjacency_pair: authenticated keeps EXECUTE');

SELECT has_function('public', 'open_route_reception', ARRAY['uuid'],
  'open_route_reception(uuid) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'open_route_reception'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'open_route_reception: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'open_route_reception'
       AND p.proacl IS NOT NULL)),
  false, 'open_route_reception: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'open_route_reception')),
  true, 'open_route_reception: authenticated keeps EXECUTE');

SELECT has_function('public', 'remove_dock_zone_adjacency_pair', ARRAY['uuid', 'uuid'],
  'remove_dock_zone_adjacency_pair(uuid,uuid) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'remove_dock_zone_adjacency_pair'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'remove_dock_zone_adjacency_pair: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'remove_dock_zone_adjacency_pair'
       AND p.proacl IS NOT NULL)),
  false, 'remove_dock_zone_adjacency_pair: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'remove_dock_zone_adjacency_pair')),
  true, 'remove_dock_zone_adjacency_pair: authenticated keeps EXECUTE');

SELECT has_function('public', 'reopen_pickup_route', ARRAY['uuid'],
  'reopen_pickup_route(uuid) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'reopen_pickup_route'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'reopen_pickup_route: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'reopen_pickup_route'
       AND p.proacl IS NOT NULL)),
  false, 'reopen_pickup_route: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'reopen_pickup_route')),
  true, 'reopen_pickup_route: authenticated keeps EXECUTE');

-- =============================================================================
-- Group C — orphan overload: start_pickup_route(text). The (uuid,uuid[])
-- overload was only partially revoked (FROM anon, not FROM PUBLIC) in
-- 20260820000003 — see the second Group C block below, this migration
-- closes that gap too. No legitimate caller found for the 1-arg overload
-- anywhere in apps/frontend, apps/agents, apps/mobile, apps/worker — closed
-- fully, no re-GRANT to authenticated.
-- =============================================================================

SELECT has_function('public', 'start_pickup_route', ARRAY['text'],
  'start_pickup_route(text) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
       AND p.pronargs = 1
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'start_pickup_route(text): no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route' AND p.pronargs = 1
       AND p.proacl IS NOT NULL)),
  false, 'start_pickup_route(text): anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route' AND p.pronargs = 1
       AND p.proacl IS NOT NULL)),
  false, 'start_pickup_route(text): authenticated has no EXECUTE grant either');

-- =============================================================================
-- Group C (continued) — start_pickup_route(uuid,uuid[]), the live signature.
-- 20260820000003 only revoked FROM anon on this signature, never FROM
-- PUBLIC — the implicit `=X` grant Postgres puts on every new function
-- survived untouched. anon does not get denied at the Postgres ACL layer;
-- the internal `get_operator_id() IS NULL -> RAISE` guard is what stops it.
-- =============================================================================

SELECT has_function('public', 'start_pickup_route', ARRAY['uuid', 'uuid[]'],
  'start_pickup_route(uuid,uuid[]) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route'
       AND p.pronargs = 2
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'start_pickup_route(uuid,uuid[]): no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route' AND p.pronargs = 2
       AND p.proacl IS NOT NULL)),
  false, 'start_pickup_route(uuid,uuid[]): anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'start_pickup_route' AND p.pronargs = 2)),
  true, 'start_pickup_route(uuid,uuid[]): authenticated keeps EXECUTE');

-- =============================================================================
-- assert_operator_access(uuid) — the guard get_active_routes_with_dispatches
-- and get_unmatched_comunas call internally. No legitimate PostgREST caller
-- invokes it directly (see spec88_assert_operator_access_internal_guard.
-- test.sql for the proof its internal callers keep working after this
-- REVOKE). Closed to PUBLIC, anon, AND authenticated — nobody outside a
-- SECURITY DEFINER function that already trusts its own callers needs it.
-- =============================================================================

SELECT has_function('public', 'assert_operator_access', ARRAY['uuid'],
  'assert_operator_access(uuid) exists');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
       AND (p.proacl IS NULL OR EXISTS (
             SELECT 1 FROM aclexplode(p.proacl) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))),
  false, 'assert_operator_access: no PUBLIC EXECUTE grant survives');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
     WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
       AND p.proacl IS NOT NULL)),
  false, 'assert_operator_access: anon has no EXECUTE grant');
SELECT is(
  (SELECT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
     JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
     WHERE n.nspname = 'public' AND p.proname = 'assert_operator_access'
       AND p.proacl IS NOT NULL)),
  false, 'assert_operator_access: authenticated has no EXECUTE grant either');

SELECT * FROM finish();
ROLLBACK;
