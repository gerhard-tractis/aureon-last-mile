-- =============================================================
-- Filter empty draft routes from the ops-control snapshot.
--
-- Draft routes are created upfront in apps/frontend/src/app/api/dispatch/
-- routes/route.ts the moment a user opens a route flow, then populated
-- as stops are added. If the user abandons the flow, the empty draft
-- (status='draft', planned_stops=0) persists and shows up in the
-- Andenes panel as a phantom "order in dock", since the frontend maps
-- draft/planned routes to the docks stage.
--
-- 1. Update get_ops_control_snapshot to exclude empty drafts.
-- 2. Soft-delete the four known zombie drafts from 2026-04-29.
--
-- Template: 20260415000001_fix_ops_snapshot_delivery_window.sql
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
        'delivery_date',             o.delivery_date,
        'delivery_window_start',     TO_CHAR(o.delivery_window_start, 'HH24:MI'),
        'delivery_window_end',       TO_CHAR(o.delivery_window_end,   'HH24:MI'),
        'rescheduled_delivery_date', o.rescheduled_delivery_date,
        'rescheduled_window_start',  TO_CHAR(o.rescheduled_window_start, 'HH24:MI'),
        'rescheduled_window_end',    TO_CHAR(o.rescheduled_window_end,   'HH24:MI'),
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
        -- Exclude empty drafts (created upfront when a user opens a
        -- route flow but abandoned before any stops were added).
        AND NOT (r.status = 'draft' AND COALESCE(r.planned_stops, 0) = 0)
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
  'Single-RPC snapshot for Ops Control. Orders include delivery window fields for SLA classification and computed dwell/age/idle_minutes for stage health panels. Empty draft routes (planned_stops=0) are excluded from the docks panel.';

-- Soft-delete the 4 known zombie drafts from 2026-04-29
-- (operator 92dc5797-047d-458d-bbdb-63f18c0dd1e7).
UPDATE routes
SET deleted_at = NOW()
WHERE id IN (
  '3ed26d90-e479-47a3-8c3b-72df34588722',
  'd81eb02a-fd4d-4d65-bad6-c1d03232d28d',
  '7ab4dc0a-4966-4952-8d45-5f653c7f4def',
  '931ca00e-0e18-4e00-81ca-13fb9c42ec04'
)
AND deleted_at IS NULL
AND status = 'draft'
AND COALESCE(planned_stops, 0) = 0;
