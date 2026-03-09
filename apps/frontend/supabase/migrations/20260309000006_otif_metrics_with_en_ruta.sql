-- Restructure OTIF metrics: replace pending with en_ruta + pendientes
-- en_ruta: order not terminal AND has a dispatch with a route
-- pendientes: order not terminal AND no dispatch with a route
-- failed: only if no newer pending dispatch with a route (i.e. not re-dispatched)

CREATE OR REPLACE FUNCTION public.get_otif_metrics(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_orders', COUNT(*),
    'delivered_orders', COUNT(*) FILTER (WHERE o.status = 'delivered'),
    'failed_orders', COUNT(*) FILTER (
      WHERE o.status = 'failed'
      AND NOT EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'pending'
          AND d.route_id IS NOT NULL
          AND d.deleted_at IS NULL
      )
    ),
    'in_route_orders', COUNT(*) FILTER (
      WHERE o.status NOT IN ('delivered', 'failed')
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.route_id IS NOT NULL
          AND d.deleted_at IS NULL
      )
    ),
    'pending_orders', COUNT(*) FILTER (
      WHERE o.status NOT IN ('delivered', 'failed')
      AND NOT EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.route_id IS NOT NULL
          AND d.deleted_at IS NULL
      )
    ),
    'on_time_deliveries', COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    ),
    'otif_percentage', ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'delivered'
        AND EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.order_id = o.id
            AND d.status = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL;
$$;
