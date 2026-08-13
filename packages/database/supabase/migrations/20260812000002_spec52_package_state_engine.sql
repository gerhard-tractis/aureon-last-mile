-- =============================================================================
-- spec-52 Task 2 — package state engine: close the first link of the scan chain
-- =============================================================================
-- Production state before this migration: 1000 packages, every one at
-- 'ingresado', despite 171 pickup scans and 143 reception scans on record. The
-- pipeline has been deadlocked since it was built.
--
-- The chain has three links. Two already existed and worked:
--
--   1. pickup scan   -> packages.status = 'verificado'   MISSING  <- added here
--   2. reception scan-> packages.status = 'en_bodega'    exists (20260318000001)
--   3. packages      -> orders.status roll-up            exists (20260313000003,
--                                                        latest def 20260810000001)
--
-- Link 1 never existed **as a database trigger**: there is no trigger of any
-- kind on public.pickup_scans. Read that precisely — it does NOT mean nothing
-- ever wrote 'verificado'. The shipped frontend did: usePickupScans.ts ran an
-- unguarded packages.update({ status: 'verificado' }) straight from the browser
-- right after the pickup_scans insert. That client-side write is removed
-- earlier in THIS branch (3e4470e) because it would have made the forward-only
-- guard below inert — the trigger refuses a terminal package, the client would
-- promote it anyway one statement later.
--
-- So if you are debugging why 1000 production packages sat at 'ingresado'
-- despite a shipped write path: "no trigger existed" is only half the story,
-- and this migration is not a claim about why the client write did not take.
-- What it does claim is that from here on the promotion happens in exactly one
-- place, server-side, under the guard.
-- The reception-scan validator
-- (apps/frontend/src/lib/reception/reception-scan-validator.ts) rejects any
-- package still in a pre-verificado status with 'Paquete no verificado en
-- retiro', so every reception scan was persisted as 'not_found' and link 2
-- correctly never fired. One missing trigger deadlocked everything.
--
-- This migration adds link 1, adds a shared forward-only guard, and applies the
-- guard to link 2. It deliberately does NOT touch link 3 — recalculate_order_status
-- already derives orders.status (MIN pipeline position), orders.leading_status
-- (MAX) and the retorno_hub / all-terminal / cancel branches. A second roll-up
-- writer would race it and silently drop leading_status and
-- parcialmente_entregado handling.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Shared forward-only guard
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spec52_may_advance_status(
  p_current TEXT,
  p_new     TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_current IN ('cancelado','devuelto','dañado','extraviado','retorno_hub')
      THEN false
    ELSE pipeline_position(p_new) > pipeline_position(p_current)
  END;
$$;

COMMENT ON FUNCTION public.spec52_may_advance_status(TEXT, TEXT) IS
'Forward-only guard for scan-driven package status advances. THE ORDER OF THE
TWO BRANCHES IS LOAD-BEARING — do not "simplify" this to a bare rank comparison.
pipeline_position() (latest definition: 20260810000001) enumerates only the ten
active pipeline statuses and returns 0 from its ELSE branch for everything else.
In package_status_enum that means cancelado, devuelto, dañado, extraviado and
retorno_hub ALL rank 0. A bare pipeline_position(new) > pipeline_position(current)
would therefore evaluate 2 > 0 = true and promote a cancelled, damaged or lost
package back to verificado — resurrecting it. The terminal-status check must
run FIRST. Returns false for equal or lower ranks, so re-scans are idempotent.';

-- -----------------------------------------------------------------------------
-- 2. NEW — link 1: verified pickup scan advances the package to 'verificado'
--    Modelled on trg_reception_scan_advance_package_status (20260318000001).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_pickup_scan_advance_package_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.scan_result = 'verified' AND NEW.package_id IS NOT NULL THEN
    -- operator_id = NEW.operator_id IS A TENANT BOUNDARY, NOT A REDUNDANT
    -- PREDICATE. This function is SECURITY DEFINER, so it bypasses RLS. The
    -- RLS policy on pickup_scans only checks the INSERTED ROW's own
    -- operator_id; it never validates package_id against it. Without the
    -- predicate below, an authenticated user can insert a pickup_scans row
    -- carrying their own operator_id and ANOTHER tenant's package_id and force
    -- that foreign package to 'verificado'. Regression test:
    -- spec52_state_engine.sql CASE 7.
    UPDATE public.packages
    SET status            = 'verificado',
        status_updated_at = NOW()
    WHERE id = NEW.package_id
      AND operator_id = NEW.operator_id
      AND public.spec52_may_advance_status(status::text, 'verificado');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_pickup_scan_advance_package_status IS
'Advance package status to verificado on a verified pickup scan (spec-52). This
is the first link of the scan chain; without it reception scans are rejected as
"no verificado en retiro" and nothing ever reaches en_bodega. The write is
scoped to NEW.operator_id: SECURITY DEFINER bypasses RLS and pickup_scans RLS
does not validate package_id against the row''s operator_id.';

DO $$ BEGIN
  CREATE TRIGGER trg_pickup_scan_advance_status
    AFTER INSERT ON public.pickup_scans
    FOR EACH ROW EXECUTE FUNCTION public.trg_pickup_scan_advance_package_status();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 3. MODIFY — link 2: apply the same guard to the existing reception trigger.
--    Template: 20260318000001_create_hub_reception_tables.sql:263-288, which is
--    still the LATEST definition of this function (no later migration redefines
--    it). Only change: the guard in the WHERE clause. status_updated_at write
--    preserved verbatim.
-- -----------------------------------------------------------------------------
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
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reception_scan_advance_package_status IS
'Advance package status to en_bodega on successful reception scan (spec-08),
guarded forward-only by spec52_may_advance_status (spec-52): a package already
past en_bodega is not regressed, and a terminal package is not resurrected. The
write is scoped to NEW.operator_id — SECURITY DEFINER bypasses RLS and
reception_scans RLS does not validate package_id against the row''s operator.';
