-- ============================================================================
-- Migration: add sort_order column to dock_zones for manual reordering
-- Purpose:   Operators want to control the display order of andenes in the
--            distribution view (currently sorted alphabetically by name).
-- ============================================================================

ALTER TABLE public.dock_zones
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- Backfill existing rows so the initial order matches what users see today
-- (alphabetical within each operator). Without this, every existing zone
-- would have sort_order = 0 and would tie-break unpredictably.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY operator_id ORDER BY is_consolidation DESC, name) * 10 AS new_order
  FROM public.dock_zones
  WHERE deleted_at IS NULL
)
UPDATE public.dock_zones dz
SET    sort_order = n.new_order
FROM   numbered n
WHERE  dz.id = n.id
  AND  dz.sort_order = 0;

-- Multiplying by 10 leaves gaps so future inserts can be placed between
-- existing rows without renumbering everything.

CREATE INDEX IF NOT EXISTS idx_dock_zones_operator_sort
  ON public.dock_zones (operator_id, sort_order)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.dock_zones.sort_order IS
  'Display order within an operator (ascending). Tiebreak by name. New rows get 0 by default; UI assigns a real position on creation.';

-- Validation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public' AND table_name = 'dock_zones' AND column_name = 'sort_order'
  ) THEN
    RAISE EXCEPTION 'sort_order column not added to dock_zones';
  END IF;
  RAISE NOTICE '✓ dock_zones.sort_order column added and backfilled';
END $$;
