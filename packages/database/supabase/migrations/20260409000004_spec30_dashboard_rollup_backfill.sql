-- Migration: spec-30 backfill dashboard_monthly_rollup from all historical performance_metrics
-- Created: 2026-04-09
-- Idempotent: ON CONFLICT DO UPDATE in calculate_dashboard_monthly_rollup()

DO $$
DECLARE
  v_min_year  INT;
  v_min_month INT;
  v_cur_year  INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_cur_month INT := EXTRACT(MONTH FROM CURRENT_DATE)::INT;
  v_y         INT;
  v_m         INT;
BEGIN
  -- Find earliest month in performance_metrics
  SELECT
    EXTRACT(YEAR FROM MIN(metric_date))::INT,
    EXTRACT(MONTH FROM MIN(metric_date))::INT
  INTO v_min_year, v_min_month
  FROM public.performance_metrics
  WHERE deleted_at IS NULL;

  IF v_min_year IS NULL THEN
    RAISE NOTICE 'No performance_metrics rows found — skipping backfill';
    RETURN;
  END IF;

  v_y := v_min_year;
  v_m := v_min_month;

  WHILE (v_y < v_cur_year) OR (v_y = v_cur_year AND v_m <= v_cur_month) LOOP
    PERFORM public.calculate_dashboard_monthly_rollup(v_y, v_m);

    -- Advance to next month
    IF v_m = 12 THEN
      v_y := v_y + 1;
      v_m := 1;
    ELSE
      v_m := v_m + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '✓ dashboard_monthly_rollup backfill complete';
END $$;
