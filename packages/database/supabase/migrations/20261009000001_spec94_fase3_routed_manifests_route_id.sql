-- =============================================================================
-- spec-94 fase 3 — get_routed_manifests gana pickup_route_id
-- =============================================================================
-- Contexto (docs/specs/spec-94-recogida-cuatro-estados.md, fase 3): "Quitar
-- de la ruta" reutiliza `useRemoveManifestFromRoute`, y detrás de ese hook
-- está `remove_manifest_from_route(p_route_id, p_manifest_id)` -- necesita
-- el UUID de la ruta, no sólo su código. `get_routed_manifests`
-- (20261008000001) nunca lo devolvió: sólo trae `route_code`, derivado de
-- `pr.code`. Sin esta columna, la fila de "En punto de retiro" no tiene
-- forma de llamar al RPC de baja -- se descubrió al construir el botón, no
-- estaba en el listado de archivos de la fase 3, que es sólo frontend.
--
-- Aditivo y re-templado desde la ÚLTIMA definición (CLAUDE.md): mismo cuerpo
-- que 20261008000001, una columna más al final. `SELECT *` en el pgTAP
-- existente no se rompe por una columna nueva.
--
-- DROP antes de CREATE: PostgreSQL no deja que CREATE OR REPLACE cambie el
-- RETURNS TABLE de una función existente (columna nueva incluida) --
-- "cannot change return type of existing function", verificado contra el
-- contenedor pgTAP local antes de escribir esto.
BEGIN;

DROP FUNCTION IF EXISTS public.get_routed_manifests();

CREATE OR REPLACE FUNCTION public.get_routed_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  route_code             TEXT,
  route_started_at       TIMESTAMPTZ,
  driver_name            TEXT,
  route_status           TEXT,
  closed_at              TIMESTAMPTZ,
  missing_count          INT,
  verified_count         BIGINT,
  pickup_route_id        UUID
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.created_at,
    m.pickup_location AS pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name,
    pr.code AS route_code,
    pr.started_at AS route_started_at,
    drv.full_name AS driver_name,
    pr.status::TEXT AS route_status,
    CASE WHEN m.status = 'completed' THEN m.completed_at ELSE NULL END AS closed_at,
    COALESCE((
      SELECT COUNT(DISTINCT d.package_id)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         AND d.operator_id = m.operator_id
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count,
    COALESCE((
      SELECT COUNT(*)
        FROM public.pickup_scans ps
       WHERE ps.manifest_id = m.id
         AND ps.scan_result = 'verified'
         AND ps.package_id IS NOT NULL
         AND ps.deleted_at IS NULL
    ), 0)::BIGINT AS verified_count,
    -- fase 3 -- el UUID que remove_manifest_from_route(p_route_id, ...)
    -- necesita. m.pickup_route_id, no pr.id: son el mismo valor cuando "ruta
    -- viva" es true (WHERE de abajo lo exige), pero nombrarlo desde el lado
    -- del manifiesto deja claro que es la misma columna que ya decide
    -- "ruta viva" en el LEFT JOIN.
    m.pickup_route_id
  FROM public.manifests m
  LEFT JOIN public.users u ON u.id = m.labels_printed_by
  LEFT JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL
  LEFT JOIN public.users drv ON drv.id = pr.driver_id
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.status <> 'cancelled'
    AND pr.id IS NOT NULL                              -- ruta viva
    AND pr.status NOT IN ('in_transit','received')
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_routed_manifests() IS
  'spec-94 fase 1/3 -- cubo 2 ("En punto de retiro"): manifiesto con ruta VIVA cuyo status no es in_transit/received. Trae pickup_route_id (fase 3) para que la fila pueda llamar a remove_manifest_from_route.';

-- El DROP de arriba se lleva los GRANT/REVOKE de 20261008000001 con él --
-- hay que volver a dejarlos, mismos permisos.
REVOKE ALL ON FUNCTION public.get_routed_manifests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_routed_manifests() TO authenticated;
REVOKE ALL ON FUNCTION public.get_routed_manifests() FROM anon;

DO $$
DECLARE
  v_src  TEXT;
  v_cols TEXT;
BEGIN
  SELECT p.prosrc, array_to_string(p.proargnames, ',') INTO v_src, v_cols
   FROM pg_proc p WHERE p.oid = 'public.get_routed_manifests()'::regprocedure;

  IF v_src NOT LIKE '%m.pickup_route_id%' THEN
    RAISE EXCEPTION 'get_routed_manifests must return m.pickup_route_id (spec-94 fase 3 -- needed by remove_manifest_from_route)';
  END IF;
  IF v_src NOT LIKE '%LEFT JOIN public.pickup_routes pr ON pr.id = m.pickup_route_id AND pr.deleted_at IS NULL%' THEN
    RAISE EXCEPTION 'get_routed_manifests must LEFT JOIN pickup_routes with deleted_at in the ON clause, not the WHERE';
  END IF;
  IF v_src NOT LIKE '%pr.status NOT IN (%in_transit%received%)%' THEN
    RAISE EXCEPTION 'get_routed_manifests must use pr.status NOT IN (in_transit, received), not a positive list';
  END IF;
  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,total_orders,total_packages,created_at,pickup_point,labels_printed_at,labels_printed_by_name,route_code,route_started_at,driver_name,route_status,closed_at,missing_count,verified_count,pickup_route_id'
  THEN
    RAISE EXCEPTION 'get_routed_manifests column set changed unexpectedly, got: %', v_cols;
  END IF;

  RAISE NOTICE '✓ spec-94 fase 3: get_routed_manifests now returns pickup_route_id';
END $$;

COMMIT;
