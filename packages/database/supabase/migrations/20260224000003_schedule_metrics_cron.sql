-- Migration: Schedule Nightly Metrics Cron Job
-- Created: 2026-02-24
-- Story: 3.1 - Create Performance Metrics Tables and Calculation Logic
-- Epic: 3 - Performance Dashboard
-- Purpose: Enable pg_cron extension and schedule nightly metrics aggregation at 2:00 AM UTC.
-- Dependencies:
--   - 20260224000002_create_metrics_functions.sql (calculate_daily_metrics function)
-- Note: pg_cron may not be available in local dev environments. This migration
--       handles that gracefully with a DO block that catches errors.

-- ============================================================================
-- PART 1: Enable pg_cron Extension + Schedule Nightly Metrics Job
-- ============================================================================
-- Wrapped in DO block so local dev environments without pg_cron don't fail.
-- On Supabase production, pg_cron is available and this succeeds normally.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

  -- Runs at 2:00 AM UTC daily, calculates yesterday's metrics for all operators.
  -- cron.schedule is idempotent when job name matches (updates existing).
  PERFORM cron.schedule(
    'nightly-metrics',
    '0 2 * * *',
    'SELECT public.calculate_daily_metrics(CURRENT_DATE - INTERVAL ''1 day'')'
  );

  RAISE NOTICE '✓ Story 3.1 migration 3/3: pg_cron enabled, nightly-metrics job scheduled at 0 2 * * * (2:00 AM UTC)';
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '⚠ pg_cron not available in this environment (%). Cron job not scheduled — must be configured manually in production.', SQLERRM;
END $$;
