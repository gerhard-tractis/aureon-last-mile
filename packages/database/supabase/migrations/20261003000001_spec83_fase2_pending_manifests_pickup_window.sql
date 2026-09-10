-- =============================================================================
-- spec-83 fase 2 — get_pending_manifests returns the pickup window
-- =============================================================================
-- TEMPLATED ON THE LATEST DEFINITION:
-- 20260820000006_spec61_pending_manifests_exclude_routed.sql. Verified via
-- `git grep -l get_pending_manifests packages/database/supabase/migrations/`
-- on 2026-09-10: the four migrations that touch this function are
-- 20260310100002, 20260427000001, 20260428000001, 20260428000004,
-- 20260813000001 and 20260820000006, in that order — 20260820000006 is the
-- most recent. Templating on anything earlier would silently drop the
-- routed-load exclusion (spec-61) and/or the spec-53 label columns.
--
-- What this adds: `pickup_window_start`, `pickup_window_end` (from
-- pickup_points.pickup_locations[0].operating_hours — schema already had it,
-- 20260318000004:68-69, nobody ever populated it) and `pickup_cutoff_time`
-- (from pickup_points.sla_config.pickup_cutoff_time). Both are NULL for
-- every pickup point as of this migration — no data is written here, this
-- only wires the read path. The write path (admin form) lands in the same
-- phase, separately (apps/frontend/src/components/admin/PickupPointForm.tsx
-- and its API routes).
--
-- Column set intentionally NOT reduced to one row per pickup_point: `pending`
-- groups by (external_load_id, retailer_name), same as before, and pp is
-- still LEFT JOINed per order then reduced with MIN() — same aggregation
-- shape the function already used for pp.name. A load with orders split
-- across two different pickup points was already non-deterministic on
-- `pickup_point` before this migration; this does not make that worse.
--
-- ACL: this function has never had an explicit GRANT (verified with
-- `git grep -n get_pending_manifests packages/database/supabase/migrations/*.sql
-- | grep -i grant` on 2026-09-10 — no hits) and was not flagged by spec-88's
-- anon-SECURITY-DEFINER audit. It is SECURITY INVOKER, so PostgREST executes
-- it as the calling role and RLS on the underlying tables (orders,
-- manifests, pickup_points, pickup_scans) is what actually gates access —
-- an anonymous caller gets an empty result, not another operator's data.
-- The DROP+CREATE OR REPLACE pattern here is identical to what
-- 20260820000006 already did with the same starting ACL state, so this is
-- not a new exposure — no REVOKE/GRANT statements are added.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_pending_manifests();

CREATE OR REPLACE FUNCTION public.get_pending_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  order_count            BIGINT,
  package_count          BIGINT,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  verified_count         BIGINT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT,
  pickup_window_start    TEXT,
  pickup_window_end      TEXT,
  pickup_cutoff_time     TEXT
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
      MIN(pp.name)::TEXT AS pickup_point,
      MIN(pp.pickup_locations->0->'operating_hours'->>'start')::TEXT AS pickup_window_start,
      MIN(pp.pickup_locations->0->'operating_hours'->>'end')::TEXT AS pickup_window_end,
      MIN(pp.sla_config->>'pickup_cutoff_time')::TEXT AS pickup_cutoff_time
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
          AND (m.status = 'completed'
               OR m.reception_status IS NOT NULL
               OR m.pickup_route_id IS NOT NULL)
      )
    GROUP BY o.external_load_id, o.retailer_name
  ),
  with_manifest AS (
    SELECT
      pe.*,
      m.id AS manifest_id,
      m.labels_printed_at,
      u.full_name AS labels_printed_by_name,
      -- Count verified scans on the manifest row matching this load (if it
      -- exists yet — pending loads may not have a manifest row until the
      -- operator opens the scan flow).
      COALESCE((
        SELECT COUNT(*)
        FROM   pickup_scans ps
        WHERE  ps.manifest_id = m.id
          AND  ps.scan_result = 'verified'
          AND  ps.deleted_at IS NULL
      ), 0)::BIGINT AS verified_count
    FROM pending pe
    LEFT JOIN manifests m
      ON m.operator_id = public.get_operator_id()
     AND m.external_load_id = pe.external_load_id
     AND m.deleted_at IS NULL
    LEFT JOIN users u ON u.id = m.labels_printed_by
  )
  SELECT
    manifest_id,
    external_load_id,
    retailer_name,
    order_count,
    package_count,
    load_created_at AS created_at,
    pickup_point,
    verified_count,
    labels_printed_at,
    labels_printed_by_name,
    pickup_window_start,
    pickup_window_end,
    pickup_cutoff_time
  FROM with_manifest
  -- In-progress loads (≥1 verified scan) first, then newest first within each group.
  ORDER BY (verified_count > 0) DESC, load_created_at DESC
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Activos tab on the pickup screen. Includes verified_count and (spec-53) id/labels_printed_at/labels_printed_by_name. Excludes loads that are completed, already handed off (reception_status set), or (spec-61) already attached to a pickup route. (spec-83 fase 2) Also returns pickup_window_start/end and pickup_cutoff_time — NULL until a pickup point has them configured; the frontend must treat NULL as "no data", never as "no deadline". Sort: loads with ≥1 verified scan first, then by load creation date DESC.';

-- ─── Verification ────────────────────────────────────────────────────────────
-- has_function() first: a test that can't fail is not a test.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_pending_manifests'
  ) THEN
    RAISE EXCEPTION 'get_pending_manifests not found after migration';
  END IF;
END $$;

DO $$
DECLARE
  v_src  TEXT;
  v_cols TEXT;
BEGIN
  SELECT p.prosrc, array_to_string(p.proargnames, ',')
    INTO v_src, v_cols
  FROM   pg_proc p
  WHERE  p.oid = 'public.get_pending_manifests()'::regprocedure;

  -- spec-61 predicate must survive the re-template.
  IF v_src IS NULL OR v_src NOT LIKE '%m.pickup_route_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'get_pending_manifests does not exclude routed manifests';
  END IF;

  -- spec-83 fase 2: the three new columns must actually be derived from
  -- pickup_points, not just declared in RETURNS TABLE.
  IF v_src NOT LIKE '%pickup_locations->0->''operating_hours''->>''start''%' THEN
    RAISE EXCEPTION 'get_pending_manifests does not derive pickup_window_start from pickup_locations';
  END IF;

  IF v_src NOT LIKE '%sla_config->>''pickup_cutoff_time''%' THEN
    RAISE EXCEPTION 'get_pending_manifests does not derive pickup_cutoff_time from sla_config';
  END IF;

  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,order_count,package_count,created_at,pickup_point,verified_count,labels_printed_at,labels_printed_by_name,pickup_window_start,pickup_window_end,pickup_cutoff_time'
  THEN
    RAISE EXCEPTION 'get_pending_manifests column set changed unexpectedly, got: %', v_cols;
  END IF;

  RAISE NOTICE '✓ get_pending_manifests returns pickup_window_start/end and pickup_cutoff_time; spec-53/spec-61 behaviour intact';
END $$;

COMMIT;
