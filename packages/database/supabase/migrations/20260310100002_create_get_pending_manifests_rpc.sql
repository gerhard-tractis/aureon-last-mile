-- Migration: Create RPC for pending manifests list
-- Story: 4.2 - Manifest List Screen
-- Epic: 4A - Pickup Verification

-- Drop old parameterized versions
DROP FUNCTION IF EXISTS public.get_pending_manifests(UUID);
DROP FUNCTION IF EXISTS public.get_completed_manifests(UUID);

CREATE OR REPLACE FUNCTION public.get_pending_manifests()
RETURNS TABLE (
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  order_count BIGINT,
  package_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    o.external_load_id,
    o.retailer_name,
    COUNT(DISTINCT o.id) as order_count,
    COUNT(p.id) as package_count
  FROM orders o
  LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
  WHERE o.operator_id = public.get_operator_id()
    AND o.external_load_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND o.external_load_id NOT IN (
      SELECT m.external_load_id FROM manifests m
      WHERE m.operator_id = public.get_operator_id()
        AND m.status = 'completed'
        AND m.deleted_at IS NULL
    )
  GROUP BY o.external_load_id, o.retailer_name
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Get unconsumed manifests (loads not yet completed) for the manifest list screen (Story 4.2)';

-- Also create a function for completed manifests (history tab)
CREATE OR REPLACE FUNCTION public.get_completed_manifests()
RETURNS TABLE (
  id UUID,
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  total_orders INT,
  total_packages INT,
  completed_at TIMESTAMPTZ
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
    m.completed_at
  FROM manifests m
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.completed_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Get completed manifests for history tab (Story 4.2)';

-- Validation
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_manifests') THEN
    RAISE EXCEPTION 'Function get_pending_manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_completed_manifests') THEN
    RAISE EXCEPTION 'Function get_completed_manifests not found!';
  END IF;
  RAISE NOTICE '✓ Story 4.2 RPCs created';
END $$;
