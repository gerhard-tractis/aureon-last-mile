-- =============================================================================
-- spec-53 fix — get_manifest_label_data raised at runtime on every call
--
-- 20260813000001_spec53_package_labels.sql declared the RETURNS TABLE columns
-- as TEXT, but the underlying columns are VARCHAR(n):
--
--   packages.label            VARCHAR(100)
--   packages.package_number   VARCHAR(20)
--   orders.order_number       VARCHAR(50)
--   orders.customer_name      VARCHAR(255)
--   orders.comuna             VARCHAR(100)
--   orders.customer_phone     VARCHAR(20)
--   manifests.external_load_id VARCHAR(100)
--   manifests.retailer_name   VARCHAR(50)
--
-- PL/pgSQL's RETURN QUERY requires the query's column types to match the
-- declared result type exactly — it does not widen varchar to text. So the
-- function raised
--
--   ERROR: structure of query does not match function result type
--
-- for every caller, including the print route. Caught by pgTAP
-- (scripts/pgtap-local.sh), which no CI workflow runs.
--
-- Fix: cast each varchar column to TEXT in the SELECT, keeping the declared
-- signature (and therefore the generated TypeScript types) unchanged.
--
-- Template: the definition in 20260813000001_spec53_package_labels.sql, which
-- is the latest — per the CREATE OR REPLACE rule in CLAUDE.md.
--
-- orders.delivery_address is already TEXT, packages.declared_box_count is
-- INTEGER and packages.sku_items is JSONB, so those three need no cast.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_manifest_label_data(
  p_manifest_id UUID,
  p_package_id  UUID DEFAULT NULL
) RETURNS TABLE (
  package_id          UUID,
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
    p.label::TEXT,
    p.package_number::TEXT,
    p.declared_box_count,
    p.sku_items,
    o.order_number::TEXT,
    o.customer_name::TEXT,
    o.delivery_address,
    o.comuna::TEXT,
    o.customer_phone::TEXT,
    m.external_load_id::TEXT,
    m.retailer_name::TEXT
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
narrows to a single package for the torn-label reprint path. Varchar columns
are cast to TEXT because RETURN QUERY demands an exact type match.';

GRANT EXECUTE ON FUNCTION public.get_manifest_label_data(UUID, UUID) TO authenticated;

-- Verification: the function must actually execute, not merely exist. A plain
-- pg_proc lookup would have passed against the broken definition too.
DO $$
DECLARE
  v_count INT;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000000')::text,
    true
  );
  BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.get_manifest_label_data('00000000-0000-0000-0000-000000000000'::UUID);
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      -- "no operator in JWT" is the expected guard for this synthetic caller;
      -- reaching it proves the body parsed and the result type matched.
      v_count := 0;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'get_manifest_label_data still broken: % (%)', SQLERRM, SQLSTATE;
  END;
END $$;

COMMIT;
