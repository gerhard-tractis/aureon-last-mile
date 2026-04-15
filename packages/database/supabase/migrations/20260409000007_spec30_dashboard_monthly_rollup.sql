-- Migration: spec-30 dashboard_monthly_rollup table
-- Created: 2026-04-09
-- Purpose: Pre-aggregated monthly rollup for C-level dashboard north-stars.
--          One row per operator per month. Populated nightly by calculate_dashboard_monthly_rollup().

CREATE TABLE IF NOT EXISTS public.dashboard_monthly_rollup (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  period_year         INT NOT NULL CHECK (period_year BETWEEN 2020 AND 2100),
  period_month        INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  -- North stars (nullable → placeholder; future specs populate)
  cpo_clp             NUMERIC(12,2),     -- cost per order in CLP
  otif_pct            NUMERIC(5,2),      -- 0..100
  nps_score           NUMERIC(5,2),      -- -100..100
  csat_pct            NUMERIC(5,2),      -- 0..100

  -- Always populated
  total_orders        INT NOT NULL DEFAULT 0,
  delivered_orders    INT NOT NULL DEFAULT 0,
  failed_orders       INT NOT NULL DEFAULT 0,

  -- Provenance
  computed_at         TIMESTAMPTZ NOT NULL,
  source_daily_rows   INT NOT NULL DEFAULT 0,

  -- Standard
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  UNIQUE (operator_id, period_year, period_month)
);

ALTER TABLE public.dashboard_monthly_rollup ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_monthly_rollup_tenant_isolation
  ON public.dashboard_monthly_rollup
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE INDEX idx_dashboard_rollup_operator_period
  ON public.dashboard_monthly_rollup(operator_id, period_year DESC, period_month DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER set_dashboard_monthly_rollup_updated_at
  BEFORE UPDATE ON public.dashboard_monthly_rollup
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Validation
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'dashboard_monthly_rollup'
  ) THEN
    RAISE EXCEPTION 'Table dashboard_monthly_rollup not found!';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'dashboard_monthly_rollup'
      AND policyname = 'dashboard_monthly_rollup_tenant_isolation'
  ) THEN
    RAISE EXCEPTION 'RLS policy dashboard_monthly_rollup_tenant_isolation not found!';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'dashboard_monthly_rollup'
      AND indexname = 'idx_dashboard_rollup_operator_period'
  ) THEN
    RAISE EXCEPTION 'Index idx_dashboard_rollup_operator_period not found!';
  END IF;
  RAISE NOTICE '✓ dashboard_monthly_rollup table created with RLS and index';
END $$;
