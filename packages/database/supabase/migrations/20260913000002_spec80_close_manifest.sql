-- =============================================================================
-- spec-80 fase 1 — close_manifest(p_manifest_id, p_signatures)
-- =============================================================================
-- Today the "finish this load" screen (`/app/pickup/complete/[loadId]`) does a
-- raw client-side `.update()` on public.manifests: status, completed_at, and
-- the four signature columns in one call. A dropped connection mid-write — the
-- normal case on this screen, in a warehouse dock with patchy signal — leaves
-- the manifest half-closed: signed but not completed, or completed with no
-- signature. This RPC makes the close atomic and server-side.
--
-- Scope note (see docs/specs/spec-80-recogida-movil-cierre-de-carga.md, fase 1,
-- "Alcance corregido 2026-09-07"): missing packages ("faltantes") are NOT
-- handled here. They move to fase 2, which calls record_discrepancies
-- (spec-85 fase 2) once that RPC exists. This phase only closes a manifest —
-- with or without gaps — and returns a summary (verified/missing/unexpected)
-- derived by query, exactly as the fase-0 complete/[loadId] screen already
-- computes it client-side via usePickupScans + useMissingPackages.
--
-- SECURITY DEFINER, operator_id from public.get_operator_id() — never from a
-- client argument. Template: expand_carton (20260814000002).
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
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'manifest not found' USING ERRCODE = '42501';
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

  -- H3 (fix round 1): DISTINCT on barcode_scanned, not a row count. The
  -- validator (scan-validator.ts) only dedupes 'verified' scans; a foreign
  -- barcode that trips the reject beep and gets rescanned inserts one
  -- 'not_found' row per attempt. Counting rows would multiply one foreign
  -- package into several.
  --
  -- F5 (fix round 2, comment correction): this is NOT yet "the figure the
  -- client signs" — complete/[loadId]/page.tsx today discards this RPC's
  -- return value (`const { error } = await supabase.rpc(...)`) and still
  -- renders client-computed counts. This return value becomes what 5i
  -- actually displays in fase 5; this dedupe fix is correct regardless, but
  -- it isn't load-bearing for anything on screen yet.
  SELECT COUNT(DISTINCT ps.barcode_scanned) INTO v_unexpected_count
    FROM public.pickup_scans ps
   WHERE ps.manifest_id = v_manifest.id
     AND ps.scan_result = 'not_found'
     AND ps.deleted_at IS NULL;

  RETURN QUERY
  SELECT v_verified_count, v_missing_count, v_unexpected_count,
         m.completed_at, m.signature_client, m.signature_client_name::TEXT
    FROM public.manifests m
   WHERE m.id = v_manifest.id;
END $$;

COMMENT ON FUNCTION public.close_manifest(UUID, JSONB) IS
'spec-80 fase 1. Atomically closes a pickup manifest: status=completed,
completed_at, and the four signature columns, in one transaction. Operator-
scoped via get_operator_id() — p_manifest_id is never trusted as a tenant
boundary on its own. signature_operator_name is derived server-side from
public.users via auth.uid(), never taken from p_signatures — it is
custody-transfer evidence and a client-supplied value would be worthless as
such. Rejects a manifest from another operator (42501, "manifest not
found"), one in a non-closable status (P0001,
"MANIFEST_NOT_CLOSABLE: ..."), one already signed (23505,
"MANIFEST_ALREADY_SIGNED: ...", an idempotent 409 under PostgREST — NOT
P0002, which this repo already uses for 404 "not found"), or a call missing
the operator signature (P0001, "OPERATOR_SIGNATURE_REQUIRED: ..."; client
signature is optional). Does NOT reject a manifest already marked completed
by trg_route_receptions_status_sync (20260812000006) with no signature —
that is the rescue path fix round 1 exists for; completed_at is preserved
via COALESCE rather than overwritten in that case (the moment of the
RESCUED signature itself is not recorded in any queryable column — see
spec-80''s fix-round-2 note, a signed_at candidate for a later phase). Does
NOT touch missing/unexpected packages — that is fase 2, via
record_discrepancies (spec-85). Does NOT check pickup_route_crew /
assigned_to_user_id — any authenticated user of the operator can sign any
of that operator''s manifests, a pre-existing gap the raw client .update()
this RPC replaces already had; declared as debt in the spec, not closed
here. p_signatures shape:
{"operator_signature": text,
 "client_signature": text|null, "client_name": text|null}.';

GRANT EXECUTE ON FUNCTION public.close_manifest(UUID, JSONB) TO authenticated;

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

  RAISE NOTICE '✓ spec-80 fase 1 close_manifest migration complete';
END $$;

COMMIT;
