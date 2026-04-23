-- =============================================================================
-- spec-37: Pre-Ruta — get_pre_route_snapshot RPC
--
-- Returns a single JSON snapshot of all unrouted, ready orders grouped by
-- andén (dock zone) for a given operator / delivery-date / time-window.
--
-- Cohort rule (an order appears iff):
--   1. orders.deleted_at IS NULL
--   2. orders.delivery_date = p_delivery_date
--   3. If window set: tsrange(window_start, window_end) overlaps the band
--   4. Has ≥1 package: deleted_at IS NULL, dock_zone_id IS NOT NULL,
--      status IN ('en_bodega','asignado','listo_para_despacho')
--   5. Has no non-deleted dispatch on a route with status IN
--      ('draft','planned','in_progress')
--   6. operator_id matches p_operator_id
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_pre_route_snapshot(
  p_operator_id  uuid,
  p_delivery_date date,
  p_window_start  time DEFAULT NULL,
  p_window_end    time DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
-- Step 1: Packages that qualify (docked + ready status + non-deleted)
ready_pkgs AS (
  SELECT p.id, p.order_id, p.dock_zone_id, p.created_at
  FROM   packages p
  WHERE  p.operator_id  = p_operator_id
    AND  p.deleted_at   IS NULL
    AND  p.dock_zone_id IS NOT NULL
    AND  p.status IN ('en_bodega', 'asignado', 'listo_para_despacho')
),

-- Step 2: Order IDs already on an active route
routed_ids AS (
  SELECT DISTINCT d.order_id
  FROM   dispatches d
  JOIN   routes r ON r.id = d.route_id
  WHERE  d.operator_id = p_operator_id
    AND  d.deleted_at  IS NULL
    AND  d.order_id    IS NOT NULL
    AND  r.deleted_at  IS NULL
    AND  r.status IN ('draft', 'planned', 'in_progress')
),

-- Step 3: Orders that satisfy the cohort rule
eligible AS (
  SELECT o.id,
         o.order_number,
         o.customer_name,
         o.delivery_address,
         o.delivery_window_start,
         o.delivery_window_end,
         o.comuna_id
  FROM   orders o
  WHERE  o.operator_id   = p_operator_id
    AND  o.delivery_date = p_delivery_date
    AND  o.deleted_at    IS NULL
    AND  o.id NOT IN (SELECT order_id FROM routed_ids)
    AND  EXISTS (SELECT 1 FROM ready_pkgs rp WHERE rp.order_id = o.id)
    -- Window overlap (half-open intervals; null-window orders excluded if filter active)
    AND (
      p_window_start IS NULL
      OR (
        o.delivery_window_start IS NOT NULL
        AND o.delivery_window_end   IS NOT NULL
        AND o.delivery_window_start < p_window_end
        AND o.delivery_window_end   > p_window_start
      )
    )
),

-- Step 4: Assign each order to its home andén (earliest ready package)
home_anden AS (
  SELECT DISTINCT ON (rp.order_id)
    rp.order_id,
    rp.dock_zone_id
  FROM ready_pkgs rp
  WHERE rp.order_id IN (SELECT id FROM eligible)
  ORDER BY rp.order_id, rp.created_at
),

-- Step 5: Detect split-dock-zone invariant violations
split_flags AS (
  SELECT
    ha.order_id,
    ha.dock_zone_id,
    (COUNT(DISTINCT rp.dock_zone_id) > 1) AS has_split
  FROM home_anden ha
  JOIN ready_pkgs rp ON rp.order_id = ha.order_id
  GROUP BY ha.order_id, ha.dock_zone_id
),

-- Step 6: Active zone → commune map (for unmapped detection)
zone_commune_map AS (
  SELECT dzc.comuna_id
  FROM   dock_zone_comunas dzc
  JOIN   dock_zones dz ON dz.id = dzc.dock_zone_id
  WHERE  dz.operator_id    = p_operator_id
    AND  dz.is_active       = true
    AND  dz.is_consolidation = false
    AND  dz.deleted_at      IS NULL
),

-- Step 7a: Orders whose commune is covered by an active andén
routable AS (
  SELECT e.id,
         e.order_number,
         e.customer_name,
         e.delivery_address,
         e.delivery_window_start,
         e.delivery_window_end,
         e.comuna_id,
         sf.dock_zone_id,
         sf.has_split
  FROM eligible e
  JOIN split_flags sf ON sf.order_id = e.id
  WHERE EXISTS (SELECT 1 FROM zone_commune_map zcm WHERE zcm.comuna_id = e.comuna_id)
),

-- Step 7b: Orders whose commune has no active andén mapping
unmapped AS (
  SELECT e.id, e.comuna_id
  FROM eligible e
  WHERE NOT EXISTS (SELECT 1 FROM zone_commune_map zcm WHERE zcm.comuna_id = e.comuna_id)
),

-- Step 8: Package counts per order (routable + unmapped)
pkg_counts AS (
  SELECT rp.order_id, COUNT(*) AS cnt
  FROM   ready_pkgs rp
  WHERE  rp.order_id IN (SELECT id FROM routable UNION ALL SELECT id FROM unmapped)
  GROUP  BY rp.order_id
),

-- Step 9: Order-level JSON
order_rows AS (
  SELECT
    r.dock_zone_id,
    r.comuna_id,
    r.id AS order_id,
    jsonb_build_object(
      'id',                    r.id,
      'order_number',          r.order_number,
      'customer_name',         r.customer_name,
      'delivery_address',      r.delivery_address,
      'delivery_window_start', r.delivery_window_start,
      'delivery_window_end',   r.delivery_window_end,
      'package_count',         COALESCE(pc.cnt, 0),
      'has_split_dock_zone',   r.has_split
    ) AS json
  FROM routable r
  LEFT JOIN pkg_counts pc ON pc.order_id = r.id
),

-- Step 10: Comuna-level JSON (aggregated per zone + commune)
comuna_rows AS (
  SELECT
    or_.dock_zone_id,
    or_.comuna_id,
    jsonb_build_object(
      'id',            cc.id,
      'name',          cc.nombre,
      'order_count',   COUNT(*),
      'package_count', SUM(COALESCE(pc.cnt, 0)),
      'orders',        jsonb_agg(or_.json ORDER BY or_.json->>'order_number')
    ) AS json
  FROM order_rows or_
  JOIN chile_comunas cc ON cc.id = or_.comuna_id
  LEFT JOIN pkg_counts pc ON pc.order_id = or_.order_id
  GROUP BY or_.dock_zone_id, or_.comuna_id, cc.id, cc.nombre
),

-- Step 11: Andén-level JSON
anden_rows AS (
  SELECT
    dz.id AS zone_id,
    jsonb_build_object(
      'id',                           dz.id,
      'name',                         dz.name,
      'comunas_list',                 COALESCE((
        SELECT array_agg(cc2.nombre ORDER BY cc2.nombre)
        FROM   dock_zone_comunas dzc
        JOIN   chile_comunas cc2 ON cc2.id = dzc.comuna_id
        WHERE  dzc.dock_zone_id = dz.id
      ), ARRAY[]::text[]),
      'order_count',                  COUNT(DISTINCT r.id),
      'package_count',                SUM(COALESCE(pc.cnt, 0)),
      'has_split_dock_zone_warnings', bool_or(r.has_split),
      'order_ids',                    array_agg(DISTINCT r.id::text),
      'comunas',                      (
        SELECT jsonb_agg(cr.json ORDER BY cr.json->>'name')
        FROM   comuna_rows cr
        WHERE  cr.dock_zone_id = dz.id
      )
    ) AS json
  FROM (SELECT DISTINCT dock_zone_id FROM routable) sub
  JOIN dock_zones dz ON dz.id = sub.dock_zone_id
  JOIN routable r    ON r.dock_zone_id = dz.id
  LEFT JOIN pkg_counts pc ON pc.order_id = r.id
  GROUP BY dz.id, dz.name
)

SELECT jsonb_build_object(
  'generated_at', now(),

  'totals', jsonb_build_object(
    'order_count',                 (SELECT COUNT(*)               FROM eligible),
    'package_count',               (SELECT COUNT(*)               FROM ready_pkgs
                                    WHERE order_id IN (SELECT id FROM eligible)),
    'anden_count',                 (SELECT COUNT(DISTINCT dock_zone_id) FROM routable),
    'split_dock_zone_order_count', (SELECT COUNT(*)               FROM routable WHERE has_split)
  ),

  'andenes', COALESCE(
    (SELECT jsonb_agg(ar.json ORDER BY ar.json->>'name') FROM anden_rows ar),
    '[]'::jsonb
  ),

  'unmapped_comunas', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',            cc.id,
        'name',          cc.nombre,
        'order_count',   COUNT(*),
        'package_count', SUM(COALESCE(pc.cnt, 0))
      )
      ORDER BY cc.nombre
    )
    FROM   unmapped u
    JOIN   chile_comunas cc ON cc.id = u.comuna_id
    LEFT JOIN pkg_counts pc ON pc.order_id = u.id
    GROUP  BY cc.id, cc.nombre
  ), '[]'::jsonb)
)
$$;

COMMENT ON FUNCTION public.get_pre_route_snapshot(uuid, date, time, time) IS
  'Pre-Ruta planning snapshot. Returns unrouted, dock-ready orders grouped by andén for the given operator, delivery date, and optional time-window band.';
