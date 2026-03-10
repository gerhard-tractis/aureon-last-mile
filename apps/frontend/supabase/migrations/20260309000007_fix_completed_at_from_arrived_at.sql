-- Migration: Backfill completed_at on delivered dispatches where time_of_management was absent
-- Root cause: DispatchTrack webhooks do not send time_of_management — they send arrived_at instead.
--             The webhook handler mapped time_of_management ?? null, silently producing
--             status='delivered' rows with completed_at IS NULL. The OTIF on-time calculation
--             requires completed_at, so these deliveries were excluded from on_time_deliveries
--             even though they were legitimate same-day deliveries.
-- Fix: Backfill completed_at from raw_data->>'arrived_at' for all affected rows.
-- Webhook fix: completed_at now falls back to arrived_at when time_of_management is absent.

UPDATE public.dispatches
SET
  completed_at = (raw_data->>'arrived_at')::timestamptz,
  updated_at   = NOW()
WHERE status      = 'delivered'
  AND completed_at IS NULL
  AND raw_data->>'arrived_at' IS NOT NULL
  AND deleted_at IS NULL;

-- Validation: confirm no delivered dispatches remain with null completed_at
-- (those with no arrived_at either are genuinely unresolvable and logged below)
DO $$
DECLARE
  v_fixed        INT;
  v_unresolvable INT;
BEGIN
  SELECT COUNT(*) INTO v_fixed
  FROM public.dispatches
  WHERE status      = 'delivered'
    AND completed_at IS NOT NULL
    AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_unresolvable
  FROM public.dispatches
  WHERE status      = 'delivered'
    AND completed_at IS NULL
    AND deleted_at IS NULL;

  RAISE NOTICE '✓ completed_at backfill complete';
  RAISE NOTICE '  Delivered dispatches with completed_at: %', v_fixed;
  RAISE NOTICE '  Delivered dispatches still missing completed_at (no arrived_at in payload): %', v_unresolvable;

  IF v_unresolvable > 0 THEN
    RAISE WARNING '% delivered dispatch(es) still have completed_at IS NULL — no arrived_at in raw_data. Review manually.', v_unresolvable;
  END IF;
END $$;
