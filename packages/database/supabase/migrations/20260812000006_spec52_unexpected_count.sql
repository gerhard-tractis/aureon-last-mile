-- =============================================================================
-- spec-52 Task 6 — unexpected packages at reception + manifest closure
-- =============================================================================
-- At reception the receptionist scans the truck flat; she never picks a carga.
-- A package can therefore arrive that has NO verified pickup scan on this route
-- — physically present, but the driver never scanned it at pickup. spec-52
-- accepts it as 'received' and flags it UNEXPECTED, because refusing it would
-- force the receptionist to lie to the system. received_count > expected_count
-- is a NORMAL outcome from here on, and nothing handled that before.
--
-- This migration:
--   1. adds route_receptions.unexpected_count
--   2. re-derives "unexpected" server-side inside the existing counting trigger
--   3. fixes the discrepancy-notes guard so offsetting errors cannot cancel out
--   4. closes the manifests when the reception batch completes
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART 1 — route_receptions.unexpected_count
-- =============================================================================
ALTER TABLE public.route_receptions
  ADD COLUMN IF NOT EXISTS unexpected_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.route_receptions.unexpected_count IS
'How many of received_count arrived with NO verified pickup scan on this route
(spec-52). Derived server-side by trg_reception_scans_route_received_count —
never client-attested, because it feeds the discrepancy report.';

-- =============================================================================
-- PART 2 — the counting trigger also tallies unexpected packages
-- =============================================================================
-- REPLACING THE FUNCTION, NOT THE TRIGGER. The function is
-- trg_reception_scans_route_received_count (latest definition:
-- 20260625000001:267-283, no later migration redefines it);
-- trg_reception_scans_route_count is only the trigger binding on
-- reception_scans. Replacing the trigger name here would create a brand-new
-- function nothing ever calls and unexpected_count would stay 0 forever.
--
-- The trigger cannot read a flag off the row: reception_scans has no such
-- column, and both the normal and the unexpected case write
-- scan_result = 'received'. A client-written reception_scans.was_unexpected
-- column was considered and REJECTED — this count feeds a discrepancy report
-- and must not be client-attested. So it is re-derived here:
--
--   unexpected := this package has no verified pickup scan on this route
--
-- NOTE: this joins pickup_scans -> manifests on manifest_id, which is NOT a
-- duplicate of the frontend validator's external_load_id join. The two ask
-- different questions: "was this package scanned at PICKUP on this route?"
-- (here) vs "does this package BELONG to this route?" (the validator).
-- Only the whole route was replaced; everything else below is verbatim from
-- 20260625000001.
CREATE OR REPLACE FUNCTION public.trg_reception_scans_route_received_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route_id   UUID;
  v_unexpected BOOLEAN;
BEGIN
  IF NEW.scan_result = 'received' THEN
    SELECT rr.pickup_route_id INTO v_route_id
      FROM public.route_receptions rr
     WHERE rr.id = NEW.reception_id;

    -- A NULL package_id also lands here as unexpected: nothing on this route
    -- can be matched to it, which is precisely what unexpected means.
    v_unexpected := NOT EXISTS (
      SELECT 1
        FROM public.pickup_scans ps
        JOIN public.manifests m ON m.id = ps.manifest_id
       WHERE ps.package_id = NEW.package_id
         AND m.pickup_route_id = v_route_id
         AND ps.scan_result = 'verified'
    );

    UPDATE public.route_receptions
       SET received_count = received_count + 1,
           unexpected_count = unexpected_count
                              + CASE WHEN v_unexpected THEN 1 ELSE 0 END,
           status = CASE WHEN status = 'pending' THEN 'in_progress'::hub_reception_status_enum
                         ELSE status END,
           started_at = COALESCE(started_at, NOW())
     WHERE id = NEW.reception_id;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_reception_scans_route_received_count
  IS 'On received reception_scan, bump route_receptions.received_count, tally unexpected_count for packages with no verified pickup scan on this route (spec-52), and promote pending→in_progress (spec-47).';

