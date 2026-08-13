-- Performance metrics schema test suite
-- Story: 3.1 — Performance Metrics Tables and Calculation Logic
--
-- REWRITTEN 2026-08-13. The first half of this file (old TESTS 1-14 and 21)
-- asserted the existence of the `delivery_attempts` table, the
-- `delivery_attempt_status_enum` type, their indexes, FKs, RLS and audit
-- trigger. All of those objects were deliberately removed on 2026-03-06 by
-- 20260306000001_add_routes_dispatches_fleet_tables.sql, which backfilled the
-- rows into public.dispatches and then ran:
--
--     DROP TABLE IF EXISTS public.delivery_attempts CASCADE;   -- step 10d
--     DROP TYPE  IF EXISTS delivery_attempt_status_enum;       -- step 10e
--
-- The test was never updated, so it asserted a schema that had not existed for
-- five months. Those assertions are gone; TEST 0 below replaces them with the
-- inverse invariant, which is the one that still has value: the old objects
-- must stay dead, and the replacement must be present.
--
-- The file also had no BEGIN/ROLLBACK. It is read-only (catalog inspection),
-- but it is now wrapped anyway so the whole directory has one shape.

BEGIN;

-- =============================================================================
-- TEST 0: the delivery_attempts era is over and stays over
-- =============================================================================
-- Guards against an old migration being re-applied out of order and
-- resurrecting the dropped objects — the exact drift scripts/pgtap-local.sh
-- documents in its `apply` ledger.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'delivery_attempts') THEN
    RAISE EXCEPTION 'TEST 0 FAILED: public.delivery_attempts is back — it was dropped by 20260306000001 in favour of public.dispatches';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status_enum') THEN
    RAISE EXCEPTION 'TEST 0 FAILED: delivery_attempt_status_enum is back — dispatch_status_enum replaces it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dispatches') THEN
    RAISE EXCEPTION 'TEST 0 FAILED: public.dispatches, the replacement for delivery_attempts, is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_status_enum') THEN
    RAISE EXCEPTION 'TEST 0 FAILED: dispatch_status_enum is missing';
  END IF;
  RAISE NOTICE 'TEST 0 PASSED: delivery_attempts/delivery_attempt_status_enum stay dropped; dispatches/dispatch_status_enum present';
END $$;

-- TEST 15: performance_metrics table exists with all required columns
-- =============================================================================

DO $$
DECLARE
  v_col RECORD;
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'metric_date', 'retailer_name',
    'total_orders', 'delivered_orders', 'first_attempt_deliveries',
    'failed_deliveries', 'shortage_claims_count', 'shortage_claims_amount_clp',
    'avg_delivery_time_minutes', 'created_at', 'updated_at', 'deleted_at'
  ];
  col TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'performance_metrics') THEN
    RAISE EXCEPTION 'TEST 15 FAILED: Table performance_metrics not found';
  END IF;

  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'performance_metrics' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 15 FAILED: performance_metrics.% column not found', col;
    END IF;
  END LOOP;

  -- Check metric_date is DATE type
  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_name = 'performance_metrics' AND column_name = 'metric_date';
  IF v_col.data_type != 'date' THEN
    RAISE EXCEPTION 'TEST 15 FAILED: performance_metrics.metric_date expected date, got %', v_col.data_type;
  END IF;

  -- Check shortage_claims_amount_clp is numeric
  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_name = 'performance_metrics' AND column_name = 'shortage_claims_amount_clp';
  IF v_col.data_type != 'numeric' THEN
    RAISE EXCEPTION 'TEST 15 FAILED: shortage_claims_amount_clp expected numeric, got %', v_col.data_type;
  END IF;

  RAISE NOTICE 'TEST 15 PASSED: performance_metrics table exists with all columns and correct types';
END $$;

-- =============================================================================
-- TEST 16: RLS enabled on performance_metrics
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'performance_metrics' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 16 FAILED: RLS not enabled on performance_metrics';
  END IF;
  RAISE NOTICE 'TEST 16 PASSED: RLS enabled on performance_metrics';
END $$;

-- =============================================================================
-- TEST 17: Unique index idx_perf_metrics_unique_daily exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_perf_metrics_unique_daily') THEN
    RAISE EXCEPTION 'TEST 17 FAILED: idx_perf_metrics_unique_daily not found';
  END IF;
  RAISE NOTICE 'TEST 17 PASSED: idx_perf_metrics_unique_daily exists';
END $$;

