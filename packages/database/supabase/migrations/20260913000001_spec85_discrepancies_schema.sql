-- =============================================================================
-- spec-85 fase 1 — Discrepancias: un registro resoluble de lo que faltó o
-- sobró, compartido por Recogida y Recepción.
-- =============================================================================
-- Hoy no existe nada equivalente. Lo más cercano es discrepancy_notes
-- (operator_id, manifest_id, package_id, note, created_by_user_id) — sólo
-- texto: sin tipo, sin operación, sin estado, sin resolución.
--
-- Esta migración crea el esquema compartido (tabla, enums, RLS) y migra las
-- filas vivas de discrepancy_notes con kind='missing', operation_type='pickup',
-- status='open'.
--
-- discrepancy_notes NO se borra: la pantalla de Revisión de Recogida todavía
-- la lee. Se retira en una fase de contrato posterior (ver
-- docs/specs/spec-85-discrepancias.md), como spec-56 hizo con spec-52.
--
-- Ninguna otra spec debe modificar public.discrepancies fuera de esta
-- migración y las de las fases 2/3 de spec-85 — dos migraciones paralelas
-- sobre la misma tabla es exactamente el choque que spec-85 existe para
-- evitar.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.discrepancy_kind_enum AS ENUM ('missing', 'unexpected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.discrepancy_operation_enum AS ENUM ('pickup', 'reception');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.discrepancy_status_enum AS ENUM ('open', 'resolved', 'lost');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tabla
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discrepancies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,

  kind           public.discrepancy_kind_enum      NOT NULL,
  operation_type public.discrepancy_operation_enum NOT NULL,
  status         public.discrepancy_status_enum    NOT NULL DEFAULT 'open',

  package_id     UUID REFERENCES public.packages(id),
  barcode        VARCHAR(100),

  -- Dónde ocurrió. Explícito y anulable por operación, NO polimórfico: un
  -- (source_type, source_id) sin FK real se corrompe en silencio y no se
  -- puede usar en RLS ni en un join.
  manifest_id        UUID REFERENCES public.manifests(id),
  route_reception_id UUID REFERENCES public.route_receptions(id),

  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by_user_id UUID REFERENCES public.users(id),
  note                TEXT,

  resolution          TEXT,
  resolved_at         TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES public.users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT discrepancy_shape CHECK (
    (kind = 'missing'    AND package_id IS NOT NULL) OR
    (kind = 'unexpected' AND barcode    IS NOT NULL)
  ),
  CONSTRAINT discrepancy_resolved_has_when CHECK (
    (status = 'open') OR (resolved_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.discrepancies IS
'spec-85. Registro resoluble de un bulto que faltó (missing, declarado y
nunca escaneado) o sobró (unexpected, escaneado y ajeno a esta carga/
recepción), en Recogida o en Recepción. Se resuelve, no se borra: es la
evidencia contra una indemnización.';

COMMENT ON COLUMN public.discrepancies.package_id IS
'Sólo para kind=missing: el bulto declarado que nunca se escaneó.';
COMMENT ON COLUMN public.discrepancies.barcode IS
'Sólo para kind=unexpected: el código leído que no pertenece a esta carga o
recepción — no hay packages row porque el bulto es ajeno.';

-- -----------------------------------------------------------------------------
-- 3. Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_discrepancies_operator_id
  ON public.discrepancies(operator_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_manifest_id
  ON public.discrepancies(manifest_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_route_reception_id
  ON public.discrepancies(route_reception_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_package_id
  ON public.discrepancies(package_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_operator_status
  ON public.discrepancies(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_discrepancies_deleted_at
  ON public.discrepancies(deleted_at);

-- Un bulto no puede tener dos discrepancias abiertas en la misma operación —
-- si no, cerrar dos veces duplica la merma y el cliente firma dos veces sobre
-- lo mismo.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_discrepancy_per_package
  ON public.discrepancies (operator_id, package_id, operation_type)
  WHERE status = 'open' AND package_id IS NOT NULL AND deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. RLS — mismo patrón que discrepancy_notes (20260310100000)
-- -----------------------------------------------------------------------------
ALTER TABLE public.discrepancies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "discrepancies_tenant_isolation" ON public.discrepancies
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "discrepancies_tenant_select" ON public.discrepancies
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discrepancies TO authenticated;
REVOKE ALL ON public.discrepancies FROM anon;
GRANT ALL ON public.discrepancies TO service_role;

-- -----------------------------------------------------------------------------
-- 5. updated_at trigger — mismo helper que el resto del repo
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TRIGGER set_discrepancies_updated_at
    BEFORE UPDATE ON public.discrepancies
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Migrar las filas vivas de discrepancy_notes
-- -----------------------------------------------------------------------------
-- kind='missing' (discrepancy_notes sólo documentaba bultos declarados y no
-- escaneados durante la verificación de recogida), operation_type='pickup',
-- status='open' (nunca tuvieron resolución). Conserva note, manifest_id,
-- package_id y created_by_user_id -> detected_by_user_id.
INSERT INTO public.discrepancies (
  operator_id, kind, operation_type, status,
  package_id, manifest_id, note, detected_by_user_id,
  created_at, updated_at, deleted_at
)
SELECT
  dn.operator_id, 'missing', 'pickup', 'open',
  dn.package_id, dn.manifest_id, dn.note, dn.created_by_user_id,
  dn.created_at, dn.updated_at, dn.deleted_at
FROM public.discrepancy_notes dn
WHERE dn.deleted_at IS NULL
  AND NOT EXISTS (
    -- Idempotencia: si esta migración corre dos veces (o parcialmente en un
    -- entorno con retries), no duplicar filas ya migradas.
    SELECT 1 FROM public.discrepancies d
     WHERE d.operator_id = dn.operator_id
       AND d.package_id  = dn.package_id
       AND d.manifest_id = dn.manifest_id
       AND d.kind = 'missing'
       AND d.operation_type = 'pickup'
       AND d.note = dn.note
  );

-- -----------------------------------------------------------------------------
-- 7. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'discrepancies'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'public.discrepancies missing or RLS not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'discrepancy_notes'
  ) THEN
    RAISE EXCEPTION 'discrepancy_notes was dropped — Recogida''s review screen still reads it';
  END IF;

  RAISE NOTICE '✓ spec-85 fase 1 discrepancies schema migration complete';
END $$;

COMMIT;
