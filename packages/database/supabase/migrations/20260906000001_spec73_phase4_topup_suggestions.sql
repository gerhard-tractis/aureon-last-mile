-- =============================================================================
-- spec-73 phase 4 — top-up suggestions and the move task.
--
-- Scope check (docs/specs/spec-73-capacity-ladder-truck-topup.md, Phase 4
-- bullet + Decision 5/6), verified against the codebase before writing this
-- migration:
--   * spec-70's audited manager-only removal DOES exist and works as
--     Decision 5.6 describes: DELETE /routes/[id]/packages/[pkgId]
--     (apps/frontend/src/app/api/dispatch/routes/[id]/packages/[pkgId]/route.ts)
--     soft-deletes one dispatch with a required `removal_reason`, gated to
--     PLAN_MANAGER_ROLES, refusing any route not in
--     draft/planned/loading. This migration's accept_topup_block reuses
--     the SAME mechanism (soft-delete + removal_reason + audit_logs), not a
--     second removal path — it does not call the HTTP endpoint (an RPC
--     cannot make an HTTP round-trip to itself), but it performs the exact
--     same database operation that endpoint performs, so there remains
--     exactly one AUDITED WAY an order's dispatch row gets soft-deleted off
--     a route's plan with a reason attached.
--   * spec-71's staging-scan mechanism (load_positions / dock_scans /
--     get_move_task_snapshot, 20260827000001, 20260828000001) already
--     defines "moved" as a PER-PACKAGE fact: dock_scans.load_position_id
--     IS NOT NULL for a package. get_move_task_snapshot already groups a
--     route's remaining (not-yet-scanned) packages by the andén they
--     currently sit in. A borrowed block's dispatches, once re-pointed at
--     the accepting route while its packages physically remain at the
--     donor andén, therefore appear on that EXACT snapshot as a normal
--     "still needs to move to my position" group — no new move-task table,
--     no new scan endpoint, and no shortcut that skips the physical scan:
--     the DB has moved the PLAN, but nothing marks these packages staged
--     until a warehouse worker scans them into the accepting route's
--     load position through the mechanism that already enforces that scan
--     (POST /api/dispatch/load-positions/scan). This is Decision 5.5's
--     "always an explicit scan-confirmed move task, never implicit" —
--     satisfied by reuse, not by inventing a second, parallel one.
--   * A "block" is spec-72's route_blocks — a single migration table this
--     branch is an ancestor of (20260903000001..000008, all merged). No
--     ad-hoc comuna grouping was needed; the full-value path the spec's
--     dependency note describes as possible-later is available NOW.
--
-- What this migration adds:
--   1. route_blocks.donor_route_id — nullable provenance column. NULL for
--      every ordinary ('default'/'manual'/'optimizer') block; set only on
--      a block created by accept_topup_block below, naming the route it was
--      borrowed from. This is what makes Decision 5.4's "one borrowed block
--      per route" cap checkable (a route already holding a live block with
--      donor_route_id NOT NULL has used its one slot) without inventing a
--      separate ledger table.
--   2. route_blocks_sequence_source_check widened to add 'topup' alongside
--      the three values spec-72 phase 1 already defined — a fourth,
--      additive provenance value, not a redefinition of the first three.
--   3. route_source_dock_zone_ids(route_id, operator_id, comuna_id DEFAULT
--      NULL) — shared read helper: the live, non-retired andén(es) a
--      route's packages currently sit in, optionally narrowed to one
--      comuna. Mirrors load_position_conflicts_with_route's own source-andén
--      derivation (20260827000003) exactly (dispatches -> packages via
--      order_id, packages.dock_zone_id, dock_zones.deleted_at IS NULL) —
--      reused here rather than re-derived, so "which andén does this route
--      / this block source from" means the same thing everywhere in the
--      schema.
--   4. get_topup_candidates(route_id, operator_id) — read-only. Computes
--      every adjacent donor block a route could top up with, enforcing
--      Decision 5 rules 1/2/4/6 and Decision 6's max_drops gate.
--   5. accept_topup_block(receiving_route_id, donor_route_id, comuna_id,
--      operator_id, user_id, reason) — the write. Re-validates every rule
--      under row locks (defense against a stale suggestion / a race), then
--      performs the donor-side audited removal (soft-delete + reason +
--      audit_logs, one row per dispatch, exactly like the existing DELETE
--      endpoint) and the receiving-side append (new dispatches at stage
--      'planned', a new route_blocks row at the END of the receiving
--      route's sequence, sequence_source = 'topup').
--
-- Direction hazard (per the phase-4 spec bullet, confirmed against phase 3's
-- actual write path, 20260905000001): phase 3 now writes BOTH directions of
-- every adjacency pair, so a single-column read would already be correct
-- for every pair added through the RPCs. This migration's reads still use
-- `WHERE dock_zone_id = ANY(...) OR adjacent_zone_id = ANY(...)` WITH
-- DISTINCT anyway, exactly as the spec requires, because rows written before
-- phase 3 existed (or by any future direct-SQL fixture/seed) can still be
-- one-directional — the schema itself does not forbid it, only phase 3's
-- RPCs guarantee it going forward.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. route_blocks: top-up provenance
-- ---------------------------------------------------------------------------

ALTER TABLE public.route_blocks
  ADD COLUMN IF NOT EXISTS donor_route_id UUID REFERENCES public.routes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.route_blocks.donor_route_id IS
  'spec-73 phase 4. Set only on a block created by accept_topup_block: the '
  'route this block''s comuna was borrowed from. NULL for every ordinary '
  '(default/manual/optimizer) block. Used to enforce Decision 5.4''s '
  '"one borrowed block per route" cap — a route already holding a live '
  'route_blocks row with donor_route_id NOT NULL has used its one slot and '
  'get_topup_candidates returns no further suggestions for it.';

CREATE INDEX IF NOT EXISTS idx_route_blocks_donor_route_id
  ON public.route_blocks (donor_route_id)
  WHERE donor_route_id IS NOT NULL;

ALTER TABLE public.route_blocks
  DROP CONSTRAINT IF EXISTS route_blocks_sequence_source_check;
ALTER TABLE public.route_blocks
  ADD CONSTRAINT route_blocks_sequence_source_check
  CHECK (sequence_source IN ('default', 'manual', 'optimizer', 'topup'));

-- ---------------------------------------------------------------------------
-- 1b. Who may stamp a block as borrowed.
--
-- Review fix (security), the same finding phase 3 landed one table over.
-- spec-72 phase 1 shipped `GRANT SELECT, INSERT, UPDATE ON route_blocks TO
-- authenticated` with an RLS policy that only checks the tenant, never the
-- role. Reproduced by the reviewer: a `loading_crew` user INSERTed a row
-- with sequence_source = 'topup' and an arbitrary donor_route_id straight
-- through PostgREST, and UPDATEd an existing block's provenance to match.
-- Phase 4 makes that newly harmful, because donor_route_id is now the
-- ledger Decision 5.4's "one borrowed block per route" cap reads: one
-- forged row and get_topup_candidates answers ALREADY_HAS_TOPUP for that
-- route forever -- a denial of service against every legitimate top-up,
-- available to any signed-in user in the tenant.
--
-- The full remedy phase 3 used (REVOKE the direct writes, make the RPCs
-- SECURITY DEFINER) is not available here without also rewriting spec-72's
-- three SECURITY INVOKER block writers (seed_default_route_blocks,
-- move_route_block, create_seeded_route), which is outside this phase.
-- A trigger closes the part phase 4 actually introduced, regardless of
-- grants: only a plan manager may write top-up provenance. The residual --
-- a manager forging a block directly, bypassing Decision 5's rules -- is
-- spec-72's pre-existing hole for the other three sequence_source values,
-- unchanged by this phase and called out in the spec's review notes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.route_blocks_topup_provenance_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $guard$
DECLARE
  v_uid  uuid;
  v_role public.user_role;
BEGIN
  IF NEW.sequence_source IS DISTINCT FROM 'topup' AND NEW.donor_route_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_uid := NULLIF(auth.jwt() ->> 'sub', '')::uuid;

  -- No JWT at all = a migration, a seed, or a service_role backend job.
  -- Those already hold far broader rights than this trigger could defend.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM public.users
   WHERE id = v_uid AND operator_id = NEW.operator_id AND deleted_at IS NULL;

  IF v_role IS NULL
     OR v_role::text NOT IN ('ops_leader', 'operations_manager', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un responsable puede registrar un bloque prestado (relleno).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS trg_route_blocks_topup_provenance_guard ON public.route_blocks;
CREATE TRIGGER trg_route_blocks_topup_provenance_guard
  BEFORE INSERT OR UPDATE ON public.route_blocks
  FOR EACH ROW EXECUTE FUNCTION public.route_blocks_topup_provenance_guard();

-- ---------------------------------------------------------------------------
-- 2. route_source_dock_zone_ids — shared "which andén(es) does this route
--    (or this one comuna on it) currently source packages from" read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.route_source_dock_zone_ids(
  p_route_id    uuid,
  p_operator_id uuid,
  p_comuna_id   uuid DEFAULT NULL
) RETURNS TABLE (dock_zone_id uuid)
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT dz.id
    FROM public.dispatches d
    JOIN public.orders o
      ON o.id           = d.order_id
     AND o.operator_id  = d.operator_id
     AND o.deleted_at   IS NULL
    JOIN public.packages p
      ON p.order_id     = o.id
     AND p.operator_id  = d.operator_id
     AND p.deleted_at   IS NULL
    JOIN public.dock_zones dz
      ON dz.id           = p.dock_zone_id
     AND dz.deleted_at    IS NULL
   WHERE d.route_id     = p_route_id
     AND d.operator_id  = p_operator_id
     AND d.deleted_at   IS NULL
     AND (p_comuna_id IS NULL OR o.comuna_id = p_comuna_id);
$$;

COMMENT ON FUNCTION public.route_source_dock_zone_ids(uuid, uuid, uuid) IS
  'spec-73 phase 4. The live, non-retired andén(es) (dock_zones) a route''s '
  'packages currently sit in, optionally narrowed to one comuna (used to '
  'get one block''s andén rather than a whole route''s). Mirrors '
  'load_position_conflicts_with_route''s source-andén derivation '
  '(20260827000003) exactly, so "which andén does X source from" is one '
  'definition, not two.';

GRANT EXECUTE ON FUNCTION public.route_source_dock_zone_ids(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2b. route_block_is_physically_staged — REVIEW FIX 1 (Decision 5.5).
--
-- The reviewer's probe: a donor route is allowed to be 'loading', and a
-- 'loading' route is precisely one whose packages are being scanned onto its
-- own load position right now. Move such a block and the plan follows the
-- receiving route while the boxes stay in the DONOR's truck — and because
-- spec-71's get_move_task_snapshot decides "still has to move" from
-- dock_scans.load_position_id (a GLOBAL per-package fact, not a per-route
-- one), those packages read as ALREADY MOVED and never appear on the
-- receiving route's move task. Proven live: R's snapshot went
-- total_packages 1 -> 2 while remaining_packages stayed 1, with no group
-- naming the borrowed andén. Meanwhile the new dispatch is stage='planned',
-- so sealRoute refuses the receiving route forever (UNSEALED_STOPS), and
-- validateScan refuses to re-scan the package (ALREADY_STAGED: loaded_at
-- set with load_inferred = false). The route becomes unsealable, the box
-- becomes invisible, and no scan can resolve either — the exact
-- "a top-up that only updates route_id ... is how packages go missing"
-- shortcut Decision 5.5 refuses.
--
-- The fix is a refusal, not a rewrite of the physical facts: clearing
-- loaded_at / the dock_scans row would erase a true audit fact (the box IS
-- in the donor's truck) and still would not tell anyone to pull it out
-- again. A block that has already started loading onto its donor's truck is
-- simply not a top-up candidate. Blocks that were never staged move
-- exactly as before (proven: the borrowed andén appears as its own group on
-- the receiving route's move task), so Decision 5.5's reuse claim holds for
-- the case this function now restricts it to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.route_block_is_physically_staged(
  p_route_id    uuid,
  p_operator_id uuid,
  p_comuna_id   uuid
) RETURNS boolean
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.dispatches d
      JOIN public.orders o
        ON o.id          = d.order_id
       AND o.operator_id = d.operator_id
       AND o.deleted_at  IS NULL
       AND o.comuna_id   = p_comuna_id
      JOIN public.packages p
        ON p.order_id    = o.id
       AND p.operator_id = d.operator_id
       AND p.deleted_at  IS NULL
     WHERE d.route_id    = p_route_id
       AND d.operator_id = p_operator_id
       AND d.deleted_at  IS NULL
       AND (
         -- A genuine load scan (spec-74 phase 2: loaded_at alone is not
         -- enough, phase 1 backfilled it optimistically onto every live
         -- package — load_inferred = false is what makes it a real scan,
         -- the same predicate validateScan's ALREADY_STAGED uses).
         (p.loaded_at IS NOT NULL AND p.load_inferred = false)
         OR EXISTS (
           SELECT 1 FROM public.dock_scans ds
            WHERE ds.package_id       = p.id
              AND ds.operator_id      = p_operator_id
              AND ds.deleted_at       IS NULL
              AND ds.load_position_id IS NOT NULL
         )
       )
  );
$$;

COMMENT ON FUNCTION public.route_block_is_physically_staged(uuid, uuid, uuid) IS
  'spec-73 phase 4 review fix (Decision 5.5). TRUE when any package of this '
  'route''s comuna block has already been physically scanned onto a load '
  'position. Such a block cannot be donated: spec-71''s move task would '
  'never surface it as remaining work on the receiving route (dock_scans '
  'load_position_id is a global per-package fact), validateScan would '
  'refuse to re-scan it (ALREADY_STAGED), and the receiving route could '
  'never seal — a top-up that moves the plan without a possible physical '
  'confirmation, which is exactly what Decision 5.5 refuses.';

GRANT EXECUTE ON FUNCTION public.route_block_is_physically_staged(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_topup_candidates — read-only suggestion computation.
-- ---------------------------------------------------------------------------
--
-- Enforces, in this function, before any candidate is ever returned:
--   Decision 6:   a receiving route already at max_drops gets NO
--                 suggestions, even with physical room left.
--   Decision 5.4: a route that already holds a borrowed (donor_route_id
--                 NOT NULL) live block gets NO further suggestions —
--                 "one borrowed block per route".
--   Decision 5.1: candidates are restricted to blocks sourced from an andén
--                 adjacent (dock_zone_adjacency, either direction, WITH
--                 DISTINCT) to one this route already sources from.
--   Decision 5.6: only a donor route still 'planned' or 'loading' is ever
--                 offered — 'loaded' and beyond (sealed manifest) is never
--                 raided.
--   Decision 5.4 (25% cap): a candidate block whose package_count exceeds
--                 roughly a quarter of the receiving route's OWN current
--                 live package count is excluded. A receiving route with
--                 zero packages today has no baseline to compare against
--                 (0 * 0.25 = 0 would exclude every candidate, including a
--                 tiny one), so the cap is skipped for a route with zero
--                 packages — every candidate is size-eligible in that case,
--                 and Decision 5.4's OTHER half ("one block per route") is
--                 still the binding cap for it.
--
-- Every rule this function enforces is re-enforced (not merely assumed)
-- inside accept_topup_block below, under row locks, against fresh state —
-- this function's output is a suggestion, never a ticket the accept path
-- trusts blindly.
CREATE OR REPLACE FUNCTION public.get_topup_candidates(
  p_route_id    uuid,
  p_operator_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route          RECORD;
  v_own_count      integer;
  v_drop_count     integer;
  v_cap            integer;
  v_drop_headroom  integer;
  v_has_topup      boolean;
BEGIN
  SELECT id, status, max_drops INTO v_route
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Only a route still being assembled can accept an appended block —
  -- matches the status window move_route_block/seed_default_route_blocks
  -- already gate block writes on (spec-72 phase 2/3).
  IF v_route.status NOT IN ('draft', 'planned', 'loading') THEN
    RETURN jsonb_build_object('route_id', p_route_id, 'eligible', false,
      'reason', 'ROUTE_NOT_LOADABLE', 'candidates', '[]'::jsonb);
  END IF;

  -- Live dispatch (= drop) count on this route, for both the max_drops
  -- gate (Decision 6) and the package count used by Decision 5.4's 25%
  -- cap below.
  SELECT COUNT(*) INTO v_drop_count
    FROM public.dispatches d
   WHERE d.route_id = p_route_id AND d.operator_id = p_operator_id AND d.deleted_at IS NULL;

  IF v_route.max_drops IS NOT NULL AND v_route.max_drops > 0 AND v_drop_count >= v_route.max_drops THEN
    RETURN jsonb_build_object('route_id', p_route_id, 'eligible', false,
      'reason', 'AT_MAX_DROPS', 'candidates', '[]'::jsonb);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.route_blocks rb
     WHERE rb.route_id = p_route_id
       AND rb.operator_id = p_operator_id
       AND rb.deleted_at IS NULL
       AND rb.donor_route_id IS NOT NULL
  ) INTO v_has_topup;

  IF v_has_topup THEN
    RETURN jsonb_build_object('route_id', p_route_id, 'eligible', false,
      'reason', 'ALREADY_HAS_TOPUP', 'candidates', '[]'::jsonb);
  END IF;

  -- Live PACKAGE count on this route (not dispatch/drop count) — the
  -- baseline Decision 5.4's ~25% cap is measured against.
  SELECT COUNT(*) INTO v_own_count
    FROM public.dispatches d
    JOIN public.packages p
      ON p.order_id    = d.order_id
     AND p.operator_id = d.operator_id
     AND p.deleted_at  IS NULL
   WHERE d.route_id = p_route_id AND d.operator_id = p_operator_id AND d.deleted_at IS NULL;

  -- CEIL(0.25 * own load); NULL (no cap applied) when own load is zero —
  -- see header comment.
  v_cap := CASE WHEN v_own_count > 0 THEN CEIL(v_own_count * 0.25)::integer ELSE NULL END;

  -- Remaining drops before max_drops binds; NULL = unconfigured cap, which
  -- means "no cap", never "a cap of zero" (the `> 0` guard above keeps a
  -- literal 0 meaning the same thing it did before this fix).
  v_drop_headroom := CASE
    WHEN v_route.max_drops IS NOT NULL AND v_route.max_drops > 0
      THEN v_route.max_drops - v_drop_count
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'route_id', p_route_id,
    'eligible', true,
    'reason', NULL,
    'candidates', COALESCE((
      WITH own_zones AS (
        SELECT dock_zone_id FROM public.route_source_dock_zone_ids(p_route_id, p_operator_id, NULL)
      ),
      -- Decision 5.1 + direction hazard: symmetric read over
      -- dock_zone_adjacency, DISTINCT, filtering the NEIGHBOUR zone's own
      -- deleted_at (a pair predating phase 3's cascade trigger can still
      -- point at a since-retired andén).
      neighbor_zones AS (
        SELECT DISTINCT dz2.id AS zone_id
          FROM public.dock_zone_adjacency a
          JOIN public.dock_zones dz2
            ON dz2.deleted_at IS NULL
           AND dz2.id = (CASE WHEN a.dock_zone_id IN (SELECT dock_zone_id FROM own_zones)
                               THEN a.adjacent_zone_id ELSE a.dock_zone_id END)
         WHERE a.operator_id = p_operator_id
           AND a.deleted_at  IS NULL
           AND (a.dock_zone_id IN (SELECT dock_zone_id FROM own_zones)
                OR a.adjacent_zone_id IN (SELECT dock_zone_id FROM own_zones))
           AND dz2.id NOT IN (SELECT dock_zone_id FROM own_zones)
      ),
      donor_blocks AS (
        SELECT rb.id AS route_block_id, rb.route_id AS donor_route_id, rb.comuna_id,
               dr.external_route_id AS donor_external_route_id,
               dr.driver_name AS donor_driver_name
          FROM public.route_blocks rb
          JOIN public.routes dr
            ON dr.id = rb.route_id
           AND dr.operator_id = p_operator_id
           AND dr.deleted_at IS NULL
           AND dr.status IN ('planned', 'loading')   -- Decision 5.6
         WHERE rb.operator_id = p_operator_id
           AND rb.deleted_at IS NULL
           AND rb.route_id <> p_route_id
      ),
      donor_block_zones AS (
        SELECT db.*, z.dock_zone_id
          FROM donor_blocks db
          CROSS JOIN LATERAL public.route_source_dock_zone_ids(db.donor_route_id, p_operator_id, db.comuna_id) z
      ),
      eligible_blocks AS (
        SELECT DISTINCT dbz.route_block_id, dbz.donor_route_id, dbz.comuna_id,
               dbz.donor_external_route_id, dbz.donor_driver_name
          FROM donor_block_zones dbz
         WHERE dbz.dock_zone_id IN (SELECT zone_id FROM neighbor_zones)
      ),
      sized AS (
        SELECT eb.*, c.nombre AS comuna_name,
               -- Review fix: `o2.deleted_at IS NULL` added. Every other read
               -- in this migration (route_source_dock_zone_ids) filters it,
               -- so without it a block's advertised size counted packages of
               -- soft-deleted orders the accept path would then move.
               (SELECT COUNT(*)
                  FROM public.dispatches d2
                  JOIN public.orders o2
                    ON o2.id = d2.order_id AND o2.operator_id = d2.operator_id
                   AND o2.comuna_id = eb.comuna_id AND o2.deleted_at IS NULL
                  JOIN public.packages p2
                    ON p2.order_id = o2.id AND p2.operator_id = d2.operator_id AND p2.deleted_at IS NULL
                 WHERE d2.route_id = eb.donor_route_id AND d2.operator_id = p_operator_id AND d2.deleted_at IS NULL
               ) AS package_count,
               -- Review fix (Decision 6): a DROP is a dispatch, not a
               -- package. max_drops was only ever checked as "is the route
               -- already at its cap", never "would accepting this block
               -- push it past". Proven: a route with max_drops = 2 holding
               -- 1 drop was offered — and accepted — a 5-order block and
               -- ended at 6 drops, three times its cap. The suggestion side
               -- now needs the block's ORDER count to filter on headroom.
               (SELECT COUNT(*)
                  FROM public.dispatches d3
                  JOIN public.orders o3
                    ON o3.id = d3.order_id AND o3.operator_id = d3.operator_id
                   AND o3.comuna_id = eb.comuna_id AND o3.deleted_at IS NULL
                 WHERE d3.route_id = eb.donor_route_id AND d3.operator_id = p_operator_id AND d3.deleted_at IS NULL
               ) AS order_count
          FROM eligible_blocks eb
          JOIN public.chile_comunas c ON c.id = eb.comuna_id
         -- Review fix (Decision 5.5): a block already being loaded onto its
         -- donor's truck is not a candidate — see
         -- route_block_is_physically_staged's own comment.
         WHERE NOT public.route_block_is_physically_staged(eb.donor_route_id, p_operator_id, eb.comuna_id)
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'route_block_id',          route_block_id,
          'donor_route_id',          donor_route_id,
          'donor_external_route_id', donor_external_route_id,
          'donor_driver_name',       donor_driver_name,
          'comuna_id',               comuna_id,
          'comuna_name',             comuna_name,
          'package_count',           package_count
        )
        ORDER BY package_count ASC, comuna_name
      )
      FROM sized
      WHERE package_count > 0
        AND (v_cap IS NULL OR package_count <= v_cap)
        -- Decision 6 headroom, review fix: the block must FIT under
        -- max_drops, not merely find the route not yet at it.
        AND (v_drop_headroom IS NULL OR order_count <= v_drop_headroom)
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_topup_candidates(uuid, uuid) IS
  'spec-73 phase 4 (Decision 5/6). Adjacent-andén, whole-block top-up '
  'candidates for a route, enforcing max_drops (Decision 6), the '
  '"one borrowed block" cap, adjacency (symmetric, DISTINCT), donor status '
  '(planned/loading only, Decision 5.6), and the ~25%-of-own-load size cap '
  '(Decision 5.4). Raises ROUTE_NOT_FOUND (P0002); every other ineligible '
  'case returns {eligible:false, reason, candidates:[]} rather than raising, '
  'since "no suggestions right now" is a normal state, not an error.';

GRANT EXECUTE ON FUNCTION public.get_topup_candidates(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. accept_topup_block — the write: donor removal + receiving append.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_topup_block(
  p_receiving_route_id uuid,
  p_donor_route_id     uuid,
  p_comuna_id          uuid,
  p_operator_id        uuid,
  p_user_id            uuid,
  p_reason             text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
  v_receiving   RECORD;
  v_donor       RECORD;
  v_own_count   integer;
  v_drop_count  integer;
  v_cap         integer;
  v_block_count integer;
  v_own_zones   uuid[];
  v_block_zones uuid[];
  v_adjacent    boolean;
  v_max_seq     integer;
  v_new_block   uuid;
  v_dispatch    RECORD;
  v_moved_orders uuid[] := '{}';
  v_moved_count  integer := 0;   -- DISPATCHES (= drops) moved
  v_moved_pkgs   integer := 0;   -- PACKAGES moved (review fix: the 25% unit)
  v_actor        uuid;
  v_actor_role   public.user_role;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a reason is required to move a block off its donor route'
      USING ERRCODE = '22023';
  END IF;

  -- Lock BOTH routes, in a canonical (id-sorted) order — same deadlock-
  -- avoidance reasoning as add_dock_zone_adjacency_pair's LEAST/GREATEST
  -- VALUES ordering (20260905000001): two concurrent accepts that name the
  -- same two routes in opposite roles must acquire their locks in the same
  -- global order or Postgres will abort one with 40P01.
  IF p_receiving_route_id < p_donor_route_id THEN
    PERFORM 1 FROM public.routes WHERE id = p_receiving_route_id AND operator_id = p_operator_id AND deleted_at IS NULL FOR UPDATE;
    PERFORM 1 FROM public.routes WHERE id = p_donor_route_id     AND operator_id = p_operator_id AND deleted_at IS NULL FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.routes WHERE id = p_donor_route_id     AND operator_id = p_operator_id AND deleted_at IS NULL FOR UPDATE;
    PERFORM 1 FROM public.routes WHERE id = p_receiving_route_id AND operator_id = p_operator_id AND deleted_at IS NULL FOR UPDATE;
  END IF;

  SELECT id, status, max_drops INTO v_receiving
    FROM public.routes WHERE id = p_receiving_route_id AND operator_id = p_operator_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: receiving route % for operator %', p_receiving_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT id, status INTO v_donor
    FROM public.routes WHERE id = p_donor_route_id AND operator_id = p_operator_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: donor route % for operator %', p_donor_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_receiving_route_id = p_donor_route_id THEN
    RAISE EXCEPTION 'INVALID_TOPUP: a route cannot top up from itself' USING ERRCODE = '22023';
  END IF;

  -- -------------------------------------------------------------------
  -- Review fix (security). Before this, the ONLY manager gate on a top-up
  -- lived in the Next.js handler -- but this function is
  -- `GRANT EXECUTE ... TO authenticated`, so PostgREST exposes it to every
  -- signed-in user in the tenant. Reproduced: a `loading_crew` user (the
  -- exact person spec-70 Decision 3 exists to keep away from the plan --
  -- "the person doing the loading cannot be the one who shrinks the plan")
  -- executed a full top-up, soft-deleting a dispatch off another route's
  -- plan, AND chose the `p_user_id` written into audit_logs, attributing
  -- their own action to a manager. Same class of finding as phase 3's
  -- ("the grant that made its role gate a suggestion"), so it gets phase
  -- 3's remedy: the role is read from public.users (not the JWT claim,
  -- which is minted at login), and the audit actor comes from the JWT, not
  -- from an argument the caller controls.
  v_actor := COALESCE(NULLIF(auth.jwt() ->> 'sub', '')::uuid, p_user_id);

  SELECT role INTO v_actor_role FROM public.users
   WHERE id = v_actor AND operator_id = p_operator_id AND deleted_at IS NULL;

  IF v_actor_role IS NULL
     OR v_actor_role::text NOT IN ('ops_leader', 'operations_manager', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un responsable puede aceptar un relleno de camion.'
      USING ERRCODE = '42501';
  END IF;

  -- Decision 5.6: donor must still be planned/loading — 'loaded' and
  -- beyond (sealed manifest) can never be raided.
  IF v_donor.status NOT IN ('planned', 'loading') THEN
    RAISE EXCEPTION 'DONOR_ROUTE_NOT_RAIDABLE: donor route % is % ; only planned/loading routes can donate a block', p_donor_route_id, v_donor.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_receiving.status NOT IN ('draft', 'planned', 'loading') THEN
    RAISE EXCEPTION 'RECEIVING_ROUTE_NOT_LOADABLE: receiving route % is %', p_receiving_route_id, v_receiving.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Decision 5.4a: one borrowed block per route.
  IF EXISTS (
    SELECT 1 FROM public.route_blocks
     WHERE route_id = p_receiving_route_id AND operator_id = p_operator_id
       AND deleted_at IS NULL AND donor_route_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ALREADY_HAS_TOPUP: receiving route % has already accepted a borrowed block', p_receiving_route_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Decision 6: receiving route must not already be at its drop cap.
  SELECT COUNT(*) INTO v_drop_count
    FROM public.dispatches WHERE route_id = p_receiving_route_id AND operator_id = p_operator_id AND deleted_at IS NULL;
  IF v_receiving.max_drops IS NOT NULL AND v_receiving.max_drops > 0 AND v_drop_count >= v_receiving.max_drops THEN
    RAISE EXCEPTION 'AT_MAX_DROPS: receiving route % is already at its drop cap (%)', p_receiving_route_id, v_receiving.max_drops
      USING ERRCODE = 'P0001';
  END IF;

  -- The donor block itself: must be a LIVE route_blocks row.
  SELECT COUNT(*) INTO v_block_count
    FROM public.route_blocks
   WHERE route_id = p_donor_route_id AND operator_id = p_operator_id
     AND comuna_id = p_comuna_id AND deleted_at IS NULL;
  IF v_block_count = 0 THEN
    RAISE EXCEPTION 'BLOCK_NOT_FOUND: no live block for comuna % on donor route %', p_comuna_id, p_donor_route_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Decision 5.5, review fix. A block whose packages have already been
  -- physically scanned onto the DONOR's load position cannot be moved: the
  -- resulting dispatches would never appear on the receiving route's
  -- move task (spec-71 reads "moved" per package, globally), could never be
  -- re-scanned (validateScan -> ALREADY_STAGED), and would leave the
  -- receiving route permanently unsealable. Refused here, not silently
  -- fixed up, because the boxes really are in the other truck.
  IF public.route_block_is_physically_staged(p_donor_route_id, p_operator_id, p_comuna_id) THEN
    RAISE EXCEPTION 'BLOCK_ALREADY_STAGED: block (route %, comuna %) is already loading onto its own truck and cannot be topped up away', p_donor_route_id, p_comuna_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Decision 5.1: re-verify adjacency between the receiving route's own
  -- source andén(es) and this specific block's andén(es), under lock,
  -- against current state — never trust a suggestion computed moments ago.
  SELECT COALESCE(array_agg(dock_zone_id), '{}') INTO v_own_zones
    FROM public.route_source_dock_zone_ids(p_receiving_route_id, p_operator_id, NULL);
  SELECT COALESCE(array_agg(dock_zone_id), '{}') INTO v_block_zones
    FROM public.route_source_dock_zone_ids(p_donor_route_id, p_operator_id, p_comuna_id);

  SELECT EXISTS (
    SELECT 1
      FROM public.dock_zone_adjacency a
     WHERE a.operator_id = p_operator_id
       AND a.deleted_at IS NULL
       AND (
         (a.dock_zone_id = ANY(v_own_zones) AND a.adjacent_zone_id = ANY(v_block_zones))
         OR
         (a.adjacent_zone_id = ANY(v_own_zones) AND a.dock_zone_id = ANY(v_block_zones))
       )
       -- Both ends must still be live andenes (defense-in-depth against a
       -- pair predating phase 3's soft-delete cascade).
       AND EXISTS (SELECT 1 FROM public.dock_zones z1 WHERE z1.id = a.dock_zone_id AND z1.deleted_at IS NULL)
       AND EXISTS (SELECT 1 FROM public.dock_zones z2 WHERE z2.id = a.adjacent_zone_id AND z2.deleted_at IS NULL)
  ) INTO v_adjacent;

  IF array_length(v_own_zones, 1) IS NULL OR NOT v_adjacent THEN
    RAISE EXCEPTION 'NOT_ADJACENT: donor block (route %, comuna %) is not adjacent to receiving route %''s own andén(es)', p_donor_route_id, p_comuna_id, p_receiving_route_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Decision 5.4b: ~25% cap, re-measured against the receiving route's
  -- CURRENT live package count (skipped when that count is zero — see
  -- get_topup_candidates' header comment for why).
  SELECT COUNT(*) INTO v_own_count
    FROM public.dispatches d
    JOIN public.packages p ON p.order_id = d.order_id AND p.operator_id = d.operator_id AND p.deleted_at IS NULL
   WHERE d.route_id = p_receiving_route_id AND d.operator_id = p_operator_id AND d.deleted_at IS NULL;
  v_cap := CASE WHEN v_own_count > 0 THEN CEIL(v_own_count * 0.25)::integer ELSE NULL END;

  -- ---------------------------------------------------------------------
  -- Donor side: the audited manager-only removal, one dispatch at a time —
  -- exactly the DELETE /routes/[id]/packages/[pkgId] mechanism (soft
  -- delete + removal_reason), reused rather than reimplemented as a second
  -- path. Whole block, never partial (Decision 5.2): every live dispatch
  -- for this comuna on the donor route moves, none stay behind.
  -- ---------------------------------------------------------------------
  FOR v_dispatch IN
    SELECT d.id, d.order_id
      FROM public.dispatches d
      JOIN public.orders o ON o.id = d.order_id AND o.operator_id = d.operator_id
     WHERE d.route_id = p_donor_route_id
       AND d.operator_id = p_operator_id
       AND d.deleted_at IS NULL
       -- Review fix: soft-deleted orders were not filtered here, though
       -- every read in this migration filters them -- the write path could
       -- move a dead order onto a live plan.
       AND o.deleted_at IS NULL
       AND o.comuna_id = p_comuna_id
  LOOP
    UPDATE public.dispatches
       SET deleted_at = now(), removal_reason = p_reason
     WHERE id = v_dispatch.id AND operator_id = p_operator_id;

    IF v_dispatch.order_id IS NOT NULL THEN
      UPDATE public.packages
         SET status = 'sectorizado'
       WHERE operator_id = p_operator_id AND order_id = v_dispatch.order_id AND status = 'en_carga';
    END IF;

    INSERT INTO public.audit_logs (operator_id, user_id, action, resource_type, resource_id, changes_json, ip_address)
    VALUES (p_operator_id, v_actor, 'remove_from_plan', 'dispatches', v_dispatch.id,
      jsonb_build_object('route_id', p_donor_route_id, 'order_id', v_dispatch.order_id, 'reason', p_reason, 'topup_move_to', p_receiving_route_id),
      'unknown');

    v_moved_orders := array_append(v_moved_orders, v_dispatch.order_id);
    v_moved_count  := v_moved_count + 1;
  END LOOP;

  -- Review fix (Decision 5.4b). The cap was compared against v_moved_count,
  -- which counts DISPATCHES (one per order), while get_topup_candidates
  -- filters on the block's PACKAGE count. The two disagreed on every
  -- multi-bulto order -- the normal case in this repo since spec-55's
  -- carton expansion. Reproduced: with a cap of 1, the read path correctly
  -- returned no candidates for an 8-package single-order block, and the
  -- write path accepted the very same block (v_moved_count = 1 <= 1),
  -- taking the receiving route from 1 package to 9. Both paths now measure
  -- the same thing.
  SELECT COUNT(*) INTO v_moved_pkgs
    FROM public.packages
   WHERE operator_id = p_operator_id
     AND deleted_at IS NULL
     AND order_id = ANY(v_moved_orders);

  IF v_moved_count = 0 THEN
    RAISE EXCEPTION 'BLOCK_NOT_FOUND: donor route % has no live dispatches for comuna %', p_donor_route_id, p_comuna_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_cap IS NOT NULL AND v_moved_pkgs > v_cap THEN
    -- Rolls back this whole function's work (the FOR loop above included) —
    -- a single plpgsql function body is one transaction from the caller's
    -- point of view; RAISE here aborts everything already done in it.
    RAISE EXCEPTION 'OVER_TOPUP_CAP: block has % packages, receiving route %''s cap is % (25%% of %)', v_moved_pkgs, p_receiving_route_id, v_cap, v_own_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Decision 6 headroom, review fix -- the same gap on the write side: the
  -- earlier AT_MAX_DROPS check only asked whether the route was ALREADY at
  -- its cap. A block of N orders adds N drops, so the cap has to be
  -- checked against the post-move count.
  IF v_receiving.max_drops IS NOT NULL AND v_receiving.max_drops > 0
     AND v_drop_count + v_moved_count > v_receiving.max_drops THEN
    RAISE EXCEPTION 'AT_MAX_DROPS: receiving route % would reach % drops, past its cap of %', p_receiving_route_id, v_drop_count + v_moved_count, v_receiving.max_drops
      USING ERRCODE = 'P0001';
  END IF;

  -- The donor's own block row for this comuna is now empty (every
  -- dispatch that fed it just left) — soft-delete it so route_blocks
  -- keeps meaning "what this route still delivers", not a ghost entry.
  UPDATE public.route_blocks
     SET deleted_at = now()
   WHERE route_id = p_donor_route_id AND operator_id = p_operator_id
     AND comuna_id = p_comuna_id AND deleted_at IS NULL;

  -- ---------------------------------------------------------------------
  -- Receiving side: new dispatches (stage defaults 'planned', same as
  -- create_seeded_route's INSERT, 20260903000002) + one route_blocks row
  -- APPENDED at the end (Decision 5.3 — never interleaved).
  -- ---------------------------------------------------------------------
  INSERT INTO public.dispatches (route_id, order_id, operator_id, status, provider)
  SELECT p_receiving_route_id, oid, p_operator_id, 'pending', 'dispatchtrack'
    FROM unnest(v_moved_orders) AS oid
   WHERE oid IS NOT NULL;

  SELECT COALESCE(MAX(sequence_index), 0) + 1 INTO v_max_seq
    FROM public.route_blocks
   WHERE route_id = p_receiving_route_id AND operator_id = p_operator_id AND deleted_at IS NULL;

  INSERT INTO public.route_blocks (operator_id, route_id, comuna_id, sequence_index, sequence_source, donor_route_id)
  VALUES (p_operator_id, p_receiving_route_id, p_comuna_id, v_max_seq, 'topup', p_donor_route_id)
  RETURNING id INTO v_new_block;

  INSERT INTO public.audit_logs (operator_id, user_id, action, resource_type, resource_id, changes_json, ip_address)
  VALUES (p_operator_id, v_actor, 'topup_block_move', 'route_blocks', v_new_block,
    jsonb_build_object(
      'donor_route_id', p_donor_route_id, 'receiving_route_id', p_receiving_route_id,
      'comuna_id', p_comuna_id, 'moved_package_count', v_moved_pkgs,
      'moved_order_count', v_moved_count, 'reason', p_reason
    ),
    'unknown');

  RETURN jsonb_build_object(
    'receiving_route_id', p_receiving_route_id,
    'donor_route_id', p_donor_route_id,
    'comuna_id', p_comuna_id,
    'route_block_id', v_new_block,
    -- Review fix: this key said "package" and carried the DISPATCH count.
    'moved_package_count', v_moved_pkgs,
    'moved_order_count', v_moved_count,
    'moved_order_ids', to_jsonb(v_moved_orders)
  );
END;
$$;

COMMENT ON FUNCTION public.accept_topup_block(uuid, uuid, uuid, uuid, uuid, text) IS
  'spec-73 phase 4 (Decision 5, all six sub-rules; Decision 6). Moves one '
  'whole comuna block from a donor route to a receiving route: soft-deletes '
  'every live dispatch for that comuna on the donor (spec-70''s audited '
  'manager-only removal mechanism — removal_reason + audit_logs, reused not '
  'reimplemented), appends a fresh route_blocks row at the END of the '
  'receiving route''s sequence with sequence_source=''topup'' and '
  'donor_route_id set, and inserts matching dispatches at stage ''planned'' '
  'on the receiving route. Physically the packages remain at the donor '
  'andén until scanned into the receiving route''s load position through '
  'spec-71''s existing staging-scan flow — get_move_task_snapshot already '
  'surfaces that as ordinary remaining work, which IS this migration''s '
  'scan-confirmed move task (Decision 5.5), not a new entity. Re-validates '
  'every Decision-5/6 rule under row locks before writing anything: raises '
  'ROUTE_NOT_FOUND/BLOCK_NOT_FOUND (P0002), or DONOR_ROUTE_NOT_RAIDABLE / '
  'RECEIVING_ROUTE_NOT_LOADABLE / ALREADY_HAS_TOPUP / AT_MAX_DROPS / '
  'NOT_ADJACENT / OVER_TOPUP_CAP / REASON_REQUIRED (P0001/22023).';

GRANT EXECUTE ON FUNCTION public.accept_topup_block(uuid, uuid, uuid, uuid, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'route_blocks' AND column_name = 'donor_route_id'
  ) THEN
    RAISE EXCEPTION 'route_blocks.donor_route_id missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.route_blocks'::regclass
      AND conname = 'route_blocks_sequence_source_check'
      AND pg_get_constraintdef(oid) LIKE '%topup%'
  ) THEN
    RAISE EXCEPTION 'route_blocks_sequence_source_check not widened to include topup';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'route_source_dock_zone_ids'
  ) THEN
    RAISE EXCEPTION 'route_source_dock_zone_ids function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_topup_candidates'
  ) THEN
    RAISE EXCEPTION 'get_topup_candidates function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'accept_topup_block'
  ) THEN
    RAISE EXCEPTION 'accept_topup_block function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'route_block_is_physically_staged'
  ) THEN
    RAISE EXCEPTION 'route_block_is_physically_staged function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.route_blocks'::regclass
       AND tgname  = 'trg_route_blocks_topup_provenance_guard'
  ) THEN
    RAISE EXCEPTION 'trg_route_blocks_topup_provenance_guard missing';
  END IF;
  RAISE NOTICE '✓ spec-73 phase 4 (get_topup_candidates, accept_topup_block) migration complete';
END $$;

COMMIT;
