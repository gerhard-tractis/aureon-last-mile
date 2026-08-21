-- =============================================================================
-- spec-61 Task 7 — a load already on a route is not "pending"
-- =============================================================================
-- TEMPLATED ON THE LATEST DEFINITION: 20260813000001_spec53_package_labels.sql:151
-- (spec-53's id/labels_printed_at/labels_printed_by_name columns). Templating
-- on any earlier one would silently drop those and blank the "Imprimir
-- etiquetas" button. Everything below is byte-for-byte that function except
-- the one added OR in the exclusion subquery.
--
-- Independent of the crew model and wrong under all of them: a routed load
-- stayed in the Activos list, so a second person could tick it and get a raw
-- 'manifest ... already linked to another route' out of add_manifest_to_route
-- (20260625000001:385) -- the partial-attach toast at page.tsx:200 is the only
-- thing that ever surfaced it.
--
-- NOT a data risk: this is a function body, no constraint and no index, so it
-- cannot abort a deploy on production rows. It DOES change what two live
-- screens list -- the desktop 1l Manifiestos tab and mobile 3j -- both fed by
-- the single caller usePendingManifests (useManifests.ts:53 -> page.tsx:79).
-- Verified by grep on 2026-08-20: no other caller exists, in this repo or in
-- apps/agents, apps/worker or the n8n flows.
--
-- One manifests row per (operator_id, external_load_id) is guaranteed by
-- unique_manifest_per_operator and by trg_ensure_manifest_for_order
-- (20260814000001), so "the load is routed" and "its manifest is routed" are
-- the same statement -- the NOT IN subquery cannot be tripped by a second,
-- unrouted manifest row for the same load.
--
-- The Recogida nav badge is deliberately NOT changed. It counts
-- manifests.status IN ('pending','in_progress')
-- (20260817000001_spec54_nav_counts.sql:43) -- the operator's outstanding
-- workload, which a routed load is still part of. The list answers a
-- different question ("what can I still claim"). They are meant to differ.
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
  labels_printed_by_name TEXT
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
    labels_printed_by_name
  FROM with_manifest
  -- In-progress loads (≥1 verified scan) first, then newest first within each group.
  ORDER BY (verified_count > 0) DESC, load_created_at DESC
$$;

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Activos tab on the pickup screen. Includes verified_count and (spec-53) id/labels_printed_at/labels_printed_by_name. Excludes loads that are completed, already handed off (reception_status set), or (spec-61) already attached to a pickup route. Sort: loads with ≥1 verified scan first, then by load creation date DESC.';

-- ─── Verification ────────────────────────────────────────────────────────────
-- Assert the predicate this migration exists to add is actually in the
-- installed body, and that the spec-53 column set survived the re-template.
-- Checking only "the function exists" would stay green if this file had been
-- templated on a pre-spec-53 definition.
DO $$
DECLARE
  v_src  TEXT;
  v_cols TEXT;
BEGIN
  SELECT p.prosrc, array_to_string(p.proargnames, ',')
    INTO v_src, v_cols
  FROM   pg_proc p
  WHERE  p.oid = 'public.get_pending_manifests()'::regprocedure;

  IF v_src IS NULL OR v_src NOT LIKE '%m.pickup_route_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'get_pending_manifests does not exclude routed manifests';
  END IF;

  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,order_count,package_count,created_at,pickup_point,verified_count,labels_printed_at,labels_printed_by_name'
  THEN
    RAISE EXCEPTION 'get_pending_manifests column set changed — expected the spec-53 shape, got: %', v_cols;
  END IF;

  RAISE NOTICE '✓ get_pending_manifests excludes routed loads; spec-53 columns intact';
END $$;

COMMIT;
