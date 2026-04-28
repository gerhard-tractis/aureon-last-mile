-- ============================================================================
-- Migration: sort all manifest list RPCs by created_at DESC + expose created_at
--            on the in-transit and completed RPCs.
-- Purpose:   The pickup screen needs a single sort order across the three tabs
--            (active / in-transit / completed) and that order should be the
--            manifest creation date — so a freshly-arrived load shows on top
--            no matter which tab it's in.
--
-- Templates (per CLAUDE.md, use the LATEST definition for each function):
--   get_pending_manifests     → 20260427000001_add_pickup_point_to_manifest_rpcs.sql
--   get_in_transit_manifests  → 20260427000001_add_pickup_point_to_manifest_rpcs.sql
--   get_completed_manifests   → 20260427000001_add_pickup_point_to_manifest_rpcs.sql
--
-- DROP required: the in-transit and completed RPCs gain a created_at column,
-- which is a return-type change that CREATE OR REPLACE cannot do.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_pending_manifests();
DROP FUNCTION IF EXISTS public.get_in_transit_manifests();
DROP FUNCTION IF EXISTS public.get_completed_manifests();

-- ============================================================================
-- 1. get_pending_manifests — already returns created_at; add ORDER BY created_at DESC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_pending_manifests()
RETURNS TABLE (
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  order_count BIGINT,
  package_count BIGINT,
  created_at TIMESTAMPTZ,
  pickup_point TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    o.external_load_id,
    o.retailer_name,
    COUNT(DISTINCT o.id) as order_count,
    COUNT(p.id) as package_count,
    MIN(o.created_at) as created_at,
    MIN(pp.name)::TEXT as pickup_point
  FROM orders o
  LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
  LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
  WHERE o.operator_id = public.get_operator_id()
    AND o.external_load_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND o.external_load_id NOT IN (
      SELECT m.external_load_id FROM manifests m
      WHERE m.operator_id = public.get_operator_id()
        AND m.deleted_at IS NULL
        AND (m.status = 'completed' OR m.reception_status IS NOT NULL)
    )
  GROUP BY o.external_load_id, o.retailer_name
  ORDER BY MIN(o.created_at) DESC
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Get unconsumed manifests for the Activos tab on the pickup screen. Sorted by load creation date DESC. Excludes manifests that are completed OR already handed off (reception_status set).';

-- ============================================================================
-- 2. get_in_transit_manifests — add created_at column, sort by it DESC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_in_transit_manifests()
RETURNS TABLE (
  id UUID,
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  total_orders INT,
  total_packages INT,
  reception_status TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  pickup_point TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.reception_status::TEXT,
    m.updated_at,
    m.created_at,
    m.pickup_location as pickup_point
  FROM manifests m
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.reception_status IS NOT NULL
    AND m.status != 'completed'
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_in_transit_manifests() IS 'Manifests handed off to the hub (reception_status set) but not yet completed. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location.';

-- ============================================================================
-- 3. get_completed_manifests — add created_at column, sort by it DESC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_completed_manifests()
RETURNS TABLE (
  id UUID,
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  total_orders INT,
  total_packages INT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  pickup_point TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    m.id,
    m.external_load_id,
    m.retailer_name,
    m.total_orders,
    m.total_packages,
    m.completed_at,
    m.created_at,
    m.pickup_location as pickup_point
  FROM manifests m
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Completed manifests for the history tab. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location.';

-- ============================================================================
-- Validation
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_manifests') THEN
    RAISE EXCEPTION 'Function get_pending_manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_in_transit_manifests') THEN
    RAISE EXCEPTION 'Function get_in_transit_manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_completed_manifests') THEN
    RAISE EXCEPTION 'Function get_completed_manifests not found!';
  END IF;
  RAISE NOTICE '✓ manifest list RPCs now sort by created_at DESC and expose the column';
END $$;
