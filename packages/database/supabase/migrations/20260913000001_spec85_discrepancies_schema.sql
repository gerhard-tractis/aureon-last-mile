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

  -- Origen sin polimorfismo, indexable: "un bulto puede tener una
  -- discrepancia abierta por EVENTO, no una en toda su vida" — faltar el
  -- lunes en la carga A y otra vez el martes en la carga B son dos hechos
  -- distintos, y el índice único de abajo necesita distinguirlos. Generada,
  -- no escrita a mano, porque no puede desincronizarse de manifest_id/
  -- route_reception_id.
  source_id UUID GENERATED ALWAYS AS (COALESCE(manifest_id, route_reception_id)) STORED,

  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_by_user_id UUID REFERENCES public.users(id),
  note                TEXT,

  resolution          TEXT,
  resolved_at         TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES public.users(id),

  -- Trazabilidad del backfill (ver sección 6): qué discrepancy_notes row
  -- originó esta fila, para poder reconciliar sin comparar por el texto de
  -- `note`, que el frontend deja editar.
  migrated_from_note_id UUID REFERENCES public.discrepancy_notes(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  CONSTRAINT discrepancy_shape CHECK (
    (kind = 'missing'    AND package_id IS NOT NULL) OR
    (kind = 'unexpected' AND barcode IS NOT NULL AND package_id IS NULL)
  ),
  CONSTRAINT discrepancy_resolved_has_when CHECK (
    (status = 'open') OR (resolved_at IS NOT NULL)
  ),
  -- I3: nada ata operation_type a su columna de origen si no se fuerza aquí.
  -- Sin esto se puede insertar 'pickup' sin manifest_id, o 'reception' con
  -- manifest_id — la fila entra y no cuelga de ninguna operación real:
  -- ninguna pantalla la lista y la merma de spec-83 no la cuenta.
  CONSTRAINT discrepancy_source_matches_operation CHECK (
    (operation_type = 'pickup'    AND manifest_id        IS NOT NULL AND route_reception_id IS NULL) OR
    (operation_type = 'reception' AND route_reception_id IS NOT NULL AND manifest_id        IS NULL)
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
-- Cubre tanto (operator_id, status) como el filtro por operation_type +
-- detected_at que usan la lectura de fase 2 y "Cierres de hoy" de spec-83.
CREATE INDEX IF NOT EXISTS idx_discrepancies_operator_status
  ON public.discrepancies(operator_id, status, operation_type, detected_at);
CREATE INDEX IF NOT EXISTS idx_discrepancies_deleted_at
  ON public.discrepancies(deleted_at);

-- Un bulto no puede tener dos discrepancias 'missing' abiertas en el MISMO
-- evento (misma carga o misma recepción) — si no, cerrar dos veces duplica la
-- merma y el cliente firma dos veces sobre lo mismo. Dos eventos distintos
-- (la carga del lunes y la del martes) SÍ pueden tener, cada uno, su propia
-- discrepancia abierta sobre el mismo bulto: son dos hechos, no uno.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_discrepancy_per_package
  ON public.discrepancies (operator_id, package_id, operation_type, source_id)
  WHERE status = 'open' AND package_id IS NOT NULL AND deleted_at IS NULL;

-- Lo mismo para 'unexpected': el índice de arriba exige package_id IS NOT
-- NULL, así que una 'unexpected' (que nunca lo tiene) nunca entraba en
-- ninguna barrera de duplicación. Un reintento de la cola offline (spec-81)
-- duplicaba el sobrante contra el papel que el local ya firmó.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_discrepancy_per_barcode
  ON public.discrepancies (operator_id, barcode, operation_type, source_id)
  WHERE status = 'open' AND package_id IS NULL AND deleted_at IS NULL;

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

-- I2: sólo SELECT para authenticated. La fase 2 escribe con SECURITY DEFINER
-- (record_discrepancies, resolve_discrepancy), que no necesita el GRANT de
-- escritura — corre con los privilegios del dueño de la función. Dejar
-- INSERT/UPDATE/DELETE abiertos al cliente, sin trigger de auditoría, permite
-- hoy un UPDATE ... SET status='open' o un DELETE sin dejar rastro sobre una
-- fila que el spec llama "evidencia contra una indemnización".
-- La imagen base otorga por DEFAULT ACL arwdDxt (todo) a authenticated sobre
-- cualquier tabla nueva en public creada por postgres — un GRANT SELECT no
-- resta nada, sólo suma sobre ese default. Sin el REVOKE explícito de abajo,
-- authenticated conserva INSERT/UPDATE/DELETE aunque nunca se le hayan
-- otorgado por nombre: TEST 15 del pgTAP de esta fase lo comprueba con
-- has_table_privilege(), no leyendo el texto de esta migración. El mismo
-- patrón (GRANT sin REVOKE, con el default ACL rellenando el resto) aparece
-- en otras tablas del repo — issue aparte, fuera del alcance de esta fase.
GRANT SELECT ON public.discrepancies TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.discrepancies FROM authenticated;
REVOKE ALL ON public.discrepancies FROM anon;
GRANT ALL ON public.discrepancies TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Triggers — updated_at y auditoría (I2)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TRIGGER set_discrepancies_updated_at
    BEFORE UPDATE ON public.discrepancies
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Plantilla: 20260903000001_spec72_route_blocks.sql. service_role (fase 2's
-- SECURITY DEFINER RPCs) sigue pudiendo escribir; queda registrado quién y
-- cuándo, en vez de nadie.
DO $$ BEGIN
  CREATE TRIGGER audit_discrepancies_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.discrepancies
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Migrar las filas vivas de discrepancy_notes
-- -----------------------------------------------------------------------------
-- kind='missing' (discrepancy_notes sólo documentaba bultos declarados y no
-- escaneados durante la verificación de recogida), operation_type='pickup',
-- status='open' (nunca tuvieron resolución). Conserva note, manifest_id,
-- package_id, created_by_user_id -> detected_by_user_id, y created_at ->
-- detected_at (I1: sin esto una nota de marzo aparece detectada el día del
-- deploy, y "cuándo se detectó" es la columna que importa en una discusión
-- de indemnización).
--
-- Envuelta en una función (no un INSERT suelto) para que el pgTAP de esta
-- fase pueda invocarla directamente sobre fixtures y comprobar que las
-- columnas realmente llegan (C3b) — borrar el cuerpo de este INSERT dejaba
-- los tests en verde antes porque nada lo ejercía.
--
-- C1: nadie sabe cuántas notas hay en prod (las 5 conocidas son de QA). Dos
-- notas vivas del mismo package_id en manifiestos DISTINTOS ya no colisionan
-- (el índice único ahora incluye source_id), pero el ON CONFLICT DO NOTHING
-- se deja de todos modos — sin target, así que cubre cualquiera de los dos
-- índices únicos de la tabla — porque el backfill de una tabla de evidencia
-- no puede tumbar un deploy si algo que no anticipamos sí colisiona.
CREATE OR REPLACE FUNCTION public.spec85_backfill_discrepancy_notes()
RETURNS INTEGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_count      INTEGER;
  v_live_notes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_live_notes FROM public.discrepancy_notes WHERE deleted_at IS NULL;

  INSERT INTO public.discrepancies (
    operator_id, kind, operation_type, status,
    package_id, manifest_id, note, detected_by_user_id, detected_at,
    migrated_from_note_id,
    created_at, updated_at
  )
  SELECT
    dn.operator_id, 'missing', 'pickup', 'open',
    dn.package_id, dn.manifest_id, dn.note, dn.created_by_user_id, dn.created_at,
    dn.id,
    dn.created_at, dn.updated_at
  FROM public.discrepancy_notes dn
  WHERE dn.deleted_at IS NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ON CONFLICT DO NOTHING traga en silencio cualquier nota que colisione
  -- (p.ej. dos notas vivas del mismo package_id en el MISMO manifest_id —
  -- posible si el frontend hace read-then-write sin constraint única). Tragar
  -- es lo correcto para que el backfill nunca tumbe un deploy; que nadie note
  -- la diferencia no lo es. Esto no falla el deploy: sólo dice cuántas notas
  -- vivas había contra cuántas realmente entraron.
  IF v_count < v_live_notes THEN
    RAISE NOTICE 'spec85_backfill_discrepancy_notes: % nota(s) viva(s) en discrepancy_notes, % insertada(s) en discrepancies — % descartada(s) por ON CONFLICT DO NOTHING (colisión con una fila existente)',
      v_live_notes, v_count, (v_live_notes - v_count);
  END IF;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.spec85_backfill_discrepancy_notes() FROM PUBLIC;

SELECT public.spec85_backfill_discrepancy_notes();

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
