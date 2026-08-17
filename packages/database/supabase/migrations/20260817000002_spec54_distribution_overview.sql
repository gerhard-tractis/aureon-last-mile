-- =============================================================================
-- spec-54 — get_distribution_overview: the Distribución landing (mock 3d)
--
-- Three numbers on that screen have no existing source, and all three come off
-- the same two tables, so they travel together in one call rather than three:
--
--   lotes            dock_batches still open, and when one was last closed
--   ritmo            dock_scans in the last hour — the shift's actual pace
--   operarios        who is scanning right now, where, and how much
--
-- Everything else the screen needs already has a hook (useDistributionKPIs,
-- useDockZones, useSectorizedByZone, useUnmatchedComunas) and is not duplicated
-- here.
--
-- Returns jsonb rather than a table because `operators` is a nested list; the
-- shape mirrors get_ops_control_snapshot, which does the same for the same
-- reason.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_distribution_overview(
  p_operator_id UUID
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    -- A lote is open while an operator is still filling that andén.
    'open_batches', COALESCE((
      SELECT COUNT(*) FROM dock_batches b
      WHERE b.operator_id = p_operator_id
        AND b.deleted_at IS NULL
        AND b.status = 'open'
    ), 0),

    'last_closed_at', (
      SELECT MAX(b.closed_at) FROM dock_batches b
      WHERE b.operator_id = p_operator_id
        AND b.deleted_at IS NULL
        AND b.status = 'closed'
    ),

    -- Packages actually sorted today, counted from the scans rather than from
    -- package status: status is the current state, and a package that moved on
    -- afterwards would stop being counted for a shift it was part of.
    'sorted_today', COALESCE((
      SELECT COUNT(*) FROM dock_scans s
      WHERE s.operator_id = p_operator_id
        AND s.deleted_at IS NULL
        AND s.scan_result = 'accepted'
        AND s.scanned_at >= date_trunc('day', NOW())
    ), 0),

    -- Pace over the trailing hour, which is what the floor lead is judging:
    -- "are we keeping up right now", not "what was the daily average".
    'pace_per_hour', COALESCE((
      SELECT COUNT(*) FROM dock_scans s
      WHERE s.operator_id = p_operator_id
        AND s.deleted_at IS NULL
        AND s.scan_result = 'accepted'
        AND s.scanned_at >= NOW() - INTERVAL '1 hour'
    ), 0),

    -- Whoever scanned in the last 30 minutes is "on the floor now". Their andén
    -- is the zone of the batch they last scanned into.
    'operators', COALESCE((
      SELECT jsonb_agg(row_to_json(o) ORDER BY o.last_scan_at DESC)
      FROM (
        SELECT
          u.id                            AS user_id,
          u.full_name                     AS name,
          COUNT(*)                        AS scans,
          MAX(s.scanned_at)               AS last_scan_at,
          (ARRAY_AGG(z.code ORDER BY s.scanned_at DESC))[1] AS zone_code
        FROM dock_scans s
        JOIN users u        ON u.id = s.scanned_by
        JOIN dock_batches b ON b.id = s.batch_id
        JOIN dock_zones z   ON z.id = b.dock_zone_id
        WHERE s.operator_id = p_operator_id
          AND s.deleted_at IS NULL
          AND s.scanned_at >= NOW() - INTERVAL '30 minutes'
        GROUP BY u.id, u.full_name
      ) o
    ), '[]'::jsonb)
  )
$$;

COMMENT ON FUNCTION public.get_distribution_overview(UUID) IS
  'spec-54 mock 3d — Distribución landing: open lotes, last close, packages sorted today, trailing-hour pace, and who is scanning right now. One call because all of it comes off dock_batches + dock_scans.';

GRANT EXECUTE ON FUNCTION public.get_distribution_overview(UUID) TO authenticated;
