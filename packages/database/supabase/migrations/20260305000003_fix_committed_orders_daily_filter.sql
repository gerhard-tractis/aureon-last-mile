-- Fix get_committed_orders_daily: filter by created_at (load date), group by delivery_date (commitment date)
-- Previously filtered by delivery_date range, which made the chart show only orders committed within
-- the selected period. Now shows: for orders loaded in the period, their commitment date distribution.
CREATE OR REPLACE FUNCTION public.get_committed_orders_daily(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
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
