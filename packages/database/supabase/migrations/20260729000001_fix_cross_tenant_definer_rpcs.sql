-- Migration: Stop two SECURITY DEFINER RPCs from trusting a caller-supplied operator_id
--
-- get_active_routes_with_dispatches and get_unmatched_comunas are both
-- SECURITY DEFINER (so RLS does not apply), both granted to `authenticated`,
-- and both filtered only on the p_operator_id the caller passes. Any logged-in
-- user of any tenant could read another tenant's data — routes, dispatches,
-- customer coordinates, driver names, failure reasons, order volumes — just by
-- passing a different UUID.
--
-- Both signatures are kept so callers (useActiveRoutes, useUnmatchedComunas)
-- need no change; the argument is now validated instead of trusted.
--
-- The check allows auth.uid() IS NULL through: EXECUTE is granted only to
-- `authenticated` and `service_role`, so a null uid means a server-side
-- service_role call (cron, edge function), which is legitimately cross-tenant.
-- anon cannot reach either function.
--
-- Templates: latest definitions from
--   20260310000004_get_active_routes_with_dispatches.sql
--   20260321000001_chile_comunas_normalization.sql (section 9)

-- ============================================================================
-- Shared guard
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_operator_access(p_operator_id UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service-role / server-side context: no end user, cross-tenant is intended.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF p_operator_id IS DISTINCT FROM public.get_operator_id() THEN
    RAISE EXCEPTION 'operator_id mismatch: caller may not access another tenant''s data'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_operator_access(UUID) IS
  'Raises 42501 when an authenticated caller passes an operator_id other than their own. Use in any SECURITY DEFINER function that accepts p_operator_id.';

GRANT EXECUTE ON FUNCTION public.assert_operator_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_operator_access(UUID) TO service_role;

-- ============================================================================
-- get_active_routes_with_dispatches
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_active_routes_with_dispatches(
  p_operator_id UUID,
  p_route_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_operator_access(p_operator_id);

  RETURN (
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
    ) sub
  );
END;
$$;

COMMENT ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) IS
  'Returns all routes with their dispatches for a given operator and date. Used by live route tracking UI. Rejects a p_operator_id that is not the caller''s own.';

GRANT EXECUTE ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_routes_with_dispatches(UUID, DATE) TO service_role;

-- ============================================================================
-- get_unmatched_comunas
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unmatched_comunas(p_operator_id UUID)
RETURNS TABLE (comuna_raw TEXT, order_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_operator_access(p_operator_id);

  RETURN QUERY
    SELECT o.comuna_raw, COUNT(*)::BIGINT AS order_count
      FROM public.orders o
     WHERE o.operator_id = p_operator_id
       AND o.comuna_id IS NULL
       AND o.comuna_raw IS NOT NULL
     GROUP BY o.comuna_raw
     ORDER BY order_count DESC;
END;
$$;

COMMENT ON FUNCTION public.get_unmatched_comunas(UUID) IS
  'Unnormalized comuna names and their order counts for an operator. Rejects a p_operator_id that is not the caller''s own.';

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'assert_operator_access',
    'get_active_routes_with_dispatches',
    'get_unmatched_comunas'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = v_name AND pronamespace = 'public'::regnamespace
    ) THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'missing functions after migration: %', array_to_string(v_missing, ', ');
  END IF;

  -- Both RPCs must now call the guard. Catches a future CREATE OR REPLACE that
  -- drops the check while keeping the signature.
  IF (SELECT prosrc FROM pg_proc
      WHERE proname = 'get_active_routes_with_dispatches'
        AND pronamespace = 'public'::regnamespace)
     NOT LIKE '%assert_operator_access%' THEN
    RAISE EXCEPTION 'get_active_routes_with_dispatches lost its tenant guard';
  END IF;

  IF (SELECT prosrc FROM pg_proc
      WHERE proname = 'get_unmatched_comunas'
        AND pronamespace = 'public'::regnamespace)
     NOT LIKE '%assert_operator_access%' THEN
    RAISE EXCEPTION 'get_unmatched_comunas lost its tenant guard';
  END IF;
END;
$$;
