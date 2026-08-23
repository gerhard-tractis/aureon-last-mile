-- =============================================================================
-- spec-65 Task 2 — public.get_orders_list and get_nav_counts.orders
--
-- `/app/orders` (Pedidos) shows every order regardless of stage — the full
-- history, not a day's cohort. One call returns a page, total_count (riding
-- along as `COUNT(*) OVER ()`, one round trip instead of two — unlike
-- `useAtRiskOrders`, which pages client-side over a snapshot, not viable at
-- this scale), and every server-side filter the screen supports.
--
-- Calls Task 1's public.order_sla_status (20260823000001) per row — LANGUAGE
-- sql / IMMUTABLE there so it inlines instead of running as an opaque
-- per-row call. p_now = `NOW() AT TIME ZONE 'America/Santiago'`, a TIMESTAMP,
-- per that function's contract.
--
-- There is no orders.delivered_at: delivered_at is the order's most recent
-- NON-PICKUP dispatch with status = 'delivered'. is_pickup = FALSE is not
-- optional — a completed pickup movement also carries status = 'delivered'
-- (same enum, same webhook field), and would otherwise mark the order
-- delivered (sla_status 'none') from a collection event, not an actual
-- delivery. get_nav_counts.orders (20260823000003) applies the identical
-- filter for the identical reason; the two must never diverge on what
-- "delivered" means. route_label/driver_name/has_pod come from that same
-- dispatch. p_route_ids matches every route the order's NON-PICKUP
-- dispatches touched (same is_pickup = FALSE scope as delivered_at), not
-- just the latest, so a reattempt on a different delivery route doesn't
-- fall out of a route filter — but a route that only carried a pickup leg
-- for this order is not matched.
--
-- p_client filters orders.retailer_name (free-text chips in the mock, "CLIENTE
-- / REMITENTE") — not tenant_client_id (switch to it only if this needs to
-- become authoritative rather than textual), not customer_name (a per-order,
-- not per-client, attribute). p_driver, unlike p_client, IS a partial ILIKE
-- match — drivers aren't a fixed chip list the way retailers are.
--
-- p_sla is TEXT[], not TEXT: the default "SLA en riesgo" view and
-- get_nav_counts.orders both need `sla_status IN ('late','at_risk')` in one
-- call, which scalar equality can't express.
--
-- order_candidates narrows every orders-table-only filter FIRST; the
-- packages/dispatches/audit_logs CTEs correlate to that (usually much
-- smaller) set via order_id IN (SELECT ... FROM order_candidates),
-- instead of aggregating the operator's entire history on every call.
--
-- p_date_from/p_date_to filter the SAME effective delivery date
-- order_sla_status uses (rescheduled date only when all three reschedule
-- columns are non-null — never `COALESCE(rescheduled_delivery_date,
-- delivery_date)` alone, which would treat a partial reschedule as effective
-- and diverge from the SLA rule). An order rescheduled into today must
-- appear in a "today" filter, since its SLA verdict already judges it
-- against today.
--
-- p_search is escaped for ILIKE — a literal '%' or '_' must match itself,
-- not act as a wildcard over every row.
--
-- operator_id is filtered on every table touched directly (orders, packages,
-- dispatches, routes, audit_logs), never relied on transitively via a join.
-- =============================================================================

-- The previous definition on QA has p_sla as a scalar TEXT (position 5).
-- CREATE OR REPLACE cannot change a parameter's type — Postgres identifies a
-- function by name + input argument types, so a type change makes this a
-- DIFFERENT signature, and without dropping the old one first, both would
-- exist side by side. DROP FUNCTION targets the OLD (already-deployed)
-- signature explicitly.
DROP FUNCTION IF EXISTS public.get_orders_list(
  UUID, DATE, DATE, TEXT[], TEXT, UUID[], TEXT, TEXT, TEXT[], BOOLEAN, INT, TEXT, INT, INT
);

