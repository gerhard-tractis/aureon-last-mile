-- spec-70 phase 1 (2 of 2) — the plan/load axis.
--
-- Despacho has two entry paths into `dispatches` that disagree on what a row
-- means: Pre-ruta's create_seeded_route writes one to mean "planned onto this
-- route", the route builder's scan handler writes one to mean "physically
-- scanned onto this truck". Nothing distinguishes them, so a pre-routed order
-- can never be loaded (scan-validator.ts rejects any order holding any dispatch
-- row, without filtering by route_id) and a seeded route can reach
-- DispatchTrack with no package ever physically confirmed.
--
-- `stage` is that missing distinction. It is deliberately NOT folded into
-- `dispatches.status`: status is the *provider's* delivery outcome
-- (pending/delivered/failed/partial), written by beetrack-webhook and
-- dispatchtrack-route-poll. Two writers with two vocabularies on one column is
-- how this module got into its current state.
--
-- Depends on 20260825000001 having committed its enum labels — see that file.
-- Nothing reads any of this yet; phases 2-4 wire it up.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

-- TEXT + CHECK rather than an enum: ALTER TYPE ... ADD VALUE cannot be used in
-- the same transaction that adds it, which makes every future value a
-- two-file dance (see the sibling migration). The value set here is expected to
-- grow — spec-72 may add a block-level stage. orders.geocode_status in spec-58
-- takes the same shape for the same reason.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS stage          TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS staged_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staged_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adopted_reason TEXT,
  ADD COLUMN IF NOT EXISTS removal_reason TEXT;

COMMENT ON COLUMN public.dispatches.stage IS
  'spec-70. Local plan/load axis, ours: planned = on the plan, not physically '
  'confirmed; staged = physically confirmed onto this route; adopted = '
  'physically present but never planned. Distinct from `status`, which is the '
  'routing provider''s delivery outcome. Removal from a plan is a soft-delete '
  'plus removal_reason, not a stage.';

COMMENT ON COLUMN public.dispatches.staged_by IS
  'spec-70. The user whose scan confirmed this stop onto the truck.';

-- ---------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------
--
-- Every pre-existing row predates the distinction and cannot be classified
-- retroactively, so all of them are treated as `staged` with staged_at =
-- created_at. That is the safe direction: it reads history as already
-- confirmed rather than leaving rows at `planned`, which would make the seal
-- guard in phase 3 refuse to close routes nobody can now go and verify.
--
-- Soft-deleted rows are backfilled too. They are off every plan already, and
-- leaving them at the column default would be the only rows in the table whose
-- stage means something different from every other row's.
DO $$
DECLARE moved BIGINT;
BEGIN
  UPDATE public.dispatches
     SET stage     = 'staged',
         staged_at = created_at
   WHERE stage = 'planned';
  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'spec-70: backfilled % dispatches rows to stage=staged', moved;
END $$;

-- Constraints go on *after* the backfill, so they validate the corrected data.
ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_stage_check,
  ADD  CONSTRAINT dispatches_stage_check
       CHECK (stage IN ('planned', 'staged', 'adopted'));

-- A staged or adopted row without a timestamp is a row that claims a physical
-- confirmation nobody can date. A planned row with one is a contradiction.
ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_staged_at_check,
  ADD  CONSTRAINT dispatches_staged_at_check
       CHECK ((stage = 'planned') = (staged_at IS NULL));

-- The seal guard's query is "any row on this route still at planned?", and the
-- stop-count view groups by the same pair.
CREATE INDEX IF NOT EXISTS idx_dispatches_route_stage
  ON public.dispatches (route_id, stage)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Remap existing route statuses
-- ---------------------------------------------------------------------------
--
-- This is the one irreversible step in spec-70 phase 1.
--
-- Under the old vocabulary `planned` meant "accepted by DispatchTrack" — it is
-- what POST /routes/[id]/dispatch writes after DT returns, and it is also the
-- table default that the DT webhooks land on. Under the new machine that state
-- is `dispatched`, and `planned` is re-used for the strictly local "orders
-- assigned, nothing staged yet" that Pre-ruta produces.
--
-- Leaving them would silently reclassify every live route at DT as an
-- unstarted local plan, which the phase-3 guards would then happily let someone
-- re-dispatch.
DO $$
DECLARE before_planned BIGINT; after_planned BIGINT; remapped BIGINT;
BEGIN
  SELECT COUNT(*) INTO before_planned
    FROM public.routes WHERE status = 'planned';

  UPDATE public.routes SET status = 'dispatched' WHERE status = 'planned';
  GET DIAGNOSTICS remapped = ROW_COUNT;

  SELECT COUNT(*) INTO after_planned
    FROM public.routes WHERE status = 'planned';

  RAISE NOTICE 'spec-70: routes at planned before=% remapped=% after=%',
    before_planned, remapped, after_planned;

  IF after_planned <> 0 THEN
    RAISE EXCEPTION 'spec-70: % routes still at planned after remap', after_planned;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Derived stop counts
