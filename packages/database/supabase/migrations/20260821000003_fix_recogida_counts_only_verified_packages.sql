-- =============================================================
-- Fix: Recogida counted packages that were never picked up
-- Template: latest definition from
--   20260814000003_fix_recogida_orders_vanish_on_reception_start.sql
--
-- The manifests key (Ops Control "Recogida" panel + stage counts) built its
-- packages array with no status filter at all, so every package of a listed
-- order counted as collected. The pickup flow can legitimately close a carga
-- out with packages missing: /app/pickup/review lists them (useMissingPackages),
-- requires a note each (discrepancy_notes), and /app/pickup/complete completes
-- the manifest anyway. Those packages never got a verified pickup_scan, are
-- still 'ingresado', and were being reported to the control tower as picked up.
--
-- Changes to the manifests key: the packages subquery gains
--   AND p.status = 'verificado'
--
-- Why status and not EXISTS(verified pickup_scan):
--   - trg_pickup_scan_advance_package_status (20260812000002) is the only
--     writer of 'verificado', and spec-52 closed the direct-write path from the
--     browser. The status IS the scan; a join buys nothing.
--   - It is also strictly more correct. An order stays in Recogida until every
--     one of its packages rolls up to en_bodega, so a partially received order
--     can hold packages already scanned in at the hub. Those have left Recogida
--     and must stop counting there; an EXISTS-on-scans test would count them
--     forever.
--
-- The orders key builds its packages array from an IDENTICAL subquery and is
-- deliberately NOT touched: Recepcion and every downstream panel need the whole
-- package set. Test: packages/database/supabase/tests/
-- recogida_counts_only_verified_packages.sql asserts both halves.
--
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
            AND p.status = 'verificado'
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
  'Returns a single jsonb snapshot used by the Ops Control dashboard. Keys: orders, routes, manifests, sla_config, returns. The manifests key (Recogida) lists orders still pre-reception (status ingresado/verificado) from manifests awaiting or in reception, and reports ONLY their pickup-verified packages — a package closed out as a discrepancy never reaches verificado and must not count as collected. The orders key keeps every package. The returns key lists orders in en_retorno or parcialmente_entregado status (excluded from orders) with pickup_point_name, retorno_hub packages array, and failure reason from the most-recently-updated retorno_hub package.';

-- Verification: the manifests key filters on verificado and the orders key does not.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname = 'get_ops_control_snapshot';
  IF src IS NULL THEN
    RAISE EXCEPTION 'get_ops_control_snapshot not found after migration!';
  END IF;
  IF src NOT LIKE '%reception_in_progress%' THEN
    RAISE EXCEPTION 'get_ops_control_snapshot lost the spec-47 manifests filter!';
  END IF;
  IF (length(src) - length(replace(src, 'p.status = ''verificado''', ''))) / length('p.status = ''verificado''') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one verificado package filter (manifests key only)';
  END IF;
END $$;
