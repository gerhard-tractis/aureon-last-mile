-- =============================================================================
-- spec-86 fase 2a — Resolver: el bulto aparece
-- =============================================================================
-- TEMPLATED ON THE LATEST DEFINITION: 20260812000002_spec52_package_state_engine.sql:124
-- (the only later migration to redefine trg_reception_scan_advance_package_status
-- after its original, 20260318000001 — verified 2026-09-09 by
-- `git grep 'CREATE OR REPLACE FUNCTION.*trg_reception_scan_advance_package_status'`
-- across packages/database/supabase/migrations/, two hits, this one the later).
-- Everything below is byte-for-byte that body except the new discrepancy-
-- resolution block, appended inside the same IF.
--
-- WHAT THIS ADDS
-- El bulto aparece, se escanea en recepción con scan_result = 'received', y el
-- paquete avanza a en_bodega por el camino ya existente (arriba, sin cambios).
-- Esta migración añade una segunda UPDATE, independiente, en el mismo trigger:
-- si hay una discrepancia 'reception' ABIERTA para ese paquete en ESTA
-- route_reception, pasa a 'resolved' con una resolución automática, la hora y
-- quién escaneó.
--
-- "Independiente" es la palabra que importa (spec-86-discrepancias-de-recepcion.md,
-- fase 2a): "La resolución no mueve el estado del paquete por su cuenta: lo
-- hace el escaneo, y la fila sólo lo registra." Dos UPDATE separadas, no una
-- encadenada a la otra — si la primera no avanza el paquete (p.ej. porque
-- spec52_may_advance_status ya lo bloqueó por estar en un estado terminal o
-- ya haber avanzado), la segunda igual resuelve la discrepancia: el hecho
-- físico que la resuelve es que el bulto fue escaneado, no que el estado del
-- paquete cambió.
--
-- QUÉ FILA RESUELVE, Y POR QUÉ ESOS FILTROS
--   package_id = NEW.package_id            -- el bulto que se acaba de escanear,
--                                              no cualquier otra discrepancia
--                                              abierta de la misma route_reception
--   operator_id = NEW.operator_id          -- mismo hueco de tenant que la UPDATE
--                                              de arriba: SECURITY DEFINER salta
--                                              RLS y reception_scans RLS no valida
--                                              package_id contra el operator_id de
--                                              la fila insertada
--   operation_type = 'reception'           -- una discrepancia 'pickup' del mismo
--                                              paquete (spec-80 fase 2, faltó en
--                                              recogida) no la resuelve un scan de
--                                              recepción — son hechos distintos.
--                                              Verificado por mutación (fase 2a
--                                              pgTAP) que HOY este predicado es
--                                              defensa en profundidad, no la
--                                              única barrera: discrepancy_source_
--                                              matches_operation (20260913000001)
--                                              ya obliga a que 'pickup' tenga
--                                              route_reception_id NULL, así que
--                                              nunca puede igualar NEW.reception_id
--                                              de todos modos. Se deja explícito
--                                              por si esa CHECK cambia algún día.
--   route_reception_id = NEW.reception_id  -- el mismo evento, no "el bulto
--                                              alguna vez faltó en cualquier
--                                              recepción": una discrepancia de
--                                              la recepción del lunes no la
--                                              cierra un escaneo en la del martes
--   status = 'open'                        -- una discrepancia 'lost' o
--                                              'resolved' es evidencia cerrada
--                                              (resolve_discrepancy, 20260913000003,
--                                              20260913000005): no se reabre ni se
--                                              cambia. Este trigger no llama a
--                                              resolve_discrepancy() — dos razones
--                                              verificadas, no la cola offline de
--                                              spec-81 (esa cola no cubre
--                                              reception_scans: db.ts sólo declara
--                                              pickup_scan|close_manifest|
--                                              manifest_photo; useReceptionScan.ts
--                                              inserta siempre online). La primera:
--                                              resolve_discrepancy arranca con
--                                              get_operator_id() y lanza 42501 si
--                                              es NULL — cualquier INSERT sin JWT
--                                              de operador (service_role, seed,
--                                              backfill) reventaría el escaneo
--                                              entero. La segunda: si la fila ya
--                                              está resolved/lost, lanza 23505
--                                              (DISCREPANCY_ALREADY_RESOLVED) — un
--                                              trigger que llamara al RPC
--                                              reventaría el INSERT del escaneo
--                                              cada vez que la discrepancia ya
--                                              estuviera cerrada, justo el caso
--                                              que hoy es un no-op benigno. Este
--                                              trigger replica el mismo guard
--                                              (status = 'open') a mano en vez de
--                                              arriesgar cualquiera de las dos.
--   deleted_at IS NULL                     -- soft-delete, no-negociable del
--                                              repo. Ningún código de hoy pone
--                                              deleted_at en discrepancies —
--                                              mismo caso que rs.deleted_at en
--                                              fase 1 (20260920000001): guard
--                                              de futuro-proofing, no alcanzable
--                                              todavía por ningún flujo real.
--
-- resolved_by_user_id = NEW.scanned_by, no auth.jwt()->>'sub'. reception_scans
-- ya captura quién escaneó en una columna propia (scanned_by), consistente con
-- cómo los dos triggers de spec-52 ya evitan depender del JWT para el tenant
-- (usan NEW.operator_id, no get_operator_id()) — reception_scans no tiene cola
-- offline hoy (ver arriba), pero tampoco hace falta una para justificar esto:
-- es el mismo patrón que los triggers de spec-52 ya usan, columna por columna,
-- sin depender de que el JWT de la sesión que ejecuta el INSERT diga nada.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_reception_scan_advance_package_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.scan_result = 'received' AND NEW.package_id IS NOT NULL THEN
    -- Same tenant boundary as the pickup trigger above, and the same hole:
    -- reception_scans.operator_id is the SCANNER's tenant, never checked
    -- against package_id. SECURITY DEFINER bypasses RLS, so scope the write.
    UPDATE public.packages
    SET status = 'en_bodega',
        status_updated_at = NOW()
    WHERE id = NEW.package_id
      AND operator_id = NEW.operator_id
      AND public.spec52_may_advance_status(status::text, 'en_bodega');

    -- spec-86 fase 2a: resolve the open reception discrepancy this exact
    -- scan answers, if one exists. Independent of whether the UPDATE above
    -- actually advanced the package — see header. Deliberately does NOT call
    -- resolve_discrepancy(): it raises 42501 with no operator JWT (would
    -- abort a service_role/seed/backfill insert entirely) and 23505 if the
    -- row is already resolved/lost (would abort the scan on today's benign
    -- no-op) — see header for both, verified against the RPC's own body, not
    -- against spec-81's offline queue (which does not cover reception_scans
    -- at all). Replicates the same "open only, never reopen a closed row"
    -- guard by hand instead.
    UPDATE public.discrepancies
    SET status              = 'resolved',
        resolution          = 'Resuelto automáticamente: bulto escaneado en recepción',
        resolved_at         = NOW(),
        resolved_by_user_id = NEW.scanned_by
    WHERE package_id = NEW.package_id
      AND operator_id = NEW.operator_id
      AND operation_type = 'reception'
      AND route_reception_id = NEW.reception_id
      AND status = 'open'
      AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reception_scan_advance_package_status IS
