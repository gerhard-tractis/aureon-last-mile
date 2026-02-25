-- Migration: Create Metrics Calculation Functions
-- Created: 2026-02-24
-- Story: 3.1 - Create Performance Metrics Tables and Calculation Logic
-- Epic: 3 - Performance Dashboard
-- Purpose: Create calculate_sla, calculate_fadr, get_failure_reasons, and
--          calculate_daily_metrics database functions.
-- Dependencies:
--   - 20260224000001_create_performance_metrics_tables.sql (delivery_attempts, performance_metrics)

-- ============================================================================
-- PART 1: calculate_sla — SLA percentage from pre-aggregated metrics
-- ============================================================================
-- Returns (delivered_orders / total_orders * 100) for a date range.
-- Uses SECURITY INVOKER so RLS filters by operator automatically.

CREATE OR REPLACE FUNCTION public.calculate_sla(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC(5,2)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT ROUND(
    SUM(delivered_orders)::NUMERIC / NULLIF(SUM(total_orders), 0) * 100,
    2
  )
  FROM public.performance_metrics
  WHERE operator_id = p_operator_id
    AND metric_date >= p_start_date
    AND metric_date <= p_end_date
    AND retailer_name IS NULL
    AND deleted_at IS NULL;
$$;

COMMENT ON FUNCTION public.calculate_sla(UUID, DATE, DATE) IS 'Calculate SLA percentage (delivered/total*100) from pre-aggregated metrics. Returns NULL if no orders.';

-- ============================================================================
-- PART 2: calculate_fadr — First Attempt Delivery Rate
-- ============================================================================
-- Returns (first_attempt_deliveries / total_orders * 100) for a date range.

CREATE OR REPLACE FUNCTION public.calculate_fadr(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC(5,2)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT ROUND(
    SUM(first_attempt_deliveries)::NUMERIC / NULLIF(SUM(total_orders), 0) * 100,
    2
  )
  FROM public.performance_metrics
  WHERE operator_id = p_operator_id
    AND metric_date >= p_start_date
    AND metric_date <= p_end_date
    AND retailer_name IS NULL
    AND deleted_at IS NULL;
$$;

COMMENT ON FUNCTION public.calculate_fadr(UUID, DATE, DATE) IS 'Calculate First Attempt Delivery Rate (FADR) percentage from pre-aggregated metrics. Returns NULL if no orders.';

-- ============================================================================
-- PART 3: get_failure_reasons — JSON array of failure reason breakdown
-- ============================================================================
-- Queries delivery_attempts directly for row-level detail.

CREATE OR REPLACE FUNCTION public.get_failure_reasons(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH failure_counts AS (
    SELECT
      COALESCE(failure_reason, 'Unknown') AS reason,
      COUNT(*) AS count
    FROM public.delivery_attempts
    WHERE operator_id = p_operator_id
      AND attempted_at >= p_start_date::TIMESTAMPTZ
      AND attempted_at < (p_end_date + INTERVAL '1 day')::TIMESTAMPTZ
      AND status = 'failed'
      AND deleted_at IS NULL
    GROUP BY failure_reason
  ),
  total AS (
    SELECT COALESCE(SUM(count), 0) AS total_failures FROM failure_counts
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'reason', fc.reason,
        'count', fc.count,
        'percentage', ROUND(fc.count::NUMERIC / NULLIF(t.total_failures, 0) * 100, 2)
      )
      ORDER BY fc.count DESC
    ),
    '[]'::jsonb
  )
  FROM failure_counts fc
  CROSS JOIN total t;
$$;

COMMENT ON FUNCTION public.get_failure_reasons(UUID, DATE, DATE) IS 'Get failure reasons breakdown as JSON array [{reason, count, percentage}]. Queries delivery_attempts directly.';

-- ============================================================================
-- PART 4: calculate_daily_metrics — Nightly cron aggregation target
-- ============================================================================
-- Aggregates from orders + delivery_attempts into performance_metrics via upsert.
-- SECURITY DEFINER because pg_cron runs as postgres (no JWT context).

CREATE OR REPLACE FUNCTION public.calculate_daily_metrics(p_date DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator RECORD;
  v_retailer RECORD;
  v_metrics RECORD;
BEGIN
  -- Loop over all operators
  FOR v_operator IN
    SELECT id FROM public.operators WHERE deleted_at IS NULL
  LOOP
    -- Per-retailer breakdown
    FOR v_retailer IN
      SELECT DISTINCT retailer_name
      FROM public.orders
      WHERE operator_id = v_operator.id
        AND delivery_date = p_date
        AND deleted_at IS NULL
        AND retailer_name IS NOT NULL
    LOOP
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.delivery_attempts da
          WHERE da.order_id = o.id AND da.status = 'success' AND da.deleted_at IS NULL
        )) AS delivered,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.delivery_attempts da
          WHERE da.order_id = o.id AND da.status = 'success' AND da.attempt_number = 1 AND da.deleted_at IS NULL
        )) AS first_attempt,
        COUNT(*) FILTER (WHERE
          EXISTS (
            SELECT 1 FROM public.delivery_attempts da
            WHERE da.order_id = o.id AND da.status = 'failed' AND da.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.delivery_attempts da
            WHERE da.order_id = o.id AND da.status = 'success' AND da.deleted_at IS NULL
          )
        ) AS failed
      INTO v_metrics
      FROM public.orders o
      WHERE o.operator_id = v_operator.id
        AND o.delivery_date = p_date
        AND o.retailer_name = v_retailer.retailer_name
        AND o.deleted_at IS NULL;

      INSERT INTO public.performance_metrics (
        operator_id, metric_date, retailer_name,
        total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries,
        shortage_claims_count, shortage_claims_amount_clp, avg_delivery_time_minutes
      ) VALUES (
        v_operator.id, p_date, v_retailer.retailer_name,
        v_metrics.total, v_metrics.delivered, v_metrics.first_attempt, v_metrics.failed,
        0, 0, NULL  -- shortage_claims and avg_delivery_time: no source data yet (future stories)
      )
      ON CONFLICT (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))
      DO UPDATE SET
        total_orders = EXCLUDED.total_orders,
        delivered_orders = EXCLUDED.delivered_orders,
        first_attempt_deliveries = EXCLUDED.first_attempt_deliveries,
        failed_deliveries = EXCLUDED.failed_deliveries,
        -- Preserve shortage/time values if previously set by another process
        shortage_claims_count = performance_metrics.shortage_claims_count,
        shortage_claims_amount_clp = performance_metrics.shortage_claims_amount_clp,
        avg_delivery_time_minutes = performance_metrics.avg_delivery_time_minutes,
        updated_at = NOW();
    END LOOP;

    -- Aggregate row (retailer_name = NULL → all retailers combined)
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.delivery_attempts da
        WHERE da.order_id = o.id AND da.status = 'success' AND da.deleted_at IS NULL
      )) AS delivered,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.delivery_attempts da
        WHERE da.order_id = o.id AND da.status = 'success' AND da.attempt_number = 1 AND da.deleted_at IS NULL
      )) AS first_attempt,
      COUNT(*) FILTER (WHERE
        EXISTS (
          SELECT 1 FROM public.delivery_attempts da
          WHERE da.order_id = o.id AND da.status = 'failed' AND da.deleted_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.delivery_attempts da
          WHERE da.order_id = o.id AND da.status = 'success' AND da.deleted_at IS NULL
        )
      ) AS failed
    INTO v_metrics
    FROM public.orders o
    WHERE o.operator_id = v_operator.id
      AND o.delivery_date = p_date
      AND o.deleted_at IS NULL;

    -- Only insert aggregate if there are orders for this operator on this date
    IF v_metrics.total > 0 THEN
      INSERT INTO public.performance_metrics (
        operator_id, metric_date, retailer_name,
        total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries,
        shortage_claims_count, shortage_claims_amount_clp, avg_delivery_time_minutes
      ) VALUES (
        v_operator.id, p_date, NULL,
        v_metrics.total, v_metrics.delivered, v_metrics.first_attempt, v_metrics.failed,
        0, 0, NULL  -- shortage_claims and avg_delivery_time: no source data yet (future stories)
      )
      ON CONFLICT (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))
      DO UPDATE SET
        total_orders = EXCLUDED.total_orders,
        delivered_orders = EXCLUDED.delivered_orders,
        first_attempt_deliveries = EXCLUDED.first_attempt_deliveries,
        failed_deliveries = EXCLUDED.failed_deliveries,
        -- Preserve shortage/time values if previously set by another process
        shortage_claims_count = performance_metrics.shortage_claims_count,
        shortage_claims_amount_clp = performance_metrics.shortage_claims_amount_clp,
        avg_delivery_time_minutes = performance_metrics.avg_delivery_time_minutes,
        updated_at = NOW();
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.calculate_daily_metrics(DATE) IS 'Nightly cron target: aggregates orders + delivery_attempts into performance_metrics via upsert. SECURITY DEFINER for pg_cron context.';