-- ---------------------------------------------------------------------------
--
-- routes.planned_stops drifts by construction: create_seeded_route sets it to
-- the order count, the scan handler does +1, and removal never decrements. It
-- is the EMPTY_ROUTE guard and the progress denominator, so the drift is not
-- cosmetic. Counting from the rows removes the class of bug rather than the
-- instance.
--
-- security_invoker so the querying user's RLS on `dispatches` applies. Without
-- it the view would run as its owner and hand every operator every operator's
-- counts — this repo already carries 20260729000001_fix_cross_tenant_definer_rpcs.sql,
-- so cross-tenant leakage through a privileged database object is a
-- demonstrated failure mode here, not a hypothetical.
CREATE OR REPLACE VIEW public.route_stop_counts
WITH (security_invoker = true) AS
SELECT route_id,
       operator_id,
       COUNT(*)                                  AS total_stops,
       COUNT(*) FILTER (WHERE stage = 'planned') AS pending_stops,
       COUNT(*) FILTER (WHERE stage = 'staged')  AS staged_stops,
       COUNT(*) FILTER (WHERE stage = 'adopted') AS adopted_stops
  FROM public.dispatches
 WHERE deleted_at IS NULL
   AND route_id IS NOT NULL
 GROUP BY route_id, operator_id;

COMMENT ON VIEW public.route_stop_counts IS
  'spec-70. The authoritative local stop counts, derived from dispatches. '
  'routes.planned_stops stays on the table because the DispatchTrack webhooks '
  'write it from the provider''s own figure, which is a different number — '
  'nothing local should read it.';

GRANT SELECT ON public.route_stop_counts TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The route lifecycle, in one place
-- ---------------------------------------------------------------------------
--
--   draft ──► planned ──► loading ──► loaded ──► dispatched ──► in_transit ──► completed
--     │          │           │           │            │              │
--     └──────────┴───────────┴───────────┴────────────┴──────────────┴──────► cancelled
--
-- Backward edges exist where the operation is genuinely reversible and local:
-- unsealing a manifest to add a stop (loaded → loading), emptying a route back
-- to a shell (planned → draft). There is no backward edge out of `dispatched`:
-- the route is at DT by then, and undoing it needs a compensating cancel there,
-- not a local status write.
--
-- `in_progress` is kept rather than renamed. It is what beetrack-webhook and
-- dispatchtrack-route-poll already write, and they are not touched by this
-- spec; `in_transit` is the new machine's name for the same thing and the
-- webhook writers move to it in a later phase. Both are reachable so no
-- deployed writer breaks mid-migration.
CREATE OR REPLACE FUNCTION public.transition_route_status(
  p_route_id     uuid,
  p_operator_id  uuid,
  p_to_status    route_status_enum
) RETURNS route_status_enum
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from route_status_enum;
BEGIN
  SELECT status INTO v_from
    FROM public.routes
   WHERE id = p_route_id
     AND operator_id = p_operator_id
     AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROUTE_NOT_FOUND: route % for operator %', p_route_id, p_operator_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent by design: the handlers that call this are HTTP endpoints an
  -- operator can double-tap, and a retry landing on the state it asked for is
  -- a success, not a conflict.
  IF v_from = p_to_status THEN
    RETURN v_from;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM (VALUES
        ('draft',       'planned'),
        ('draft',       'cancelled'),
        ('planned',     'draft'),
        ('planned',     'loading'),
        ('planned',     'cancelled'),
        ('loading',     'planned'),
        ('loading',     'loaded'),
        ('loading',     'cancelled'),
        ('loaded',      'loading'),
        ('loaded',      'dispatched'),
        ('loaded',      'cancelled'),
        ('dispatched',  'in_transit'),
        ('dispatched',  'in_progress'),
        ('dispatched',  'completed'),
        ('dispatched',  'cancelled'),
        ('in_transit',  'completed'),
        ('in_transit',  'cancelled'),
        ('in_progress', 'in_transit'),
        ('in_progress', 'completed'),
        ('in_progress', 'cancelled')
      ) AS legal(from_status, to_status)
     WHERE legal.from_status = v_from::text
       AND legal.to_status   = p_to_status::text
  ) THEN
    RAISE EXCEPTION 'ILLEGAL_ROUTE_TRANSITION: % -> %', v_from, p_to_status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.routes
     SET status     = p_to_status,
         updated_at = NOW()
   WHERE id = p_route_id
     AND operator_id = p_operator_id;

  RETURN p_to_status;
END;
$$;

COMMENT ON FUNCTION public.transition_route_status(uuid, uuid, route_status_enum) IS
  'spec-70. The only sanctioned writer of routes.status for local transitions. '
  'Raises ILLEGAL_ROUTE_TRANSITION (P0001) or ROUTE_NOT_FOUND (P0002). '
  'Per the project rule, any future CREATE OR REPLACE must use the LATEST '
  'migration''s definition as its template, never this one once superseded.';

GRANT EXECUTE ON FUNCTION public.transition_route_status(uuid, uuid, route_status_enum) TO authenticated;
