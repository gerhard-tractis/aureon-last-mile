-- =============================================================
-- Spec 32: Ops Control snapshot RPC
--
-- Consolidates 5 separate client queries into a single RPC.
-- Excludes successfully delivered (entregado) and cancelled
-- orders/routes to keep the payload small and focused on
-- in-progress work only.
-- Manifests enriched with pickup_point_name and effective
-- delivery date (rescheduled takes precedence over original).
-- =============================================================

CREATE OR REPLACE FUNCTION get_ops_control_snapshot(
  p_operator_id UUID
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(row_to_json(o))
      FROM orders o
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at IS NULL
        AND o.status NOT IN ('entregado', 'cancelado')
    ), '[]'::jsonb),

    'routes', COALESCE((
      SELECT jsonb_agg(row_to_json(r))
      FROM routes r
      WHERE r.operator_id = p_operator_id
        AND r.deleted_at IS NULL
        AND r.status NOT IN ('completed', 'cancelled')
    ), '[]'::jsonb),

    'manifests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                     m.id,
        'external_load_id',       m.external_load_id,
        'retailer_name',          m.retailer_name,
        'pickup_location',        m.pickup_location,
        'total_orders',           m.total_orders,
        'total_packages',         m.total_packages,
        'status',                 m.status,
        'reception_status',       m.reception_status,
        'created_at',             m.created_at,
        'updated_at',             m.updated_at,
        'pickup_point_name',      agg.pickup_point_name,
        'effective_delivery_date', agg.effective_delivery_date,
        'order_count',            agg.order_count
      ))
      FROM manifests m
      LEFT JOIN LATERAL (
        SELECT
          pp.name                                            AS pickup_point_name,
          MIN(COALESCE(o.rescheduled_delivery_date, o.delivery_date)) AS effective_delivery_date,
          COUNT(*)::int                                       AS order_count
        FROM orders o
        LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
        WHERE o.external_load_id = m.external_load_id
          AND o.operator_id     = m.operator_id
          AND o.deleted_at IS NULL
        GROUP BY pp.name
        LIMIT 1
      ) agg ON true
      WHERE m.operator_id     = p_operator_id
        AND m.deleted_at IS NULL
        AND m.status NOT IN ('completed', 'cancelled')
        AND m.reception_status = 'awaiting_reception'
    ), '[]'::jsonb),

    'sla_config', COALESCE((
      SELECT jsonb_agg(row_to_json(s))
      FROM retailer_return_sla_config s
      WHERE s.operator_id = p_operator_id
        AND s.deleted_at IS NULL
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION get_ops_control_snapshot(UUID) IS
  'Single-RPC snapshot for the Ops Control dashboard. Returns only in-progress orders, routes, and in-transit manifests with enriched pickup point and effective delivery date.';
