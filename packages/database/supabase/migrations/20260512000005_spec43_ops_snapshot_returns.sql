-- =============================================================
-- Spec-43: Add 'returns' key to get_ops_control_snapshot RPC
-- Template: latest definition from 20260505000001_filter_empty_drafts_from_ops_control.sql
--
-- Adds a 'returns' key alongside the existing orders, routes, manifests,
-- sla_config keys. One row per order (using DISTINCT ON), with the most recent
-- package failure reason selected via ORDER BY p.updated_at DESC.
--
-- Cross-spec dependency note (spec-44a):
--   When spec-44a lands, the 'returns' subquery will need
--   AND o.return_to_sender_state IS NULL added to prevent dual-listing
--   orders that have been escalated to "return to sender". That column does
--   not exist yet on this branch.
-- =============================================================

CREATE OR REPLACE FUNCTION get_ops_control_snapshot(
  p_operator_id UUID
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name,
        'retailer_name', o.retailer_name, 'external_load_id', o.external_load_id,
        'status', o.status, 'pickup_point_name', pp.name,
        'effective_delivery_date', COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna', o.comuna, 'delivery_date', o.delivery_date,
        'delivery_window_start', TO_CHAR(o.delivery_window_start, 'HH24:MI'),
        'delivery_window_end', TO_CHAR(o.delivery_window_end, 'HH24:MI'),
        'rescheduled_delivery_date', o.rescheduled_delivery_date,
        'rescheduled_window_start', TO_CHAR(o.rescheduled_window_start, 'HH24:MI'),
        'rescheduled_window_end', TO_CHAR(o.rescheduled_window_end, 'HH24:MI'),
        'dwell_minutes', EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'age_minutes', EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'idle_minutes', EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'packages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'status', p.status, 'declared_box_count', p.declared_box_count, 'sku_items', p.sku_items))
          FROM packages p WHERE p.order_id = o.id AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id AND o.deleted_at IS NULL AND o.status NOT IN ('entregado', 'cancelado')
    ), '[]'::jsonb),
    'routes', COALESCE((
      SELECT jsonb_agg(row_to_json(r)) FROM routes r
      WHERE r.operator_id = p_operator_id AND r.deleted_at IS NULL AND r.status NOT IN ('completed', 'cancelled')
        AND NOT (r.status = 'draft' AND COALESCE(r.planned_stops, 0) = 0)
    ), '[]'::jsonb),
    'manifests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'customer_name', o.customer_name,
        'retailer_name', o.retailer_name, 'external_load_id', o.external_load_id,
        'status', o.status, 'pickup_point_name', pp.name,
        'effective_delivery_date', COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna', o.comuna,
        'packages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'status', p.status, 'declared_box_count', p.declared_box_count, 'sku_items', p.sku_items))
          FROM packages p WHERE p.order_id = o.id AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id AND o.deleted_at IS NULL
        AND o.external_load_id IN (
          SELECT m.external_load_id FROM manifests m
          WHERE m.operator_id = p_operator_id AND m.deleted_at IS NULL
            AND m.status != 'cancelled' AND m.reception_status = 'awaiting_reception'
        )
    ), '[]'::jsonb),
    'sla_config', COALESCE((
      SELECT jsonb_agg(row_to_json(s)) FROM retailer_return_sla_config s
      WHERE s.operator_id = p_operator_id AND s.deleted_at IS NULL
    ), '[]'::jsonb),
    'returns', COALESCE((
      SELECT jsonb_agg(row)
      FROM (
        SELECT DISTINCT ON (o.id)
          jsonb_build_object(
            'id',                 o.id,
            'order_number',       o.order_number,
            'retailer_name',      o.retailer_name,
            'status',             o.status,
            'return_reason',      p.return_reason,
            'return_reason_code', p.return_reason_code,
            'age_minutes',        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60
          ) AS row
        FROM orders o
        JOIN packages p
          ON p.order_id   = o.id
         AND p.status     = 'retorno_hub'
         AND p.deleted_at IS NULL
        WHERE o.operator_id = p_operator_id
          AND o.status IN ('en_retorno', 'parcialmente_entregado')
          AND o.deleted_at IS NULL
        ORDER BY o.id, p.updated_at DESC  -- picks the most-recently-updated package reason
      ) sub
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION get_ops_control_snapshot(UUID) IS
  'Returns a single jsonb snapshot used by the Ops Control dashboard. Keys: orders, routes, manifests, sla_config, returns. The returns key lists orders in en_retorno or parcialmente_entregado status with failure reason from the most recently updated retorno_hub package.';
