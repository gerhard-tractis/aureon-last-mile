-- =============================================================================
-- spec-80 fase 2 — close_manifest ahora llama a record_discrepancies
-- =============================================================================
-- Fase 1 (20260913000002) y su arreglo de ACL 1b (20260913000004) dejaron
-- explícito que close_manifest NO tocaba faltantes/ajenos — spec-85 fase 2
-- (record_discrepancies, 20260913000003) no existía todavía. Ya existe.
--
-- Esta migración es la única diferencia con 20260913000004: dentro de la
-- MISMA transacción que fija status/firmas, construye p_items a partir de
-- los mismos datos que ya alimentaban out_missing_count/out_unexpected_count
-- (paquetes declarados y no verificados + barcodes 'not_found' deduplicados)
-- y llama a record_discrepancies('pickup', p_manifest_id, p_items).
--
-- Por qué SQL manda la nota, no el frontend: el texto que el operario
-- escribió en 5e (Revisión) vive hoy en discrepancy_notes
-- (manifest_id, package_id, note) — la pantalla la guarda ANTES de llegar
-- aquí, si el operario decide escribirla. close_manifest la lee con un
-- LEFT JOIN; un bulto faltante sin nota SÍ es alcanzable desde 5e — la nota
-- es opcional (decisión del usuario, 2026-09-08: "Es opcional, y la dejaría
-- editable en el futuro"; el mock 5e muestra el CTA de cierre totalmente
-- opaco con bultos sin nota, sin ningún estado deshabilitado) — se registra
-- de todos modos con note=NULL. discrepancies.note no tiene NOT NULL, así
-- que esto no es una corrección de esquema, sólo de comentario: la fila que
-- este bloque ya insertaba con NULL antes de esta nota corregida es
-- exactamente la misma fila que inserta ahora. Nota (2026-09-08): hoy no
-- existe ningún camino para EDITAR esa nota después de capturada — ni
-- record_discrepancies ni resolve_discrepancy escriben sobre
-- discrepancies.note una vez insertada (resolve_discrepancy escribe
-- `resolution`, un campo distinto). Queda como trabajo pendiente, declarado
-- en spec-80 fase 2, no resuelto aquí.
--
-- record_discrepancies acepta p_items=[] y devuelve el conjunto vacío sin
-- lanzar (spec-85 fase 2, M5) — el caso de un cierre limpio (0 faltantes,
-- 0 ajenos) llama con [] y no falla el cierre.
--
-- p_operation_type='pickup' cast: record_discrepancies exige que p_source_id
-- (aquí, v_manifest.id) pertenezca a public.manifests para ese operador —
-- ya lo probó Rule 1 de esta misma función, así que esa comprobación es
-- redundante pero inofensiva (misma fila, mismo operador, misma transacción).
--
-- SECURITY DEFINER, operator_id desde public.get_operator_id() — nunca de un
-- argumento del cliente. Plantilla: expand_carton (20260814000002); ACL:
-- 20260913000004 (fase 1b), primer precedente de este mismo arreglo.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.close_manifest(
  p_manifest_id UUID,
  p_signatures  JSONB
) RETURNS TABLE (
  out_verified_count        INT,
  out_missing_count         INT,
  out_unexpected_count      INT,
  out_completed_at          TIMESTAMPTZ,
  out_signature_client      TEXT,
  out_signature_client_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator             UUID;
  v_manifest             public.manifests%ROWTYPE;
  v_operator_signature   TEXT;
  v_operator_name        TEXT;
  v_client_signature     TEXT;
  v_client_name          TEXT;
  v_verified_count       INT;
  v_missing_count        INT;
  v_unexpected_count     INT;
  v_items                JSONB;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'NO_OPERATOR_IN_JWT: no operator in JWT' USING ERRCODE = '42501';
  END IF;

  -- H5 (fix round 1)/F4 (fix round 2): the signer's name is legal evidence
  -- of a custody transfer — it must come from the authenticated actor's own
  -- row, never from p_signatures, which a client fully controls. Same
  -- principle as expand_carton's v_actor, one step further: that RPC only
  -- records WHO acted (created_by_user_id); this one has to also assert
  -- what their name IS at the moment of signing.
  --
  -- No NOT FOUND / NULL guard here (fix round 2, F4): get_operator_id()
  -- above already resolved v_operator FROM this exact row — same
  -- `id = auth.uid() AND deleted_at IS NULL` predicate — and `full_name` is
  -- NOT NULL in the schema (20260216170542). A NULL v_operator_name is
  -- unreachable *except by a race between these two statements*: under
  -- READ COMMITTED, if the user's `deleted_at` gets sealed between
  -- get_operator_id()'s SELECT and this one, this SELECT returns zero rows
  -- and v_operator_name stays NULL — the close proceeds and writes a
  -- signature with no name, silently. Round 1's "signing user not found"
  -- branch and its `AND operator_id = v_operator` filter were both dead
  -- code performing a tautological re-check of what get_operator_id() had
  -- just proven, not a guard against this race — the window is real but
  -- narrow enough (two statements, no I/O between them) that no guard was
  -- added here for it.
  SELECT full_name INTO v_operator_name
    FROM public.users
   WHERE id = auth.uid()
     AND deleted_at IS NULL;

  -- Rule 1: ownership + soft-delete, locked to serialize concurrent closes of
  -- the same manifest (two crew members tapping "close" at once).
  SELECT * INTO v_manifest
    FROM public.manifests
   WHERE id = p_manifest_id
     AND operator_id = v_operator
     AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MANIFEST_NOT_FOUND: manifest not found' USING ERRCODE = '42501';
  END IF;

  -- Rule 2 (fix round 1, H4): a manifest that was never actually worked —
  -- 'pending' (remove_manifest_from_route, 20260824000004, resets it there
  -- with started_at NULL) or 'cancelled' — cannot be signed. 'in_progress'
  -- and 'completed' are both legitimate: see rule 3 for why 'completed' is
  -- not rejected outright here.
  IF v_manifest.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'MANIFEST_NOT_CLOSABLE: manifest is not in a closable state (status: %)', v_manifest.status;
  END IF;

  -- Rule 3 (fix round 1, H1): trg_route_receptions_status_sync
  -- (20260812000006) is a SECOND closer — it force-sets manifests.status =
  -- 'completed' the moment the hub finishes receiving the whole route,
  -- with NO signature at all, precisely because crews have skipped this
  -- screen for months (that gap is what this spec exists to close). Gating
  -- on status = 'completed', as fix round 0 did, made that signature
  -- permanently uncapturable — the exact evidence a shipper needs to
  -- contest an indemnity claim. The real "already closed" boundary is
  -- whether a signature already exists, not the status column.
  --
  -- ERRCODE 23505 (fix round 2, F2 — BLOCKING in round 2's review): NOT
  -- P0002. P0002 is Postgres's standard no_data_found, and this repo
  -- already spends it on "not found" in 8 places (20260812000005,
  -- 20260827000003) — PostgREST maps P0002 to HTTP 404, and a consumer
  -- following the repo's own pattern (app/api/dispatch/routes/[id]/blocks/
  -- route.ts: `rpcError.code === 'P0002' && message.startsWith(...)`) would
  -- read "already signed" as "doesn't exist". 23505 (unique_violation) is
  -- the repo's idiom for "this already happened" (20260820000003,
  -- 20260824000003) and maps to 409, which is what an idempotent
  -- double-close actually is.
  IF v_manifest.signature_operator IS NOT NULL THEN
    RAISE EXCEPTION 'MANIFEST_ALREADY_SIGNED: manifest already has an operator signature' USING ERRCODE = '23505';
  END IF;

  v_operator_signature := NULLIF(p_signatures ->> 'operator_signature', '');
  v_client_signature   := NULLIF(p_signatures ->> 'client_signature', '');
  v_client_name        := NULLIF(p_signatures ->> 'client_name', '');

  -- Rule 4: the operator's own signature is mandatory (5f enforces it in the
  -- UI too); the local's/client's signature is optional — the mock allows
  -- closing without it.
  IF v_operator_signature IS NULL THEN
    RAISE EXCEPTION 'OPERATOR_SIGNATURE_REQUIRED: operator signature is required';
  END IF;

  -- completed_at: COALESCE, not NOW() unconditionally — a manifest rescued
  -- under rule 3 was already completed by the OTHER closer, at that
  -- closer's time. Signing it later must not rewrite when the load actually
  -- finished.
  UPDATE public.manifests
     SET status                  = 'completed',
         completed_at            = COALESCE(completed_at, NOW()),
         signature_operator      = v_operator_signature,
         signature_operator_name = v_operator_name,
         signature_client        = v_client_signature,
         signature_client_name   = v_client_name
   WHERE id = v_manifest.id;

  -- Summary for 5i, derived by query — the same shape usePickupScans +
  -- useMissingPackages already compute client-side, moved server-side so the
  -- close and its summary are consistent with each other.
  SELECT COUNT(DISTINCT ps.package_id) INTO v_verified_count
    FROM public.pickup_scans ps
   WHERE ps.manifest_id = v_manifest.id
     AND ps.scan_result = 'verified'
     AND ps.deleted_at IS NULL;

  -- fase 2: p_items for record_discrepancies — one 'missing' entry per
  -- declared-and-unverified package (LEFT JOIN discrepancy_notes for
  -- whatever note 5e already saved; NULL if none), one 'unexpected' entry
  -- per distinct 'not_found' barcode (H3's dedupe rule, same as
  -- out_unexpected_count below).
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_items
    FROM (
      SELECT jsonb_build_object('kind', 'missing', 'package_id', p.id, 'note', dn.note) AS item
        FROM public.packages p
        JOIN public.orders o ON o.id = p.order_id
        LEFT JOIN public.discrepancy_notes dn
          ON dn.manifest_id = v_manifest.id
         AND dn.package_id = p.id
         AND dn.deleted_at IS NULL
       WHERE o.operator_id = v_operator
         AND o.external_load_id = v_manifest.external_load_id
         AND o.deleted_at IS NULL
         AND p.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.pickup_scans ps
            WHERE ps.manifest_id = v_manifest.id
              AND ps.package_id = p.id
              AND ps.scan_result = 'verified'
              AND ps.deleted_at IS NULL
         )
      UNION ALL
      SELECT jsonb_build_object('kind', 'unexpected', 'barcode', barcode_scanned, 'note', NULL)
        FROM (
          SELECT DISTINCT barcode_scanned
            FROM public.pickup_scans
           WHERE manifest_id = v_manifest.id
             AND scan_result = 'not_found'
             AND deleted_at IS NULL
        ) unexpected_barcodes
    ) all_items;

  -- Same transaction as the status/signature UPDATE above: if this raises,
  -- the whole close rolls back — a half-closed manifest (signed, but with
  -- its faltantes unrecorded) is exactly the failure mode this phase exists
  -- to remove. p_source_id ownership is re-checked inside
  -- record_discrepancies against v_manifest.id; redundant with Rule 1 above
  -- but harmless (same row, same transaction).
  PERFORM public.record_discrepancies('pickup'::public.discrepancy_operation_enum, v_manifest.id, v_items);

  -- H3 (fix round 1): DISTINCT on barcode_scanned, not a row count. The
  -- validator (scan-validator.ts) only dedupes 'verified' scans; a foreign
  -- barcode that trips the reject beep and gets rescanned inserts one
  -- 'not_found' row per attempt. Counting rows would multiply one foreign
  -- package into several.
  --
  -- fase 2: this IS now the figure the client signs on 5f — it is the same
  -- count of barcodes just recorded as 'unexpected' discrepancies above,
  -- computed the same way.
  SELECT COUNT(DISTINCT ps.barcode_scanned) INTO v_unexpected_count
    FROM public.pickup_scans ps
   WHERE ps.manifest_id = v_manifest.id
     AND ps.scan_result = 'not_found'
     AND ps.deleted_at IS NULL;

  SELECT COUNT(*) INTO v_missing_count
    FROM public.packages p
    JOIN public.orders o ON o.id = p.order_id
   WHERE o.operator_id = v_operator
     AND o.external_load_id = v_manifest.external_load_id
     AND o.deleted_at IS NULL
     AND p.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.pickup_scans ps
        WHERE ps.manifest_id = v_manifest.id
          AND ps.package_id = p.id
          AND ps.scan_result = 'verified'
          AND ps.deleted_at IS NULL
     );

  RETURN QUERY
  SELECT v_verified_count, v_missing_count, v_unexpected_count,
         m.completed_at, m.signature_client, m.signature_client_name::TEXT
    FROM public.manifests m
   WHERE m.id = v_manifest.id;
