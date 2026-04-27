-- ============================================================================
-- Migration: add pickup_point to manifest list RPCs
-- Purpose:   The pickup screen renders manifests but never shows which pickup
--            point (warehouse / generator location) they belong to. The data
--            is in the database (orders.pickup_point_id → pickup_points.name
--            for pending; manifests.pickup_location TEXT for in-transit and
--            completed) but no RPC returns it.
--
-- Each RPC gets a new pickup_point TEXT column.
--
-- Templates (per CLAUDE.md, use the LATEST definition for each function):
--   get_pending_manifests     → 20260409000008_add_created_at_to_pending_manifests_rpc.sql
--   get_in_transit_manifests  → 20260408000001_add_in_transit_manifests_rpc.sql
--   get_completed_manifests   → 20260310100002_create_get_pending_manifests_rpc.sql
--
-- DROP required: PostgreSQL forbids CREATE OR REPLACE when the return type
-- changes. Adding a column to RETURNS TABLE is a return-type change.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_pending_manifests();
DROP FUNCTION IF EXISTS public.get_in_transit_manifests();
DROP FUNCTION IF EXISTS public.get_completed_manifests();

-- ============================================================================
-- 1. get_pending_manifests — pickup_point comes from JOIN orders.pickup_point_id
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
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Get unconsumed manifests for the Activos tab on the pickup screen. Excludes manifests that are completed OR already handed off to the hub (reception_status set). Returns created_at as MIN(order.created_at) and pickup_point as MIN(pickup_points.name) joined via orders.pickup_point_id.';

-- ============================================================================
-- 2. get_in_transit_manifests — pickup_point from manifests.pickup_location
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
    m.pickup_location as pickup_point
  FROM manifests m
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.reception_status IS NOT NULL
    AND m.status != 'completed'
  ORDER BY m.updated_at DESC
$$;

COMMENT ON FUNCTION public.get_in_transit_manifests() IS 'Get manifests handed off to the hub (reception_status set) but not yet marked as completed. pickup_point sourced from manifests.pickup_location.';

-- ============================================================================
-- 3. get_completed_manifests — pickup_point from manifests.pickup_location
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_completed_manifests()
RETURNS TABLE (
  id UUID,
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  total_orders INT,
  total_packages INT,
  completed_at TIMESTAMPTZ,
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
    m.pickup_location as pickup_point
  FROM manifests m
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.completed_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Get completed manifests for the history tab. pickup_point sourced from manifests.pickup_location.';

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
  RAISE NOTICE '✓ pickup_point added to all 3 manifest list RPCs';
END $$;
