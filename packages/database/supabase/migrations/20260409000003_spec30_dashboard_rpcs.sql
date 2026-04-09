-- Migration: spec-30 dashboard RPCs
-- Created: 2026-04-09
-- Purpose: Five new SECURITY INVOKER RPCs for the C-level dashboard.
--          RLS enforcement via get_operator_id() applies; explicit p_operator_id
--          parameter provides additional defence-in-depth filtering.

-- ============================================================================
-- RPC 1: get_dashboard_north_stars
-- Returns current month + prior month + prior year rows for north-star KPIs.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_north_stars(
  p_operator_id UUID,
  p_year        INT,
  p_month       INT
)
RETURNS TABLE (
  row_type         TEXT,   -- 'current' | 'prior_month' | 'prior_year'
  period_year      INT,
  period_month     INT,
  cpo_clp          NUMERIC,
  otif_pct         NUMERIC,
  nps_score        NUMERIC,
  csat_pct         NUMERIC,
  total_orders     INT,
  delivered_orders INT,
  failed_orders    INT,
  computed_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  -- current month
  SELECT 'current'::TEXT,
         period_year, period_month,
         cpo_clp, otif_pct, nps_score, csat_pct,
         total_orders, delivered_orders, failed_orders, computed_at
  FROM public.dashboard_monthly_rollup
  WHERE operator_id = p_operator_id
    AND period_year = p_year
    AND period_month = p_month
    AND deleted_at IS NULL
  UNION ALL
  -- prior month
  SELECT 'prior_month'::TEXT,
         period_year, period_month,
         cpo_clp, otif_pct, nps_score, csat_pct,
         total_orders, delivered_orders, failed_orders, computed_at
  FROM public.dashboard_monthly_rollup
  WHERE operator_id = p_operator_id
    AND (period_year, period_month) = (
      CASE WHEN p_month = 1 THEN p_year - 1 ELSE p_year END,
      CASE WHEN p_month = 1 THEN 12 ELSE p_month - 1 END
    )
    AND deleted_at IS NULL
  UNION ALL
  -- prior year same month
  SELECT 'prior_year'::TEXT,
         period_year, period_month,
         cpo_clp, otif_pct, nps_score, csat_pct,
         total_orders, delivered_orders, failed_orders, computed_at
  FROM public.dashboard_monthly_rollup
  WHERE operator_id = p_operator_id
    AND period_year = p_year - 1
    AND period_month = p_month
    AND deleted_at IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_north_stars(UUID, INT, INT) TO authenticated;

-- ============================================================================
-- RPC 2: get_dashboard_otif_by_region
-- OTIF breakdown by Chilean region for a given date range.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_otif_by_region(
  p_operator_id UUID,
  p_start       DATE,
  p_end         DATE
)
RETURNS TABLE (
  region_name      TEXT,
  total_orders     BIGINT,
  delivered_orders BIGINT,
  otif_pct         NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(cc.region_name, 'Sin región') AS region_name,
    COUNT(*)::BIGINT                        AS total_orders,
    COUNT(*) FILTER (WHERE d.status = 'delivered')::BIGINT AS delivered_orders,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE d.status = 'delivered') / NULLIF(COUNT(*), 0),
      2
    ) AS otif_pct
  FROM public.dispatches d
  JOIN public.orders o ON o.id = d.order_id
  LEFT JOIN public.chile_comunas cc ON cc.id = o.comuna_id
  WHERE d.operator_id = p_operator_id
    AND d.created_at::DATE BETWEEN p_start AND p_end
    AND d.deleted_at IS NULL
    AND o.deleted_at IS NULL
  GROUP BY cc.region_name
  ORDER BY total_orders DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_otif_by_region(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- RPC 3: get_dashboard_otif_by_customer
-- OTIF breakdown by customer for a given date range.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_otif_by_customer(
  p_operator_id UUID,
  p_start       DATE,
  p_end         DATE
)
RETURNS TABLE (
  customer_name    TEXT,
  total_orders     BIGINT,
  delivered_orders BIGINT,
  otif_pct         NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(tc.name, 'Sin cliente') AS customer_name,
    COUNT(*)::BIGINT                  AS total_orders,
    COUNT(*) FILTER (WHERE d.status = 'delivered')::BIGINT AS delivered_orders,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE d.status = 'delivered') / NULLIF(COUNT(*), 0),
      2
    ) AS otif_pct
  FROM public.dispatches d
  JOIN public.orders o ON o.id = d.order_id
  LEFT JOIN public.tenant_clients tc ON tc.id = o.client_id
  WHERE d.operator_id = p_operator_id
    AND d.created_at::DATE BETWEEN p_start AND p_end
    AND d.deleted_at IS NULL
    AND o.deleted_at IS NULL
  GROUP BY tc.name
  ORDER BY total_orders DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_otif_by_customer(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- RPC 4: get_dashboard_late_reasons
-- Failed / returned dispatch breakdown by failure_reason.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_late_reasons(
  p_operator_id UUID,
  p_start       DATE,
  p_end         DATE
)
RETURNS TABLE (
  reason       TEXT,
  count        BIGINT,
  pct          NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH reasons AS (
    SELECT
      COALESCE(d.failure_reason, 'Sin motivo') AS reason,
      COUNT(*) AS cnt
    FROM public.dispatches d
    WHERE d.operator_id = p_operator_id
      AND d.created_at::DATE BETWEEN p_start AND p_end
      AND d.status IN ('failed', 'returned')
      AND d.deleted_at IS NULL
    GROUP BY d.failure_reason
  ),
  total AS (SELECT SUM(cnt) AS t FROM reasons)
  SELECT
    r.reason,
    r.cnt::BIGINT AS count,
    ROUND(100.0 * r.cnt / NULLIF(t.t, 0), 2) AS pct
  FROM reasons r, total t
  ORDER BY r.cnt DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_late_reasons(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- RPC 5: get_dashboard_route_tactics
-- Route efficiency KPIs: FADR%, avg km per route/stop, avg orders per route.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_route_tactics(
  p_operator_id UUID,
  p_start       DATE,
  p_end         DATE
)
RETURNS TABLE (
  fadr_pct            NUMERIC,
  avg_km_per_route    NUMERIC,
  avg_km_per_stop     NUMERIC,
  avg_orders_per_route NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE da.status = 'failed') / NULLIF(COUNT(*), 0),
      2
    ) AS fadr_pct,
    ROUND(AVG(r.total_km), 2)                              AS avg_km_per_route,
    ROUND(AVG(r.total_km / NULLIF(r.stop_count, 0)), 2)   AS avg_km_per_stop,
    ROUND(AVG(r.order_count), 2)                           AS avg_orders_per_route
  FROM public.delivery_attempts da
  JOIN public.routes r ON r.id = da.route_id
  WHERE da.operator_id = p_operator_id
    AND da.attempted_at::DATE BETWEEN p_start AND p_end
    AND da.deleted_at IS NULL
    AND r.deleted_at IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_route_tactics(UUID, DATE, DATE) TO authenticated;

-- ============================================================================
-- Validation — verify all 5 RPCs exist
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dashboard_north_stars') THEN
    RAISE EXCEPTION 'Function get_dashboard_north_stars not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dashboard_otif_by_region') THEN
    RAISE EXCEPTION 'Function get_dashboard_otif_by_region not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dashboard_otif_by_customer') THEN
    RAISE EXCEPTION 'Function get_dashboard_otif_by_customer not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dashboard_late_reasons') THEN
    RAISE EXCEPTION 'Function get_dashboard_late_reasons not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_dashboard_route_tactics') THEN
    RAISE EXCEPTION 'Function get_dashboard_route_tactics not found!';
  END IF;
  RAISE NOTICE '✓ All 5 dashboard RPCs created successfully';
END $$;
