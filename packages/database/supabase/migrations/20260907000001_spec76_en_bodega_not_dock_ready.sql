-- =============================================================================
-- en_bodega stops being a "dock-ready" status — SQL catches up to TypeScript
-- =============================================================================
-- spec-76 task 3 (escalated decision) removed 'en_bodega' from
-- DISPATCHABLE_STATUSES (apps/frontend/src/lib/dispatch/scan-validator.ts):
-- migration 20260817000003's own analysis notes `dock_zone_id IS NOT NULL
-- AND status = 'en_bodega'` are "very nearly mutually exclusive" — the only
-- writer of packages.dock_zone_id (trg_dock_scan_advance_package_status,
-- latest def 20260506000001) sets status = 'sectorizado' in the SAME
-- UPDATE. A package still 'en_bodega' genuinely has never been sorted to
-- an andén; the crew cannot physically be holding it. That migration added
-- 'sectorizado' to the dock-ready cohort — it did NOT add 'en_bodega',
-- whose presence there was vestigial, not deliberate. Dock-door
-- verification norm is block-not-warn for freight that has not been
-- "scanned, verified and released"; the scanner now matches that.
--
-- Follow-up review on that change found the TS-side fix was NOT mirrored in
-- SQL, and it should have been: two functions carry their own hand-copied
-- status list.
--
-- 1. recompute_dispatch_stage (latest def: 20260902000001, line 456) decides
--    whether a dispatch is "outstanding" or "staged"/"partially_staged" —
--    the exact figure seal-route.ts's adopted-completeness gate and 2c/2h's
--    "órdenes incompletas" / "NO EMBARCADO" both read. Left un-migrated,
--    a route with an en_bodega sibling could SEAL (seal-route.ts already
--    excludes en_bodega, via DISPATCHABLE_STATUSES on the TS side) while
--    the dispatch stayed pinned at partially_staged forever — a crew that
--    scans every box it can get a sealed route whose orders read
--    incomplete forever, with no scan able to fix it.
--
--    That migration's own header (20260902000001:398-409) claims the SQL
--    list "MUST stay identical to DISPATCHABLE_STATUSES" and that drift
--    would turn two suites red. Checked: it would not have. Neither
--    spec74_phase3_partially_staged.test.sql (0 occurrences of 'en_bodega'
--    before this migration) nor stage-dispatch.test.ts asserted it, and
--    SQL tests do not run in CI here regardless (scripts/pgtap-local.sh is
--    a local-only Docker harness) — the guard was claimed and never
--    written. TEST 10 in spec74_phase3_partially_staged.test.sql (added
--    alongside this migration) is what makes that claim true from here on.
--
-- 2. get_pre_route_snapshot (latest def: 20260825000004, line 47) decides
--    which orders Pre-Ruta offers a manager to build a route from. Its own
--    COMMENT ON FUNCTION already called en_bodega "legacy" — this makes
--    that literal: a planner must not build a route around a box the dock
--    will refuse to load. TEST 14 in pre_route_snapshot.test.sql (added
--    alongside this migration) covers the exclusion; every other fixture
--    in that file was ALSO switched from 'en_bodega' to 'sectorizado' —
--    they used 'en_bodega' purely as a generic "ready" placeholder
--    (TEST 11's own comment already called that combination one "the app
--    never produces"), and that placeholder is no longer valid.
--
-- Kept in sync going forward: `DISPATCHABLE_STATUSES`
-- (apps/frontend/src/lib/dispatch/scan-validator.ts) is the one source of
-- truth for "which package statuses can be scanned/staged/routed"; both
-- functions below, plus their own two comments, restate the SAME list by
-- hand because SQL cannot import a TS constant. A future change to that
-- constant must update both function bodies here AND the two test files
-- named above (spec74_phase3_partially_staged.test.sql TEST 10,
-- pre_route_snapshot.test.sql TEST 14) — those are what will actually go
-- red on drift now, not just a comment promising it.
--
-- No backfill, no data migration: CREATE OR REPLACE only. Production sits
-- at roughly 112k dispatches; nothing here rewrites existing rows, and the
-- pre-deploy check this depends on (count route/position scans that landed
-- on an en_bodega package in the last 30 days) is recorded in
-- docs/specs/spec-76-despacho-movil-carga.md, not run here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. recompute_dispatch_stage — template: 20260902000001 (latest def).
--    Only the status list on the outstanding-count query changed;
--    every other clause is byte-for-byte identical to that definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_dispatch_stage(
  p_dispatch_id uuid,
  p_operator_id uuid,
  p_order_id    uuid,
  p_user_id     uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current_stage      text;
  v_next_stage         text;
  v_outstanding_count  integer;
BEGIN
  -- Lock first, read second: nothing about this dispatch is trusted until
  -- the row is ours. `operator_id` is filtered here too (not just relied on
  -- via RLS) so a wrong-tenant id fails the row match outright rather than
  -- depending solely on the policy.
  SELECT stage INTO v_current_stage
    FROM public.dispatches
   WHERE id = p_dispatch_id
     AND operator_id = p_operator_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recompute_dispatch_stage: no dispatch row matched (dispatch %, operator %)',
      p_dispatch_id, p_operator_id;
  END IF;

  -- spec-74 phase 2 review item 3, preserved here exactly as
  -- stage-dispatch.ts preserved it: `adopted` is never rewritten. Read from
  -- the just-locked row rather than trusting a caller-supplied value, which
  -- is strictly fresher than anything the TS layer could have cached from
  -- validation time.
  IF v_current_stage = 'adopted' THEN
    v_next_stage := 'adopted';
  ELSE
    -- Fix 1's intersection, done here instead of in the caller now that the
    -- caller no longer performs this read at all.
    --
    -- spec-76 task 3 (escalated decision): 'en_bodega' dropped. It means
    -- "never sorted to an andén" (see this migration's header) — the
    -- scanner now refuses it (NOT_ON_DOCK), so it must not count as
    -- outstanding here either, same reasoning as dañado/retenido/entregado
    -- never counting.
    SELECT COUNT(*) INTO v_outstanding_count
      FROM public.packages
     WHERE operator_id = p_operator_id
       AND order_id    = p_order_id
       AND deleted_at IS NULL
       AND loaded_at  IS NULL
       AND status IN ('sectorizado', 'asignado', 'listo_para_despacho');

    v_next_stage := CASE WHEN v_outstanding_count > 0 THEN 'partially_staged' ELSE 'staged' END;
  END IF;

  UPDATE public.dispatches
     SET stage     = v_next_stage,
         staged_at = now(),
         staged_by = p_user_id
   WHERE id = p_dispatch_id
     AND operator_id = p_operator_id;

  RETURN v_next_stage;
END;
$$;

COMMENT ON FUNCTION public.recompute_dispatch_stage(uuid, uuid, uuid, uuid) IS
  'spec-74 phase 3 review Fix 3, status list updated spec-76 task 3 (escalated '
  'decision, en_bodega removed — see 20260907000001). Atomically locks a '
  'dispatch row, recomputes its stage from packages (planned/'
  'partially_staged <-> staged, adopted preserved), and writes stage/'
  'staged_at/staged_by in one statement — closing the read-then-write race '
  'two concurrent scans of one order could hit. Caller MUST write the '
  'scanned package''s loaded_at before calling (see this function''s own '
  'header comment). SECURITY INVOKER — relies on the caller''s own RLS on '
  'dispatches/packages, exactly like every other function in this file.';

GRANT EXECUTE ON FUNCTION public.recompute_dispatch_stage(uuid, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_pre_route_snapshot — template: 20260825000004 (latest def).
--    Only the ready_pkgs status list and its COMMENT ON FUNCTION changed;
--    every other clause is byte-for-byte identical to that definition.
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
-- spec-76 task 3 (escalated decision): 'en_bodega' dropped — a planner
-- must not build a route around a box the dock will refuse to load
-- (scan-validator.ts's NOT_ON_DOCK). See this migration's header.
ready_pkgs AS (
  SELECT p.id, p.order_id, p.dock_zone_id, p.created_at
  FROM   packages p
  WHERE  p.operator_id  = p_operator_id
    AND  p.deleted_at   IS NULL
    AND  p.dock_zone_id IS NOT NULL
    AND  p.status IN ('sectorizado', 'asignado', 'listo_para_despacho')
),

-- Step 2: Order IDs already on an active route. Every non-terminal status —
-- draft/planned/loading/loaded (still local) and dispatched/in_transit/
-- in_progress (already at DT) — owns its order. Only completed/cancelled
-- release it, which is what lets retorno_hub (spec-43) route a failed
-- delivery again.
routed_ids AS (
  SELECT DISTINCT d.order_id
  FROM   dispatches d
  JOIN   routes r ON r.id = d.route_id
  WHERE  d.operator_id = p_operator_id
    AND  d.deleted_at  IS NULL
    AND  d.order_id    IS NOT NULL
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
  'Pre-Ruta planning snapshot. Returns unrouted, dock-ready orders grouped by andén for the given operator, delivery date, and optional time-window band. Ready = sectorizado (the state the dock-scan trigger writes) plus asignado/listo_para_despacho; en_bodega removed spec-76 task 3 (escalated decision, 20260907000001) — a planner must not build a route around a box the dock will refuse to load. retenido (consolidation) is excluded. An order is excluded from the unrouted cohort while any of its dispatches sits on a route in an active spec-70 status (draft/planned/loading/loaded/dispatched/in_transit/in_progress) — only completed/cancelled release it, so retorno_hub (spec-43) can route a failed delivery again.';

-- ============================================================================
-- Validation: both replaced functions must still exist and parse
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'recompute_dispatch_stage'
  ) THEN
    RAISE EXCEPTION 'Function recompute_dispatch_stage missing after CREATE OR REPLACE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_pre_route_snapshot'
  ) THEN
    RAISE EXCEPTION 'Function get_pre_route_snapshot missing after CREATE OR REPLACE';
  END IF;
END $$;
