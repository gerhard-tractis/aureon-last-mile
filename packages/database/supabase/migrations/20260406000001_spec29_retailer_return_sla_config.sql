-- =============================================================================
-- Migration: 20260406000001_spec29_retailer_return_sla_config.sql
-- Description: Spec-29 — per-retailer return-to-retail SLA configuration.
--   Read by the Ops Control Mission Deck "Devoluciones" stage.
--   Table order:
--   1. retailer_return_sla_config — per-operator, per-retailer SLA hours
--   2. Index on operator_id (active rows only)
--   3. RLS — service_role + authenticated tenant isolation
--   4. updated_at trigger
-- =============================================================================

-- ============================================================================
-- 1. CREATE retailer_return_sla_config
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.retailer_return_sla_config (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID        NOT NULL REFERENCES public.operators(id),
  retailer_id   TEXT        NOT NULL,
  retailer_name TEXT        NOT NULL,
  sla_hours     INTEGER     NOT NULL CHECK (sla_hours > 0),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (operator_id, retailer_id)
);

COMMENT ON TABLE public.retailer_return_sla_config IS
  'Per-retailer return SLA in hours. Consumed by the Ops Control Mission Deck Devoluciones stage.';

COMMENT ON COLUMN public.retailer_return_sla_config.retailer_id IS
  'External retailer identifier (e.g. ERP code). Unique per operator.';
COMMENT ON COLUMN public.retailer_return_sla_config.sla_hours IS
  'Maximum hours allowed to complete a return to this retailer. Must be > 0.';

-- ============================================================================
-- 2. INDEX
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_rrsc_operator
  ON public.retailer_return_sla_config(operator_id)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE public.retailer_return_sla_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "rrsc_service_role" ON public.retailer_return_sla_config
    TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "rrsc_authenticated_read" ON public.retailer_return_sla_config
    FOR SELECT TO authenticated
    USING (operator_id = (SELECT operator_id FROM public.users WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.retailer_return_sla_config TO authenticated;
REVOKE ALL ON public.retailer_return_sla_config FROM anon;
GRANT ALL ON public.retailer_return_sla_config TO service_role;

-- ============================================================================
-- 4. updated_at TRIGGER
-- ============================================================================
DROP TRIGGER IF EXISTS set_updated_at_rrsc ON public.retailer_return_sla_config;
CREATE TRIGGER set_updated_at_rrsc
  BEFORE UPDATE ON public.retailer_return_sla_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
