-- =============================================================
-- Fix ops-control snapshot:
-- 1. Restore delivery window fields stripped by 20260414:
--    delivery_date, delivery_window_start, delivery_window_end,
--    rescheduled_delivery_date, rescheduled_window_start,
--    rescheduled_window_end.
--    Times are formatted as HH24:MI (not HH24:MI:SS) so the
--    frontend toISO helper produces a valid ISO datetime string.
-- 2. Add computed health metrics to orders:
--    dwell_minutes / age_minutes / idle_minutes — minutes since
--    the order last changed status (status_updated_at).
-- =============================================================

CREATE OR REPLACE FUNCTION get_ops_control_snapshot(
  p_operator_id UUID
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                        o.id,
        'order_number',              o.order_number,
        'customer_name',             o.customer_name,
        'retailer_name',             o.retailer_name,
        'external_load_id',          o.external_load_id,
        'status',                    o.status,
        'pickup_point_name',         pp.name,
        'effective_delivery_date',   COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna',                    o.comuna,
        -- Delivery window fields needed by classifyRisk (SLA / at-risk banner).
        -- Times formatted as HH24:MI so toISO() produces a valid ISO string.
        'delivery_date',             o.delivery_date,
        'delivery_window_start',     TO_CHAR(o.delivery_window_start, 'HH24:MI'),
        'delivery_window_end',       TO_CHAR(o.delivery_window_end,   'HH24:MI'),
        'rescheduled_delivery_date', o.rescheduled_delivery_date,
        'rescheduled_window_start',  TO_CHAR(o.rescheduled_window_start, 'HH24:MI'),
        'rescheduled_window_end',    TO_CHAR(o.rescheduled_window_end,   'HH24:MI'),
        -- Stage health metrics: minutes since last status change.
        -- Used by computeStageHealth for reception (dwell), consolidation
        -- (age), and docks (idle) stage panels.
        'dwell_minutes',             EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'age_minutes',               EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'idle_minutes',              EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'packages',                  COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',                 p.id,
            'label',              p.label,
            'status',             p.status,
            'declared_box_count', p.declared_box_count,
            'sku_items',          p.sku_items
          ))
          FROM packages p
          WHERE p.order_id = o.id
            AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o
      LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
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
        'id',                      o.id,
        'order_number',            o.order_number,
        'customer_name',           o.customer_name,
        'retailer_name',           o.retailer_name,
        'external_load_id',        o.external_load_id,
        'status',                  o.status,
        'pickup_point_name',       pp.name,
        'effective_delivery_date', COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna',                  o.comuna,
        'packages',                COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',                 p.id,
            'label',              p.label,
            'status',             p.status,
            'declared_box_count', p.declared_box_count,
            'sku_items',          p.sku_items
          ))
          FROM packages p
          WHERE p.order_id = o.id
            AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o
      LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at IS NULL
        AND o.external_load_id IN (
          SELECT m.external_load_id
          FROM manifests m
          WHERE m.operator_id     = p_operator_id
            AND m.deleted_at IS NULL
            AND m.status != 'cancelled'
            AND m.reception_status = 'awaiting_reception'
        )
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
  'Single-RPC snapshot for Ops Control. Orders include delivery window fields for SLA classification and computed dwell/age/idle_minutes for stage health panels.';
