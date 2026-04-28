-- ============================================================================
-- Migration: surface in-progress count on pending manifests + sort it first
-- Purpose:   Operators want a visual badge on loads that already have at
--            least one verified package, and those loads should appear at
--            the top of the Activos tab regardless of creation date.
--            "In progress" means: scan flow has started (manifest row exists,
--            not yet handed off) AND ≥1 pickup_scan with scan_result='verified'.
--
-- Template (per CLAUDE.md, latest definition):
--   20260428000001_sort_manifests_by_created_at.sql → get_pending_manifests
--
-- DROP required: adding verified_count column changes the return shape, and
-- CREATE OR REPLACE cannot do that.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_pending_manifests();

CREATE OR REPLACE FUNCTION public.get_pending_manifests()
RETURNS TABLE (
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  order_count BIGINT,
  package_count BIGINT,
  created_at TIMESTAMPTZ,
  pickup_point TEXT,
  verified_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH pending AS (
    SELECT
      o.external_load_id,
      o.retailer_name,
      COUNT(DISTINCT o.id) AS order_count,
      COUNT(p.id) AS package_count,
      MIN(o.created_at) AS load_created_at,
      MIN(pp.name)::TEXT AS pickup_point
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
  ),
  with_verified AS (
    SELECT
      pe.external_load_id,
      pe.retailer_name,
      pe.order_count,
      pe.package_count,
      pe.load_created_at,
      pe.pickup_point,
      -- Count verified scans on the manifest row matching this load (if it
      -- exists yet — pending loads may not have a manifest row until the
      -- operator opens the scan flow).
      COALESCE((
        SELECT COUNT(*)
        FROM   manifests m
        JOIN   pickup_scans ps
          ON   ps.manifest_id = m.id
         AND   ps.scan_result = 'verified'
         AND   ps.deleted_at IS NULL
        WHERE  m.operator_id = public.get_operator_id()
          AND  m.external_load_id = pe.external_load_id
          AND  m.deleted_at IS NULL
      ), 0)::BIGINT AS verified_count
    FROM pending pe
  )
  SELECT
    external_load_id,
    retailer_name,
    order_count,
    package_count,
    load_created_at AS created_at,
    pickup_point,
    verified_count
  FROM with_verified
  -- In-progress loads (≥1 verified scan) first, then newest first within each group.
  ORDER BY (verified_count > 0) DESC, load_created_at DESC
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Activos tab on the pickup screen. Includes verified_count (count of pickup_scans with scan_result=verified for this load). Sort: loads with ≥1 verified scan first, then by load creation date DESC.';

-- ============================================================================
-- Validation
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_manifests') THEN
    RAISE EXCEPTION 'Function get_pending_manifests not found!';
  END IF;
  RAISE NOTICE '✓ get_pending_manifests now returns verified_count and sorts in-progress loads first';
END $$;
