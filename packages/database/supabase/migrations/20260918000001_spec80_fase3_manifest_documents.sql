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
-- CHECK sobre operator_id, GRANT SELECT/INSERT/UPDATE a authenticated.
-- Borrado suave (deleted_at), nunca DELETE físico.
--
-- Ronda 2 de review del PR #706 (Mayor 1): copiar el patrón de
-- discrepancy_notes a medias — sin su trigger de auditoría ni el REVOKE de
-- DELETE — deja una tabla de evidencia legal ("no se borra físicamente",
-- comment de arriba) donde cualquier autenticado puede borrarla físicamente
-- y reescribir uploaded_by/storage_path sin dejar rastro. Verificado contra
-- la policy real con un JWT de authenticated normal antes de este fix:
-- "cliente hizo DELETE FISICO de 1 fila(s) de evidencia". Cerrado abajo con
-- REVOKE DELETE, el trigger de auditoría, y WITH CHECK atando uploaded_by al
-- actor real del JWT (no puede insertar/actualizar una fila a nombre de
-- otro usuario).
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
  deleted_at    TIMESTAMPTZ
);

COMMENT ON TABLE public.manifest_documents IS
'spec-80 fase 3. Respaldo fotográfico del manifiesto firmado por el local
(5f). Una fila por hoja fotografiada; storage_path apunta al bucket privado
`manifests`, prefijado operator_id/manifest_id/. Es el respaldo si después
falta un paquete — no se borra físicamente (DELETE revocado a authenticated;
sólo service_role, y auditado).';

CREATE INDEX IF NOT EXISTS idx_manifest_documents_operator_id
  ON public.manifest_documents(operator_id);
CREATE INDEX IF NOT EXISTS idx_manifest_documents_manifest_id
  ON public.manifest_documents(manifest_id);
CREATE INDEX IF NOT EXISTS idx_manifest_documents_deleted_at
  ON public.manifest_documents(deleted_at);

-- El spec original (docs/specs/spec-80-recogida-movil-cierre-de-carga.md)
-- pedía un UNIQUE(manifest_id, sheet_number) de tabla, literal. Corregido
-- aquí (y en el spec) a índice único PARCIAL sobre deleted_at IS NULL: un
-- UNIQUE de tabla sobrevive al borrado suave, así que borrar la hoja 1 de 2
-- dejaría un "hueco" en el conteo (MAX(sheet_number) sigue viendo 1 fila
-- borrada) y una futura hoja "1" volvería a colisionar contra la fila
-- muerta para siempre. Con el índice parcial, una fila borrada libera su
-- número.
--
-- Ronda 2 de review del PR #706, seguimiento 3 — esta migración cambió de
-- forma DESPUÉS de que algunas bases (el contenedor pgTAP compartido, en
-- particular) ya la hubieran aplicado con el UNIQUE de tabla viejo.
-- CREATE TABLE IF NOT EXISTS no toca una tabla existente, así que sin este
-- DROP, forzar esta versión con `\i` sobre una de esas bases deja el UNIQUE
-- viejo Y el índice parcial nuevo coexistiendo — el viejo sigue bloqueando
-- exactamente el caso (reinsertar un sheet_number tras borrado suave) que
-- el nuevo existe para permitir, y TEST 11 fallaría sin motivo aparente
-- para quien no supiera que había dos constraints. Nombre por defecto de
-- Postgres para un UNIQUE de columna(s) sin nombre explícito:
-- <tabla>_<columnas>_key.
ALTER TABLE public.manifest_documents
  DROP CONSTRAINT IF EXISTS manifest_documents_manifest_id_sheet_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_manifest_documents_manifest_sheet
  ON public.manifest_documents (manifest_id, sheet_number)
  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- RLS — mismo patrón que discrepancy_notes (20260310100000): tabla
-- client-writable, aislada por operator_id.
-- -----------------------------------------------------------------------------
ALTER TABLE public.manifest_documents ENABLE ROW LEVEL SECURITY;

