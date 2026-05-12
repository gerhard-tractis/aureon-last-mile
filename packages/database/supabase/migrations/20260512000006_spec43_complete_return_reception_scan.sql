-- =============================================================
-- Spec-43: complete_return_reception_scan RPC
--
-- Called once per successful barcode scan in the Retornos tab of the Reception Hub.
-- Moves the scanned package from retorno_hub back to en_bodega so the delivery
-- pipeline can restart. Records the scan in return_reception_scans and increments
-- received_count on the session.
--
-- Order status is NOT updated directly here — the recalculate_order_status trigger
-- (Migration 2) fires on the packages UPDATE and derives the correct order status:
--   - Partway through a route: order stays in en_retorno / parcialmente_entregado
--   - Last retorno_hub package received: order naturally transitions to en_bodega
--     (or en_bodega + leading_status=entregado in the partial delivery case)
--
-- return_reason / return_reason_code are intentionally preserved on the package
-- record as audit history of why it returned.
--
-- Concurrency: uses FOR UPDATE OF o to serialise concurrent scans on the same
-- order so two simultaneous "last package" scans cannot both observe remaining = 0.
-- =============================================================

CREATE OR REPLACE FUNCTION complete_return_reception_scan(
  p_package_id          UUID,
  p_return_reception_id UUID,
  p_scanned_by          UUID,
  p_barcode             TEXT,
  p_operator_id         UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_order_id          UUID;
  v_remaining_count   INT;
  v_new_order_status  order_status_enum;
BEGIN
  -- Validate package and lock its order row so concurrent scans on the same
  -- order serialise (prevents two scans both observing remaining = 0 from a
  -- stale read of orders.status).
  SELECT p.order_id INTO v_order_id
  FROM packages p
  JOIN orders   o ON o.id = p.order_id
  WHERE p.id          = p_package_id
    AND p.operator_id = p_operator_id
    AND p.status      = 'retorno_hub'
    AND p.deleted_at IS NULL
  FOR UPDATE OF o;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found_or_wrong_status');
  END IF;

  -- Move package back to active pipeline; the trigger updates orders.status.
  -- return_reason / return_reason_code are intentionally preserved on the
  -- package record as audit history of why it returned.
  UPDATE packages
  SET status            = 'en_bodega',
      status_updated_at = NOW(),
      updated_at        = NOW()
  WHERE id = p_package_id;

  -- Record scan.
  INSERT INTO return_reception_scans
    (return_reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
  VALUES
    (p_return_reception_id, p_package_id, p_operator_id, p_scanned_by, p_barcode, 'received', NOW());

  -- Increment received_count on the session.
  UPDATE return_receptions
  SET received_count = received_count + 1,
      updated_at     = NOW()
  WHERE id = p_return_reception_id;

  -- Re-read state derived by the trigger.
  SELECT COUNT(*) INTO v_remaining_count
  FROM packages
  WHERE order_id   = v_order_id
    AND status     = 'retorno_hub'
    AND deleted_at IS NULL;

  SELECT status INTO v_new_order_status
  FROM orders
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'package_id',       p_package_id,
    'order_id',         v_order_id,
    'order_promoted',   v_remaining_count = 0,
    'order_status',     v_new_order_status,
    'remaining',        v_remaining_count
  );
END;
$$;
