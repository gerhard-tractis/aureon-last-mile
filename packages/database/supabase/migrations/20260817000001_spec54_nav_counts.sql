-- =============================================================================
-- spec-54 — get_nav_counts: the sidebar's per-module queue counters
--
-- The nav counters were derived from get_pipeline_counts, which counts ORDERS
-- by orders.status. That is the wrong unit for this job, and it under-reports:
-- recalculate_order_status (latest def 20260810000001) deliberately collapses
-- the package-only states back to `en_bodega`, so an order whose packages are
-- already sectorizado still reports as en_bodega. The nav showed Distribución 0
-- while the Distribución screen showed 25 packages waiting to be sorted.
-- lib/ops-control/stage.ts fixed the same class of bug for the tower (#419);
-- this fixes it for the nav.
--
-- Why a new function rather than changing get_pipeline_counts: that RPC has
-- four consumers, and two of them depend on its current shape —
-- PipelineOverview renders PIPELINE_STAGES keyed by order status, and
-- useDayPromise reads its `entregado` row. Changing its semantics to be
-- package-aware would silently break both. This is one extra function and no
-- extra round trip: the nav made exactly one call before and makes one now.
--
-- Each counter is the number the module's OWN screen leads with, so the
-- sidebar and the screen it links to can never disagree:
--
--   pickup       manifests still to collect        (Recogida: "Manifiestos pendientes")
--   reception    routes inbound or in the yard     (Recepción: "Rutas esperadas hoy")
--   distribution packages awaiting sectorization   (Distribución: "Pendientes de sectorizar")
--   dispatch     packages staged at an andén       (Despacho: work ready to route)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_nav_counts(
  p_operator_id UUID
)
RETURNS TABLE (
  pickup       BIGINT,
  reception    BIGINT,
  distribution BIGINT,
  dispatch     BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    -- Loads whose collection has not been closed out yet.
    COALESCE((
      SELECT COUNT(*) FROM manifests m
      WHERE m.operator_id = p_operator_id
        AND m.deleted_at IS NULL
        AND m.status IN ('pending', 'in_progress')
    ), 0)::BIGINT AS pickup,

    -- A route is the reception module's unit of work: one QR, one count.
    -- in_progress = still collecting, in_transit = standing in the yard.
    COALESCE((
      SELECT COUNT(*) FROM pickup_routes pr
      WHERE pr.operator_id = p_operator_id
        AND pr.deleted_at IS NULL
        AND pr.status IN ('in_progress', 'in_transit')
    ), 0)::BIGINT AS reception,

    -- Packages, not orders: this is the number that was wrong before.
    COALESCE((
      SELECT COUNT(*) FROM packages p
      WHERE p.operator_id = p_operator_id
        AND p.deleted_at IS NULL
        AND p.status = 'en_bodega'
    ), 0)::BIGINT AS distribution,

    -- Sorted onto an andén and waiting for a route. `retenido` is deliberately
    -- excluded: a package held in consolidation is waiting for its siblings,
    -- not for a router.
    COALESCE((
      SELECT COUNT(*) FROM packages p
      WHERE p.operator_id = p_operator_id
        AND p.deleted_at IS NULL
        AND p.status = 'sectorizado'
    ), 0)::BIGINT AS dispatch
$$;

COMMENT ON FUNCTION public.get_nav_counts(UUID) IS
  'spec-54 — sidebar queue counters, one row. Counts the same unit each module''s own screen leads with (manifests / routes / packages), so nav and screen cannot disagree. Deliberately NOT derived from orders.status, which collapses the package-only states.';

GRANT EXECUTE ON FUNCTION public.get_nav_counts(UUID) TO authenticated;