CREATE OR REPLACE FUNCTION public.get_orders_list(
  p_operator_id   UUID,
  p_date_from     DATE    DEFAULT NULL,
  p_date_to       DATE    DEFAULT NULL,
  p_statuses      TEXT[]  DEFAULT NULL,
  p_sla           TEXT[]  DEFAULT NULL,
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
  WITH params AS (
    -- Escape existing backslashes, then % and _, before wrapping in
    -- wildcards (that order, so escaping %/_ is not re-escaped). NULL stays NULL.
    SELECT
      replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_')
        AS search_escaped
  ),
  order_candidates AS (
    -- Every SARGable orders-only filter, applied before any fan-out.
    SELECT ocb.*
    FROM (
      -- Projected explicitly, not o.* — referenced 3x below so Postgres
      -- materializes this CTE; o.* would drag every order's full
      -- raw_data/metadata JSONB along just to hand the fan-out CTEs a list
      -- of ids. Only what this WHERE and the downstream candidates/SLA call use.
      SELECT
        o.id, o.order_number, o.customer_name, o.leading_status, o.comuna,
        o.delivery_date, o.delivery_window_start, o.delivery_window_end,
        o.rescheduled_delivery_date, o.rescheduled_window_start, o.rescheduled_window_end,
        o.retailer_name, o.delivery_address,
        -- Same "all three reschedule columns or none" rule order_sla_status
        -- uses for its effective window end — see that function's header.
        CASE
          WHEN o.rescheduled_delivery_date IS NOT NULL
           AND o.rescheduled_window_start  IS NOT NULL
           AND o.rescheduled_window_end    IS NOT NULL
            THEN o.rescheduled_delivery_date
          ELSE o.delivery_date
        END AS effective_delivery_date
      FROM public.orders o
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at IS NULL
    ) ocb
    CROSS JOIN params
    WHERE (p_statuses  IS NULL OR ocb.leading_status::TEXT = ANY(p_statuses))
      AND (p_comunas   IS NULL OR ocb.comuna = ANY(p_comunas))
      AND (p_client    IS NULL OR ocb.retailer_name = p_client)
      AND (p_date_from IS NULL OR ocb.effective_delivery_date >= p_date_from)
      AND (p_date_to   IS NULL OR ocb.effective_delivery_date <= p_date_to)
      AND (
        p_search IS NULL
        OR ocb.order_number    ILIKE '%' || params.search_escaped || '%' ESCAPE '\'
        OR ocb.customer_name   ILIKE '%' || params.search_escaped || '%' ESCAPE '\'
        OR ocb.delivery_address ILIKE '%' || params.search_escaped || '%' ESCAPE '\'
      )
  ),
  order_packages AS (
    -- How many non-deleted packages each candidate order has.
    SELECT p.order_id, COUNT(*) AS package_count
    FROM public.packages p
    WHERE p.operator_id = p_operator_id
      AND p.deleted_at IS NULL
      AND p.order_id IN (SELECT order_candidates.id FROM order_candidates)
    GROUP BY p.order_id
  ),
  order_dispatches AS (
    -- Delivery-attempt stats over each candidate's non-pickup dispatches,
    -- plus the single most recent one (display) and every route touched
    -- (filtering). d.id DESC (below) makes the "latest" tiebreak deterministic.
    SELECT
      d.order_id,
      COUNT(*) AS attempt_count,
      -- A 'delivered' dispatch with a NULL completed_at (DispatchTrack can
      -- send that shape) yields delivered_at = NULL, keeping a live SLA
      -- verdict — considered, not missed: get_nav_counts does the same FILTER.
      MAX(d.completed_at) FILTER (WHERE d.status = 'delivered') AS delivered_at,
      (ARRAY_AGG(d.id ORDER BY COALESCE(d.completed_at, d.created_at) DESC, d.id DESC))[1]
        AS latest_dispatch_id,
      ARRAY_AGG(DISTINCT d.route_id) FILTER (WHERE d.route_id IS NOT NULL) AS route_ids
    FROM public.dispatches d
    WHERE d.operator_id = p_operator_id
      AND d.deleted_at IS NULL
      AND d.is_pickup = FALSE
      AND d.order_id IN (SELECT order_candidates.id FROM order_candidates)
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
    -- Most recent audit_logs row per candidate order (resource_type='order');
    -- al.id DESC breaks ties on timestamp (NOW(), transaction-constant).
    SELECT DISTINCT ON (al.resource_id)
      al.resource_id AS order_id,
      al.timestamp   AS last_event_at,
      al.action      AS last_event_label
    FROM public.audit_logs al
    WHERE al.operator_id = p_operator_id
      AND al.resource_type = 'order'
      AND al.resource_id IN (SELECT order_candidates.id FROM order_candidates)
    ORDER BY al.resource_id, al.timestamp DESC, al.id DESC
  ),
  candidates AS (
    SELECT
      oc.id,
      oc.order_number,
      oc.customer_name,
      oc.leading_status::TEXT AS leading_status,
      oc.comuna,
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
    FROM order_candidates oc
    LEFT JOIN order_packages opk         ON opk.order_id = oc.id
    LEFT JOIN order_latest_dispatch disp ON disp.order_id = oc.id
    LEFT JOIN order_last_event ole       ON ole.order_id = oc.id
    CROSS JOIN LATERAL public.order_sla_status(
      oc.delivery_date,
      oc.delivery_window_start,
      oc.delivery_window_end,
      oc.rescheduled_delivery_date,
      oc.rescheduled_window_start,
      oc.rescheduled_window_end,
      disp.delivered_at AT TIME ZONE 'America/Santiago',
      NOW() AT TIME ZONE 'America/Santiago'
    ) sla
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
  WHERE (p_sla IS NULL OR c.sla_status = ANY(p_sla))
    AND (p_route_ids IS NULL OR c.route_ids && p_route_ids)
    -- Escaped like p_search (backslash, then %, then _); computed inline
    -- since params isn't joined into this final query and p_driver isn't used elsewhere.
    AND (p_driver IS NULL OR c.driver_name ILIKE '%' ||
      replace(replace(replace(p_driver, '\', '\\'), '%', '\%'), '_', '\_')
      || '%' ESCAPE '\')
    AND (p_has_pod IS NULL OR c.has_pod = p_has_pod)
    -- attempt_count counts non-pickup dispatches only: is_pickup exists to
    -- separate collection from delivery attempts, and "2+ intentos de
    -- entrega" in the mock means delivery attempts — do not fold pickups in.
    AND (p_min_attempts IS NULL OR c.attempt_count >= p_min_attempts)
  -- Most urgent first: sla_status ranked explicitly (late, at_risk, ok,
  -- none) rather than sorting on minutes_remaining alone, since 'none' uses
  -- 0 as a placeholder and would otherwise outrank genuinely at-risk orders.
  -- order_number is a deterministic tiebreaker — without one, two orders
  -- sharing a sort key can swap between paginated requests.
  ORDER BY
    CASE c.sla_status
      WHEN 'late'    THEN 0
      WHEN 'at_risk' THEN 1
      WHEN 'ok'      THEN 2
      ELSE 3 -- 'none'
    END,
    c.minutes_remaining ASC NULLS LAST,
    c.order_number ASC
  LIMIT p_limit OFFSET p_offset
$$;

COMMENT ON FUNCTION public.get_orders_list(
  UUID, DATE, DATE, TEXT[], TEXT[], UUID[], TEXT, TEXT, TEXT[], BOOLEAN, INT, TEXT, INT, INT
) IS
  'spec-65 Task 2 — one page of the full order history for /app/orders, with every filter the screen supports and total_count riding along via COUNT(*) OVER() so pagination costs one round trip. Calls order_sla_status (Task 1) per row; delivered_at is derived from the order''s most recent NON-PICKUP delivered dispatch (there is no orders.delivered_at) — matches get_nav_counts.orders exactly. route_label/driver_name/has_pod come from that same dispatch; p_route_ids matches against every route the order''s NON-PICKUP dispatches ever touched, not just the latest. p_sla is TEXT[] so callers can pass ARRAY[''late'',''at_risk''] in one call, matching the nav badge.';

GRANT EXECUTE ON FUNCTION public.get_orders_list(
  UUID, DATE, DATE, TEXT[], TEXT[], UUID[], TEXT, TEXT, TEXT[], BOOLEAN, INT, TEXT, INT, INT
) TO authenticated;
