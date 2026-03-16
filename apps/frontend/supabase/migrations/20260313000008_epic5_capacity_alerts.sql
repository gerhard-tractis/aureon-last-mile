-- =============================================================
-- Epic 5: capacity_alerts table, order alert trigger,
--          and get_forecast_accuracy RPC
-- Thresholds handled here: 100% and 120% (≥80% handled by n8n)
-- =============================================================

-- ── capacity_alerts table ─────────────────────────────────────

CREATE TABLE capacity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES tenant_clients(id) ON DELETE CASCADE,
  alert_date DATE NOT NULL,
  threshold_pct INT NOT NULL,
  actual_orders INT NOT NULL,
  daily_capacity INT NOT NULL,
  utilization_pct NUMERIC NOT NULL,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT unique_alert_per_threshold
    UNIQUE (operator_id, client_id, alert_date, threshold_pct)
);

CREATE INDEX idx_capacity_alerts_operator_active
  ON capacity_alerts(operator_id, dismissed_at)
  WHERE dismissed_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER set_capacity_alerts_updated_at
  BEFORE UPDATE ON capacity_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE capacity_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "capacity_alerts_tenant_isolation" ON capacity_alerts
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "capacity_alerts_tenant_select" ON capacity_alerts
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON capacity_alerts TO authenticated;
REVOKE ALL ON capacity_alerts FROM anon;

CREATE TRIGGER audit_capacity_alerts_changes
  AFTER INSERT OR UPDATE OR DELETE ON capacity_alerts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ── check_capacity_and_alert trigger function ─────────────────
-- Fires AFTER INSERT on orders.
-- Upserts capacity_alerts when utilization reaches 100% or 120%.

CREATE OR REPLACE FUNCTION check_capacity_and_alert()
RETURNS TRIGGER AS $$
DECLARE
  v_daily_capacity INT;
  v_actual_orders INT;
  v_utilization_pct NUMERIC;
BEGIN
  -- Get daily capacity for this retailer/date
  SELECT daily_capacity INTO v_daily_capacity
  FROM retailer_daily_capacities
  WHERE operator_id = NEW.operator_id
    AND client_id = NEW.tenant_client_id
    AND capacity_date = NEW.delivery_date
    AND deleted_at IS NULL
  LIMIT 1;

  -- No capacity configured → skip
  IF v_daily_capacity IS NULL OR v_daily_capacity = 0 THEN
    RETURN NEW;
  END IF;

  -- Count actual orders for this retailer/date
  SELECT COUNT(*) INTO v_actual_orders
  FROM orders
  WHERE operator_id = NEW.operator_id
    AND tenant_client_id = NEW.tenant_client_id
    AND delivery_date = NEW.delivery_date
    AND deleted_at IS NULL;

  v_utilization_pct := v_actual_orders::NUMERIC / v_daily_capacity * 100;

  -- Upsert alert for 100% threshold
  IF v_utilization_pct >= 100 THEN
    INSERT INTO capacity_alerts (
      operator_id, client_id, alert_date, threshold_pct,
      actual_orders, daily_capacity, utilization_pct
    ) VALUES (
      NEW.operator_id, NEW.tenant_client_id, NEW.delivery_date, 100,
      v_actual_orders, v_daily_capacity, v_utilization_pct
    )
    ON CONFLICT (operator_id, client_id, alert_date, threshold_pct)
    DO UPDATE SET
      actual_orders = EXCLUDED.actual_orders,
      utilization_pct = EXCLUDED.utilization_pct,
      updated_at = NOW();
  END IF;

  -- Upsert alert for 120% threshold
  IF v_utilization_pct >= 120 THEN
    INSERT INTO capacity_alerts (
      operator_id, client_id, alert_date, threshold_pct,
      actual_orders, daily_capacity, utilization_pct
    ) VALUES (
      NEW.operator_id, NEW.tenant_client_id, NEW.delivery_date, 120,
      v_actual_orders, v_daily_capacity, v_utilization_pct
    )
    ON CONFLICT (operator_id, client_id, alert_date, threshold_pct)
    DO UPDATE SET
      actual_orders = EXCLUDED.actual_orders,
      utilization_pct = EXCLUDED.utilization_pct,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_orders_capacity_alert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION check_capacity_and_alert();

-- ── get_forecast_accuracy RPC ─────────────────────────────────
-- Returns per-retailer forecast accuracy over a date range.
-- Uses a CTE to pre-aggregate orders per capacity row, avoiding
-- the illegal pattern of nesting aggregates (COUNT inside AVG).

CREATE OR REPLACE FUNCTION get_forecast_accuracy(
  p_operator_id UUID,
  p_date_from DATE,
  p_date_to DATE
) RETURNS TABLE (
  client_id UUID,
  retailer_name VARCHAR,
  avg_variance_pct NUMERIC,
  accuracy_score NUMERIC,
  days_measured BIGINT
) AS $$
  WITH daily_counts AS (
    SELECT
      rdc.client_id,
      tc.name AS retailer_name,
      rdc.capacity_date,
      rdc.daily_capacity,
      COUNT(o.id) AS actual_orders
    FROM retailer_daily_capacities rdc
    JOIN tenant_clients tc ON tc.id = rdc.client_id
    LEFT JOIN orders o ON o.operator_id = rdc.operator_id
      AND o.tenant_client_id = rdc.client_id
      AND o.delivery_date = rdc.capacity_date
      AND o.deleted_at IS NULL
    WHERE rdc.operator_id = p_operator_id
      AND rdc.capacity_date BETWEEN p_date_from AND p_date_to
      AND rdc.deleted_at IS NULL
      AND rdc.capacity_date <= CURRENT_DATE
    GROUP BY rdc.client_id, tc.name, rdc.capacity_date, rdc.daily_capacity
  )
  SELECT
    client_id,
    retailer_name,
    ROUND(AVG(
      ABS(actual_orders::NUMERIC - daily_capacity)
      / NULLIF(daily_capacity, 0) * 100
    ), 1) AS avg_variance_pct,
    ROUND(100 - AVG(
      ABS(actual_orders::NUMERIC - daily_capacity)
      / NULLIF(daily_capacity, 0) * 100
    ), 1) AS accuracy_score,
    COUNT(DISTINCT capacity_date) AS days_measured
  FROM daily_counts
  GROUP BY client_id, retailer_name;
$$ LANGUAGE sql STABLE;
