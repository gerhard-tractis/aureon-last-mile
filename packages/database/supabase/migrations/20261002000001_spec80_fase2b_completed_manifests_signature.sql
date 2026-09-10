-- =============================================================================
-- spec-80 fase 2b (ronda 2) — get_completed_manifests() gains signature_operator
-- =============================================================================
-- Ronda 2 de review de esta fase encontró que la entrada original (dentro de
-- PickupMobileActiveRoute) es inalcanzable en el caso real: `trg_route_
-- receptions_status_sync` (20260812000006) pone `manifests.status='completed'`
-- Y `pickup_routes.status='received'` en el MISMO bloque, y
-- `get_my_active_pickup_route` (20260820000005) filtra `status='in_progress'`.
-- Es decir: en el instante en que nace un rescate, la ruta activa desaparece,
-- y con ella la pantalla donde se había puesto la entrada.
--
-- La corrección mueve la fuente de datos de "manifiestos de ESTA ruta"
-- (useRouteManifests, con ámbito pickup_route_id) a "manifiestos completados
-- del operador" (get_completed_manifests, ya de ámbito operador — la misma
-- fuente que alimenta la pestaña Completados de escritorio). Necesita
-- signature_operator para distinguir un cierre con firma real de uno que
-- `trg_route_receptions_status_sync` completó sin ella.
--
-- Template (per CLAUDE.md, última definición vigente de get_completed_manifests
-- verificada con `git grep -l get_completed_manifests packages/database/
-- supabase/migrations/` — la más reciente es 20260917000002_spec83_fase1_
-- get_completed_manifests_missing_count.sql, que ya añadió missing_count sobre
-- la de spec-53. Este CREATE OR REPLACE parte de ESA, no de la original.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_completed_manifests();

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
  labels_printed_by_name TEXT,
  missing_count          INT,
  signature_operator     TEXT
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
    u.full_name AS labels_printed_by_name,
    -- COUNT(DISTINCT d.package_id), not COUNT(*): uniq_open_discrepancy_per_package
    -- (20260913000001) only blocks two 'open' rows for the same
    -- (package_id, source_id) — it does NOT block an 'open' row coexisting
    -- with a 'lost' or already-'resolved' row for that same package on the
    -- same manifest. spec-83 fase 1's round-2 review first accepted this as
    -- a documented, rare limitation, then reversed that call: the fix is
    -- cheaper than the note justifying skipping it, and the failure mode is
    -- OVERSTATEMENT in a figure that can end up in an indemnity dispute
    -- (never an undercount). Do not simplify this back to a plain row
    -- count without re-reading that round's fixture (CARGA-83-4).
    COALESCE((
      SELECT COUNT(DISTINCT d.package_id)
        FROM public.discrepancies d
       WHERE d.manifest_id = m.id
         -- Defense in depth, not load-bearing on its own: d.manifest_id
         -- already FKs to a manifests row that the outer WHERE has scoped
         -- to public.get_operator_id(), so a cross-operator d row could
         -- only reach here via a manifest that isn't this operator's in the
         -- first place — which the outer clause already excludes. No
         -- fixture kills this line alone; it stays for the same reason the
         -- rest of this repo re-checks tenant scope on every join.
         AND d.operator_id = m.operator_id
         -- Redundant by discrepancy_source_matches_operation (20260913000001):
         -- that CHECK forces operation_type='reception' rows to have
         -- manifest_id IS NULL, so d.manifest_id = m.id above already
         -- implies operation_type='pickup'. Kept for readability, not as a
         -- second guard — do not go looking for a fixture that kills this
         -- clause alone.
         AND d.operation_type = 'pickup'
         AND d.kind = 'missing'
         AND d.deleted_at IS NULL
         AND d.status <> 'resolved'
    ), 0)::INT AS missing_count,
    m.signature_operator
  FROM manifests m
  LEFT JOIN users u ON u.id = m.labels_printed_by
  WHERE m.operator_id = public.get_operator_id()
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
$$;

COMMENT ON FUNCTION public.get_completed_manifests() IS 'Completed manifests for the history tab. Sorted by manifest creation date DESC. pickup_point sourced from manifests.pickup_location. spec-53: adds labels_printed_at/labels_printed_by_name. spec-83 fase 1: adds missing_count, a COUNT(DISTINCT package_id) over public.discrepancies (kind=''missing'', operation_type=''pickup'', not soft-deleted, status <> ''resolved''). spec-80 fase 2b (ronda 2): adds signature_operator so callers can tell a genuinely-signed close apart from one trg_route_receptions_status_sync completed without ever reaching Firma (NULL) — the mobile rescue entry filters on this column, operator-wide, because the manifest''s own route is no longer in_progress by the time this state exists.';

-- =============================================================================
-- Verification
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_completed_manifests'
  ) THEN
    RAISE EXCEPTION 'get_completed_manifests not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_completed_manifests'
       AND pg_get_function_result(p.oid) ILIKE '%signature_operator text%'
  ) THEN
    RAISE EXCEPTION 'get_completed_manifests signature_operator column not found';
  END IF;

  RAISE NOTICE '✓ spec-80 fase 2b get_completed_manifests signature_operator migration complete';
END $$;

COMMIT;
