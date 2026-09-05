-- =============================================================================
-- spec-77 phase 1b — force-seal splits a `partially_staged` stop instead of
-- refusing it.
--
-- The version of decision 9 that merged in #611 released only stops nobody
-- ever touched (`stage = 'planned'`); it kept refusing the whole force call
-- (`409 UNSEALED_STOPS`) the moment ANY pending stop was `partially_staged`
-- — some of the order's boxes already on the truck, some not. With
-- multi-bulto orders that is the canonical case, not an edge one: "24
-- bultos sin cargar" routinely includes half-scanned orders. The user's
-- decision: force now SPLITS a `partially_staged` stop — the scanned boxes
-- travel, the unscanned ones go back to the dock, available to another
-- route.
--
-- `dispatches.stage` gains a new value, `force_split` (section 1). Unlike
-- the fully-`planned` release, the row is NOT soft-deleted — part of the
-- order genuinely travels with this route, so the row still has to say so.
-- `force_split` is deliberately its own value rather than reusing `staged`:
-- `get_move_task_snapshot`'s plan-membership filter (latest def
-- 20260902000001: `stage IN ('planned', 'partially_staged', 'staged')`)
-- would otherwise keep listing the released packages as still needing to
-- move onto this route forever —
-- they will never get a `dock_scans` row here. `force_split` opts a split
-- order out of that membership; `get_move_task_snapshot` itself needs no
-- change (it simply never matches the new value). `seal-route.ts`'s own
-- final step, which advances staged/adopted packages to
-- `listo_para_despacho`, is widened (app layer, same PR) to also match
-- `force_split` — the loaded half of a split order still has to complete
-- the seal.
--
-- `get_pre_route_snapshot` (section 2) is the other half. Without a change
-- here, the split order's released packages would be invisible to Pre-Ruta:
-- the order still has a non-deleted `dispatches` row tied to an active
-- route (this one, now `loaded`), and `routed_ids` excludes the WHOLE order
-- on that basis alone, regardless of stage. `routed_ids` now excludes a
-- dispatch only when its stage is NOT `force_split` — a split order's other
-- (real) commitments still exclude it if any exist, but the split dispatch
-- itself no longer reserves the whole order. `ready_pkgs` is widened the
-- other way: a genuinely-loaded package (`loaded_at IS NOT NULL AND
-- load_inferred = false`) never counts as available, regardless of which
-- order it belongs to — so the half that already shipped does not reappear
-- as "ready" once the order-level exclusion is relaxed. Without this second
-- change, a split order would reappear in Pre-Ruta with BOTH halves
-- counted, including the boxes already on the truck.
--
-- `removal_reason` is deliberately NOT written for a `force_split` row —
-- that column is documented (20260825000002) as "soft-delete plus
-- removal_reason, not a stage"; nothing is removed here. The audited trace
-- is the same `audit_logs` row spec-77 decision 9 already writes
-- (`action: 'force_seal_route'`), widened (app layer) to carry
-- `split_count`/`split_order_ids` alongside `released_count`/
-- `released_order_ids`.
--
-- No backfill: `force_split` is reached only by a future `sealRoute` force
-- call, never by existing data.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. dispatches.stage: add 'force_split'
-- ---------------------------------------------------------------------------
-- `stage` is TEXT + CHECK, not an enum (20260825000002) — a plain DROP+ADD
-- CONSTRAINT, same as every prior addition to this set (partially_staged,
-- 20260901000001).
ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_stage_check,
  ADD  CONSTRAINT dispatches_stage_check
       CHECK (stage IN ('planned', 'partially_staged', 'staged', 'adopted', 'force_split'));

-- dispatches_staged_at_check ((stage = 'planned') = (staged_at IS NULL)) is
-- untouched: 'force_split' is not 'planned', so it already requires
-- staged_at IS NOT NULL, which `force-seal-split.ts` sets.

-- ---------------------------------------------------------------------------
-- 2. route_stop_counts: force_split gets its own bucket
-- ---------------------------------------------------------------------------
-- Template: 20260902000001 (latest def). Only force_split_stops is new,
-- appended after partially_staged_stops — CREATE OR REPLACE VIEW refuses to
-- reorder or rename existing output columns, same constraint that migration
-- already documents.
CREATE OR REPLACE VIEW public.route_stop_counts
WITH (security_invoker = true) AS
SELECT route_id,
       operator_id,
       COUNT(*)                                  AS total_stops,
       COUNT(*) FILTER (WHERE stage = 'planned') AS pending_stops,
       COUNT(*) FILTER (WHERE stage = 'staged')  AS staged_stops,
       COUNT(*) FILTER (WHERE stage = 'adopted') AS adopted_stops,
       COUNT(*) FILTER (WHERE stage = 'partially_staged') AS partially_staged_stops,
       COUNT(*) FILTER (WHERE stage = 'force_split') AS force_split_stops
  FROM public.dispatches
 WHERE deleted_at IS NULL
   AND route_id IS NOT NULL
 GROUP BY route_id, operator_id;

