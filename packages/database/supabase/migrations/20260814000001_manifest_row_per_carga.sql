-- =============================================================================
-- One manifests row per CARGA, always — spec-53 follow-up
-- =============================================================================
-- Until now a `manifests` row was created lazily, the first time an operator
-- tapped a load card (apps/frontend/src/app/app/pickup/page.tsx). So a CARGA
-- that nobody had opened yet existed only as `orders.external_load_id`, and
-- get_pending_manifests returned id = NULL for it.
--
-- That split leaked into the UI: spec-53's "Imprimir etiquetas" button keys on
-- the manifest id, so it was hidden for exactly the loads that need it most —
-- labels are printed BEFORE the crew departs, which is precisely the state
-- where no manifests row existed. Tapping the card and pressing Back made the
-- button appear, which is how the defect was found in QA.
--
-- CARGA and manifest are the same thing in the operator's head. Make them the
-- same thing in the schema: every CARGA gets a manifests row at ingest, with
-- status 'pending' (the column default). 'in_progress' continues to mean "the
-- crew has started scanning", set by the app when the scan flow opens.
--
-- A trigger rather than an edit to the ingest code: orders arrive through
-- several paths (apps/agents intake-agent, apps/worker connectors, n8n CSV and
-- webhook flows). A trigger covers all of them and cannot be bypassed by a new
-- one.
-- =============================================================================

BEGIN;

-- ─── 1. Trigger: create the manifests row when a CARGA first appears ─────────
CREATE OR REPLACE FUNCTION public.ensure_manifest_for_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.external_load_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.manifests (operator_id, external_load_id, retailer_name, status)
  VALUES (NEW.operator_id, NEW.external_load_id, NEW.retailer_name, 'pending')
  ON CONFLICT ON CONSTRAINT unique_manifest_per_operator DO NOTHING;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.ensure_manifest_for_order() IS
'Creates the manifests row for a CARGA the first time an order carrying that
external_load_id is inserted. Idempotent via unique_manifest_per_operator.
total_orders/total_packages are left NULL — the pickup RPCs compute those from
orders, so a stale denormalised count would be worse than none.';

DROP TRIGGER IF EXISTS trg_ensure_manifest_for_order ON public.orders;
CREATE TRIGGER trg_ensure_manifest_for_order
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_manifest_for_order();

-- ─── 2. Backfill every existing CARGA that has no manifests row ──────────────
INSERT INTO public.manifests (operator_id, external_load_id, retailer_name, status)
SELECT DISTINCT ON (o.operator_id, o.external_load_id)
       o.operator_id, o.external_load_id, o.retailer_name, 'pending'
FROM   public.orders o
WHERE  o.external_load_id IS NOT NULL
  AND  o.deleted_at IS NULL
  AND  NOT EXISTS (
         SELECT 1 FROM public.manifests m
         WHERE  m.operator_id = o.operator_id
           AND  m.external_load_id = o.external_load_id
       )
ORDER  BY o.operator_id, o.external_load_id, o.created_at
ON CONFLICT ON CONSTRAINT unique_manifest_per_operator DO NOTHING;

-- ─── 3. Verification ─────────────────────────────────────────────────────────
-- Assert the invariant this migration exists to establish, rather than merely
-- checking the trigger object exists.
DO $$
DECLARE
  v_orphans INT;
BEGIN
  SELECT COUNT(*) INTO v_orphans
  FROM (
    SELECT DISTINCT o.operator_id, o.external_load_id
    FROM   public.orders o
    WHERE  o.external_load_id IS NOT NULL
      AND  o.deleted_at IS NULL
      AND  NOT EXISTS (
             SELECT 1 FROM public.manifests m
             WHERE  m.operator_id = o.operator_id
               AND  m.external_load_id = o.external_load_id
           )
  ) orphaned;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % CARGAs still have no manifests row', v_orphans;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ensure_manifest_for_order'
  ) THEN
    RAISE EXCEPTION 'trg_ensure_manifest_for_order not created';
  END IF;

  RAISE NOTICE '✓ every CARGA has a manifests row; trigger installed';
END $$;

COMMIT;
