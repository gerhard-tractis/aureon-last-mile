-- spec-51 — closing a dispatch route must not cancel its orders
--
-- Regression test for the 'listo' -> 'listo_para_despacho' rename
-- (20260324000001) never reaching pipeline_position(). Before the fix,
-- pipeline_position('listo_para_despacho') returned 0, so an order whose
-- packages had all been staged for dispatch counted as having zero active
-- packages and recalculate_order_status() set it to 'cancelado'.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000251','Spec51 Pipeline','spec51-pipeline')
ON CONFLICT (slug) DO NOTHING;

-- ── pipeline_position knows the current literal, not the pre-rename one ─────
DO $$
BEGIN
  IF pipeline_position('listo_para_despacho') <> 8 THEN
    RAISE EXCEPTION
      'pipeline_position(''listo_para_despacho'') = %, expected 8 — the 20260324000001 rename did not reach this function',
      pipeline_position('listo_para_despacho');
  END IF;

  IF pipeline_position('listo') <> 0 THEN
    RAISE EXCEPTION
      'pipeline_position(''listo'') = %, expected 0 — that value no longer exists in the enum',
      pipeline_position('listo');
  END IF;
END $$;

-- ── The real path: stage every package for dispatch, order must not cancel ──
-- customer_phone / raw_data / imported_via / imported_at are NOT NULL with no
-- default; the fixture omitted them, so this INSERT aborted the transaction and
-- nothing below it ever ran.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, status, leading_status,
  raw_data, imported_via, imported_at
) VALUES (
  'aaaaaaaa-0000-4000-a000-000000000252',
  'aaaaaaaa-0000-4000-a000-000000000251',
  'SPEC51-ORD-1', 'Cliente Spec51', '+56900000251',
  'Calle Spec51 123', 'Maipú', CURRENT_DATE, 'en_carga', 'en_carga',
  '{}'::jsonb, 'MANUAL', NOW()
);

-- packages.raw_data is likewise NOT NULL with no default.
INSERT INTO public.packages (id, operator_id, order_id, label, status, raw_data)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000253',
   'aaaaaaaa-0000-4000-a000-000000000251',
   'aaaaaaaa-0000-4000-a000-000000000252', 'SPEC51-CTN-1', 'en_carga', '{}'::jsonb),
  ('aaaaaaaa-0000-4000-a000-000000000254',
   'aaaaaaaa-0000-4000-a000-000000000251',
   'aaaaaaaa-0000-4000-a000-000000000252', 'SPEC51-CTN-2', 'en_carga', '{}'::jsonb);

-- Exactly what POST /api/dispatch/routes/[id]/close does.
UPDATE public.packages
SET status = 'listo_para_despacho'
WHERE order_id = 'aaaaaaaa-0000-4000-a000-000000000252'
  AND status   = 'en_carga';

DO $$
DECLARE
  v_status  TEXT;
  v_leading TEXT;
BEGIN
  SELECT status::text, leading_status::text
  INTO v_status, v_leading
  FROM public.orders
  WHERE id = 'aaaaaaaa-0000-4000-a000-000000000252';

  IF v_status = 'cancelado' THEN
    RAISE EXCEPTION
      'closing a dispatch route cancelled the order — pipeline_position() does not recognise listo_para_despacho';
  END IF;

  IF v_status <> 'listo_para_despacho' OR v_leading <> 'listo_para_despacho' THEN
    RAISE EXCEPTION
      'expected order status/leading_status listo_para_despacho, got %/%',
      v_status, v_leading;
  END IF;
END $$;

-- ── A genuinely empty order still cancels (the branch must stay reachable) ──
UPDATE public.packages
SET status = 'cancelado'
WHERE order_id = 'aaaaaaaa-0000-4000-a000-000000000252';

DO $$
DECLARE v_status TEXT;
BEGIN
  SELECT status::text INTO v_status
  FROM public.orders
  WHERE id = 'aaaaaaaa-0000-4000-a000-000000000252';

  IF v_status <> 'cancelado' THEN
    RAISE EXCEPTION
      'order with only cancelado packages should be cancelado, got %', v_status;
  END IF;
END $$;

ROLLBACK;