'Advance package status to en_bodega on successful reception scan (spec-08),
guarded forward-only by spec52_may_advance_status (spec-52): a package already
past en_bodega is not regressed, and a terminal package is not resurrected. The
write is scoped to NEW.operator_id — SECURITY DEFINER bypasses RLS and
reception_scans RLS does not validate package_id against the row''s operator.
spec-86 fase 2a: the same scan also resolves the open reception discrepancy
(if any) recorded for this package on this exact route_reception — a separate
UPDATE, not chained to the status advance, scoped by operator_id/operation_type/
route_reception_id/status=open/deleted_at IS NULL. It never reopens a resolved
or lost row.';

-- CREATE OR REPLACE preserves the function's ACL — same signature, same
-- owner, no REVOKE/GRANT needed (this function pre-dates this migration).

-- ─── Verification ────────────────────────────────────────────────────────────
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM   pg_proc p
  WHERE  p.oid = 'public.trg_reception_scan_advance_package_status()'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'trg_reception_scan_advance_package_status is missing';
  END IF;
  IF v_src NOT LIKE '%en_bodega%' THEN
    RAISE EXCEPTION 'trg_reception_scan_advance_package_status lost the package status advance — this file was templated on the wrong definition';
  END IF;
  IF v_src NOT LIKE '%spec52_may_advance_status%' THEN
    RAISE EXCEPTION 'trg_reception_scan_advance_package_status lost the forward-only guard';
  END IF;
  IF v_src NOT LIKE '%public.discrepancies%' OR v_src NOT LIKE '%''resolved''%' THEN
    RAISE EXCEPTION 'trg_reception_scan_advance_package_status has no discrepancy-resolution block — fase 2a not installed';
  END IF;
  IF v_src NOT LIKE '%operation_type = ''reception''%' THEN
    RAISE EXCEPTION 'trg_reception_scan_advance_package_status discrepancy resolution is missing the operation_type=reception guard — would also resolve pickup discrepancies';
  END IF;
  IF v_src NOT LIKE '%status = ''open''%' THEN
    RAISE EXCEPTION 'trg_reception_scan_advance_package_status discrepancy resolution is missing the status=open guard — could reopen a resolved or lost row';
  END IF;

  RAISE NOTICE '✓ trg_reception_scan_advance_package_status: en_bodega advance intact, discrepancy resolution installed';
END $$;

COMMIT;
