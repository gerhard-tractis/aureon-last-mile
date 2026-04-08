-- Migration: Add get_in_transit_manifests RPC and exclude in-transit from pending
-- Created: 2026-04-08
-- Purpose: Surface a third bucket on the pickup screen for manifests that
--          have been handed off to the hub but not yet marked completed.
--          Without this split, handed-off manifests remain in the "Activos"
--          tab and tapping them re-enters the scan flow instead of showing
--          the operator the QR code they need to present at the warehouse.
--
-- NOTE: Originally shipped in PR #214 but did not deploy because the pinned
--       Supabase CLI version (2.20.12) rejected config.toml's
--       db.major_version=17 with "Failed reading config: Invalid db.major_version: 17".
--       Re-touched here so the path filter on packages/database/supabase/migrations/**
--       triggers deploy-supabase again, this time with the bumped CLI (2.88.1).
--       The SQL itself is unchanged.
--
-- Two SQL changes in one migration:
--   1. CREATE OR REPLACE get_pending_manifests() — exclude manifests where
--      reception_status IS NOT NULL (i.e. already handed off). The previous
--      definition only excluded manifests with status='completed'.
--   2. CREATE OR REPLACE get_in_transit_manifests() — return manifests where
--      reception_status IS NOT NULL AND status != 'completed'.
--
-- Template per CLAUDE.md: latest definition is in
--   20260310100002_create_get_pending_manifests_rpc.sql
-- Carrying over the same RETURNS shape, language, security, and join layout.

-- ============================================================================
-- 1. get_pending_manifests — exclude in-transit manifests
-- ============================================================================
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
        AND m.deleted_at IS NULL
        AND (m.status = 'completed' OR m.reception_status IS NOT NULL)
    )
  GROUP BY o.external_load_id, o.retailer_name
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Get unconsumed manifests for the Activos tab on the pickup screen. Excludes manifests that are completed OR already handed off to the hub (reception_status set).';

-- ============================================================================
-- 2. get_in_transit_manifests — new RPC for the En tránsito tab
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_in_transit_manifests()
RETURNS TABLE (
  id UUID,
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  total_orders INT,
  total_packages INT,
  reception_status TEXT,
  updated_at TIMESTAMPTZ
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
    m.updated_at
  FROM manifests m
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.reception_status IS NOT NULL
    AND m.status != 'completed'
  ORDER BY m.updated_at DESC
$$;

COMMENT ON FUNCTION public.get_in_transit_manifests() IS 'Get manifests handed off to the hub (reception_status set) but not yet marked as completed. Powers the En tránsito tab on the pickup screen.';

-- ============================================================================
-- Validation
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_in_transit_manifests') THEN
    RAISE EXCEPTION 'Function get_in_transit_manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_manifests') THEN
    RAISE EXCEPTION 'Function get_pending_manifests not found!';
  END IF;
  RAISE NOTICE '✓ get_in_transit_manifests RPC created and get_pending_manifests updated';
END $$;
