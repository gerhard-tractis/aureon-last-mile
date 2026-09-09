-- =============================================================================
-- spec-80 fase 3 — manifest_documents: fotos del manifiesto firmado (5f).
-- =============================================================================
-- Ninguna columna ligaba una foto al manifiesto (spec-80, "Fotos del
-- manifiesto firmado — falta dónde apuntarlas"). El bucket privado
-- `manifests` ya existe (20260430000001, con RLS por
-- (storage.foldername(name))[1] = operator_id) y ya tiene un subidor real
-- (useCameraIntake.ts). Esta migración sólo añade la tabla que vincula una
-- foto subida a ese bucket con el manifiesto que respalda.
--
-- Tabla copiada literal del cuerpo del spec (docs/specs/
-- spec-80-recogida-movil-cierre-de-carga.md, fase 3) — no se reinventa aquí.
--
-- Es escrita directamente por el cliente móvil al capturar cada hoja (no por
-- un RPC SECURITY DEFINER, a diferencia de discrepancies/spec-85): el mismo
-- patrón de discrepancy_notes (20260310100000) — FOR ALL con USING/WITH
-- CHECK sobre operator_id, GRANT SELECT/INSERT/UPDATE/DELETE a authenticated.
-- Borrado suave (deleted_at), nunca DELETE físico.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.manifest_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id   UUID NOT NULL REFERENCES public.manifests(id),
  storage_path  TEXT NOT NULL,
  sheet_number  INT  NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by   UUID REFERENCES public.users(id),
  deleted_at    TIMESTAMPTZ,
  UNIQUE (manifest_id, sheet_number)
);

COMMENT ON TABLE public.manifest_documents IS
'spec-80 fase 3. Respaldo fotográfico del manifiesto firmado por el local
(5f). Una fila por hoja fotografiada; storage_path apunta al bucket privado
`manifests`, prefijado operator_id/manifest_id/. Es el respaldo si después
falta un paquete — no se borra físicamente.';

CREATE INDEX IF NOT EXISTS idx_manifest_documents_operator_id
  ON public.manifest_documents(operator_id);
CREATE INDEX IF NOT EXISTS idx_manifest_documents_manifest_id
  ON public.manifest_documents(manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_documents_deleted_at
  ON public.manifest_documents(deleted_at);

-- -----------------------------------------------------------------------------
-- RLS — mismo patrón que discrepancy_notes (20260310100000): tabla
-- client-writable, aislada por operator_id.
-- -----------------------------------------------------------------------------
ALTER TABLE public.manifest_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "manifest_documents_tenant_isolation" ON public.manifest_documents
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "manifest_documents_tenant_select" ON public.manifest_documents
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manifest_documents TO authenticated;
REVOKE ALL ON public.manifest_documents FROM anon;
GRANT ALL ON public.manifest_documents TO service_role;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'manifest_documents'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'public.manifest_documents missing or RLS not enabled';
  END IF;

  RAISE NOTICE '✓ spec-80 fase 3 manifest_documents migration complete';
END $$;

COMMIT;
