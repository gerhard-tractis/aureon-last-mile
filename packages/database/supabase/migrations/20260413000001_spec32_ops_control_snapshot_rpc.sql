-- =============================================================
-- Spec 32: Ops Control snapshot RPC
--
-- Consolidates 5 separate client queries into a single RPC.
-- Excludes successfully delivered (entregado) and cancelled
-- orders/routes to keep the payload small and focused on
-- in-progress work only.
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
      SELECT jsonb_agg(row_to_json(m))
      FROM manifests m
      WHERE m.operator_id = p_operator_id
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
  'Single-RPC snapshot for the Ops Control dashboard. Returns only in-progress orders, routes, and manifests — excludes delivered/cancelled.';
