-- Migration: spec-30 drop legacy dashboard RPCs
-- Created: 2026-04-09
-- Purpose: Remove old dashboard RPCs made redundant by spec-30 new RPCs.
--          Safe to run after spec-30 frontend deployment (legacy pages deleted).

DROP FUNCTION IF EXISTS public.get_otif_metrics(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_otif_by_retailer(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_fadr_metric(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_customer_performance(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_failure_reasons(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_late_deliveries(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_orders_detail(UUID, DATE, DATE, TEXT, TEXT, TEXT, BOOLEAN, INT, INT);
DROP FUNCTION IF EXISTS public.get_pending_orders_summary(UUID);
DROP FUNCTION IF EXISTS public.get_daily_orders_by_client(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_committed_orders_daily(UUID, DATE, DATE);

DO $$
BEGIN
  RAISE NOTICE '✓ Legacy dashboard RPCs dropped (spec-30 cleanup)';
END $$;
