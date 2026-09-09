-- =============================================================================
-- spec-86 fase 1 — complete_route_reception ahora registra faltantes por
-- paquete en public.discrepancies (operation_type='reception')
-- =============================================================================
-- El agujero medido en QA (PR-2026-2298): una recepción se cerró 2 bultos
-- corta y lo único que quedó escrito fue la palabra "Corregir" en
-- route_receptions.discrepancy_notes -- texto libre, sin dueño, sin bulto.
-- Las dos órdenes quedaron invisibles en todo Ops Control (ver spec-86,
-- sección "El agujero, medido").
--
-- Plantilla de firma y de guardas: la ÚLTIMA definición de
-- complete_route_reception es 20260625000001:566-603 (verificado con
-- `git grep -l complete_route_reception packages/database/supabase/migrations/`
-- -- 20260812000006 PART 3 dice explícitamente "DELIBERATELY NOT TOUCHED
-- HERE" y 20260820000002 sólo la menciona en un comentario, no la redefine).
-- Esta migración cambia la lista de parámetros (agrega p_missing_reasons),
-- así que CREATE OR REPLACE no basta -- Postgres trataría dos listas de
-- parámetros distintas como funciones distintas y dejaría la vieja de
-- (UUID, TEXT) huérfana. DROP FUNCTION IF EXISTS primero es el patrón del
-- repo para esto (20260310100002, 20260409000008, 20260427000001,
-- 20260428000001/000004 lo hacen exactamente así).
--
-- Patrón de "registro automático incluso sin razón" y de las tres guardas de
-- soft-delete/scope: copiado de spec-80 fase 2
-- (20260916000001_spec80_fase2_close_manifest_records_discrepancies.sql),
-- que hace lo mismo para close_manifest en el lado pickup. Aquí no existe una
-- tabla discrepancy_notes equivalente para recepción (esa tabla es
-- manifest_id NOT NULL, sólo de pickup) -- el payload de razones por paquete
-- lo manda el cliente en la misma llamada (p_missing_reasons), no se lee de
-- una tabla aparte.
--
-- p_source_id para record_discrepancies es route_reception_id (v_rr.id), NO
-- manifest_id -- discrepancy_source_matches_operation (20260913000001) exige
-- exactamente eso para operation_type='reception'.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.complete_route_reception(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.complete_route_reception(
  p_route_id            UUID,
  p_discrepancy_notes   TEXT DEFAULT NULL,
  p_missing_reasons     JSONB DEFAULT '[]'::jsonb
) RETURNS public.route_receptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_rr       public.route_receptions;
  v_items    JSONB;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- Locked for the duration of this call, same reasoning as close_manifest's
  -- Rule 1 (20260916000001): the discrepancy computation below and the
  -- status UPDATE must see a consistent row, not two closers racing.
  SELECT * INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL
   FOR UPDATE;
  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'route_reception for route % not found', p_route_id;
  END IF;

  IF v_rr.received_count < v_rr.expected_count
     AND (p_discrepancy_notes IS NULL OR length(trim(p_discrepancy_notes)) = 0) THEN
    RAISE EXCEPTION 'discrepancy_notes required when received (%) < expected (%)',
      v_rr.received_count, v_rr.expected_count;
  END IF;

  -- Defensive: a malformed/absent payload behaves exactly like an empty one
  -- -- it must never block the close, only the missing-package detection
  -- below (which does not depend on this at all) records the discrepancy.
  IF p_missing_reasons IS NULL OR jsonb_typeof(p_missing_reasons) <> 'array' THEN
    p_missing_reasons := '[]'::jsonb;
  END IF;

  -- El respaldo automático es el punto (spec-86): un paquete esperado en esta
  -- ruta (verificado en pickup_scans) sin un reception_scan 'received' para
  -- ESTA route_reception abre una discrepancia 'missing', con o sin razón.
  -- p.deleted_at IS NULL -- mutation guard, mismo no-negociable de soft
  -- deletes que 20260916000001 fijó para el lado pickup: sin él, un paquete
  -- borrado contaría como faltante.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', 'missing',
           'package_id', p.id,
           'note', (
             SELECT reason ->> 'note'
               FROM jsonb_array_elements(p_missing_reasons) reason
              WHERE NULLIF(reason ->> 'package_id', '')::UUID = p.id
              LIMIT 1
           )
         )), '[]'::jsonb) INTO v_items
    FROM (
      SELECT DISTINCT ps.package_id
        FROM public.pickup_scans ps
        JOIN public.manifests m ON m.id = ps.manifest_id
       WHERE m.pickup_route_id = p_route_id
         AND ps.scan_result = 'verified'
         AND ps.package_id IS NOT NULL
    ) expected
    JOIN public.packages p
      ON p.id = expected.package_id
     AND p.deleted_at IS NULL
   WHERE NOT EXISTS (
     SELECT 1 FROM public.reception_scans rs
      WHERE rs.reception_id = v_rr.id
        AND rs.package_id = p.id
        AND rs.scan_result = 'received'
        AND rs.deleted_at IS NULL
   );

  UPDATE public.route_receptions
     SET status = 'completed',
         completed_at = NOW(),
         discrepancy_notes = COALESCE(p_discrepancy_notes, discrepancy_notes)
   WHERE id = v_rr.id
  RETURNING * INTO v_rr;

  -- Misma transacción que el UPDATE de arriba: si esto lanza, el cierre
  -- entero revierte -- una recepción "completed" con sus faltantes sin
  -- registrar es exactamente el bug que este fase existe para cerrar
  -- (PR-2026-2298). p_source_id ownership se re-verifica dentro de
  -- record_discrepancies contra v_rr.id; redundante con el SELECT ... FOR
  -- UPDATE de arriba pero inofensivo (misma fila, misma transacción). M5 de
  -- spec-85 fase 2: un v_items vacío (cierre limpio) se acepta sin lanzar.
  PERFORM public.record_discrepancies(
    'reception'::public.discrepancy_operation_enum, v_rr.id, v_items
  );

  RETURN v_rr;
