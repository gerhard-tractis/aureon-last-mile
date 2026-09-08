-- =============================================================================
-- spec-85 fase 2 — Discrepancias: RPCs de escritura y lectura
-- =============================================================================
-- Fase 1 (20260913000001) dejó public.discrepancies con GRANT SELECT como
-- única concesión efectiva a `authenticated` — nada por debajo filtra por
-- operator_id salvo estos RPCs. record_discrepancies y resolve_discrepancy
-- son SECURITY DEFINER (propiedad de postgres): saltan RLS igual que
-- service_role, porque la tabla no tiene FORCE ROW LEVEL SECURITY. Cada uno
-- resuelve v_operator := public.get_operator_id() y filtra por él en TODAS
-- las consultas — plantilla: expand_carton (20260814000002).
--
--   record_discrepancies(p_operation_type, p_source_id, p_items jsonb)
--     Inserta una fila por ítem. Idempotente por los dos índices únicos
--     parciales de fase 1 (uniq_open_discrepancy_per_package,
--     uniq_open_discrepancy_per_barcode): un ON CONFLICT ... DO NOTHING por
--     forma, porque cada forma tiene su propio índice objetivo. La llaman
--     close_manifest (spec-80) y su equivalente de recepción.
--
--   resolve_discrepancy(p_id, p_status, p_resolution)
--     Sólo open -> resolved | lost. Rechaza reabrir con ERRCODE 23505
--     (unique_violation, el idioma del repo para "esto ya pasó" -> HTTP 409)
--     — distinto de P0001, que es para validaciones (estado destino inválido,
--     resolución vacía), igual que spec-80's close_manifest distingue "ya
--     firmado" (23505) de una validación (P0001). P0002 (no_data_found)
--     queda fuera a propósito: PostgREST lo mapea a 404, y una cola offline
--     (spec-81) leería "ya resuelta" como "no existe" y descartaría el ítem.
--
--   get_discrepancies(p_operation_type, p_status, p_source_id) — lectura
--     para la pantalla de resolución, todos los argumentos opcionales.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. record_discrepancies
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_discrepancies(
  p_operation_type public.discrepancy_operation_enum,
  p_source_id       UUID,
  p_items           JSONB
) RETURNS SETOF public.discrepancies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator    UUID;
  v_actor       UUID;
  v_item        JSONB;
  v_kind        TEXT;
  v_package_id  UUID;
  v_barcode     TEXT;
  v_note        TEXT;
  v_ids         UUID[] := ARRAY[]::UUID[];
  v_id          UUID;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- detected_by_user_id is optional evidence (who was present), not a
  -- tenant boundary, so unlike expand_carton this does not hard-require it.
  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  -- Ownership of the operation: the manifest/route_reception the client
  -- claims p_source_id belongs to must actually belong to this operator.
  -- Nothing below the RPC checks this — the table's effective RLS is
  -- SELECT-only, and this function runs SECURITY DEFINER as postgres.
  -- Checked even for an empty p_items (below) — a bogus/foreign source_id is
  -- still rejected regardless of whether there is anything to insert.
  IF p_operation_type = 'pickup' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.manifests
       WHERE id = p_source_id AND operator_id = v_operator AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'manifest % not found for this operator', p_source_id USING ERRCODE = '42501';
    END IF;
  ELSIF p_operation_type = 'reception' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.route_receptions
       WHERE id = p_source_id AND operator_id = v_operator AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'route_reception % not found for this operator', p_source_id USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown operation_type %', p_operation_type;
  END IF;

  -- M5: a clean close (0 missing, 0 unexpected) calls this with an empty
  -- array. close_manifest (spec-80) is named as this RPC's caller — failing
  -- the whole close with a 400 precisely when nothing went wrong would be
  -- backwards. Returning an empty set is the caller-friendly contract;
  -- [] is not malformed input, just "nothing to record" — but the source_id
  -- ownership above still gets checked first.
  IF jsonb_array_length(p_items) = 0 THEN
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_id         := NULL;
    v_kind       := v_item ->> 'kind';
    v_package_id := NULLIF(v_item ->> 'package_id', '')::UUID;
    v_barcode    := NULLIF(v_item ->> 'barcode', '');
    v_note       := v_item ->> 'note';

    IF v_kind = 'missing' THEN
      IF v_package_id IS NULL THEN
        RAISE EXCEPTION 'kind=missing requires package_id, got item %', v_item;
      END IF;

      -- Cross-tenant guard: package_id is client-supplied. Without this a
      -- caller under operator A's JWT, quoting operator B's package_id
      -- inside an otherwise-legitimate manifest of A's, would insert
      -- evidence pointing at another operator's package.
      IF NOT EXISTS (
        SELECT 1 FROM public.packages
         WHERE id = v_package_id AND operator_id = v_operator AND deleted_at IS NULL
      ) THEN
        RAISE EXCEPTION 'package % not found for this operator', v_package_id USING ERRCODE = '42501';
      END IF;

      IF p_operation_type = 'pickup' THEN
        INSERT INTO public.discrepancies
          (operator_id, kind, operation_type, package_id, manifest_id, detected_by_user_id, note)
        VALUES
          (v_operator, 'missing', 'pickup', v_package_id, p_source_id, v_actor, v_note)
        ON CONFLICT (operator_id, package_id, operation_type, source_id)
          WHERE status = 'open' AND package_id IS NOT NULL AND deleted_at IS NULL
        DO NOTHING;
      ELSE
        INSERT INTO public.discrepancies
          (operator_id, kind, operation_type, package_id, route_reception_id, detected_by_user_id, note)
        VALUES
          (v_operator, 'missing', 'reception', v_package_id, p_source_id, v_actor, v_note)
        ON CONFLICT (operator_id, package_id, operation_type, source_id)
          WHERE status = 'open' AND package_id IS NOT NULL AND deleted_at IS NULL
        DO NOTHING;
      END IF;

      SELECT id INTO v_id
        FROM public.discrepancies
       WHERE operator_id = v_operator AND package_id = v_package_id
         AND operation_type = p_operation_type AND source_id = p_source_id
         AND status = 'open' AND deleted_at IS NULL;

    ELSIF v_kind = 'unexpected' THEN
      IF v_barcode IS NULL THEN
        RAISE EXCEPTION 'kind=unexpected requires barcode, got item %', v_item;
      END IF;

      IF p_operation_type = 'pickup' THEN
        INSERT INTO public.discrepancies
          (operator_id, kind, operation_type, barcode, manifest_id, detected_by_user_id, note)
        VALUES
          (v_operator, 'unexpected', 'pickup', v_barcode, p_source_id, v_actor, v_note)
        ON CONFLICT (operator_id, barcode, operation_type, source_id)
          WHERE status = 'open' AND package_id IS NULL AND deleted_at IS NULL
        DO NOTHING;
      ELSE
        INSERT INTO public.discrepancies
          (operator_id, kind, operation_type, barcode, route_reception_id, detected_by_user_id, note)
        VALUES
          (v_operator, 'unexpected', 'reception', v_barcode, p_source_id, v_actor, v_note)
        ON CONFLICT (operator_id, barcode, operation_type, source_id)
          WHERE status = 'open' AND package_id IS NULL AND deleted_at IS NULL
        DO NOTHING;
      END IF;

      SELECT id INTO v_id
        FROM public.discrepancies
       WHERE operator_id = v_operator AND barcode = v_barcode AND package_id IS NULL
         AND operation_type = p_operation_type AND source_id = p_source_id
         AND status = 'open' AND deleted_at IS NULL;

    ELSE
      RAISE EXCEPTION 'unknown kind % (expected missing|unexpected)', v_kind;
    END IF;

    IF v_id IS NOT NULL THEN
      v_ids := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT * FROM public.discrepancies WHERE id = ANY(v_ids);
