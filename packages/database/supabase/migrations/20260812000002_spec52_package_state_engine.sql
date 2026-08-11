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
-- Link 1 never existed: there is no trigger of any kind on public.pickup_scans.
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
    UPDATE public.packages
    SET status            = 'verificado',
        status_updated_at = NOW()
    WHERE id = NEW.package_id
      AND public.spec52_may_advance_status(status::text, 'verificado');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_pickup_scan_advance_package_status IS
'Advance package status to verificado on a verified pickup scan (spec-52). This
is the first link of the scan chain; without it reception scans are rejected as
"no verificado en retiro" and nothing ever reaches en_bodega.';

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
    UPDATE public.packages
    SET status = 'en_bodega',
        status_updated_at = NOW()
    WHERE id = NEW.package_id
      AND public.spec52_may_advance_status(status::text, 'en_bodega');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reception_scan_advance_package_status IS
'Advance package status to en_bodega on successful reception scan (spec-08),
guarded forward-only by spec52_may_advance_status (spec-52): a package already
past en_bodega is not regressed, and a terminal package is not resurrected.';
