-- Migration: Fix manual dock assignment (spec-39 follow-up)
-- Created: 2026-05-04
-- Problem:
--   useManualDockAssignment inserts into dock_scans without a batch_id, but the
--   column was NOT NULL.  It also passes dock_zone_id, which the table didn't have.
--   Both issues caused the insert to fail silently, so clicking a dock in the ⋯ menu
--   appeared to do nothing.
-- Fix:
--   1. Drop NOT NULL from dock_scans.batch_id (manual overrides have no batch).
--   2. Add dock_scans.dock_zone_id so manual-override rows can record their target
--      zone directly (no batch join needed).
--   3. Update trg_dock_scan_advance_package_status to handle both paths:
--      - manual_override = TRUE  → read zone from NEW.dock_zone_id
--      - manual_override = FALSE → read zone via batch join (unchanged behaviour)
-- Dependencies:
--   - 20260319000001_create_distribution_tables.sql (dock_scans, dock_batches, dock_zones)
--   - 20260428000006_spec39_dock_verifications_and_redirect.sql (manual_override column)

-- ============================================================================
-- PART 1: Make batch_id nullable
-- ============================================================================

ALTER TABLE public.dock_scans
  ALTER COLUMN batch_id DROP NOT NULL;

COMMENT ON COLUMN public.dock_scans.batch_id IS
  'NULL for manager manual-override rows (manual_override = TRUE). NOT NULL for scanner-based scans.';

-- ============================================================================
-- PART 2: Add dock_zone_id to dock_scans
-- ============================================================================

ALTER TABLE public.dock_scans
  ADD COLUMN IF NOT EXISTS dock_zone_id UUID REFERENCES public.dock_zones(id);

CREATE INDEX IF NOT EXISTS idx_dock_scans_dock_zone_id
  ON public.dock_scans (dock_zone_id)
  WHERE dock_zone_id IS NOT NULL;

COMMENT ON COLUMN public.dock_scans.dock_zone_id IS
  'Target zone for manual-override rows. Derived from batch for normal scans.';

-- ============================================================================
-- PART 3: Update trigger to handle manual overrides
-- Requirement: when manual_override = TRUE, use NEW.dock_zone_id directly.
-- When manual_override = FALSE, keep the existing batch → zone join path.
-- Template: latest definition from 20260319000001_create_distribution_tables.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_dock_scan_advance_package_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_consolidation BOOLEAN;
  v_dock_zone_id UUID;
BEGIN
  IF NEW.scan_result = 'accepted' AND NEW.package_id IS NOT NULL THEN

    IF NEW.manual_override = TRUE AND NEW.dock_zone_id IS NOT NULL THEN
      -- Manual-override path: zone is stored directly on the row
      SELECT id, is_consolidation
      INTO v_dock_zone_id, v_is_consolidation
      FROM public.dock_zones
      WHERE id = NEW.dock_zone_id;
    ELSIF NEW.batch_id IS NOT NULL THEN
      -- Normal scan path: look up target zone via batch
      SELECT dz.id, dz.is_consolidation
      INTO v_dock_zone_id, v_is_consolidation
      FROM public.dock_batches db
      JOIN public.dock_zones dz ON dz.id = db.dock_zone_id
      WHERE db.id = NEW.batch_id;

      -- Increment batch package_count (only for batch-bound scans)
      UPDATE public.dock_batches
      SET package_count = package_count + 1
      WHERE id = NEW.batch_id;
    ELSE
      -- No zone info available — skip
      RETURN NEW;
    END IF;

    IF v_dock_zone_id IS NOT NULL THEN
      UPDATE public.packages
      SET status           = CASE WHEN v_is_consolidation THEN 'retenido' ELSE 'sectorizado' END,
          dock_zone_id     = v_dock_zone_id,
          status_updated_at = NOW()
      WHERE id = NEW.package_id;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- PART 4: Validation
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dock_scans' AND column_name = 'dock_zone_id'
  ) THEN
    RAISE EXCEPTION 'Column dock_scans.dock_zone_id not added!';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dock_scans'
      AND column_name = 'batch_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'dock_scans.batch_id is still NOT NULL after migration!';
  END IF;
END $$;
