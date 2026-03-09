-- Fix OTIF calculation: on-time = delivered on or before delivery_date
-- OTIF = on_time / total_orders (not delivered/total or on_time/delivered)
-- Uses completed_at from dispatches in America/Santiago timezone.
-- When delivery_window_end is populated, switch to: completed_at < delivery_date + window_end

-- 1. Main OTIF metrics
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
    'on_time_deliveries', COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    ),
    'otif_percentage', ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'delivered'
        AND EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.order_id = o.id
            AND d.status = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL;
$$;

-- 2. OTIF by retailer
CREATE OR REPLACE FUNCTION public.get_otif_by_retailer(
  p_operator_id UUID,
  p_start_date  DATE,
  p_end_date    DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'retailer_name',  COALESCE(o.retailer_name, 'Sin cliente'),
    'total_orders',   COUNT(*),
    'delivered',      COUNT(*) FILTER (WHERE o.status = 'delivered'),
    'on_time',        COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    ),
    'otif_pct',       ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'delivered'
        AND EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.order_id = o.id
            AND d.status = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id  = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at    IS NULL
  GROUP BY COALESCE(o.retailer_name, 'Sin cliente')
  ORDER BY ROUND(
    COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    )::numeric / NULLIF(COUNT(*), 0) * 100,
    1
  ) ASC NULLS FIRST;
$$;
