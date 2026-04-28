-- ============================================================================
-- Migration: re-backfill dock_zones.sort_order using code instead of name
-- Purpose:   The initial backfill in 20260428000002 ordered zones by name —
--            but operator names like "Andén 1", "Andén 10", "Andén 2" sort
--            alphabetically, not numerically. Codes ("DOCK-001",
--            "DOCK-002", "DOCK-010") have zero-padded suffixes, so sorting
--            by code gives the natural numeric order users expect.
--
-- Operator's manual reorderings (if any) WILL be overwritten by this. The
-- user explicitly asked for "sort by dock id" as the initial state, so this
-- is the desired behaviour. They can still use the up/down buttons in the UI
-- afterwards.
-- ============================================================================

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY operator_id
      ORDER BY is_consolidation DESC, code
    ) * 10 AS new_order
  FROM public.dock_zones
  WHERE deleted_at IS NULL
)
UPDATE public.dock_zones dz
SET    sort_order = n.new_order
FROM   numbered n
WHERE  dz.id = n.id;

-- Validation
DO $$
DECLARE
  v_zero_count INT;
BEGIN
  SELECT COUNT(*) INTO v_zero_count
  FROM   public.dock_zones
  WHERE  deleted_at IS NULL AND sort_order = 0;

  IF v_zero_count > 0 THEN
    RAISE WARNING 'Found % dock_zones with sort_order = 0 after re-backfill (expected 0)', v_zero_count;
  ELSE
    RAISE NOTICE '✓ dock_zones.sort_order re-backfilled by code; no zones at 0';
  END IF;
END $$;
