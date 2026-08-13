-- =============================================================================
-- spec-53 — Aureon package label printing
-- =============================================================================
-- Adds manifests.labels_printed_at / labels_printed_by, the two RPCs the
-- print route needs (mark_manifest_labels_printed, get_manifest_label_data),
-- and surfaces the print status on the three manifest-list RPCs that back
-- ManifestCard's tabs so the "Imprimir etiquetas" / "Reimprimir etiquetas"
-- entry point has the manifest id and last-print info to render.
--
-- Templates (per CLAUDE.md, latest definition of each function):
--   get_pending_manifests     → 20260428000004_pending_manifests_in_progress_first.sql
--   get_in_transit_manifests  → 20260428000001_sort_manifests_by_created_at.sql
--   get_completed_manifests   → 20260428000001_sort_manifests_by_created_at.sql
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — manifests.labels_printed_at / labels_printed_by
-- =============================================================================
ALTER TABLE public.manifests
  ADD COLUMN IF NOT EXISTS labels_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS labels_printed_by UUID REFERENCES public.users(id);

COMMENT ON COLUMN public.manifests.labels_printed_at IS
'spec-53. Set on every successful "print job dispatched" (window.print() called),
overwritten on reprint. Manifest-level, not per-package: the only operational
question is whether this manifest''s labels have been printed at all.';

COMMENT ON COLUMN public.manifests.labels_printed_by IS
'spec-53. Who triggered the most recent print (auth.uid() at call time).';

-- =============================================================================
-- PART 2 — mark_manifest_labels_printed
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mark_manifest_labels_printed(
  p_manifest_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_actor    UUID;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;

  UPDATE public.manifests
     SET labels_printed_at = NOW(),
         labels_printed_by = v_actor
   WHERE id = p_manifest_id
     AND operator_id = v_operator
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'manifest % not found', p_manifest_id;
  END IF;
END $$;

COMMENT ON FUNCTION public.mark_manifest_labels_printed(UUID) IS
'spec-53. Records that a label print job was dispatched for this manifest.
Overwrites labels_printed_at/by on every call (no versioning, no history —
reprint is idempotent). Scoped to the caller''s operator_id; raises if the
manifest belongs to another operator or is soft-deleted.';

GRANT EXECUTE ON FUNCTION public.mark_manifest_labels_printed(UUID) TO authenticated;

-- =============================================================================
-- PART 3 — get_manifest_label_data
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_manifest_label_data(
  p_manifest_id UUID,
  p_package_id  UUID DEFAULT NULL
) RETURNS TABLE (
  package_id         UUID,
  package_label       TEXT,
  package_number      TEXT,
  declared_box_count  INT,
  sku_items           JSONB,
  order_number        TEXT,
  customer_name       TEXT,
  delivery_address    TEXT,
  comuna              TEXT,
  customer_phone      TEXT,
  external_load_id    TEXT,
  retailer_name       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.label,
    p.package_number,
    p.declared_box_count,
    p.sku_items,
    o.order_number,
    o.customer_name,
    o.delivery_address,
    o.comuna,
    o.customer_phone,
    m.external_load_id,
    m.retailer_name
  FROM public.manifests m
  JOIN public.orders o
    ON o.external_load_id = m.external_load_id
   AND o.operator_id = m.operator_id
   AND o.deleted_at IS NULL
  JOIN public.packages p
    ON p.order_id = o.id
   AND p.deleted_at IS NULL
  WHERE m.id = p_manifest_id
    AND m.operator_id = v_operator
    AND m.deleted_at IS NULL
    AND (p_package_id IS NULL OR p.id = p_package_id)
  ORDER BY o.order_number, p.package_number, p.label;
END $$;

COMMENT ON FUNCTION public.get_manifest_label_data(UUID, UUID) IS
'spec-53. One row per packages row on this manifest (orders joined by
external_load_id — orders and manifests are not FK-linked). Ordered so the
printed stack mirrors the order the crew walks the manifest. p_package_id
narrows to a single package for the torn-label reprint path.';

GRANT EXECUTE ON FUNCTION public.get_manifest_label_data(UUID, UUID) TO authenticated;

-- =============================================================================
-- PART 4 — get_pending_manifests: add id + labels_printed_at + printer name
-- =============================================================================
-- A pending load may not have a manifests row yet (see comment inline below);
-- id/labels_printed_at/labels_printed_by_name are NULL until one exists, which
-- is exactly the "can't print yet" state ManifestCard needs to represent.
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
          AND (m.status = 'completed' OR m.reception_status IS NOT NULL)
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

COMMENT ON FUNCTION public.get_pending_manifests() IS 'Activos tab on the pickup screen. Includes verified_count and (spec-53) id/labels_printed_at/labels_printed_by_name — id is NULL until a manifests row exists for the load. Sort: loads with ≥1 verified scan first, then by load creation date DESC.';

-- =============================================================================
-- PART 5 — get_in_transit_manifests / get_completed_manifests: add print status
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_in_transit_manifests();
DROP FUNCTION IF EXISTS public.get_completed_manifests();

CREATE OR REPLACE FUNCTION public.get_in_transit_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  reception_status       TEXT,
  updated_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT
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
    m.pickup_location as pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    AND m.deleted_at IS NULL
    AND m.reception_status IS NOT NULL
    AND m.status != 'completed'
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_in_transit_manifests() IS 'Manifests handed off to the hub (reception_status set) but not yet completed. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name.';

CREATE OR REPLACE FUNCTION public.get_completed_manifests()
RETURNS TABLE (
  id                     UUID,
  external_load_id       VARCHAR(100),
  retailer_name          VARCHAR(50),
  total_orders           INT,
  total_packages         INT,
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ,
  pickup_point           TEXT,
  labels_printed_at      TIMESTAMPTZ,
  labels_printed_by_name TEXT
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
    m.pickup_location as pickup_point,
    m.labels_printed_at,
    u.full_name AS labels_printed_by_name
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Completed manifests for the history tab. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name.';

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manifests' AND column_name = 'labels_printed_at'
  ) THEN
    RAISE EXCEPTION 'manifests.labels_printed_at missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manifests' AND column_name = 'labels_printed_by'
  ) THEN
    RAISE EXCEPTION 'manifests.labels_printed_by missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_manifest_labels_printed') THEN
    RAISE EXCEPTION 'Function mark_manifest_labels_printed not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_manifest_label_data') THEN
    RAISE EXCEPTION 'Function get_manifest_label_data not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pending_manifests') THEN
    RAISE EXCEPTION 'Function get_pending_manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_in_transit_manifests') THEN
    RAISE EXCEPTION 'Function get_in_transit_manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_completed_manifests') THEN
    RAISE EXCEPTION 'Function get_completed_manifests not found!';
  END IF;
  RAISE NOTICE '✓ spec-53 package label printing schema + RPCs in place';
END $$;

COMMIT;
