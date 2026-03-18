-- Migration: Create RPC functions for Loading Data dashboard tab
-- All functions use SECURITY INVOKER so RLS policies apply.

-- 1. Package loading statistics (count + avg per order)
CREATE OR REPLACE FUNCTION public.get_packages_loaded_stats(
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
    'packages_count', COALESCE(COUNT(p.id), 0),
    'avg_per_order', COALESCE(ROUND(COUNT(p.id)::numeric / NULLIF(COUNT(DISTINCT o.id), 0), 1), 0)
  )
  FROM packages p
  JOIN orders o ON p.order_id = o.id
  WHERE p.created_at >= p_start_date::timestamp
    AND p.created_at < (p_end_date + 1)::timestamp
    AND o.deleted_at IS NULL
    AND p.deleted_at IS NULL;
$$;

-- 2. Daily order counts grouped by client
CREATE OR REPLACE FUNCTION public.get_daily_orders_by_client(
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
    'day', d.day::text,
    'retailer_name', COALESCE(d.retailer_name, 'Sin cliente'),
    'count', d.cnt
  )
  FROM (
    SELECT DATE(created_at) AS day, retailer_name, COUNT(*) AS cnt
    FROM orders
    WHERE created_at >= p_start_date::timestamp
      AND created_at < (p_end_date + 1)::timestamp
      AND deleted_at IS NULL
    GROUP BY DATE(created_at), retailer_name
    ORDER BY day, retailer_name
  ) d;
$$;

-- 3. Committed orders per delivery date
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
  WHERE delivery_date >= p_start_date
    AND delivery_date <= p_end_date
    AND deleted_at IS NULL
  GROUP BY delivery_date
  ORDER BY delivery_date;
$$;

-- 4. Orders and packages grouped by client with percentages
CREATE OR REPLACE FUNCTION public.get_orders_by_client(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT COUNT(*) AS total
    FROM orders
    WHERE created_at >= p_start_date::timestamp
      AND created_at < (p_end_date + 1)::timestamp
      AND deleted_at IS NULL
  ),
  by_client AS (
    SELECT
      COALESCE(o.retailer_name, 'Sin cliente') AS retailer_name,
      COUNT(DISTINCT o.id) AS orders,
      COUNT(p.id) AS packages
    FROM orders o
    LEFT JOIN packages p ON p.order_id = o.id AND p.deleted_at IS NULL
    WHERE o.created_at >= p_start_date::timestamp
      AND o.created_at < (p_end_date + 1)::timestamp
      AND o.deleted_at IS NULL
    GROUP BY o.retailer_name
  )
  SELECT json_build_object(
    'retailer_name', bc.retailer_name,
    'orders', bc.orders,
    'packages', bc.packages,
    'pct', ROUND(bc.orders::numeric / NULLIF(t.total, 0) * 100, 1)
  )
  FROM by_client bc, totals t
  ORDER BY bc.orders DESC;
$$;

-- 5. Orders grouped by comuna with optional region filter
CREATE OR REPLACE FUNCTION public.get_orders_by_comuna(
  p_start_date DATE,
  p_end_date DATE,
  p_region TEXT DEFAULT NULL
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT COUNT(*) AS total
    FROM orders
    WHERE created_at >= p_start_date::timestamp
      AND created_at < (p_end_date + 1)::timestamp
      AND deleted_at IS NULL
      AND (p_region IS NULL OR recipient_region = p_region)
  )
  SELECT json_build_object(
    'comuna', o.comuna,
    'count', COUNT(*),
    'pct', ROUND(COUNT(*)::numeric / NULLIF(t.total, 0) * 100, 1)
  )
  FROM orders o, totals t
  WHERE o.created_at >= p_start_date::timestamp
    AND o.created_at < (p_end_date + 1)::timestamp
    AND o.deleted_at IS NULL
    AND (p_region IS NULL OR o.recipient_region = p_region)
  GROUP BY o.comuna, t.total
  ORDER BY COUNT(*) DESC;
$$;
