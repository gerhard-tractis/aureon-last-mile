-- Migration: Fix dock-scan trigger CASE → enum cast
-- Created: 2026-05-06
-- Problem:
--   trg_dock_scan_advance_package_status updates packages.status with a
--   CASE expression whose branches are unknown-type string literals. The
--   CASE result is typed as text, but packages.status is package_status_enum.
--   Postgres does NOT implicitly cast text → enum, so every insert into
--   dock_scans that reaches the UPDATE fails with:
--     ERROR 42804: column "status" is of type package_status_enum but
--                  expression is of type text
--   This surfaced in production via the manager manual-assign UI
--   (useManualDockAssignment), which now actually hits this trigger path
--   thanks to migration 20260504000002.
-- Fix:
--   Add an explicit ::public.package_status_enum cast on the CASE result.
-- Template: latest definition from 20260504000002_fix_manual_dock_assignment.sql
-- Dependencies:
--   - 20260319000001_create_distribution_tables.sql (function origin)
--   - 20260504000002_fix_manual_dock_assignment.sql (current definition)
--   - 20260313000001_epic5_enum_migration.sql (package_status_enum type)

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
      SET status            = (CASE WHEN v_is_consolidation THEN 'retenido' ELSE 'sectorizado' END)::public.package_status_enum,
          dock_zone_id      = v_dock_zone_id,
          status_updated_at = NOW()
      WHERE id = NEW.package_id;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- Validation: ensure the function exists and parses
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'trg_dock_scan_advance_package_status'
  ) THEN
    RAISE EXCEPTION 'Function trg_dock_scan_advance_package_status missing after CREATE OR REPLACE';
  END IF;
END $$;
