-- Migration: spec-30 dashboard rollup aggregation function + nightly cron
-- Created: 2026-04-09
-- Purpose: Nightly aggregation of performance_metrics into dashboard_monthly_rollup.
--          Scheduled via pg_cron if available; otherwise caller must invoke manually.

CREATE OR REPLACE FUNCTION public.calculate_dashboard_monthly_rollup(p_year INT, p_month INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.dashboard_monthly_rollup (
    operator_id, period_year, period_month,
    otif_pct, total_orders, delivered_orders, failed_orders,
    computed_at, source_daily_rows
  )
  SELECT
    pm.operator_id,
    p_year, p_month,
    ROUND(100.0 * SUM(pm.delivered_orders) / NULLIF(SUM(pm.total_orders), 0), 2),
    SUM(pm.total_orders),
    SUM(pm.delivered_orders),
    SUM(pm.failed_deliveries),
    NOW(),
    COUNT(*)
  FROM public.performance_metrics pm
  WHERE EXTRACT(YEAR FROM pm.metric_date) = p_year
    AND EXTRACT(MONTH FROM pm.metric_date) = p_month
    AND pm.retailer_name IS NULL   -- aggregate row only
    AND pm.deleted_at IS NULL
  GROUP BY pm.operator_id
  ON CONFLICT (operator_id, period_year, period_month)
  DO UPDATE SET
    otif_pct         = EXCLUDED.otif_pct,
    total_orders     = EXCLUDED.total_orders,
    delivered_orders = EXCLUDED.delivered_orders,
    failed_orders    = EXCLUDED.failed_orders,
    computed_at      = EXCLUDED.computed_at,
    source_daily_rows = EXCLUDED.source_daily_rows,
    updated_at       = NOW();
END;
$$;

-- ============================================================================
-- Nightly cron — wrap in DO block to survive environments without pg_cron
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'dashboard_monthly_rollup',
      '30 2 * * *',
      $$SELECT public.calculate_dashboard_monthly_rollup(
          EXTRACT(YEAR FROM CURRENT_DATE)::INT,
          EXTRACT(MONTH FROM CURRENT_DATE)::INT
        )$$
    );
    RAISE NOTICE '✓ dashboard_monthly_rollup cron scheduled';
  ELSE
    RAISE NOTICE 'pg_cron not available — skipping cron schedule';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Cron schedule skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- Validation
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'calculate_dashboard_monthly_rollup'
  ) THEN
    RAISE EXCEPTION 'Function calculate_dashboard_monthly_rollup not found!';
  END IF;
  RAISE NOTICE '✓ calculate_dashboard_monthly_rollup function created';
END $$;