COMMENT ON VIEW public.route_stop_counts IS
  'spec-70/74/77. The authoritative local stop counts, derived from dispatches. '
  'routes.planned_stops stays on the table because the DispatchTrack webhooks '
  'write it from the provider''s own figure, which is a different number — '
  'nothing local should read it. partially_staged_stops (spec-74 phase 3) and '
  'force_split_stops (spec-77 phase 1b) are each their own bucket, not folded '
  'into pending_stops or staged_stops: neither state is "nothing scanned" nor '
  '"fully loaded" in the way those buckets mean.';

GRANT SELECT ON public.route_stop_counts TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_pre_route_snapshot — template: 20260907000001 (latest def).
--    Two changes only: ready_pkgs excludes genuinely-loaded packages;
--    routed_ids no longer treats a force_split dispatch as claiming the
--    whole order. Every other clause is byte-for-byte identical.
-- ---------------------------------------------------------------------------
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
-- Step 1: Packages that qualify (docked + ready status + non-deleted).
-- spec-76 task 3: 'en_bodega' dropped. spec-77 phase 1b: a genuinely-loaded
-- package (loaded_at IS NOT NULL AND load_inferred = false — the same
-- discriminator scan-validator.ts and force-seal-split.ts use, never
-- packages.status alone) never counts as available, regardless of which
-- order it belongs to. Without this, a force_split order's already-shipped
-- half would reappear as "ready" the moment routed_ids below stops
-- excluding the order wholesale.
ready_pkgs AS (
  SELECT p.id, p.order_id, p.dock_zone_id, p.created_at
  FROM   packages p
  WHERE  p.operator_id  = p_operator_id
    AND  p.deleted_at   IS NULL
    AND  p.dock_zone_id IS NOT NULL
    AND  p.status IN ('sectorizado', 'asignado', 'listo_para_despacho')
    AND  NOT (p.loaded_at IS NOT NULL AND p.load_inferred = false)
),

-- Step 2: Order IDs already on an active route. Every non-terminal status —
-- draft/planned/loading/loaded (still local) and dispatched/in_transit/
-- in_progress (already at DT) — owns its order. Only completed/cancelled
-- release it, which is what lets retorno_hub (spec-43) route a failed
-- delivery again.
--
-- spec-77 phase 1b: a `force_split` dispatch is excluded from this set. A
-- split order's row is never soft-deleted (part of it genuinely travels
-- with this route), but it must not keep reserving the WHOLE order against
-- Pre-Ruta — only the (now-shipped) half it actually claims, which
-- ready_pkgs' own loaded_at filter above already keeps out of the "ready"
-- set. Any OTHER, still-fully-committing dispatch for the same order (a
-- separate route) still excludes it, unaffected by this.
routed_ids AS (
  SELECT DISTINCT d.order_id
  FROM   dispatches d
  JOIN   routes r ON r.id = d.route_id
  WHERE  d.operator_id = p_operator_id
    AND  d.deleted_at  IS NULL
    AND  d.order_id    IS NOT NULL
    AND  d.stage       <> 'force_split'
    AND  r.deleted_at  IS NULL
    AND  r.status IN ('draft', 'planned', 'loading', 'loaded', 'dispatched', 'in_transit', 'in_progress')
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

  -- jsonb_agg cannot wrap a jsonb_build_object that itself contains COUNT/SUM
  -- in the same SELECT (nested aggregates, SQLSTATE 42803). Hoist the GROUP BY
  -- into a subquery so the per-comuna aggregates are computed first, then
  -- jsonb_agg over the resulting rows.
  'unmapped_comunas', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',            uc.id,
        'name',          uc.name,
        'order_count',   uc.order_count,
        'package_count', uc.package_count
      )
      ORDER BY uc.name
    )
    FROM (
      SELECT
        cc.id,
        cc.nombre AS name,
        COUNT(*) AS order_count,
        SUM(COALESCE(pc.cnt, 0)) AS package_count
      FROM   unmapped u
      JOIN   chile_comunas cc ON cc.id = u.comuna_id
      LEFT JOIN pkg_counts pc ON pc.order_id = u.id
      GROUP  BY cc.id, cc.nombre
    ) uc
  ), '[]'::jsonb)
)
$$;

COMMENT ON FUNCTION public.get_pre_route_snapshot(uuid, date, time, time) IS
  'Pre-Ruta planning snapshot. Returns unrouted, dock-ready orders grouped by andén for the given operator, delivery date, and optional time-window band. Ready = sectorizado (the state the dock-scan trigger writes) plus asignado/listo_para_despacho, excluding any package genuinely loaded onto a route already (loaded_at IS NOT NULL AND load_inferred = false, spec-77 phase 1b); en_bodega removed spec-76 task 3. retenido (consolidation) is excluded. An order is excluded from the unrouted cohort while any of its NON-force_split dispatches sits on a route in an active spec-70 status (draft/planned/loading/loaded/dispatched/in_transit/in_progress) — only completed/cancelled release it (retorno_hub, spec-43), and a force_split dispatch (spec-77 phase 1b) never claims the whole order in the first place, only the half that already shipped.';

GRANT EXECUTE ON FUNCTION public.get_pre_route_snapshot(uuid, date, time, time) TO authenticated;

-- ============================================================================
-- Validation: the replaced function must still exist and parse
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_pre_route_snapshot'
  ) THEN
    RAISE EXCEPTION 'Function get_pre_route_snapshot missing after CREATE OR REPLACE';
  END IF;
END $$;

COMMIT;
