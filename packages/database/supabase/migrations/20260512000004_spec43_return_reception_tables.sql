-- =============================================================
-- Spec-43: return_receptions and return_reception_scans tables
--
-- Enum reuse: hub_reception_status_enum (pending | in_progress | completed) and
-- reception_scan_result_enum (received | not_found | duplicate) are pre-existing
-- types created in migration 20260318000001_create_hub_reception_tables.sql (spec-08).
-- They are reused here without redefinition.
--
-- expected_count is populated at session creation by useReturnReceptionSession,
-- which runs SELECT COUNT(*) FROM packages WHERE status = 'retorno_hub' AND
-- <route join> AND operator_id = $1 at the moment the receptionist opens the route.
-- The count is a snapshot — packages arriving later will appear in the live list
-- but will not retroactively change expected_count.
-- =============================================================

-- ── return_receptions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_receptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  external_route_id TEXT NOT NULL,
  received_by       UUID REFERENCES public.users(id),
  status            hub_reception_status_enum NOT NULL DEFAULT 'pending',
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  expected_count    INT NOT NULL DEFAULT 0,
  received_count    INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.return_receptions IS
  'Return reception sessions — tracks hub receipt of packages returning after failed delivery. Grouped by DT route.';
COMMENT ON COLUMN public.return_receptions.external_route_id IS
  'DispatchTrack route_id (TEXT cast from integer). Groups all returning packages from one route.';

CREATE INDEX IF NOT EXISTS idx_return_receptions_operator_id
  ON public.return_receptions(operator_id);
CREATE INDEX IF NOT EXISTS idx_return_receptions_route
  ON public.return_receptions(operator_id, external_route_id);
CREATE INDEX IF NOT EXISTS idx_return_receptions_status
  ON public.return_receptions(operator_id, status);

ALTER TABLE public.return_receptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "return_receptions_tenant_isolation" ON public.return_receptions
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── return_reception_scans ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_reception_scans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_reception_id   UUID NOT NULL REFERENCES public.return_receptions(id),
  package_id            UUID REFERENCES public.packages(id),
  operator_id           UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  scanned_by            UUID REFERENCES public.users(id),
  barcode               TEXT NOT NULL,
  scan_result           reception_scan_result_enum NOT NULL,
  scanned_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

COMMENT ON TABLE public.return_reception_scans IS
  'Individual barcode scans during a return reception session.';
COMMENT ON COLUMN public.return_reception_scans.package_id IS
  'NULL when scan_result = not_found (barcode not found among expected returning packages).';

CREATE INDEX IF NOT EXISTS idx_return_reception_scans_reception
  ON public.return_reception_scans(return_reception_id);
CREATE INDEX IF NOT EXISTS idx_return_reception_scans_package
  ON public.return_reception_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_return_reception_scans_operator
  ON public.return_reception_scans(operator_id);

ALTER TABLE public.return_reception_scans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "return_reception_scans_tenant_isolation" ON public.return_reception_scans
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
