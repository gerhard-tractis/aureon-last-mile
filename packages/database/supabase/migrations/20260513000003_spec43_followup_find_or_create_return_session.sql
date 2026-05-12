-- =============================================================
-- Spec-43 follow-up: find_or_create_return_reception RPC
--
-- Atomic find-or-create for a return reception session, plus a refreshed
-- expected_count. The old hook ran SELECT-then-INSERT and never refreshed
-- expected_count after the initial insert, so:
--   1. Two receptionists opening the same route simultaneously could both
--      try to insert (now blocked at the DB by uq_return_receptions_open_per_route,
--      but we still need a clean caller-side fallback).
--   2. expected_count stayed frozen at the value snapshotted when the
--      session was first opened. If a re-attempted route triggers another
--      DT status-3 webhook, new packages enter retorno_hub for the same
--      external_route_id but expected_count doesn't move — making
--      received_count > expected_count reachable.
--
-- This RPC takes pg_advisory_xact_lock keyed on (operator_id, external_route_id)
-- so concurrent callers serialise, recomputes expected_count from the live
-- retorno_hub state, and either returns the existing open session (after
-- UPDATEing its expected_count) or inserts a new one.
-- =============================================================

CREATE OR REPLACE FUNCTION find_or_create_return_reception(
  p_operator_id        UUID,
  p_external_route_id  TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_session_id      UUID;
  v_status          hub_reception_status_enum;
  v_expected_count  INT;
  v_received_count  INT;
  v_now             TIMESTAMPTZ := NOW();
BEGIN
  -- Serialise concurrent find-or-create for the same route within this txn.
  -- hashtextextended gives us a stable bigint from the composite key.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_operator_id::text || '|' || p_external_route_id, 0)
  );

  -- Recompute expected_count from the live state (count packages currently
  -- in retorno_hub whose most-recent dispatch points at this external_route_id).
  WITH latest_dispatch AS (
    SELECT DISTINCT ON (d.order_id)
      d.order_id, d.external_route_id, d.route_id
    FROM dispatches d
    LEFT JOIN routes r ON r.id = d.route_id
    WHERE d.operator_id = p_operator_id
      AND d.deleted_at IS NULL
    ORDER BY d.order_id, d.created_at DESC
  )
  SELECT COUNT(*)
    INTO v_expected_count
  FROM packages p
  LEFT JOIN latest_dispatch ld ON ld.order_id = p.order_id
  LEFT JOIN routes r ON r.id = ld.route_id
  WHERE p.operator_id = p_operator_id
    AND p.status      = 'retorno_hub'
    AND p.deleted_at IS NULL
    AND COALESCE(ld.external_route_id, r.external_route_id) = p_external_route_id;

  -- Try existing open session first.
  SELECT id, status, received_count
    INTO v_session_id, v_status, v_received_count
  FROM return_receptions
  WHERE operator_id        = p_operator_id
    AND external_route_id  = p_external_route_id
    AND status IN ('pending', 'in_progress')
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_session_id IS NOT NULL THEN
    -- Keep expected_count in sync with the live state. We bump it to the max
    -- of (recomputed live, current value) so it never decreases below what
    -- the receptionist has already observed.
    UPDATE return_receptions
       SET expected_count = GREATEST(expected_count, v_expected_count + received_count),
           updated_at     = v_now
     WHERE id = v_session_id
     RETURNING expected_count, received_count
        INTO v_expected_count, v_received_count;

    RETURN jsonb_build_object(
      'id',                v_session_id,
      'operator_id',       p_operator_id,
      'external_route_id', p_external_route_id,
      'status',            v_status,
      'expected_count',    v_expected_count,
      'received_count',    v_received_count,
      'created',           false
    );
  END IF;

  -- No open session — create one.
  INSERT INTO return_receptions
    (operator_id, external_route_id, status, started_at, expected_count, received_count)
  VALUES
    (p_operator_id, p_external_route_id, 'in_progress', v_now, v_expected_count, 0)
  RETURNING id, status, expected_count, received_count
       INTO v_session_id, v_status, v_expected_count, v_received_count;

  RETURN jsonb_build_object(
    'id',                v_session_id,
    'operator_id',       p_operator_id,
    'external_route_id', p_external_route_id,
    'status',            v_status,
    'expected_count',    v_expected_count,
    'received_count',    v_received_count,
    'created',           true
  );
END;
$$;

COMMENT ON FUNCTION find_or_create_return_reception(UUID, TEXT) IS
  'Atomically returns the open return_receptions row for (operator_id, external_route_id) — creating it if none exists and refreshing expected_count from the live retorno_hub package count for the route. Serialises concurrent callers via pg_advisory_xact_lock.';
