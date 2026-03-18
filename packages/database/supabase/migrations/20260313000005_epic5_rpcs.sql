-- =============================================================
-- Epic 5: Pipeline counts and capacity utilization RPCs
-- =============================================================

-- ── get_pipeline_counts ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_pipeline_counts(
  p_operator_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
  status order_status_enum,
  count BIGINT,
  urgent_count BIGINT,
  alert_count BIGINT,
  late_count BIGINT
) AS $$
  SELECT
    o.status,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE calculate_order_priority(
      o.delivery_date, o.delivery_window_end
    ) = 'urgent') AS urgent_count,
    COUNT(*) FILTER (WHERE calculate_order_priority(
      o.delivery_date, o.delivery_window_end
    ) = 'alert') AS alert_count,
    COUNT(*) FILTER (WHERE calculate_order_priority(
      o.delivery_date, o.delivery_window_end
    ) = 'late') AS late_count
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date = p_date
    AND o.deleted_at IS NULL
    AND o.status != 'cancelado'
  GROUP BY o.status;
$$ LANGUAGE sql STABLE;

-- ── get_capacity_utilization ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_capacity_utilization(
  p_operator_id UUID,
  p_date_from DATE,
  p_date_to DATE
) RETURNS TABLE (
  client_id UUID,
  retailer_name VARCHAR,
  capacity_date DATE,
  daily_capacity INT,
  actual_orders BIGINT,
  utilization_pct NUMERIC
) AS $$
  SELECT
    rdc.client_id,
    tc.name AS retailer_name,
    rdc.capacity_date,
    rdc.daily_capacity,
    COUNT(o.id) AS actual_orders,
    ROUND(COUNT(o.id)::NUMERIC / NULLIF(rdc.daily_capacity, 0) * 100, 1)
  FROM retailer_daily_capacities rdc
  JOIN tenant_clients tc ON tc.id = rdc.client_id
  LEFT JOIN orders o ON o.operator_id = rdc.operator_id
    AND o.tenant_client_id = rdc.client_id
    AND o.delivery_date = rdc.capacity_date
    AND o.deleted_at IS NULL
  WHERE rdc.operator_id = p_operator_id
    AND rdc.capacity_date BETWEEN p_date_from AND p_date_to
    AND rdc.deleted_at IS NULL
  GROUP BY rdc.client_id, tc.name, rdc.capacity_date, rdc.daily_capacity;
$$ LANGUAGE sql STABLE;
