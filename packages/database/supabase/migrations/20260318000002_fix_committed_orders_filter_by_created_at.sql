-- Fix get_committed_orders_daily: filter by created_at (load date), group by delivery_date
-- Migration 20260310000001 accidentally reverted the fix from 20260305000003.
-- The date filter selects which orders to include (loaded in the period),
-- while grouping shows their commitment date distribution.
CREATE OR REPLACE FUNCTION public.get_committed_orders_daily(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET timezone = 'America/Santiago'
AS $$
  SELECT json_build_object(
    'day', delivery_date::text,
    'count', COUNT(*)
  )
  FROM orders
  WHERE created_at >= p_start_date::timestamp
    AND created_at < (p_end_date + 1)::timestamp
    AND deleted_at IS NULL
    AND delivery_date IS NOT NULL
  GROUP BY delivery_date
  ORDER BY delivery_date;
$$;
