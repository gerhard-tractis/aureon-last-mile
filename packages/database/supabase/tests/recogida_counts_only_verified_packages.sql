-- Recogida (get_ops_control_snapshot -> 'manifests') must count only packages
-- that were actually pickup-verified.
--
-- The pickup flow can legitimately close a carga out with packages missing:
-- the Revision step lists them (useMissingPackages), requires a note each
-- (discrepancy_notes), and Firma completes the manifest anyway. Those packages
-- never got a verified pickup_scan, so they are still 'ingresado' — and the
-- control tower must not count them as collected.
--
-- The 'orders' key is asserted UNCHANGED in the same breath: both keys build a
-- packages array from an identical subquery, and only the manifests one moves.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000864','Recogida Counts','recogida-counts-864')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, raw_data, imported_via, imported_at,
  external_load_id
) VALUES (
  'eeee0864-0000-4000-e000-000000000864','aaaaaaaa-0000-4000-a000-000000000864',
  'T864-ORD-001','Cliente 864','+56900000864',
  'Calle 864','TestComuna 864', CURRENT_DATE,
  '{}'::jsonb,'MANUAL', NOW(),
  'CARGA-VERIF-COUNT-864'
);

-- One package was scanned at the pickup point, one was not (documented as a
-- discrepancy). trg_recalculate_order_status rolls the order to the MIN
-- pipeline position, so it stays 'ingresado' and therefore stays in Recogida.
INSERT INTO public.packages (id, operator_id, order_id, label, raw_data, status)
VALUES
  ('bbbb0864-0000-4000-b000-000000000001','aaaaaaaa-0000-4000-a000-000000000864',
   'eeee0864-0000-4000-e000-000000000864','T864-ORD-001-CTN-1','{}'::jsonb,'verificado'),
  ('bbbb0864-0000-4000-b000-000000000002','aaaaaaaa-0000-4000-a000-000000000864',
   'eeee0864-0000-4000-e000-000000000864','T864-ORD-001-CTN-2','{}'::jsonb,'ingresado');

-- The manifest already exists: trg_ensure_manifest_for_order created it from the
-- order's external_load_id. Completing it is what the Firma step does, and
-- trg_manifest_reception_status then sets reception_status = awaiting_reception,
-- which is what puts the order in Recogida.
UPDATE public.manifests
   SET status = 'completed', completed_at = NOW()
 WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000864'
   AND external_load_id = 'CARGA-VERIF-COUNT-864';

DO $$
DECLARE rs TEXT;
BEGIN
  SELECT reception_status::text INTO rs FROM public.manifests
   WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000864'
     AND external_load_id = 'CARGA-VERIF-COUNT-864';
  IF rs IS DISTINCT FROM 'awaiting_reception' THEN
    RAISE EXCEPTION 'fixture precondition failed: reception_status is %, expected awaiting_reception', rs;
  END IF;
END $$;

DO $$
DECLARE
  snap            JSONB;
  recogida_pkgs   INT;
  recogida_rows   INT;
  orders_pkgs     INT;
BEGIN
  snap := public.get_ops_control_snapshot('aaaaaaaa-0000-4000-a000-000000000864');

  SELECT COUNT(*) INTO recogida_rows
    FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T864-ORD-001';
  IF recogida_rows <> 1 THEN
    RAISE EXCEPTION 'order should appear once in Recogida, found % row(s)', recogida_rows;
  END IF;

  SELECT jsonb_array_length(x->'packages') INTO recogida_pkgs
    FROM jsonb_array_elements(snap->'manifests') x
   WHERE x->>'order_number' = 'T864-ORD-001';
  IF recogida_pkgs <> 1 THEN
    RAISE EXCEPTION
      'Recogida must count only pickup-verified packages, got % (expected 1)', recogida_pkgs;
  END IF;

  SELECT jsonb_array_length(x->'packages') INTO orders_pkgs
    FROM jsonb_array_elements(snap->'orders') x
   WHERE x->>'order_number' = 'T864-ORD-001';
  IF orders_pkgs <> 2 THEN
    RAISE EXCEPTION
      'the orders key must keep every package, got % (expected 2)', orders_pkgs;
  END IF;
END $$;

ROLLBACK;
