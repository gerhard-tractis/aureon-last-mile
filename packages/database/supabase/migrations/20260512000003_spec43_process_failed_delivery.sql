-- =============================================================
-- Spec-43: process_failed_delivery RPC
--
-- Called by n8n when DispatchTrack fires status 3 (rejected) or 4 (partial).
-- Moves all non-terminal packages on the order to retorno_hub and records the
-- failure reason. The recalculate_order_status trigger (Migration 2) derives the
-- new orders.status (en_retorno or parcialmente_entregado) from the resulting
-- package mix — this RPC does NOT update orders.status directly.
--
-- Idempotency: if the order is already in a return state (en_retorno or
-- parcialmente_entregado), the RPC returns skipped: true to prevent stale
-- replays from dragging re-dispatched packages back to retorno_hub.
--
-- Partial delivery note (status 4): DT does not provide package-level granularity,
-- so ALL non-terminal packages are moved to retorno_hub for both status 3 and 4.
-- The en_retorno vs parcialmente_entregado distinction is derived by the trigger
-- based on whether any entregado packages already exist on the order.
-- =============================================================

CREATE OR REPLACE FUNCTION process_failed_delivery(
  p_order_number    TEXT,
  p_dt_status       INT,        -- 3 = rejected, 4 = partial
  p_substatus       TEXT,
  p_substatus_code  TEXT,
  p_operator_id     UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_order_id          UUID;
  v_current_status    order_status_enum;
  v_returning_count   INT;
BEGIN
  IF p_dt_status NOT IN (3, 4) THEN
    RETURN jsonb_build_object('error', 'unsupported_dt_status');
  END IF;

  -- Resolve and lock the order row so concurrent webhooks serialise.
  SELECT id, status
    INTO v_order_id, v_current_status
  FROM orders
  WHERE order_number = p_order_number
    AND operator_id  = p_operator_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'order_not_found');
  END IF;

  -- Idempotency / duplicate-webhook short-circuit.
  -- If the order is already in a return state, do nothing — the original
  -- webhook already moved every non-terminal package to retorno_hub and we
  -- don't want to drag en_bodega/en_ruta packages (from a subsequent
  -- re-dispatch cycle) back into retorno_hub on a stale replay.
  IF v_current_status IN ('en_retorno', 'parcialmente_entregado') THEN
    SELECT COUNT(*) INTO v_returning_count
    FROM packages
    WHERE order_id   = v_order_id
      AND status     = 'retorno_hub'
      AND deleted_at IS NULL;

    RETURN jsonb_build_object(
      'order_id',        v_order_id,
      'returning_count', v_returning_count,
      'skipped',         true
    );
  END IF;

  -- Move all non-terminal packages to retorno_hub.
  -- The recalculate_order_status trigger (Migration 2) will derive the new
  -- orders.status (en_retorno or parcialmente_entregado) from the resulting
  -- package mix — we do NOT update orders.status here.
  UPDATE packages
  SET status             = 'retorno_hub',
      return_reason      = p_substatus,
      return_reason_code = p_substatus_code,
      status_updated_at  = NOW(),
      updated_at         = NOW()
  WHERE order_id   = v_order_id
    AND status NOT IN ('entregado', 'cancelado', 'devuelto', 'dañado', 'extraviado', 'retorno_hub')
    AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_returning_count
  FROM packages
  WHERE order_id   = v_order_id
    AND status     = 'retorno_hub'
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'order_id',        v_order_id,
    'returning_count', v_returning_count,
    'skipped',         false
  );
END;
$$;
