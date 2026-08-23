-- =============================================================================
-- spec-65 Task 2 — public.get_orders_list and get_nav_counts.orders
--
-- `/app/orders` (Pedidos) is the one screen that shows every order regardless
-- of stage — the full order history, not a day's cohort. This is one query
-- that returns a page of orders with everything the table shows, the total
-- for pagination (`total_count`, riding along as `COUNT(*) OVER ()` so
-- pagination costs one round trip instead of two — `useAtRiskOrders` pages
-- client-side over a snapshot, which does not scale to this dataset), and
-- server-side filtering.
--
-- Depends on Task 1's public.order_sla_status (20260822000002), which is
-- LANGUAGE sql / IMMUTABLE specifically so it can be inlined here rather than
-- executed as an opaque per-row function call — see that migration's header.
-- p_now is passed as `NOW() AT TIME ZONE 'America/Santiago'`, a TIMESTAMP,
-- per that function's contract.
--
-- There is no orders.delivered_at. The delivered timestamp is derived from
-- the order's dispatches: the most recent dispatch with status = 'delivered'
-- (converted to the same wall-clock TIMESTAMP as p_now, for the same reason).
--
-- route_label / driver_name / has_pod all come from the order's most recent
-- non-pickup dispatch (is_pickup = false) — an order can carry several
-- dispatches across retries and even across routes, and the display columns
-- need one dispatch, not all of them. p_route_ids, by contrast, matches
-- against EVERY route the order's dispatches ever touched, not just the
-- latest — so filtering by a route does not silently exclude an order that
-- was reattempted on a different route afterwards.
--
-- p_client filters on orders.retailer_name (the retailer that owns the
-- order), not customer_name — customer_name is a per-order attribute (one
-- person), retailer_name is the grouping that "client" means in this
-- multi-tenant, multi-retailer system.
--
-- operator_id is filtered on every table this touches directly — orders,
-- packages, dispatches, routes, audit_logs — never relied on transitively
-- through a join, per this project's tenant-isolation rule.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_orders_list(
  p_operator_id   UUID,
  p_date_from     DATE    DEFAULT NULL,
  p_date_to       DATE    DEFAULT NULL,
  p_statuses      TEXT[]  DEFAULT NULL,
  p_sla           TEXT    DEFAULT NULL,
  p_route_ids     UUID[]  DEFAULT NULL,
  p_driver        TEXT    DEFAULT NULL,
  p_client        TEXT    DEFAULT NULL,
  p_comunas       TEXT[]  DEFAULT NULL,
  p_has_pod       BOOLEAN DEFAULT NULL,
  p_min_attempts  INT     DEFAULT NULL,
  p_search        TEXT    DEFAULT NULL,
  p_limit         INT     DEFAULT 50,
  p_offset        INT     DEFAULT 0
)
RETURNS TABLE (
  id                 UUID,
  order_number       TEXT,
  customer_name      TEXT,
  leading_status     TEXT,
  comuna             TEXT,
  package_count      INT,
  route_label        TEXT,
  driver_name        TEXT,
  sla_status         TEXT,
  minutes_remaining  INT,
  last_event_at      TIMESTAMPTZ,
  last_event_label   TEXT,
  has_pod            BOOLEAN,
  total_count        BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH order_packages AS (
    -- One row per order: how many non-deleted packages it has.
    SELECT p.order_id, COUNT(*) AS package_count
    FROM public.packages p
    WHERE p.operator_id = p_operator_id
      AND p.deleted_at IS NULL
    GROUP BY p.order_id
  ),
  order_dispatches AS (
    -- One row per order: delivery-attempt stats folded over every non-pickup
    -- dispatch, plus the id of the single most recent one (for display) and
    -- the set of every route it ever touched (for filtering).
    SELECT
      d.order_id,
      COUNT(*) AS attempt_count,
      MAX(d.completed_at) FILTER (WHERE d.status = 'delivered') AS delivered_at,
      (ARRAY_AGG(d.id ORDER BY COALESCE(d.completed_at, d.created_at) DESC))[1] AS latest_dispatch_id,
      ARRAY_AGG(DISTINCT d.route_id) FILTER (WHERE d.route_id IS NOT NULL) AS route_ids
    FROM public.dispatches d
    WHERE d.operator_id = p_operator_id
      AND d.deleted_at IS NULL
      AND d.is_pickup = FALSE
    GROUP BY d.order_id
  ),
  order_latest_dispatch AS (
    -- The display-only columns: route label, driver, POD flag, sourced from
    -- the single latest dispatch resolved above.
    SELECT
      od.order_id,
      od.attempt_count,
      od.delivered_at,
      od.route_ids,
      r.external_route_id AS route_label,
      r.driver_name        AS driver_name,
      (ld.raw_data ? 'photo_url' OR ld.raw_data ? 'signature') AS has_pod
    FROM order_dispatches od
    JOIN public.dispatches ld
      ON ld.id = od.latest_dispatch_id
     AND ld.operator_id = p_operator_id
     AND ld.deleted_at IS NULL
    LEFT JOIN public.routes r
      ON r.id = ld.route_id
     AND r.operator_id = p_operator_id
     AND r.deleted_at IS NULL
  ),
  order_last_event AS (
    -- Most recent audit_logs row per order (resource_type = 'order').
    SELECT DISTINCT ON (al.resource_id)
      al.resource_id AS order_id,
      al.timestamp   AS last_event_at,
      al.action      AS last_event_label
    FROM public.audit_logs al
    WHERE al.operator_id = p_operator_id
      AND al.resource_type = 'order'
    ORDER BY al.resource_id, al.timestamp DESC
  ),
  candidates AS (
    SELECT
      o.id,
      o.order_number,
      o.customer_name,
      o.leading_status::TEXT AS leading_status,
      o.comuna,
      COALESCE(opk.package_count, 0)::INT AS package_count,
      disp.route_label,
      disp.driver_name,
      sla.sla_status,
      sla.minutes_remaining,
      ole.last_event_at,
      ole.last_event_label,
      COALESCE(disp.has_pod, FALSE) AS has_pod,
      COALESCE(disp.attempt_count, 0) AS attempt_count,
      disp.route_ids
    FROM public.orders o
    LEFT JOIN order_packages opk        ON opk.order_id = o.id
    LEFT JOIN order_latest_dispatch disp ON disp.order_id = o.id
    LEFT JOIN order_last_event ole      ON ole.order_id = o.id
    CROSS JOIN LATERAL public.order_sla_status(
      o.delivery_date,
      o.delivery_window_start,
      o.delivery_window_end,
      o.rescheduled_delivery_date,
      o.rescheduled_window_start,
      o.rescheduled_window_end,
      disp.delivered_at AT TIME ZONE 'America/Santiago',
      NOW() AT TIME ZONE 'America/Santiago'
    ) sla
    WHERE o.operator_id = p_operator_id
      AND o.deleted_at IS NULL
      AND (p_date_from IS NULL OR o.delivery_date >= p_date_from)
      AND (p_date_to   IS NULL OR o.delivery_date <= p_date_to)
      AND (p_statuses  IS NULL OR o.leading_status::TEXT = ANY(p_statuses))
      AND (p_comunas   IS NULL OR o.comuna = ANY(p_comunas))
      AND (p_client    IS NULL OR o.retailer_name = p_client)
      AND (
        p_search IS NULL
        OR o.order_number ILIKE '%' || p_search || '%'
        OR o.customer_name ILIKE '%' || p_search || '%'
        OR o.delivery_address ILIKE '%' || p_search || '%'
      )
  )
  SELECT
    c.id,
    c.order_number,
    c.customer_name,
    c.leading_status,
    c.comuna,
    c.package_count,
    c.route_label,
    c.driver_name,
    c.sla_status,
    c.minutes_remaining,
    c.last_event_at,
    c.last_event_label,
    c.has_pod,
    COUNT(*) OVER ()::BIGINT AS total_count
  FROM candidates c
  WHERE (p_sla IS NULL OR c.sla_status = p_sla)
    AND (p_route_ids IS NULL OR c.route_ids && p_route_ids)
    AND (p_driver IS NULL OR c.driver_name ILIKE '%' || p_driver || '%')
    AND (p_has_pod IS NULL OR c.has_pod = p_has_pod)
    AND (p_min_attempts IS NULL OR c.attempt_count >= p_min_attempts)
  ORDER BY c.minutes_remaining ASC NULLS LAST, c.order_number ASC
  LIMIT p_limit OFFSET p_offset
$$;

COMMENT ON FUNCTION public.get_orders_list(
  UUID, DATE, DATE, TEXT[], TEXT, UUID[], TEXT, TEXT, TEXT[], BOOLEAN, INT, TEXT, INT, INT
) IS
  'spec-65 Task 2 — one page of the full order history for /app/orders, with every filter the screen supports and total_count riding along via COUNT(*) OVER() so pagination costs one round trip. Calls order_sla_status (Task 1) per row; delivered_at is derived from dispatches.completed_at (there is no orders.delivered_at). route_label/driver_name/has_pod come from the single most recent non-pickup dispatch; p_route_ids matches against every route the order''s dispatches ever touched.';

GRANT EXECUTE ON FUNCTION public.get_orders_list(
  UUID, DATE, DATE, TEXT[], TEXT, UUID[], TEXT, TEXT, TEXT[], BOOLEAN, INT, TEXT, INT, INT
) TO authenticated;
