-- Migration: Add get_active_routes_with_dispatches RPC
-- Created: 2026-03-10
-- Story: Phase 3 - Live Route Tracking
-- Purpose: Returns today's active routes with all their dispatches for the frontend
--          route progress UI. Called by useActiveRoutes hook.

CREATE OR REPLACE FUNCTION get_active_routes_with_dispatches(
  p_operator_id UUID,
  p_route_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(route_data ORDER BY route_data->>'start_time'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'external_route_id', r.external_route_id,
      'driver_name', r.driver_name,
      'vehicle_id', r.vehicle_id,
      'status', r.status,
      'start_time', r.start_time,
      'total_stops', (
        SELECT COUNT(*)
        FROM dispatches d
        WHERE d.route_id = r.id AND d.deleted_at IS NULL
      ),
      'completed_stops', (
        SELECT COUNT(*)
        FROM dispatches d
        WHERE d.route_id = r.id
          AND d.status IN ('delivered', 'failed', 'partial')
          AND d.deleted_at IS NULL
      ),
      'dispatches', (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', d.id,
              'external_dispatch_id', d.external_dispatch_id,
              'order_id', d.order_id,
              'status', d.status,
              'planned_sequence', d.planned_sequence,
              'estimated_at', d.estimated_at,
              'arrived_at', d.arrived_at,
              'completed_at', d.completed_at,
              'latitude', d.latitude,
              'longitude', d.longitude,
              'failure_reason', d.failure_reason
            ) ORDER BY d.planned_sequence NULLS LAST
          ),
          '[]'::jsonb
        )
        FROM dispatches d
        WHERE d.route_id = r.id AND d.deleted_at IS NULL
      )
    ) AS route_data
    FROM routes r
    WHERE r.operator_id = p_operator_id
      AND r.route_date = p_route_date
      AND r.deleted_at IS NULL
    ORDER BY r.start_time
  ) sub;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_active_routes_with_dispatches(UUID, DATE) IS
  'Returns all routes with their dispatches for a given operator and date. Used by live route tracking UI.';

GRANT EXECUTE ON FUNCTION get_active_routes_with_dispatches(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_routes_with_dispatches(UUID, DATE) TO service_role;