END $$;

COMMENT ON FUNCTION public.close_manifest(UUID, JSONB) IS
'spec-80 fase 2. Atomically closes a pickup manifest: status=completed,
completed_at, the four signature columns, AND — new in fase 2 — every
declared-and-unverified package as an open ''missing'' discrepancy (with
whatever note 5e already saved in discrepancy_notes, or NULL) and every
distinct ''not_found'' barcode as an open ''unexpected'' discrepancy, via
public.record_discrepancies(''pickup'', manifest_id, items) — spec-85 fase 2 —
all in the SAME transaction. A clean close (0 missing, 0 unexpected) calls
record_discrepancies with an empty array, which returns the empty set rather
than raising (spec-85''s M5). Operator-scoped via get_operator_id() —
p_manifest_id is never trusted as a tenant boundary on its own.
signature_operator_name is derived server-side from public.users via
auth.uid(), never taken from p_signatures — it is custody-transfer evidence
and a client-supplied value would be worthless as such. Rejects a manifest
from another operator (42501, "MANIFEST_NOT_FOUND: ..."), no operator_id in
the JWT (42501, "NO_OPERATOR_IN_JWT: ..."), one in a non-closable status
(P0001, "MANIFEST_NOT_CLOSABLE: ..."), one already signed (23505,
"MANIFEST_ALREADY_SIGNED: ...", an idempotent 409 under PostgREST — NOT
P0002, which this repo already uses for 404 "not found"), or a call missing
the operator signature (P0001, "OPERATOR_SIGNATURE_REQUIRED: ..."; client
signature is optional). Does NOT reject a manifest already marked completed
by trg_route_receptions_status_sync (20260812000006) with no signature —
that is the rescue path fix round 1 exists for; completed_at is preserved
via COALESCE rather than overwritten in that case. Does NOT check
pickup_route_crew / assigned_to_user_id — any authenticated user of the
operator can sign any of that operator''s manifests, a pre-existing gap
declared as debt in the spec, not closed here. p_signatures shape:
{"operator_signature": text,
 "client_signature": text|null, "client_name": text|null}.';

-- Repo convention (20260812000003:298, 20260812000005:273,
-- 20260820000003:316, 20260820000005:110; most recent precedent for this
-- exact fix, spec-80 fase 1b, 20260913000004): CREATE OR REPLACE preserves
-- the existing proacl, so the REVOKE/GRANT pair below is required even
-- though the function body above is a full replacement, or `anon` keeps its
-- default-ACL EXECUTE grant.
REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_manifest(UUID, JSONB) TO authenticated;
REVOKE ALL ON FUNCTION public.close_manifest(UUID, JSONB) FROM anon;

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'close_manifest'
  ) THEN
    RAISE EXCEPTION 'close_manifest not created';
  END IF;

  RAISE NOTICE '✓ spec-80 fase 2 close_manifest records_discrepancies migration complete';
END $$;

COMMIT;
