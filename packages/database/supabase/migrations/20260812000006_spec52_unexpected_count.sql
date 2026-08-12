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
--   3. does NOT tighten the discrepancy-notes guard — deferred to the contract
--      phase, see PART 3 below for why that is deliberate
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
-- PART 3 — complete_route_reception: DELIBERATELY NOT TOUCHED HERE
-- =============================================================================
-- THE NOTES RULE IS NOT TIGHTENED IN THIS MIGRATION. Do not "finish the job"
-- by adding it back — read this first.
--
-- The rule spec-52 wants is:
--     matched := received_count - unexpected_count
--     notes required when matched <> expected_count OR unexpected_count > 0
--
-- and it is correct. A naive widening of the spec-47 guard to
-- received_count <> expected_count would NOT be, because an unexpected package
-- increments BOTH counters and two errors offset:
--
--   10 expected · 10 received, of which 1 unexpected  ->  received = expected
--   -> no notes demanded — yet one expected package never arrived AND one
--      package belonging on another truck did. That is the most likely
--      real-world shape and exactly what the discrepancy report exists to catch.
--
-- WHY IT IS DEFERRED. This migration is the EXPAND half of an expand/contract
-- pair and the database ships AHEAD of the frontend. The SHIPPED
-- FinalizeReceptionButton (apps/frontend/src/components/reception/
-- FinalizeReceptionButton.tsx:38) decides whether to even open the notes modal
-- with `const hasMissing = receivedCount < expectedCount`, and
-- unexpected_count is not carried by RouteReceptionSnapshot, so the UI cannot
-- see it. Tighten the guard now and the offsetting case becomes UNFINISHABLE
-- in production: 10 expected / 10 received / 1 unexpected reads as equal
-- counts, no modal opens, onFinalize(null) hits this function, the server
-- raises, and the receptionist gets an error toast with no way to supply the
-- notes the server is demanding. The batch could never be closed. Under the
-- spec-47 guard both shapes finalize fine — so tightening here is a REGRESSION
-- introduced by the very migration that makes the failing case reachable.
--
-- Tightening a guard the shipped UI cannot satisfy is a CONTRACT-phase change.
-- Migration 20260812000005 PART 5 already fails the deploy if anything
-- contract-phase lands early; this is the same principle applied to a guard
-- rather than to a dropped function.
--
-- WHERE IT LANDS INSTEAD. The spec-52 contract-phase task — the one migration
-- 20260812000005 refers to throughout as "Task 8" — together with the
-- FinalizeReceptionButton change that reads unexpected_count and mirrors the
-- server rule exactly:
--
--     const needsNotes =
--       receivedCount - unexpectedCount !== expectedCount || unexpectedCount > 0;
--
-- SQL and TSX must land in ONE commit; either alone is a broken reception
-- screen. See docs/specs/spec-52-…md, Task 11 (the FinalizeReceptionButton /
-- unexpected_count task), which now carries this migration in its Files block.
--
-- complete_route_reception therefore keeps its spec-47 definition
-- (20260625000001:566, guard: received_count < expected_count) untouched.
-- PARTS 1, 2 and 4 below are unaffected: unexpected_count is populated and
-- correct from this migration on, it is simply not yet ENFORCED.

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
