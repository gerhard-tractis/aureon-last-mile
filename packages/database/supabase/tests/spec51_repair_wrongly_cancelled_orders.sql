-- spec-51 — the repair must fix bug-cancelled orders and nothing else.
--
-- The dangerous failure mode is over-reach: beetrack-webhook cancels orders
-- directly for failed/partial DispatchTrack dispatches, leaving packages at
-- 'en_ruta'. Un-cancelling those would resurrect genuinely failed deliveries.

BEGIN;

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000261','Spec51 Repair','spec51-repair')
ON CONFLICT (slug) DO NOTHING;

-- Helper: create an order with given package statuses, then force it cancelado
-- the way each real path would.
CREATE OR REPLACE FUNCTION pg_temp.mk_order(
  p_id UUID, p_number TEXT, p_pkg_statuses TEXT[]
) RETURNS VOID AS $fn$
DECLARE s TEXT; i INT := 0;
BEGIN
  INSERT INTO public.orders (
    id, operator_id, order_number, customer_name,
    delivery_address, comuna, delivery_date
  ) VALUES (
    p_id, 'aaaaaaaa-0000-4000-a000-000000000261', p_number, 'Cliente Repair',
    'Calle Repair 1', 'Maipú', CURRENT_DATE
  );

  FOREACH s IN ARRAY p_pkg_statuses LOOP
    i := i + 1;
    INSERT INTO public.packages (operator_id, order_id, label, status)
    VALUES ('aaaaaaaa-0000-4000-a000-000000000261', p_id,
            p_number || '-CTN-' || i, s::package_status_enum);
  END LOOP;
END;
$fn$ LANGUAGE plpgsql;

-- A: the bug — every package staged for dispatch, order forced to cancelado
--    exactly as the broken trigger would have left it.
SELECT pg_temp.mk_order(
  'aaaaaaaa-0000-4000-a000-000000000262', 'SPEC51-REP-A',
  ARRAY['listo_para_despacho','listo_para_despacho']);
UPDATE public.orders SET status = 'cancelado', leading_status = 'cancelado'
WHERE id = 'aaaaaaaa-0000-4000-a000-000000000262';

-- B: a genuinely failed delivery — beetrack-webhook wrote cancelado directly
--    while packages stayed en_ruta. MUST NOT be touched.
SELECT pg_temp.mk_order(
  'aaaaaaaa-0000-4000-a000-000000000263', 'SPEC51-REP-B',
  ARRAY['en_ruta','en_ruta']);
UPDATE public.orders
SET status = 'cancelado', leading_status = 'cancelado',
    status_detail = 'Failed via DispatchTrack dispatch #123'
WHERE id = 'aaaaaaaa-0000-4000-a000-000000000263';

-- C: a genuinely cancelled order — all packages cancelado. MUST stay cancelado.
SELECT pg_temp.mk_order(
  'aaaaaaaa-0000-4000-a000-000000000264', 'SPEC51-REP-C',
  ARRAY['cancelado','cancelado']);

-- D: mixed — one staged, one en_ruta. Not the bug signature, leave alone.
SELECT pg_temp.mk_order(
  'aaaaaaaa-0000-4000-a000-000000000265', 'SPEC51-REP-D',
  ARRAY['listo_para_despacho','en_ruta']);
UPDATE public.orders SET status = 'cancelado', leading_status = 'cancelado'
WHERE id = 'aaaaaaaa-0000-4000-a000-000000000265';

-- ── Run the same repair the migration performs ─────────────────────────────
UPDATE public.packages p
SET status = p.status
WHERE p.deleted_at IS NULL
  AND p.order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.status = 'cancelado'
      AND o.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM public.packages x
                  WHERE x.order_id = o.id AND x.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.packages x
                      WHERE x.order_id = o.id AND x.deleted_at IS NULL
                        AND x.status <> 'listo_para_despacho')
  );

DO $$
DECLARE v TEXT;
BEGIN
  SELECT status::text INTO v FROM public.orders
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000262';
  IF v <> 'listo_para_despacho' THEN
    RAISE EXCEPTION 'A: bug-cancelled order should be repaired to listo_para_despacho, got %', v;
  END IF;

  SELECT status::text INTO v FROM public.orders
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000263';
  IF v <> 'cancelado' THEN
    RAISE EXCEPTION 'B: a genuinely failed delivery was un-cancelled — got %', v;
  END IF;

  SELECT status::text INTO v FROM public.orders
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000264';
  IF v <> 'cancelado' THEN
    RAISE EXCEPTION 'C: a genuinely cancelled order changed — got %', v;
  END IF;

  SELECT status::text INTO v FROM public.orders
   WHERE id = 'aaaaaaaa-0000-4000-a000-000000000265';
  IF v <> 'cancelado' THEN
    RAISE EXCEPTION 'D: a mixed-state order was repaired but should not match — got %', v;
  END IF;
END $$;

ROLLBACK;
