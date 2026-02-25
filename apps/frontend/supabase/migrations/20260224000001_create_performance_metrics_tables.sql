-- Migration: Create Performance Metrics Tables
-- Created: 2026-02-24
-- Story: 3.1 - Create Performance Metrics Tables and Calculation Logic
-- Epic: 3 - Performance Dashboard
-- Purpose: Create delivery_attempts and performance_metrics tables with ENUMs,
--          indexes, RLS policies, audit triggers, and validation.
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260216170542_create_users_table_with_rbac.sql (operators table)
--   - 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql (audit_trigger_func)
--   - 20260217000003_create_orders_table.sql (orders table)
--   - 20260223000001_create_automation_worker_schema.sql (set_updated_at function)

-- ============================================================================
-- PART 1: Create ENUM Types (idempotent)
-- ============================================================================

-- delivery_attempt_status_enum: Status of a delivery attempt
DO $$ BEGIN
  CREATE TYPE delivery_attempt_status_enum AS ENUM (
    'success',   -- Delivered successfully
    'failed',    -- Delivery attempt failed
    'returned'   -- Package returned to sender
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE delivery_attempt_status_enum IS 'Delivery attempt outcome status for Story 3.1 performance metrics';

-- ============================================================================
-- PART 2: Create delivery_attempts Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_id        UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  attempt_number  INT NOT NULL,
  status          delivery_attempt_status_enum NOT NULL,
  failure_reason  VARCHAR(100),
  attempted_at    TIMESTAMPTZ NOT NULL,
  driver_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

COMMENT ON TABLE  public.delivery_attempts IS 'Records each delivery attempt per order for performance tracking and FADR calculation.';
COMMENT ON COLUMN public.delivery_attempts.operator_id     IS 'Tenant identifier for multi-tenant isolation';
COMMENT ON COLUMN public.delivery_attempts.attempt_number  IS 'Sequential attempt number (1 = first attempt, used for FADR)';
COMMENT ON COLUMN public.delivery_attempts.failure_reason  IS 'Reason for failure (NULL on success). Used in get_failure_reasons aggregation.';
COMMENT ON COLUMN public.delivery_attempts.driver_id       IS 'Optional reference to driver who made the attempt';
COMMENT ON COLUMN public.delivery_attempts.deleted_at      IS 'Soft delete timestamp (7-year compliance)';

-- ============================================================================
-- PART 3: Create performance_metrics Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.performance_metrics (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id                 UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  metric_date                 DATE NOT NULL,
  retailer_name               VARCHAR(50),
  total_orders                INT NOT NULL DEFAULT 0,
  delivered_orders            INT NOT NULL DEFAULT 0,
  first_attempt_deliveries    INT NOT NULL DEFAULT 0,
  failed_deliveries           INT NOT NULL DEFAULT 0,
  shortage_claims_count       INT NOT NULL DEFAULT 0,
  shortage_claims_amount_clp  NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_delivery_time_minutes   NUMERIC(8,2),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

COMMENT ON TABLE  public.performance_metrics IS 'Pre-aggregated daily performance metrics per operator (optionally per retailer). Populated by nightly pg_cron job.';
COMMENT ON COLUMN public.performance_metrics.retailer_name              IS 'Retailer name filter. NULL = all-retailer aggregate row.';
COMMENT ON COLUMN public.performance_metrics.shortage_claims_amount_clp IS 'Shortage claims total in Chilean Pesos (CLP)';
COMMENT ON COLUMN public.performance_metrics.deleted_at                 IS 'Soft delete timestamp (7-year compliance)';

-- ============================================================================
-- PART 4: Create Unique Functional Index (NULL-safe)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_perf_metrics_unique_daily
  ON public.performance_metrics (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'));

-- ============================================================================
-- PART 5: Create Indexes
-- ============================================================================

-- delivery_attempts indexes
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_operator_id ON public.delivery_attempts(operator_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_order_id ON public.delivery_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_attempted_at ON public.delivery_attempts(attempted_at);

-- performance_metrics indexes
CREATE INDEX IF NOT EXISTS idx_performance_metrics_operator_id ON public.performance_metrics(operator_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_metric_date ON public.performance_metrics(metric_date);

-- ============================================================================
-- PART 6: Enable RLS + Create Tenant Isolation Policies
-- ============================================================================

-- delivery_attempts RLS
ALTER TABLE public.delivery_attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "delivery_attempts_tenant_isolation" ON public.delivery_attempts
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "delivery_attempts_tenant_select" ON public.delivery_attempts
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- performance_metrics RLS
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "performance_metrics_tenant_isolation" ON public.performance_metrics
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "performance_metrics_tenant_select" ON public.performance_metrics
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 7: GRANT/REVOKE Permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_metrics TO authenticated;
REVOKE ALL ON public.delivery_attempts FROM anon;
REVOKE ALL ON public.performance_metrics FROM anon;

-- ============================================================================
-- PART 8: Attach Audit Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER audit_delivery_attempts_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TRIGGER audit_delivery_attempts_changes ON public.delivery_attempts IS 'Audit trigger: Logs all delivery_attempts changes to audit_logs table';

DO $$ BEGIN
  CREATE TRIGGER audit_performance_metrics_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.performance_metrics
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TRIGGER audit_performance_metrics_changes ON public.performance_metrics IS 'Audit trigger: Logs all performance_metrics changes to audit_logs table';

-- ============================================================================
-- PART 9: Attach set_updated_at() Trigger to performance_metrics
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER set_performance_metrics_updated_at
    BEFORE UPDATE ON public.performance_metrics
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TRIGGER set_performance_metrics_updated_at ON public.performance_metrics IS 'Auto-update updated_at on row modification';

-- ============================================================================
-- PART 10: Migration Validation
-- ============================================================================

DO $$
BEGIN
  -- 1. Verify ENUM
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_attempt_status_enum') THEN
    RAISE EXCEPTION 'ENUM delivery_attempt_status_enum not created!';
  END IF;

  -- 2. Verify delivery_attempts table + RLS
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'delivery_attempts') THEN
    RAISE EXCEPTION 'Table public.delivery_attempts not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'delivery_attempts' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.delivery_attempts!';
  END IF;

  -- 3. Verify performance_metrics table + RLS
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'performance_metrics') THEN
    RAISE EXCEPTION 'Table public.performance_metrics not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'performance_metrics' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.performance_metrics!';
  END IF;

  -- 4. Verify unique index
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'performance_metrics' AND indexname = 'idx_perf_metrics_unique_daily') THEN
    RAISE EXCEPTION 'Unique index idx_perf_metrics_unique_daily not found!';
  END IF;

  -- 5. Verify indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_delivery_attempts_operator_id') THEN
    RAISE EXCEPTION 'Index idx_delivery_attempts_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_delivery_attempts_order_id') THEN
    RAISE EXCEPTION 'Index idx_delivery_attempts_order_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_delivery_attempts_attempted_at') THEN
    RAISE EXCEPTION 'Index idx_delivery_attempts_attempted_at not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_operator_id') THEN
    RAISE EXCEPTION 'Index idx_performance_metrics_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_performance_metrics_metric_date') THEN
    RAISE EXCEPTION 'Index idx_performance_metrics_metric_date not found!';
  END IF;

  -- 6. Verify triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_delivery_attempts_changes') THEN
    RAISE EXCEPTION 'Trigger audit_delivery_attempts_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_performance_metrics_changes') THEN
    RAISE EXCEPTION 'Trigger audit_performance_metrics_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_performance_metrics_updated_at') THEN
    RAISE EXCEPTION 'Trigger set_performance_metrics_updated_at not found!';
  END IF;

  RAISE NOTICE '✓ Story 3.1 migration 1/3 validation complete';
  RAISE NOTICE '  ENUM: delivery_attempt_status_enum';
  RAISE NOTICE '  Tables: delivery_attempts, performance_metrics';
  RAISE NOTICE '  RLS enabled on both tables with tenant isolation policies';
  RAISE NOTICE '  Indexes: 5 standard + 1 unique functional';
  RAISE NOTICE '  Triggers: 2 audit + 1 set_updated_at';
END $$;