-- ============================================================================
-- PART 5: Function Permissions
-- ============================================================================

-- User-facing functions: revoke public, grant to authenticated
REVOKE EXECUTE ON FUNCTION public.calculate_sla(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.calculate_fadr(UUID, DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_failure_reasons(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_sla(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_fadr(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_failure_reasons(UUID, DATE, DATE) TO authenticated;

-- calculate_daily_metrics is internal-only (cron) and SECURITY DEFINER — must revoke from PUBLIC
REVOKE EXECUTE ON FUNCTION public.calculate_daily_metrics(DATE) FROM PUBLIC;

-- ============================================================================
-- PART 6: Validation
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_sla') THEN
    RAISE EXCEPTION 'Function calculate_sla not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_fadr') THEN
    RAISE EXCEPTION 'Function calculate_fadr not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_failure_reasons') THEN
    RAISE EXCEPTION 'Function get_failure_reasons not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_daily_metrics') THEN
    RAISE EXCEPTION 'Function calculate_daily_metrics not created!';
  END IF;

  RAISE NOTICE '✓ Story 3.1 migration 2/3 validation complete';
  RAISE NOTICE '  Functions: calculate_sla, calculate_fadr, get_failure_reasons, calculate_daily_metrics';
  RAISE NOTICE '  Permissions: authenticated can execute SLA/FADR/failure_reasons; daily_metrics is internal-only';
END $$;
