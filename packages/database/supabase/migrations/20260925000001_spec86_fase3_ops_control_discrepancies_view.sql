-- =============================================================================
-- spec-86 fase 3 — get_discrepancies_ops_control: la vista de Discrepancias
-- en Ops Control
-- =============================================================================
-- Fase 1 (20260920000001) hizo que complete_route_reception abriera una fila
-- por paquete faltante en public.discrepancies (operation_type='reception');
-- spec-80 fase 2 (20260916000001) hace lo mismo para close_manifest
-- (operation_type='pickup'). get_discrepancies (spec-85 fase 2,
-- 20260913000003) ya lee esa tabla, pero devuelve las columnas crudas de
-- discrepancies — sin orden, sin paquete, sin carga, sin ruta, sin quién
-- cerró. Ops Control necesita esas cinco cosas en una fila (ver spec-86,
-- fase 3, y docs/specs/spec-86-discrepancias-de-recepcion.md "Criterios de
-- aceptación" #3), así que esta función las adjunta con LEFT JOINs en vez de
-- forzar al frontend a hacer N llamadas por fila.
--
-- Plantilla de firma y ACL: get_discrepancies (20260913000003) — SQL STABLE,
-- SECURITY INVOKER (no DEFINER: discrepancies y todas las tablas que se unen
-- aquí ya tienen RLS + GRANT SELECT a authenticated, así que una consulta
-- plana ya queda correctamente acotada por tenant sola). El filtro explícito
-- por operator_id en CADA join de abajo es defensa en profundidad, no lo
-- único que separa esta consulta de otro tenant — mismo comentario que
-- get_discrepancies.
--
-- "Carga" y "ruta" no se derivan igual para las dos operaciones, porque
-- discrepancies no las guarda igual (spec-85, discrepancy_source_matches_operation):
--   - pickup:    manifest_id vive EN LA FILA. carga = manifests.external_load_id,
--                ruta = pickup_routes.code vía manifests.pickup_route_id.
--   - reception: route_reception_id vive en la fila, pero NINGÚN manifest --
--                una route_reception consolida varias cargas. La carga se
--                deriva del pickup_scan 'verified' del propio paquete, en el
--                MISMO pickup_route que esta reception (no cualquier scan
--                histórico del paquete): es exactamente el conjunto contra el
--                que complete_route_reception decide "falta" (fase 1,
--                20260920000001). La ruta sale directo de
--                route_receptions.pickup_route_id -- no necesita ese join.
--
-- El hueco conocido (spec-86 fase 1, "El hueco... route_receptions.
-- expected_count y get_route_reception_snapshot no filtran borrados, y fase 1
-- sí"): esta vista NO expone expected_count/received_count de route_receptions
-- a propósito. Son un número que puede no cuadrar con las filas reales de
-- discrepancies (el snapshot ya está declarado desincronizado en QA). Mostrar
-- ambos aquí invitaría a comparar "el cierre dijo N, discrepancias dice M" en
-- la MISMA pantalla -- esta vista sólo enseña lo que discrepancies sabe con
-- certeza, fila por paquete, no un recuento agregado que puede contradecirla.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_discrepancies_ops_control(
  p_status public.discrepancy_status_enum DEFAULT 'open'
) RETURNS TABLE (
  id             UUID,
  kind           public.discrepancy_kind_enum,
  operation_type public.discrepancy_operation_enum,
  status         public.discrepancy_status_enum,
  detected_at    TIMESTAMPTZ,
  note           TEXT,
  order_number   VARCHAR,
  package_label  VARCHAR,
  carga          TEXT,
  ruta           TEXT,
  closed_by_name VARCHAR
)
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    d.id,
    d.kind,
    d.operation_type,
    d.status,
    d.detected_at,
    d.note,
    o.order_number,
    p.label AS package_label,
    COALESCE(pm.external_load_id, rm.external_load_id) AS carga,
    COALESCE(prp.code, prr.code) AS ruta,
    u.full_name AS closed_by_name
  FROM public.discrepancies d
  LEFT JOIN public.packages p
    ON p.id = d.package_id AND p.operator_id = public.get_operator_id()
  LEFT JOIN public.orders o
    ON o.id = p.order_id AND o.operator_id = public.get_operator_id()
  -- pickup: manifest_id ya está en la fila.
  LEFT JOIN public.manifests pm
    ON pm.id = d.manifest_id AND pm.operator_id = public.get_operator_id()
  LEFT JOIN public.pickup_routes prp
    ON prp.id = pm.pickup_route_id AND prp.operator_id = public.get_operator_id()
  -- reception: la ruta sale directo de route_reception_id; la carga se
  -- deriva abajo vía LATERAL.
  LEFT JOIN public.route_receptions rr
    ON rr.id = d.route_reception_id AND rr.operator_id = public.get_operator_id()
  LEFT JOIN public.pickup_routes prr
    ON prr.id = rr.pickup_route_id AND prr.operator_id = public.get_operator_id()
  LEFT JOIN LATERAL (
    SELECT m.external_load_id
      FROM public.pickup_scans ps
      JOIN public.manifests m
        ON m.id = ps.manifest_id AND m.operator_id = public.get_operator_id()
     WHERE ps.operator_id = public.get_operator_id()
       AND ps.package_id = d.package_id
       AND ps.scan_result = 'verified'
       AND m.pickup_route_id = rr.pickup_route_id
     LIMIT 1
  ) rm ON d.operation_type = 'reception'
  LEFT JOIN public.users u
    ON u.id = d.detected_by_user_id AND u.operator_id = public.get_operator_id()
 WHERE d.operator_id = public.get_operator_id()
   AND d.deleted_at IS NULL
   AND (p_status IS NULL OR d.status = p_status)
 ORDER BY d.detected_at DESC;
$$;

COMMENT ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) IS
'spec-86 fase 3. Lectura enriquecida de public.discrepancies para el panel
Discrepancias de Ops Control: orden, paquete, carga, ruta y quién cerró la
operación que las detectó, además de las columnas propias de la tabla.
p_status filtra por estado (default ''open'' -- la cola de lo que Ops todavía
tiene que resolver; NULL devuelve todos los estados, incluido lost, para uso
futuro). No expone route_receptions.expected_count/received_count: ver
comentario de cabecera de este archivo sobre por qué esta vista no compara un
agregado que puede desincronizarse de las filas reales de discrepancies.
SECURITY INVOKER: discrepancies y cada tabla unida aquí ya tienen RLS +
GRANT SELECT a authenticated; el filtro por operator_id en cada join es
defensa en profundidad, mismo patrón que get_discrepancies
(20260913000003).';

REVOKE ALL ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) TO authenticated;
REVOKE ALL ON FUNCTION public.get_discrepancies_ops_control(public.discrepancy_status_enum) FROM anon;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_discrepancies_ops_control'
  ) THEN
    RAISE EXCEPTION 'get_discrepancies_ops_control not created';
  END IF;

  RAISE NOTICE '✓ spec-86 fase 3 get_discrepancies_ops_control migration complete';
END $$;

COMMIT;
