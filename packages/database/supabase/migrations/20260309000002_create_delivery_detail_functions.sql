-- Migration: Create RPC functions for Delivery Detail tab
-- Created: 2026-03-09
-- Story: 3B.4 - OTIF Metrics & Pending Orders Dashboard Widget
-- Purpose: Three RPCs for the delivery detail drill-down view:
--   1. get_otif_by_retailer  — OTIF breakdown per retailer
--   2. get_late_deliveries   — List of orders delivered late
--   3. get_orders_detail     — Paginated order list with filters
-- Dependencies:
--   - 20260217000003_create_orders_table.sql (orders table)
--   - 20260306000001_add_routes_dispatches_fleet_tables.sql (dispatches, routes)
--   - 20260309000001_create_otif_metrics_functions.sql (same patterns)

-- ============================================================================
-- 1. OTIF breakdown by retailer
-- ============================================================================

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
    'retailer_name',  o.retailer_name,
    'total_orders',   COUNT(*),
    'delivered',      COUNT(*) FILTER (WHERE o.status = 'delivered'),
    'on_time',        COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status   = 'delivered'
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
            AND d.status   = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*) FILTER (WHERE o.status = 'delivered'), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id  = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at    IS NULL
  GROUP BY o.retailer_name
  ORDER BY ROUND(
    COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status   = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    )::numeric / NULLIF(COUNT(*) FILTER (WHERE o.status = 'delivered'), 0) * 100,
    1
  ) ASC NULLS FIRST;
$$;

COMMENT ON FUNCTION public.get_otif_by_retailer(UUID, DATE, DATE)
  IS 'OTIF breakdown per retailer. Returns SETOF JSON {retailer_name, total_orders, delivered, on_time, otif_pct}. Sorted worst-first.';

-- ============================================================================
-- 2. Late deliveries list
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_late_deliveries(
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
    'order_number',   o.order_number,
    'retailer_name',  o.retailer_name,
    'delivery_date',  o.delivery_date,
    'completed_date', (d.completed_at AT TIME ZONE 'America/Santiago')::date,
    'days_late',      (d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date,
    'driver_name',    r.driver_name
  )
  FROM orders o
  JOIN dispatches d ON d.order_id = o.id
    AND d.status     = 'delivered'
    AND d.deleted_at IS NULL
  LEFT JOIN routes r ON r.id = d.route_id
    AND r.deleted_at IS NULL
  WHERE o.operator_id  = p_operator_id
    AND o.status       = 'delivered'
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at   IS NULL
    AND (d.completed_at AT TIME ZONE 'America/Santiago')::date > o.delivery_date
  ORDER BY (d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date DESC;
$$;

COMMENT ON FUNCTION public.get_late_deliveries(UUID, DATE, DATE)
  IS 'Orders delivered after their delivery_date. Returns SETOF JSON {order_number, retailer_name, delivery_date, completed_date, days_late, driver_name}. Sorted by days_late DESC.';

-- ============================================================================
-- 3. Paginated order detail with filters
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_orders_detail(
  p_operator_id  UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_status       TEXT     DEFAULT NULL,
  p_retailer     TEXT     DEFAULT NULL,
  p_search       TEXT     DEFAULT NULL,
  p_overdue_only BOOLEAN  DEFAULT FALSE,
  p_page         INTEGER  DEFAULT 1,
  p_page_size    INTEGER  DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_offset      INTEGER;
  v_total_count BIGINT;
  v_rows        JSON;
  v_today       DATE;
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  v_today  := (NOW() AT TIME ZONE 'America/Santiago')::date;

  -- Count total matching rows (for pagination metadata)
  SELECT COUNT(*)
  INTO v_total_count
  FROM orders o
  LEFT JOIN LATERAL (
    SELECT d.completed_at, d.failure_reason, d.route_id
    FROM dispatches d
    WHERE d.order_id   = o.id
      AND d.deleted_at IS NULL
    ORDER BY d.completed_at DESC NULLS LAST
    LIMIT 1
  ) ld ON true
  WHERE o.operator_id  = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at    IS NULL
    AND (p_status   IS NULL OR o.status::text = p_status)
    AND (p_retailer IS NULL OR o.retailer_name = p_retailer)
    AND (p_search   IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (NOT p_overdue_only OR (
      o.status NOT IN ('delivered', 'failed')
      AND o.delivery_date < v_today
    ));

  -- Fetch page of rows
  SELECT COALESCE(json_agg(row_data), '[]'::json)
  INTO v_rows
  FROM (
    SELECT json_build_object(
      'id',             o.id,
      'order_number',   o.order_number,
      'retailer_name',  o.retailer_name,
      'comuna',         o.comuna,
      'delivery_date',  o.delivery_date,
      'status',         o.status,
      'completed_at',   ld.completed_at,
      'driver_name',    r.driver_name,
      'route_id',       ld.route_id,
      'failure_reason', ld.failure_reason,
      'days_delta',     CASE
        WHEN o.status = 'delivered' AND ld.completed_at IS NOT NULL
          THEN (ld.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date
        WHEN o.status NOT IN ('delivered', 'failed') AND o.delivery_date < v_today
          THEN v_today - o.delivery_date
        ELSE NULL
      END
    ) AS row_data
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT d.completed_at, d.failure_reason, d.route_id
      FROM dispatches d
      WHERE d.order_id   = o.id
        AND d.deleted_at IS NULL
      ORDER BY d.completed_at DESC NULLS LAST
      LIMIT 1
    ) ld ON true
    LEFT JOIN routes r ON r.id = ld.route_id
      AND r.deleted_at IS NULL
    WHERE o.operator_id  = p_operator_id
      AND o.delivery_date BETWEEN p_start_date AND p_end_date
      AND o.delivery_date IS NOT NULL
      AND o.deleted_at    IS NULL
      AND (p_status   IS NULL OR o.status::text = p_status)
      AND (p_retailer IS NULL OR o.retailer_name = p_retailer)
      AND (p_search   IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (NOT p_overdue_only OR (
        o.status NOT IN ('delivered', 'failed')
        AND o.delivery_date < v_today
      ))
    ORDER BY o.delivery_date DESC, o.order_number ASC
    OFFSET v_offset
    LIMIT p_page_size
  ) sub;

  RETURN json_build_object(
    'rows',        v_rows,
    'total_count', v_total_count
  );
END;
$$;

COMMENT ON FUNCTION public.get_orders_detail(UUID, DATE, DATE, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER)
  IS 'Paginated order detail with filters. Returns JSON {rows: [...], total_count}. Supports status, retailer, search (ILIKE), overdue_only filters.';
