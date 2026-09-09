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

  -- Ronda 2 de review (#704): before this fase, re-closing an already-
  -- completed route_reception was inert (it only refreshed completed_at/
  -- discrepancy_notes). After this fase it is NOT inert: a second call would
  -- re-run the missing-package scan and re-call record_discrepancies, which
  -- reopens a fresh 'open' row for any package whose discrepancy a human
  -- already resolved -- record_discrepancies' idempotency is scoped to
  -- status='open' (uniq_open_discrepancy_per_package), not to "has this
  -- source_id already been processed". A resolved discrepancy would vanish
  -- from Ops' queue and reappear as unresolved, silently. Reachable: any
  -- double-submit, or a retried offline-queue call (spec-81) after a success
  -- whose ack was lost. Same precedent and same ERRCODE as close_manifest's
  -- MANIFEST_ALREADY_SIGNED (20260916000001) -- 23505 (unique_violation,
  -- "this already happened" -> HTTP 409 under PostgREST), not P0001.
  IF v_rr.status = 'completed' THEN
    RAISE EXCEPTION 'ROUTE_RECEPTION_ALREADY_COMPLETED: route_reception % is already completed -- re-closing it would resurrect discrepancies a human already resolved', v_rr.id
      USING ERRCODE = '23505';
  END IF;

  IF v_rr.received_count < v_rr.expected_count
     AND (p_discrepancy_notes IS NULL OR length(trim(p_discrepancy_notes)) = 0) THEN
    RAISE EXCEPTION 'discrepancy_notes required when received (%) < expected (%)',
      v_rr.received_count, v_rr.expected_count;
  END IF;

  -- Ronda 2 de review (#704): this top-level check alone did NOT deliver what
  -- its old comment promised ("a malformed payload must never block the
  -- close") -- it only catches a malformed ARRAY. A well-formed array whose
  -- element has a non-UUID-shaped package_id (e.g. {"package_id":"nope"})
  -- passed this check and then blew up on the ::UUID cast below (22P02),
  -- aborting the whole close. A scalar element (["oops"]) was ALREADY safe:
  -- ->> on a jsonb value that is not an object returns NULL, no cast, no
  -- error -- that half of the old comment was accurate. The regex guard
  -- added below (search for "UUID-shape") is what actually closes the gap;
  -- this top-level check only handles NULL/non-array p_missing_reasons.
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
             -- UUID-shape guard (ronda 2 de review, #704): checked BEFORE
             -- the ::UUID cast, not after. A non-UUID-shaped string here
             -- (typo, a foreign id format, anything) simply fails the regex
             -- and never reaches the cast -- no 22P02, no aborted close.
             -- Silent by design, same as a reason for an already-received
             -- or soft-deleted package_id (neither is in the missing set
             -- this subquery runs against, so its note is dropped the same
             -- way): this fase's automatic backstop does not depend on
             -- p_missing_reasons at all, so a malformed or unmatched entry
             -- in it is data the client sent about nothing this call cares
             -- about, not an error.
             SELECT reason ->> 'note'
               FROM jsonb_array_elements(p_missing_reasons) reason
              WHERE reason ->> 'package_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                AND (reason ->> 'package_id')::UUID = p.id
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
  IS 'Finaliza una route_reception; el trigger cascada manifest + pickup_route (spec-47). spec-86 fase 1: en la MISMA transacción, abre una discrepancia (public.discrepancies, operation_type=''reception'') por cada paquete esperado (verificado en pickup_scans de esta ruta) sin un reception_scan ''received'' para esta route_reception -- con o sin razón: p_missing_reasons es un array opcional de {package_id, note} que el cliente puede mandar, pero el registro NO depende de él, así que un payload vacío o parcial no vuelve a tragarse un bulto en silencio. Un elemento con package_id que no tiene forma de UUID, o que no matchea ningún paquete faltante (ya recibido, borrado, o ajeno), pierde su nota en silencio -- no es un error, es una razón sobre algo que esta llamada no necesitaba. p_source_id de record_discrepancies es route_reception_id (v_rr.id), no manifest_id. discrepancy_notes del cierre sigue siendo el comentario libre de la recepción, ya no el único registro del faltante. Rechaza re-cerrar una route_reception ya ''completed'' (23505, ROUTE_RECEPTION_ALREADY_COMPLETED) -- un segundo cierre re-abriría como ''open'' cualquier discrepancia que un humano ya hubiera resuelto, mismo patrón que MANIFEST_ALREADY_SIGNED en close_manifest (20260916000001).';

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
