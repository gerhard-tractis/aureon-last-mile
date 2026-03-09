-- Migration: Create RPC functions for Delivery tab — OTIF metrics and pending orders
-- All functions use SECURITY INVOKER so RLS policies apply.

-- 1. OTIF metrics for a date range
CREATE OR REPLACE FUNCTION public.get_otif_metrics(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_orders', COUNT(*),
    'delivered_orders', COUNT(*) FILTER (WHERE o.status = 'delivered'),
    'failed_orders', COUNT(*) FILTER (WHERE o.status = 'failed'),
    'pending_orders', COUNT(*) FILTER (WHERE o.status NOT IN ('delivered', 'failed')),
    'otif_percentage', ROUND(
      COUNT(*) FILTER (WHERE o.status = 'delivered')::numeric
        / NULLIF(COUNT(*), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL;
$$;

-- 2. Pending orders summary (no date range — current operational state)
CREATE OR REPLACE FUNCTION public.get_pending_orders_summary(
  p_operator_id UUID
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'overdue_count', COUNT(*) FILTER (WHERE o.delivery_date < (NOW() AT TIME ZONE 'America/Santiago')::date),
    'due_today_count', COUNT(*) FILTER (WHERE o.delivery_date = (NOW() AT TIME ZONE 'America/Santiago')::date),
    'due_tomorrow_count', COUNT(*) FILTER (WHERE o.delivery_date = (NOW() AT TIME ZONE 'America/Santiago')::date + 1),
    'total_pending', COUNT(*)
  )
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.status NOT IN ('delivered', 'failed')
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL;
$$;
