-- =============================================================================
-- spec-51 — repair orders wrongly cancelled by the pipeline_position bug
-- =============================================================================
-- Companion to 20260810000001, which fixed the cause. This repairs the rows the
-- bug already created. It MUST run after that migration, because the repair
-- re-fires trg_recalculate_order_status and relies on the corrected
-- pipeline_position().
--
-- WHAT WENT WRONG
--   POST /api/dispatch/routes/[id]/close set every en_carga package on a route
--   to 'listo_para_despacho'. pipeline_position() did not recognise that value
--   and returned 0, so recalculate_order_status() saw an order with no active
--   packages and set it to 'cancelado'.
--
-- WHY THE REPAIR IS NARROW
--   "cancelado with active packages" is NOT by itself a bug signature. The
--   beetrack-webhook edge function writes orders.status = 'cancelado' directly
--   for failed and partial DispatchTrack dispatches, bypassing the trigger and
--   leaving packages wherever they were (typically 'en_ruta'). Repairing on
--   "has active packages" would silently un-cancel genuinely failed deliveries.
--
--   The bug's signature is specific: EVERY non-deleted package on the order sits
--   at 'listo_para_despacho'. An order in that state never dispatched, so the
--   webhook cannot have cancelled it, and no other code path sets an order to
--   cancelado while leaving its packages staged.
--
-- HOW IT REPAIRS
--   By re-firing the trigger (UPDATE packages SET status = status), not by
--   writing orders.status. The canonical derivation decides the outcome, so
--   this migration cannot invent a status the trigger would not produce.
--   Idempotent: after the first run these orders no longer match the predicate.
-- =============================================================================

DO $$
DECLARE
  v_affected  INT;
  v_repaired  INT;
BEGIN
  CREATE TEMP TABLE spec51_wrongly_cancelled ON COMMIT DROP AS
  SELECT o.id, o.operator_id, o.order_number
  FROM public.orders o
  WHERE o.status = 'cancelado'
    AND o.deleted_at IS NULL
    -- has at least one live package ...
    AND EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.order_id = o.id AND p.deleted_at IS NULL
    )
    -- ... and every one of them is staged for dispatch
    AND NOT EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.order_id = o.id
        AND p.deleted_at IS NULL
        AND p.status <> 'listo_para_despacho'
    );

  SELECT count(*) INTO v_affected FROM spec51_wrongly_cancelled;

  IF v_affected = 0 THEN
    RAISE NOTICE 'spec51 repair: no wrongly cancelled orders found — nothing to do.';
    RETURN;
  END IF;

  RAISE NOTICE 'spec51 repair: % order(s) match the bug signature', v_affected;

  -- Touch the packages so trg_recalculate_order_status re-derives each order.
  -- The trigger fires on UPDATE OF status regardless of whether the value
  -- actually changed, so assigning the same value is enough.
  UPDATE public.packages p
  SET status = p.status
  WHERE p.deleted_at IS NULL
    AND p.order_id IN (SELECT id FROM spec51_wrongly_cancelled);

  SELECT count(*) INTO v_repaired
  FROM public.orders o
  JOIN spec51_wrongly_cancelled w ON w.id = o.id
  WHERE o.status = 'listo_para_despacho';

  RAISE NOTICE 'spec51 repair: % order(s) now listo_para_despacho', v_repaired;

  IF v_repaired <> v_affected THEN
    RAISE WARNING
      'spec51 repair: expected % repaired, got % — inspect the remainder before assuming success',
      v_affected, v_repaired;
  END IF;
END $$;
