-- =============================================================================
-- spec-88 fase 5 — Defensa en profundidad del resto: REVOKE sobre 16
-- funciones SECURITY DEFINER con guard efectivo pero cuyo ACL nunca fue
-- revocado de PUBLIC/anon, más dos correcciones de "mina" y dos guards que
-- no hacían lo que decían, encontrados en la re-auditoría de esta fase.
-- Auditoría completa: docs/specs/spec-88-anon-security-definer-audit.md.
-- =============================================================================
-- Recuento re-medido (no heredado sin verificar) contra un contenedor pgTAP
-- propio (PGTAP_LOCAL_CONTAINER=spec88f5-pg, NO spec52-pg — compartido),
-- levantado desde origin/main con las fases 1-3 de este spec ya aplicadas:
--
--   SELECT count(*) FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.prosecdef
--     AND p.prorettype <> 'trigger'::regtype
--     AND has_function_privilege('anon', p.oid, 'EXECUTE')
--     AND has_schema_privilege('anon', n.nspname, 'USAGE')
--     AND NOT EXISTS (
--       SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
--       WHERE d.objid = p.oid AND d.deptype = 'e'
--     );
--   -- => 16
-- Confirma la medición baja de las dos que el spec dejó sin reconciliar
-- (16, no 17). La discrepancia se explica: `complete_route_reception` tiene
-- hoy una tercera firma en vivo, `(uuid,text,jsonb)`, con ACL ya cerrado
-- (postgres/authenticated/service_role — sin PUBLIC ni anon); no pertenece a
-- este conjunto. El recuento de 17 usaba la firma vieja `(uuid,text)` de la
-- tabla estática del spec, no el ACL real — el mismo tipo de cifra
-- propagada sin verificar que este spec ya corrigió dos veces (34→39, 13→10).
-- ⚠️ MINA 1 — get_operator_id() y get_current_user_role() son el guard de
-- 61 políticas RLS sobre 38 tablas (USING/WITH CHECK las invocan). Revocar
-- `authenticated` sobre cualquiera de las dos tumba TODO SELECT de la
-- aplicación con "permission denied for function get_operator_id" — no cero
-- filas, un fallo total, medido. Estas dos se revocan SOLO de PUBLIC y anon.
-- anon no corre riesgo simétrico: no tiene SELECT de tabla, así que ninguna
-- política llega nunca a invocar la función para ese rol.
-- ⚠️ MINA 2 — get_operator_id() era la única de las 16 sin SET search_path,
-- pese a ser el guard de 10 de ellas y de las 61 políticas de arriba. No es
-- explotable hoy (anon/authenticated no tienen CREATE sobre public, medido;
-- el cuerpo cualifica public.users/auth.uid()), pero queda a una migración
-- futura de distancia de un bypass de autenticación completo si algún
-- esquema llegara a preceder a public en el search_path resuelto. Plantilla:
-- 20260216170542_create_users_table_with_rbac.sql (última CREATE OR REPLACE
-- de esta función — no 20260209000001_auth_function.sql, la original). El
-- cuerpo no cambia, sólo se añade el SET search_path.
-- Dos guards que no hacían lo que decían (auditoría de esta fase):
--   - get_enabled_modules_for_operator(NULL) esquivaba su propio RAISE:
--     `NULL IS DISTINCT FROM NULL` es FALSE, así que devolvía '{}' en vez de
--     "access denied". Ningún consumidor real pasa NULL — los dos hooks del
--     frontend (apps/frontend/src/lib/modules/enabled.ts,
--     apps/frontend/src/hooks/modules/useEnabledModules.ts) cortan antes de
--     llamar al RPC si no hay operator_id en la sesión — así que esto no
--     filtraba nada hoy, pero es el patrón que alguien copiaría mal. Se
--     añade `p_operator_id IS NULL` a la condición. Plantilla:
--     20260616000004_spec45_module_activation_rpcs.sql (única definición).
--   - get_manifest_label_data devolvía 0 rows para un manifest de otro
--     operador en vez de 42501 — un 0 rows no distingue "bloqueado" de "no
--     hay datos", la misma trampa que este spec ya documentó con
--     map_comuna_alias (fase 1). Se añade una comprobación explícita que
--     lanza 42501 cuando el manifest EXISTE pero pertenece a otro operador;
--     si no existe en absoluto, sigue devolviendo 0 rows — eso sí es
--     "no hay datos", no un bloqueo. Plantilla:
--     20260813000002_fix_spec53_label_rpc_types.sql (última CREATE OR
--     REPLACE — corrigió los casts VARCHAR→TEXT, no toca la lógica de
--     acceso que esta migración añade ahora).
--
-- Los 16 tienen consumidores exclusivamente bajo apps/frontend/src/app/app/**
-- (área autenticada tras el middleware) — verificado por grep, no asumido —
-- así que el REVOKE de PUBLIC/anon no rompe ningún camino vivo. Ninguna de
-- las 16 depende de la RLS que SECURITY DEFINER desactiva: las que tocan
-- datos filtran por operator_id explícitamente y fallan con RAISE antes de
-- leer nada — el REVOKE es higiene (ACL coherente con la intención), no el
-- cierre de un incidente activo.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- get_operator_id() — MINA 1 (sólo PUBLIC/anon) + MINA 2 (SET search_path).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_operator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT operator_id
  FROM public.users
  WHERE id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_operator_id IS 'Extract operator_id from users table for RLS policies (updated for Story 1.3). spec-88 fase 5: added SET search_path (mina 2) — body unchanged.';

REVOKE ALL ON FUNCTION public.get_operator_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_operator_id() FROM anon;
-- authenticated NOT touched — 61 políticas RLS la invocan en USING/WITH CHECK.

-- -----------------------------------------------------------------------------
-- get_current_user_role() — MINA 1 (sólo PUBLIC/anon). Ya traía
-- SET search_path=public; sin cambio de cuerpo, sólo ACL.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_user_role() FROM anon;
-- authenticated NOT touched — mismo motivo que arriba.

-- -----------------------------------------------------------------------------
-- Guard fix — get_enabled_modules_for_operator(NULL) esquivaba su propio
-- RAISE. Plantilla: 20260616000004_spec45_module_activation_rpcs.sql.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_enabled_modules_for_operator(
  p_operator_id UUID
) RETURNS TEXT[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_operator UUID;
BEGIN
  caller_operator := public.spec45_caller_operator_id();
  IF NOT public.is_super_admin()
     AND (p_operator_id IS NULL OR caller_operator IS DISTINCT FROM p_operator_id) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (SELECT array_agg(module_key)
       FROM public.operator_enabled_modules
      WHERE operator_id = p_operator_id AND disabled_at IS NULL),
    ARRAY[]::TEXT[]
  );
END $$;

REVOKE ALL ON FUNCTION public.get_enabled_modules_for_operator(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_enabled_modules_for_operator(UUID) FROM anon;

-- -----------------------------------------------------------------------------
-- Guard fix — get_manifest_label_data devolvía 0 rows cross-tenant en vez de
-- 42501. Plantilla: 20260813000002_fix_spec53_label_rpc_types.sql (última).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_manifest_label_data(
  p_manifest_id UUID,
  p_package_id  UUID DEFAULT NULL
) RETURNS TABLE (
  package_id          UUID,
  package_label       TEXT,
  package_number      TEXT,
  declared_box_count  INT,
  sku_items           JSONB,
  order_number        TEXT,
  customer_name       TEXT,
  delivery_address    TEXT,
  comuna              TEXT,
  customer_phone      TEXT,
  external_load_id    TEXT,
  retailer_name       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- spec-88 fase 5: a manifest that EXISTS but belongs to another operator
  -- must raise, not silently return 0 rows — 0 rows doesn't distinguish
  -- "blocked" from "no data" (same trap already documented for
  -- map_comuna_alias). A manifest that does not exist at all still falls
  -- through to 0 rows below — that genuinely is "no data".
  IF EXISTS (
    SELECT 1 FROM public.manifests m
     WHERE m.id = p_manifest_id AND m.deleted_at IS NULL AND m.operator_id <> v_operator
  ) THEN
    RAISE EXCEPTION 'operator_id mismatch: caller may not access another tenant''s data'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.label::TEXT,
    p.package_number::TEXT,
    p.declared_box_count,
    p.sku_items,
    o.order_number::TEXT,
    o.customer_name::TEXT,
    o.delivery_address,
    o.comuna::TEXT,
    o.customer_phone::TEXT,
    m.external_load_id::TEXT,
    m.retailer_name::TEXT
  FROM public.manifests m
  JOIN public.orders o
    ON o.external_load_id = m.external_load_id
   AND o.operator_id = m.operator_id
   AND o.deleted_at IS NULL
  JOIN public.packages p
    ON p.order_id = o.id
   AND p.deleted_at IS NULL
  WHERE m.id = p_manifest_id
    AND m.operator_id = v_operator
    AND m.deleted_at IS NULL
    AND (p_package_id IS NULL OR p.id = p_package_id)
  ORDER BY o.order_number, p.package_number, p.label;
END $$;

COMMENT ON FUNCTION public.get_manifest_label_data(UUID, UUID) IS
'spec-53. One row per packages row on this manifest (orders joined by
external_load_id — orders and manifests are not FK-linked). Ordered so the
printed stack mirrors the order the crew walks the manifest. p_package_id
narrows to a single package for the torn-label reprint path. Varchar columns
are cast to TEXT because RETURN QUERY demands an exact type match.
spec-88 fase 5: a manifest belonging to another operator now raises 42501
instead of silently returning 0 rows; a nonexistent manifest still returns
0 rows (genuinely "no data", not "blocked").';

REVOKE ALL ON FUNCTION public.get_manifest_label_data(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_manifest_label_data(UUID, UUID) FROM anon;

-- -----------------------------------------------------------------------------
-- Resto de las 16 — sólo ACL, ningún cuerpo cambia.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enable_module_for_operator(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enable_module_for_operator(UUID, TEXT, TEXT) FROM anon;

REVOKE ALL ON FUNCTION public.disable_module_for_operator(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_module_for_operator(UUID, TEXT, TEXT) FROM anon;

REVOKE ALL ON FUNCTION public.list_operators_with_module_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_operators_with_module_state() FROM anon;

REVOKE ALL ON FUNCTION public.get_module_audit_for_operator(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_module_audit_for_operator(UUID) FROM anon;

REVOKE ALL ON FUNCTION public.add_manifest_to_route(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_manifest_to_route(UUID, UUID) FROM anon;

REVOKE ALL ON FUNCTION public.close_pickup_route(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_pickup_route(UUID) FROM anon;

REVOKE ALL ON FUNCTION public.cancel_pickup_route(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_pickup_route(UUID, TEXT) FROM anon;

REVOKE ALL ON FUNCTION public.get_route_reception_snapshot(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_route_reception_snapshot(UUID) FROM anon;

REVOKE ALL ON FUNCTION public.mark_manifest_labels_printed(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_manifest_labels_printed(UUID) FROM anon;

REVOKE ALL ON FUNCTION public.expand_carton(UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expand_carton(UUID, INT, TEXT) FROM anon;

REVOKE ALL ON FUNCTION public.delete_minted_carton(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_minted_carton(UUID, TEXT) FROM anon;

REVOKE ALL ON FUNCTION public.remove_manifest_from_route(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_manifest_from_route(UUID, UUID) FROM anon;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_operator_id'
  ) THEN
    RAISE EXCEPTION 'get_operator_id not found — migration template mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_operator_id'
      AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'get_operator_id still grants PUBLIC EXECUTE — REVOKE failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
    JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
    WHERE n.nspname = 'public' AND p.proname = 'get_operator_id'
  ) THEN
    RAISE EXCEPTION 'get_operator_id lost its authenticated EXECUTE grant — this would break 61 RLS policies';
  END IF;

  RAISE NOTICE '✓ spec-88 fase 5 defensa en profundidad complete — 16 functions closed, 2 guard fixes applied';
END $$;

COMMIT;