-- Ronda 3 de review del PR #706 (seguimiento 3) — DROP + CREATE, no el
-- patrón `CREATE POLICY ... EXCEPTION WHEN duplicate_object THEN NULL`
-- de ronda 2. Ese patrón es correcto para una policy que nunca cambia,
-- pero aquí la definición SÍ cambió entre ronda 1 y ronda 2 (se le añadió
-- la cláusula de `uploaded_by`) con el MISMO nombre de policy: sobre una
-- base que ya corrió la forma de ronda 1, `CREATE POLICY` habría chocado
-- con `duplicate_object`, la excepción lo habría tragado en silencio, y la
-- policy vieja (sin la protección de `uploaded_by`) habría seguido vigente
-- — exactamente lo que TEST 10 detectó al forzar esta migración sobre una
-- base simulada en la forma de ronda 1.
DROP POLICY IF EXISTS "manifest_documents_tenant_isolation" ON public.manifest_documents;
CREATE POLICY "manifest_documents_tenant_isolation" ON public.manifest_documents
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (
    operator_id = public.get_operator_id()
    -- Ronda 2 (Mayor 1, "opcionalmente"): uploaded_by no puede mentir sobre
    -- quién subió la foto — igual que close_manifest deriva la firma del
    -- operador server-side porque "un nombre que controla el cliente no
    -- sirve como evidencia de custodia" (spec-80 fase 1). NULL se permite
    -- para una futura escritura de service_role (p.ej. backfill), que de
    -- todos modos bypassa RLS.
    AND (uploaded_by IS NULL OR uploaded_by = auth.uid())
  );

-- NO redundante pese a que la policy de arriba ya es FOR ALL (que incluye
-- SELECT): Postgres exige que un UPDATE/DELETE, además de pasar el USING de
-- su propia policy, pase también el USING de las policies de SELECT
-- aplicables a la fila objetivo (la fila debe ser "visible" antes de poder
-- tocarla) — ver la sección de RLS de la documentación de Postgres sobre
-- UPDATE/DELETE. Quitar esta policy pensando que "FOR ALL ya cubre SELECT"
-- no reduce superficie: la deja en el mismo sitio, sólo que expresada una
-- vez en vez de dos. Se mantiene explícita para que nadie la borre por
-- parecer duplicada.
DO $$ BEGIN
  CREATE POLICY "manifest_documents_tenant_select" ON public.manifest_documents
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Ronda 2 (Mayor 1): DELETE revocado — es la única forma de que "no se borra
-- físicamente" (el COMMENT de la tabla) sea cierto contra un cliente
-- autenticado normal, no sólo contra la ausencia de UI para hacerlo.
-- service_role (bypassa RLS) sigue pudiendo, para operaciones de backend.
GRANT SELECT, INSERT, UPDATE ON public.manifest_documents TO authenticated;
REVOKE DELETE ON public.manifest_documents FROM authenticated;
REVOKE ALL ON public.manifest_documents FROM anon;
GRANT ALL ON public.manifest_documents TO service_role;

-- -----------------------------------------------------------------------------
-- Auditoría — mismo patrón que discrepancy_notes/manifests (20260310100000).
-- Ronda 2 (Mayor 1): es el control compensatorio que hace tolerable que la
-- tabla sea escribible por el cliente en vez de por un RPC SECURITY
-- DEFINER — sin esto, un UPDATE que reescribe storage_path/uploaded_by/
-- captured_at no deja ningún rastro de quién lo hizo ni cuándo.
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TRIGGER audit_manifest_documents_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.manifest_documents
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'audit_manifest_documents_changes'
  ) THEN
    RAISE EXCEPTION 'audit_manifest_documents_changes trigger missing';
  END IF;

  RAISE NOTICE '✓ spec-80 fase 3 manifest_documents migration complete';
END $$;

COMMIT;
