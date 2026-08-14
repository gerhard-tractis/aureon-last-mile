-- =============================================================
-- Fix: Recogida orders vanish the moment reception scanning starts
-- Template: latest definition from 20260513000004_spec43_followup_returns_snapshot.sql
--
-- The manifests key (Ops Control "Recogida" panel + stage counts) filtered at
-- MANIFEST level: reception_status = 'awaiting_reception'. Spec-47's route
-- reception flips every linked manifest to 'reception_in_progress' the moment
-- the receptionist starts scanning (route_receptions -> in_progress, see
-- 20260812000006), so ALL orders of those manifests dropped out of Recogida at
-- once — including orders whose packages were still 'verificado' (not yet
-- received).
--
-- Per-order truth already exists: recalculate_order_status rolls orders up
-- from MIN(pipeline_position) of their packages, so an order stays
-- 'verificado' until every package has been reception-scanned to 'en_bodega'.
-- Changes to the manifests key:
--   - manifest filter widened to IN ('awaiting_reception','reception_in_progress')
--   - per-order guard o.status IN ('ingresado','verificado') so each order
--     leaves Recogida individually when it rolls up to 'en_bodega' (at which
--     point the orders key surfaces it in the Recepción panel — no double
--     listing)
-- Orders, routes, sla_config and returns keys are unchanged from the template.
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
      WHERE o.operator_id = p_operator_id AND o.deleted_at IS NULL AND o.status NOT IN ('entregado', 'cancelado', 'en_retorno', 'parcialmente_entregado')
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
        AND o.status IN ('ingresado', 'verificado')
        AND o.external_load_id IN (
          SELECT m.external_load_id FROM manifests m
          WHERE m.operator_id = p_operator_id AND m.deleted_at IS NULL
            AND m.status != 'cancelled'
            AND m.reception_status IN ('awaiting_reception', 'reception_in_progress')
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
            'pickup_point_name',  pp.name,
            'status',             o.status,
            'return_reason',      p.return_reason,
            'return_reason_code', p.return_reason_code,
            'age_minutes',        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60,
            'dwell_minutes',      EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60,
            'idle_minutes',       EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60,
            'packages', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', pk.id, 'label', pk.label, 'status', pk.status,
                'return_reason', pk.return_reason, 'return_reason_code', pk.return_reason_code
              ))
              FROM packages pk
              WHERE pk.order_id = o.id
                AND pk.status = 'retorno_hub'
                AND pk.deleted_at IS NULL
            ), '[]'::jsonb)
          ) AS row
        FROM orders o
        JOIN packages p
          ON p.order_id   = o.id
         AND p.status     = 'retorno_hub'
         AND p.deleted_at IS NULL
        LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
        WHERE o.operator_id = p_operator_id
          AND o.status IN ('en_retorno', 'parcialmente_entregado')
          AND o.deleted_at IS NULL
        ORDER BY o.id, p.updated_at DESC  -- picks the most-recently-updated package reason
      ) sub
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION get_ops_control_snapshot(UUID) IS
  'Returns a single jsonb snapshot used by the Ops Control dashboard. Keys: orders, routes, manifests, sla_config, returns. The manifests key (Recogida) lists orders still pre-reception (status ingresado/verificado) from manifests awaiting or in reception — each order drops out individually once all its packages are reception-scanned and it rolls up to en_bodega. The returns key lists orders in en_retorno or parcialmente_entregado status (excluded from orders) with pickup_point_name, retorno_hub packages array, and failure reason from the most-recently-updated retorno_hub package.';

-- Verification: function exists and still compiles with the expected signature.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc pr
    JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND pr.proname = 'get_ops_control_snapshot'
  ) THEN
    RAISE EXCEPTION 'get_ops_control_snapshot not found after migration!';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'get_ops_control_snapshot')
     NOT LIKE '%reception_in_progress%' THEN
    RAISE EXCEPTION 'get_ops_control_snapshot manifests filter was not updated!';
  END IF;
END $$;