-- =============================================================================
-- TEST 18: Index idx_performance_metrics_operator_id exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_operator_id') THEN
    RAISE EXCEPTION 'TEST 18 FAILED: idx_performance_metrics_operator_id not found';
  END IF;
  RAISE NOTICE 'TEST 18 PASSED: idx_performance_metrics_operator_id exists';
END $$;

-- =============================================================================
-- TEST 19: Index idx_performance_metrics_metric_date exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_metric_date') THEN
    RAISE EXCEPTION 'TEST 19 FAILED: idx_performance_metrics_metric_date not found';
  END IF;
  RAISE NOTICE 'TEST 19 PASSED: idx_performance_metrics_metric_date exists';
END $$;

-- =============================================================================
-- TEST 20: set_performance_metrics_updated_at trigger exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_performance_metrics_updated_at') THEN
    RAISE EXCEPTION 'TEST 20 FAILED: set_performance_metrics_updated_at trigger not found';
  END IF;
  RAISE NOTICE 'TEST 20 PASSED: set_performance_metrics_updated_at trigger exists';
END $$;

-- =============================================================================
-- TEST 22: audit_performance_metrics_changes trigger exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_performance_metrics_changes') THEN
    RAISE EXCEPTION 'TEST 22 FAILED: audit_performance_metrics_changes trigger not found';
  END IF;
  RAISE NOTICE 'TEST 22 PASSED: audit_performance_metrics_changes trigger exists';
END $$;

-- =============================================================================
-- TEST 23: calculate_sla function exists and returns numeric
-- =============================================================================

DO $$
DECLARE
  v_ret TEXT;
BEGIN
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_ret
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'calculate_sla';

  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST 23 FAILED: function calculate_sla not found';
  END IF;
  IF v_ret != 'numeric' THEN
    RAISE EXCEPTION 'TEST 23 FAILED: calculate_sla expected return numeric, got %', v_ret;
  END IF;
  RAISE NOTICE 'TEST 23 PASSED: calculate_sla function exists and returns numeric';
END $$;

-- =============================================================================
-- TEST 24: calculate_fadr function exists and returns numeric
-- =============================================================================

DO $$
DECLARE
  v_ret TEXT;
BEGIN
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_ret
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'calculate_fadr';

  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST 24 FAILED: function calculate_fadr not found';
  END IF;
  IF v_ret != 'numeric' THEN
    RAISE EXCEPTION 'TEST 24 FAILED: calculate_fadr expected return numeric, got %', v_ret;
  END IF;
  RAISE NOTICE 'TEST 24 PASSED: calculate_fadr function exists and returns numeric';
END $$;

-- =============================================================================
-- TEST 25: get_failure_reasons is GONE (spec-30 cleanup)
-- =============================================================================
-- This slot used to assert get_failure_reasons(UUID,DATE,DATE) exists. It was
-- dropped on 2026-04-09 by 20260409000012_spec30_drop_legacy_dashboard_rpcs.sql
-- along with nine other legacy dashboard RPCs, superseded by the spec-30 RPCs.
-- Asserting its absence keeps the slot honest and catches a resurrection.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_failure_reasons'
  ) THEN
    RAISE EXCEPTION 'TEST 25 FAILED: get_failure_reasons is back — 20260409000012 dropped it as a legacy dashboard RPC';
  END IF;
  RAISE NOTICE 'TEST 25 PASSED: legacy get_failure_reasons stays dropped';
END $$;

-- =============================================================================
-- TEST 26: calculate_daily_metrics function exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'calculate_daily_metrics'
  ) THEN
    RAISE EXCEPTION 'TEST 26 FAILED: function calculate_daily_metrics not found';
  END IF;
  RAISE NOTICE 'TEST 26 PASSED: calculate_daily_metrics function exists';
END $$;

-- =============================================================================
-- TEST 27: pg_cron extension is enabled (skipped gracefully if unavailable)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'TEST 27 SKIPPED: pg_cron extension not available in this environment';
    RETURN;
  END IF;
  RAISE NOTICE 'TEST 27 PASSED: pg_cron extension is enabled';
END $$;

-- =============================================================================
-- TEST 28: Cron job nightly-metrics exists (skipped gracefully if pg_cron unavailable)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'TEST 28 SKIPPED: pg_cron not available, cannot verify cron job';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-metrics') THEN
    RAISE EXCEPTION 'TEST 28 FAILED: cron job nightly-metrics not found';
  END IF;
  RAISE NOTICE 'TEST 28 PASSED: cron job nightly-metrics is scheduled';
END $$;

ROLLBACK;
