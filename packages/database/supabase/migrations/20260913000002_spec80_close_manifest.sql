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

  -- Rule 2: cannot close what is already closed.
  IF v_manifest.status = 'completed' THEN
    RAISE EXCEPTION 'manifest already completed';
  END IF;

  v_operator_signature := NULLIF(p_signatures ->> 'operator_signature', '');
  v_operator_name      := NULLIF(p_signatures ->> 'operator_name', '');
  v_client_signature   := NULLIF(p_signatures ->> 'client_signature', '');
  v_client_name        := NULLIF(p_signatures ->> 'client_name', '');

  -- Rule 3: the operator's own signature is mandatory (5f enforces it in the
  -- UI too); the local's/client's signature is optional — the mock allows
  -- closing without it.
  IF v_operator_signature IS NULL THEN
    RAISE EXCEPTION 'operator signature is required';
  END IF;

  UPDATE public.manifests
     SET status                  = 'completed',
         completed_at            = NOW(),
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

  SELECT COUNT(*) INTO v_unexpected_count
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
boundary on its own. Rejects a manifest from another operator, one already
completed, or a call missing the operator signature (client signature is
optional). Does NOT touch missing/unexpected packages — that is fase 2, via
record_discrepancies (spec-85). p_signatures shape:
{"operator_signature": text, "operator_name": text,
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
