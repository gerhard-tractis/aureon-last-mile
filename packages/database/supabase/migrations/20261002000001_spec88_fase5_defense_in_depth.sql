-- =============================================================================
-- spec-88 fase 5 — Defensa en profundidad del resto: REVOKE sobre 16
-- funciones SECURITY DEFINER con guard efectivo pero cuyo ACL nunca fue
-- revocado de PUBLIC/anon, más dos correcciones de "mina" y dos guards que
-- no hacían lo que decían. Razonamiento completo, recuento re-medido (16,
-- no 17 — comando y resultado), y la corrección de ronda 2 de review sobre
-- el riesgo real de anon (20 tablas con SELECT propio, no cero): ver
-- docs/specs/spec-88-anon-security-definer-audit.md, fase 5.
-- =============================================================================
-- ⚠️ MINA 1 — get_operator_id()/get_current_user_role() son el guard de 61
-- políticas RLS sobre 38 tablas. Revocar `authenticated` sobre cualquiera
-- tumba TODO SELECT de la aplicación con "permission denied", no cero filas
-- — medido. Estas dos se revocan SOLO de PUBLIC y anon; el `DO` block de
-- verificación al final comprueba esto para las 16, no sólo estas dos
-- (ronda 2 de review: la primera versión sólo comprobaba get_operator_id).
--
-- ⚠️ MINA 2 — get_operator_id() era la única sin SET search_path, pese a
-- ser el guard de 10 de las 16 y de las 61 políticas de arriba. Plantilla:
-- 20260216170542_create_users_table_with_rbac.sql (última CREATE OR
-- REPLACE — no 20260209000001_auth_function.sql, la original). Cuerpo sin
-- cambios, sólo se añade el SET search_path.
--
-- Dos guards corregidos (cuerpo cambia, plantilla = última CREATE OR
-- REPLACE real en cada caso):
--   - get_enabled_modules_for_operator(NULL) esquivaba su propio RAISE
--     (`NULL IS DISTINCT FROM NULL` es FALSE) — se añade
--     `p_operator_id IS NULL` a la condición. Ningún consumidor real pasa
--     NULL (los dos hooks del frontend cortan antes de llamar al RPC si no
--     hay operator_id en la sesión).
--   - get_manifest_label_data devolvía 0 rows para un manifest de otro
--     operador en vez de 42501 (misma trampa que map_comuna_alias, fase 1)
--     — RAISE explícito cuando el manifest EXISTE y es de otro operador; si
--     no existe en absoluto, sigue devolviendo 0 rows. Contrapartida: esto
--     es un oráculo de existencia deliberado (un authenticated de A ahora
--     distingue "existe y es de B" de "no existe"), aceptado porque
--     p_manifest_id es un UUIDv4 no enumerable.
--
-- Los 16 tienen consumidores exclusivamente bajo apps/frontend/src/app/app/**
-- (autenticado, verificado por grep) — el REVOKE de PUBLIC/anon no rompe
-- ningún camino vivo. Ninguna depende de la RLS que SECURITY DEFINER
-- desactiva — el REVOKE es higiene, no el cierre de un incidente activo.
-- =============================================================================

BEGIN;

-- get_operator_id() — MINA 1 (sólo PUBLIC/anon) + MINA 2 (SET search_path).
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

-- get_current_user_role() — MINA 1 (sólo PUBLIC/anon). Ya traía
-- SET search_path=public; sin cambio de cuerpo, sólo ACL.
REVOKE ALL ON FUNCTION public.get_current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_user_role() FROM anon;
-- authenticated NOT touched — mismo motivo que arriba.

-- Guard fix — get_enabled_modules_for_operator(NULL) esquivaba su propio
-- RAISE. Plantilla: 20260616000004_spec45_module_activation_rpcs.sql.
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

-- Guard fix — get_manifest_label_data devolvía 0 rows cross-tenant en vez de
-- 42501. Plantilla: 20260813000002_fix_spec53_label_rpc_types.sql (última).
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

-- Resto de las 16 — sólo ACL, ningún cuerpo cambia.
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

-- Verification — loops over all 16 by exact regprocedure (not proname: an
-- overload with its own grant would satisfy a proname-only check even if the
-- live signature lost it — start_pickup_route in fase 1 tripped on exactly
-- this). Checked for EVERY one of the 16, not just get_operator_id: ronda 2
-- of review found the original block only checked get_operator_id, so a
-- missing `authenticated` grant on any of the other 15 in a real
-- environment (get_current_user_role included — same MINA 1 risk) would
-- COMMIT a total outage for that RPC/RLS guard while reporting "complete".
DO $$
DECLARE
  fn regprocedure;
  fns regprocedure[] := ARRAY[
    'public.get_operator_id()',
    'public.get_current_user_role()',
    'public.get_enabled_modules_for_operator(uuid)',
    'public.enable_module_for_operator(uuid,text,text)',
    'public.disable_module_for_operator(uuid,text,text)',
    'public.list_operators_with_module_state()',
    'public.get_module_audit_for_operator(uuid)',
    'public.add_manifest_to_route(uuid,uuid)',
    'public.close_pickup_route(uuid)',
    'public.cancel_pickup_route(uuid,text)',
    'public.get_route_reception_snapshot(uuid)',
    'public.mark_manifest_labels_printed(uuid)',
    'public.get_manifest_label_data(uuid,uuid)',
    'public.expand_carton(uuid,int,text)',
    'public.delete_minted_carton(uuid,text)',
    'public.remove_manifest_from_route(uuid,uuid)'
  ]::regprocedure[];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = fn
        AND EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION '% still grants PUBLIC EXECUTE — REVOKE failed', fn;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
      JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'anon'
      WHERE p.oid = fn
    ) THEN
      RAISE EXCEPTION '% still grants anon EXECUTE — REVOKE failed', fn;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN aclexplode(p.proacl) a ON a.privilege_type = 'EXECUTE'
      JOIN pg_roles r ON r.oid = a.grantee AND r.rolname = 'authenticated'
      WHERE p.oid = fn
    ) THEN
      RAISE EXCEPTION '% lost its authenticated EXECUTE grant — this breaks its real caller outright (get_operator_id/get_current_user_role: 61 RLS policies)', fn;
    END IF;
  END LOOP;

  -- MINA 2, checked by oid too — a future overload of get_operator_id
  -- wouldn't share this proconfig, and this check must not silently pass it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.get_operator_id()'::regprocedure
      AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'get_operator_id is missing SET search_path = public, pg_temp — MINA 2 not closed';
  END IF;

  RAISE NOTICE '✓ spec-88 fase 5 defensa en profundidad complete — 16 functions verified by exact regprocedure (PUBLIC/anon revoked, authenticated intact), MINA 2 confirmed';
END $$;

COMMIT;
