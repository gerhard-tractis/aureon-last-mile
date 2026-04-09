-- ============================================================================
-- Migration: add created_at to get_pending_manifests()
-- Story: show manifest creation date on the Activos tab
--
-- Template: latest definition from 20260408000001_add_in_transit_manifests_rpc.sql
-- ============================================================================

-- DROP required: PostgreSQL forbids CREATE OR REPLACE when the return type changes.
-- Adding created_at to the RETURNS TABLE is a return-type change.
DROP FUNCTION IF EXISTS public.get_pending_manifests();

CREATE OR REPLACE FUNCTION public.get_pending_manifests()
RETURNS TABLE (
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  order_count BIGINT,
  package_count BIGINT,
  created_at TIMESTAMPTZ
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
    MIN(o.created_at) as created_at
  FROM orders o
  LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
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

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Get unconsumed manifests for the Activos tab on the pickup screen. Excludes manifests that are completed OR already handed off to the hub (reception_status set). Returns created_at as MIN(order.created_at) for the load.';

-- Smoke test
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_manifests') THEN
    RAISE EXCEPTION 'Function get_pending_manifests not found!';
  END IF;
  RAISE NOTICE '✓ get_pending_manifests updated with created_at column';
END $$;
