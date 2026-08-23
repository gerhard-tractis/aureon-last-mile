-- =============================================================================
-- get_nav_counts gains an `orders` column — the same count the default "SLA
-- en riesgo" Pedidos view leads with (order_sla_status IN ('late', 'at_risk')),
-- so the nav badge and the screen it links to can never disagree. Templated
-- from the latest definition, 20260817000001_spec54_nav_counts.sql, per this
-- project's CLAUDE.md rule to always build CREATE OR REPLACE from the newest
-- migration, never the original.
--
-- DROP FUNCTION IF EXISTS is required here, not optional: CREATE OR REPLACE
-- cannot change the row type of an existing RETURNS TABLE function, and this
-- adds a fifth OUT column (`orders`) to the four the previous definition had.
-- Postgres refuses with "cannot change return type of existing function" /
-- "Row type defined by OUT parameters is different" otherwise. Same pattern
-- as 20260820000006_spec61_pending_manifests_exclude_routed.sql. Dropping the
-- function also drops its grants, which is why GRANT EXECUTE is repeated
-- below, after the CREATE, in this same migration.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_nav_counts(UUID);

CREATE OR REPLACE FUNCTION public.get_nav_counts(
  p_operator_id UUID
)
RETURNS TABLE (
  pickup       BIGINT,
  reception    BIGINT,
  distribution BIGINT,
  dispatch     BIGINT,
  orders       BIGINT
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
    ), 0)::BIGINT AS dispatch,

    -- spec-65: orders whose SLA verdict is late or at_risk right now — the
    -- same set the default Pedidos view ("SLA en riesgo") leads with, and the
    -- IDENTICAL delivered_at derivation get_orders_list (20260823000002)
    -- uses: the most recent NON-PICKUP dispatch's completed_at (there is no
    -- orders.delivered_at). is_pickup = FALSE is required, not incidental —
    -- a completed pickup movement also carries status = 'delivered' (same
    -- enum, same webhook field), and without this filter an order whose only
    -- "delivered" dispatch is a collection event would count as delivered
    -- here while get_orders_list still shows it with a live SLA verdict —
    -- exactly the nav-vs-screen mismatch this migration exists to prevent
    -- (see 20260817000001:4-11).
    COALESCE((
      SELECT COUNT(*)
      FROM orders o
      CROSS JOIN LATERAL public.order_sla_status(
        o.delivery_date,
        o.delivery_window_start,
        o.delivery_window_end,
        o.rescheduled_delivery_date,
        o.rescheduled_window_start,
        o.rescheduled_window_end,
        (
          SELECT MAX(d.completed_at) AT TIME ZONE 'America/Santiago'
          FROM public.dispatches d
          WHERE d.order_id = o.id
            AND d.operator_id = p_operator_id
            AND d.deleted_at IS NULL
            AND d.status = 'delivered'
            AND d.is_pickup = FALSE
        ),
        NOW() AT TIME ZONE 'America/Santiago'
      ) sla
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at IS NULL
        AND sla.sla_status IN ('late', 'at_risk')
    ), 0)::BIGINT AS orders
$$;

COMMENT ON FUNCTION public.get_nav_counts(UUID) IS
  'spec-54/spec-65 — sidebar queue counters, one row. Counts the same unit each module''s own screen leads with (manifests / routes / packages / at-risk orders), so nav and screen cannot disagree. pickup/reception/distribution/dispatch deliberately NOT derived from orders.status, which collapses the package-only states. orders is the count in late/at_risk via order_sla_status, matching the default Pedidos "SLA en riesgo" view.';

GRANT EXECUTE ON FUNCTION public.get_nav_counts(UUID) TO authenticated;
