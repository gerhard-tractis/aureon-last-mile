-- =============================================================
-- Enrich ops-control snapshot:
-- 1. Orders key now returns the same enriched shape as manifests
--    (pickup_point_name, effective_delivery_date, nested packages).
-- 2. Fix manifests filter: allow completed manifests awaiting
--    reception (the trigger sets reception_status on completion,
--    so excluding completed was contradictory).
-- =============================================================

CREATE OR REPLACE FUNCTION get_ops_control_snapshot(
  p_operator_id UUID
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'orders', COALESCE((
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
  'Single-RPC snapshot for Ops Control. Orders and manifests share the same enriched shape (pickup_point_name, effective_delivery_date, nested packages). Routes remain raw row_to_json.';