END $$;

COMMENT ON FUNCTION public.record_discrepancies(public.discrepancy_operation_enum, UUID, JSONB) IS
'spec-85 fase 2. Inserta una fila por ítem de p_items (cada uno
{kind, package_id|barcode, note}). Idempotente por los índices únicos
parciales de fase 1: llamar dos veces con el mismo ítem deja una sola fila
abierta. Verifica que p_source_id (manifest_id o route_reception_id según
p_operation_type) y cada package_id pertenezcan al operador del JWT — nada
por debajo lo hace, porque corre SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.record_discrepancies(public.discrepancy_operation_enum, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_discrepancies(public.discrepancy_operation_enum, UUID, JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. resolve_discrepancy
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_discrepancy(
  p_id         UUID,
  p_status     public.discrepancy_status_enum,
  p_resolution TEXT
) RETURNS public.discrepancies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_actor    UUID;
  v_row      public.discrepancies%ROWTYPE;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;

  -- M3: `NULL NOT IN (...)` evaluates to NULL, not TRUE — this IF would
  -- never fire for p_status = NULL (reachable from PostgREST as
  -- {"p_status": null}), and execution would fall through to the UPDATE
  -- below, which raises a raw 23502 not-null violation instead of a clean
  -- validation error. Check IS NULL explicitly.
  IF p_status IS NULL OR p_status NOT IN ('resolved', 'lost') THEN
    RAISE EXCEPTION 'p_status must be resolved or lost, got %', p_status USING ERRCODE = 'P0001';
  END IF;

  IF p_resolution IS NULL OR length(trim(p_resolution)) = 0 THEN
    RAISE EXCEPTION 'p_resolution is required' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership + lock: filtered by operator_id here, because the table's
  -- effective RLS is SELECT-only and this function runs as postgres. A
  -- discrepancy belonging to another operator is indistinguishable from one
  -- that does not exist — same as expand_carton's "package not found".
  SELECT * INTO v_row
    FROM public.discrepancies
   WHERE id = p_id AND operator_id = v_operator AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'discrepancy % not found for this operator', p_id USING ERRCODE = '42501';
  END IF;

  -- A closed discrepancy is evidence; editing it afterward destroys its
  -- probative value (see docs/specs/spec-85-discrepancias.md). This gets its
  -- own ERRCODE, 23505 (unique_violation — the repo's idiom for "this
  -- already happened", maps to HTTP 409), distinct from the P0001
  -- validation failures above, so an offline retry queue (spec-81) can tell
  -- "already closed, stop retrying" apart from "malformed request, do not
  -- retry blindly" — same split spec-80's close_manifest uses. Deliberately
  -- NOT P0002 (no_data_found): PostgREST maps that to HTTP 404, and a
  -- retrying client would read "already resolved" as "doesn't exist" and
  -- discard the item instead of stopping.
  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'discrepancy % is already % — a closed discrepancy is evidence and cannot be reopened or changed', p_id, v_row.status
      USING ERRCODE = '23505';
  END IF;

  -- m1: operator_id and deleted_at repeated here even though the FOR UPDATE
  -- select above already scoped and locked this exact row — "operator_id on
  -- every query" is a repo non-negotiable, not just a safety net for this
  -- particular call site.
  UPDATE public.discrepancies
     SET status              = p_status,
         resolution          = p_resolution,
         resolved_at         = NOW(),
         resolved_by_user_id = v_actor
   WHERE id = p_id AND operator_id = v_operator AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

COMMENT ON FUNCTION public.resolve_discrepancy(UUID, public.discrepancy_status_enum, TEXT) IS
'spec-85 fase 2. Transiciona una discrepancia de open a resolved o lost.
Rechaza reabrir o cambiar una discrepancia ya cerrada (resolved/lost -> open,
o resolved -> lost) con ERRCODE 23505 (unique_violation, "esto ya pasó" ->
HTTP 409): una discrepancia cerrada es evidencia y no se reabre. p_status
distinto de resolved/lost (incluido NULL), o p_resolution vacío, es una
validación aparte y usa P0001. p_resolution es obligatorio.';

REVOKE ALL ON FUNCTION public.resolve_discrepancy(UUID, public.discrepancy_status_enum, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_discrepancy(UUID, public.discrepancy_status_enum, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. get_discrepancies — lectura para la pantalla de resolución
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_discrepancies(
  p_operation_type public.discrepancy_operation_enum DEFAULT NULL,
  p_status         public.discrepancy_status_enum    DEFAULT NULL,
  p_source_id      UUID                               DEFAULT NULL
) RETURNS SETOF public.discrepancies
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  -- SECURITY INVOKER (default): the table already GRANTs SELECT to
  -- authenticated and RLS filters by operator_id, so a plain query is
  -- correctly tenant-scoped on its own. The explicit operator_id filter
  -- below is defence in depth, not the only thing standing between this
  -- query and another tenant's rows.
  SELECT *
    FROM public.discrepancies
   WHERE operator_id = public.get_operator_id()
     AND deleted_at IS NULL
     AND (p_operation_type IS NULL OR operation_type = p_operation_type)
     AND (p_status IS NULL OR status = p_status)
     AND (p_source_id IS NULL OR source_id = p_source_id)
   ORDER BY detected_at DESC;
$$;

COMMENT ON FUNCTION public.get_discrepancies(public.discrepancy_operation_enum, public.discrepancy_status_enum, UUID) IS
'spec-85 fase 2. Lectura para la pantalla de resolución, filtrable por
operation_type, status y/o source_id (manifest_id o route_reception_id según
corresponda). Todos los filtros son opcionales.';

REVOKE ALL ON FUNCTION public.get_discrepancies(public.discrepancy_operation_enum, public.discrepancy_status_enum, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_discrepancies(public.discrepancy_operation_enum, public.discrepancy_status_enum, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_discrepancies'
  ) THEN
    RAISE EXCEPTION 'record_discrepancies not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resolve_discrepancy'
  ) THEN
    RAISE EXCEPTION 'resolve_discrepancy not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_discrepancies'
  ) THEN
    RAISE EXCEPTION 'get_discrepancies not created';
  END IF;

  RAISE NOTICE '✓ spec-85 fase 2 discrepancies RPCs migration complete';
END $$;

COMMIT;