-- =============================================================================
-- PART 3 — complete_route_reception: offsetting errors must not cancel out
-- =============================================================================
-- Latest definition: 20260625000001:566 (no later migration redefines it).
-- ONLY the discrepancy guard changes; everything else is verbatim.
--
-- The old guard fired on received_count < expected_count. A naive widening to
-- received_count <> expected_count is ALSO wrong, because an unexpected package
-- increments BOTH counters, so two errors offset:
--
--   10 expected · 10 received, of which 1 unexpected  ->  received = expected
--   -> no notes demanded — yet one expected package never arrived AND one
--      package belonging on another truck did. That is the most likely
--      real-world shape and exactly what the discrepancy report exists to catch.
--
-- Correct rule:
--   matched_count := received_count - unexpected_count   (expected AND arrived)
--   notes required when matched_count <> expected_count OR unexpected_count > 0
CREATE OR REPLACE FUNCTION public.complete_route_reception(
  p_route_id            UUID,
  p_discrepancy_notes   TEXT DEFAULT NULL
) RETURNS public.route_receptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator UUID;
  v_rr       public.route_receptions;
  v_matched  INT;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rr FROM public.route_receptions
   WHERE pickup_route_id = p_route_id AND operator_id = v_operator AND deleted_at IS NULL;
  IF v_rr.id IS NULL THEN
    RAISE EXCEPTION 'route_reception for route % not found', p_route_id;
  END IF;

  v_matched := v_rr.received_count - v_rr.unexpected_count;

  IF (v_matched <> v_rr.expected_count OR v_rr.unexpected_count > 0)
     AND (p_discrepancy_notes IS NULL OR length(trim(p_discrepancy_notes)) = 0) THEN
    RAISE EXCEPTION 'discrepancy_notes required: matched (%) vs expected (%), unexpected (%)',
      v_matched, v_rr.expected_count, v_rr.unexpected_count;
  END IF;

  UPDATE public.route_receptions
     SET status = 'completed',
         completed_at = NOW(),
         discrepancy_notes = COALESCE(p_discrepancy_notes, discrepancy_notes)
   WHERE id = v_rr.id
  RETURNING * INTO v_rr;
  RETURN v_rr;
END $$;

COMMENT ON FUNCTION public.complete_route_reception(UUID, TEXT)
  IS 'Finalize a route reception; demands discrepancy_notes whenever matched (received - unexpected) <> expected or anything unexpected arrived (spec-52). Trigger cascades manifest + pickup_route status (spec-47).';

-- =============================================================================
-- PART 4 — completing the batch closes the manifests
-- =============================================================================
-- Latest definition: 20260625000001:573 (no later migration redefines it).
-- ONLY the 'completed' branch changes: it also closes the manifests, which
-- previously stayed at in_progress forever (15/15 production manifests were
-- stuck there). manifests.status and completed_at are set in the SAME UPDATE
-- as reception_status, which keeps trg_manifest_reception_status
-- (20260318000001:295-319) benign — it is guarded by
-- IF NEW.reception_status IS NULL, and here it never is.
CREATE OR REPLACE FUNCTION public.trg_route_receptions_status_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'in_progress' THEN
    IF NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    UPDATE public.manifests
       SET reception_status = 'reception_in_progress'
     WHERE pickup_route_id = NEW.pickup_route_id;

  ELSIF NEW.status = 'completed' THEN
    IF NEW.completed_at IS NULL THEN
      NEW.completed_at := NOW();
    END IF;
    UPDATE public.manifests
       SET reception_status = 'received',
           status = 'completed',
           completed_at = COALESCE(completed_at, NOW())
     WHERE pickup_route_id = NEW.pickup_route_id;
    UPDATE public.pickup_routes
       SET status = 'received', received_at = NOW()
     WHERE id = NEW.pickup_route_id
       AND status <> 'received';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_route_receptions_status_sync
  IS 'Cascade route_receptions status to manifests and pickup_routes; a completed reception also closes the manifests (spec-52).';

COMMIT;
