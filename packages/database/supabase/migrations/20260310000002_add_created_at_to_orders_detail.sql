-- Add created_at (Fecha de Carga) to get_orders_detail RPC output

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
SET timezone = 'America/Santiago'
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
      'created_at',     o.created_at,
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
