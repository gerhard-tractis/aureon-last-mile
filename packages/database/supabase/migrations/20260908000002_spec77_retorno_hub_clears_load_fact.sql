-- =============================================================================
-- spec-77 fix — retorno_hub blocker: complete_return_reception_scan must
-- clear the stale load fact on the package it moves back to en_bodega.
--
-- 20260908000001 added a global predicate to get_pre_route_snapshot's
-- ready_pkgs: a package with `loaded_at IS NOT NULL AND load_inferred =
-- false` never counts as available, regardless of order. That predicate is
-- correct on its own — it is what stops a force_split order's
-- already-shipped half from reappearing as "ready" — but nothing on the
-- OTHER path that produces a stale loaded_at, the return-from-failed-
-- delivery path, ever cleared it:
--
--   - process_failed_delivery (20260512000003) writes packages.status =
--     'retorno_hub' only.
--   - complete_return_reception_scan (20260512000006) writes packages.status
--     = 'en_bodega' only.
--   - trg_dock_scan_advance_package_status (20260506000001) writes
--     status/dock_zone_id/status_updated_at only.
--
-- So a box that travelled on a route, failed delivery, came back, was
-- re-received, and was re-dock-scanned arrives at `sectorizado` with its
-- ORIGINAL loaded_at from the completed route still set and
-- load_inferred = false — and 20260908000001's predicate now excludes it
-- from Pre-Ruta permanently, because nothing ever clears the fact. If it
-- was the order's only live package, the whole order drops out. This is
-- spec-43's re-route flow (retorno_hub), and it is dead without this fix.
--
-- Where the clear belongs: `SCANNABLE_STATUSES` in
-- apps/frontend/src/lib/distribution/dock-scan-validator.ts is
-- `['en_bodega', 'sectorizado']` — a retorno_hub package can only ever
-- reach `sectorizado` again by first passing through
-- complete_return_reception_scan (`retorno_hub` -> `en_bodega`). That RPC is
-- therefore the single, guaranteed choke point on the return path,
-- mirroring the two "remove from plan" endpoints
-- (routes/[id]/packages/[pkgId]/route.ts, routes/[id]/route.ts) that
-- already clear loaded_at/loaded_by/load_inferred when a box leaves a
-- route's plan. A box coming back from a failed delivery is not loaded on
-- anything either — same fact, same reset, same place in spirit.
-- process_failed_delivery and the dock-scan trigger are left untouched:
-- ready_pkgs already excludes `retorno_hub`/`en_bodega` by status, so a
-- stale loaded_at is inert until the package reaches a ready_pkgs status —
-- which cannot happen without this RPC running first.
--
-- Template: 20260512000006 (the function's only prior definition — no
-- later migration touched it; confirmed via
-- `git grep -l complete_return_reception_scan
-- packages/database/supabase/migrations/`). Only the UPDATE's SET list
-- changes.
-- =============================================================================

BEGIN;

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
  --
  -- spec-77 fix: loaded_at/loaded_by/load_inferred reset here too. A box
  -- coming back from a failed delivery is not loaded on anything — leaving
  -- the stale fact from the completed route would make
  -- get_pre_route_snapshot's ready_pkgs predicate (20260908000001) hide it
  -- from Pre-Ruta forever once it is re-dock-scanned to sectorizado.
  UPDATE packages
  SET status            = 'en_bodega',
      status_updated_at = NOW(),
      updated_at        = NOW(),
      loaded_at         = NULL,
      loaded_by         = NULL,
      load_inferred     = false
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

-- ============================================================================
-- Validation: the replaced function must still exist and parse
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'complete_return_reception_scan'
  ) THEN
    RAISE EXCEPTION 'Function complete_return_reception_scan missing after CREATE OR REPLACE';
  END IF;
END $$;

COMMIT;