END $$;

COMMENT ON FUNCTION public.complete_route_reception(UUID, TEXT, JSONB)
  IS 'Finaliza una route_reception; el trigger cascada manifest + pickup_route (spec-47). spec-86 fase 1: en la MISMA transacción, abre una discrepancia (public.discrepancies, operation_type=''reception'') por cada paquete esperado (verificado en pickup_scans de esta ruta) sin un reception_scan ''received'' para esta route_reception -- con o sin razón: p_missing_reasons es un array opcional de {package_id, note} que el cliente puede mandar, pero el registro NO depende de él, así que un payload vacío o parcial no vuelve a tragarse un bulto en silencio. p_source_id de record_discrepancies es route_reception_id (v_rr.id), no manifest_id. discrepancy_notes del cierre sigue siendo el comentario libre de la recepción, ya no el único registro del faltante.';

-- Repo convention (ver comentario de 20260916000001, misma regla): CREATE OR
-- REPLACE conserva el proacl existente, así que el REVOKE/GRANT explícito de
-- abajo es necesario aunque el DROP FUNCTION de arriba ya haya limpiado la
-- función vieja -- la nueva firma nace con los defaults de Supabase
-- (EXECUTE a anon/authenticated/service_role), no con lo que tenía la vieja.
REVOKE ALL ON FUNCTION public.complete_route_reception(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_route_reception(UUID, TEXT, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_route_reception(UUID, TEXT, JSONB) FROM anon;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_route_reception'
      AND pg_get_function_identity_arguments(p.oid) = 'p_route_id uuid, p_discrepancy_notes text, p_missing_reasons jsonb'
  ) THEN
    RAISE EXCEPTION 'complete_route_reception(UUID, TEXT, JSONB) not created';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_route_reception'
      AND pg_get_function_identity_arguments(p.oid) = 'p_route_id uuid, p_discrepancy_notes text'
  ) THEN
    RAISE EXCEPTION 'old complete_route_reception(UUID, TEXT) still exists -- DROP FUNCTION did not take';
  END IF;

  RAISE NOTICE '✓ spec-86 fase 1 complete_route_reception discrepancies migration complete';
END $$;

COMMIT;
