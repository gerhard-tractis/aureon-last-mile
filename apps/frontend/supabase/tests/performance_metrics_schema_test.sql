-- Performance Metrics Schema Test Suite
-- Story: 3.1 - Create Performance Metrics Tables and Calculation Logic
-- Date: 2026-02-24
-- Purpose: Verify delivery_attempts, performance_metrics tables, ENUMs, indexes,
--          RLS, FKs, triggers, functions, and cron job exist with correct structure.
-- Target: 28 assertion blocks

-- =============================================================================
-- TEST 1: delivery_attempt_status_enum exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status_enum') THEN
    RAISE EXCEPTION 'TEST 1 FAILED: ENUM delivery_attempt_status_enum not found';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: delivery_attempt_status_enum ENUM exists';
END $$;

-- =============================================================================
-- TEST 2: delivery_attempt_status_enum has exactly 3 values
-- =============================================================================

DO $$
DECLARE
  v_count INT;
  v_values TEXT[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
  INTO v_values
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'delivery_attempt_status_enum';

  IF v_values IS NULL OR array_length(v_values, 1) != 3 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected 3 enum values, got %', array_length(v_values, 1);
  END IF;
  IF v_values != ARRAY['success', 'failed', 'returned'] THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected {success,failed,returned}, got %', v_values;
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: delivery_attempt_status_enum has correct values (success, failed, returned)';
END $$;

-- =============================================================================
-- TEST 3: delivery_attempts table exists with all columns and correct types
-- =============================================================================

DO $$
DECLARE
  v_col RECORD;
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'order_id', 'attempt_number', 'status',
    'failure_reason', 'attempted_at', 'driver_id', 'created_at', 'deleted_at'
  ];
  col TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'delivery_attempts') THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Table delivery_attempts not found';
  END IF;

  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'delivery_attempts' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 3 FAILED: delivery_attempts.% column not found', col;
    END IF;
  END LOOP;

  -- Check specific column types
  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'id';
  IF v_col.data_type != 'uuid' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: delivery_attempts.id expected uuid, got %', v_col.data_type;
  END IF;

  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'attempt_number';
  IF v_col.data_type != 'integer' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: delivery_attempts.attempt_number expected integer, got %', v_col.data_type;
  END IF;

  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'status';
  IF v_col.data_type != 'USER-DEFINED' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: delivery_attempts.status expected USER-DEFINED (enum), got %', v_col.data_type;
  END IF;

  SELECT data_type INTO v_col FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'failure_reason';
  IF v_col.data_type != 'character varying' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: delivery_attempts.failure_reason expected varchar, got %', v_col.data_type;
  END IF;

  RAISE NOTICE 'TEST 3 PASSED: delivery_attempts table exists with all columns and correct types';
END $$;

-- =============================================================================
-- TEST 4: delivery_attempts.operator_id is NOT NULL
-- =============================================================================

DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'operator_id';
  IF v_nullable != 'NO' THEN
    RAISE EXCEPTION 'TEST 4 FAILED: delivery_attempts.operator_id should be NOT NULL';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: delivery_attempts.operator_id is NOT NULL';
END $$;

-- =============================================================================
-- TEST 5: delivery_attempts.order_id is NOT NULL
-- =============================================================================

DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'order_id';
  IF v_nullable != 'NO' THEN
    RAISE EXCEPTION 'TEST 5 FAILED: delivery_attempts.order_id should be NOT NULL';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: delivery_attempts.order_id is NOT NULL';
END $$;

-- =============================================================================
-- TEST 6: delivery_attempts.attempted_at is NOT NULL
-- =============================================================================

DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'attempted_at';
  IF v_nullable != 'NO' THEN
    RAISE EXCEPTION 'TEST 6 FAILED: delivery_attempts.attempted_at should be NOT NULL';
  END IF;
  RAISE NOTICE 'TEST 6 PASSED: delivery_attempts.attempted_at is NOT NULL';
END $$;

-- =============================================================================
-- TEST 7: delivery_attempts.failure_reason is nullable
-- =============================================================================

DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'failure_reason';
  IF v_nullable != 'YES' THEN
    RAISE EXCEPTION 'TEST 7 FAILED: delivery_attempts.failure_reason should be nullable';
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: delivery_attempts.failure_reason is nullable';
END $$;

-- =============================================================================
-- TEST 8: delivery_attempts.deleted_at is nullable (soft delete)
-- =============================================================================

DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
  WHERE table_name = 'delivery_attempts' AND column_name = 'deleted_at';
  IF v_nullable != 'YES' THEN
    RAISE EXCEPTION 'TEST 8 FAILED: delivery_attempts.deleted_at should be nullable';
  END IF;
  RAISE NOTICE 'TEST 8 PASSED: delivery_attempts.deleted_at is nullable (soft delete)';
END $$;

-- =============================================================================
-- TEST 9: RLS enabled on delivery_attempts
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'delivery_attempts' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 9 FAILED: RLS not enabled on delivery_attempts';
  END IF;
  RAISE NOTICE 'TEST 9 PASSED: RLS enabled on delivery_attempts';
END $$;

-- =============================================================================
-- TEST 10: FK delivery_attempts → orders(id) exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'delivery_attempts' AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%order_id%'
  ) THEN
    RAISE EXCEPTION 'TEST 10 FAILED: FK to orders(id) not found on delivery_attempts';
  END IF;
  RAISE NOTICE 'TEST 10 PASSED: FK delivery_attempts → orders(id) exists';
END $$;

-- =============================================================================
-- TEST 11: FK delivery_attempts → operators(id) exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'delivery_attempts' AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%operator_id%'
  ) THEN
    RAISE EXCEPTION 'TEST 11 FAILED: FK to operators(id) not found on delivery_attempts';
  END IF;
  RAISE NOTICE 'TEST 11 PASSED: FK delivery_attempts → operators(id) exists';
END $$;

-- =============================================================================
-- TEST 12: Index idx_delivery_attempts_operator_id exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_delivery_attempts_operator_id') THEN
    RAISE EXCEPTION 'TEST 12 FAILED: idx_delivery_attempts_operator_id not found';
  END IF;
  RAISE NOTICE 'TEST 12 PASSED: idx_delivery_attempts_operator_id exists';
END $$;

-- =============================================================================
-- TEST 13: Index idx_delivery_attempts_order_id exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_delivery_attempts_order_id') THEN
    RAISE EXCEPTION 'TEST 13 FAILED: idx_delivery_attempts_order_id not found';
  END IF;
  RAISE NOTICE 'TEST 13 PASSED: idx_delivery_attempts_order_id exists';
END $$;

-- =============================================================================
-- TEST 14: Index idx_delivery_attempts_attempted_at exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_delivery_attempts_attempted_at') THEN
    RAISE EXCEPTION 'TEST 14 FAILED: idx_delivery_attempts_attempted_at not found';
  END IF;
  RAISE NOTICE 'TEST 14 PASSED: idx_delivery_attempts_attempted_at exists';
END $$;

-- =============================================================================
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
-- TEST 21: audit_delivery_attempts_changes trigger exists
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_delivery_attempts_changes') THEN
    RAISE EXCEPTION 'TEST 21 FAILED: audit_delivery_attempts_changes trigger not found';
  END IF;
  RAISE NOTICE 'TEST 21 PASSED: audit_delivery_attempts_changes trigger exists';
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
-- TEST 25: get_failure_reasons function exists and returns jsonb
-- =============================================================================

DO $$
DECLARE
  v_ret TEXT;
BEGIN
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_ret
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_failure_reasons';

  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST 25 FAILED: function get_failure_reasons not found';
  END IF;
  IF v_ret != 'jsonb' THEN
    RAISE EXCEPTION 'TEST 25 FAILED: get_failure_reasons expected return jsonb, got %', v_ret;
  END IF;
  RAISE NOTICE 'TEST 25 PASSED: get_failure_reasons function exists and returns jsonb';
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
