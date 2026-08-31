-- =============================================================================
-- spec-74 phase 1 — per-package load state.
--
-- Today one scan of one bulto flips `dispatches.stage` to 'staged' for the
-- WHOLE order (spec-70), so a multi-bulto order can be sealed and dispatched
-- with boxes still sitting on the dock. See docs/specs/spec-74-per-bulto-staging.md
-- for the full repro. This migration lays the per-box fact the rest of the
-- spec (phases 2-5, app layer) is built on; nothing reads it yet.
--
-- ---------------------------------------------------------------------------
-- Column set, against spec-70 phase 1's convention (20260825000002):
--
--   packages.loaded_at      TIMESTAMPTZ  — when this box was confirmed onto a
--                                          truck. Mirrors dispatches.staged_at.
--   packages.loaded_by      UUID         — who confirmed it, FK to
--                                          public.users(id) ON DELETE SET NULL,
--                                          mirroring dispatches.staged_by
--                                          exactly (same actor-for-a-physical-
--                                          confirmation-event convention spec-71
--                                          phase 1 also followed for
--                                          routes.load_position_assigned_by).
--   packages.load_inferred  BOOLEAN      — true when loaded_at was written by
--                                          THIS migration's backfill rather than
--                                          a real scan. Per spec-74's "Backfill
--                                          is optimistic, and says so": no
--                                          per-package scan evidence exists for
--                                          history, so a later report must be
--                                          able to tell assumption from fact.
--
-- IMPORTANT — `adopted` is backfilled for lack of an alternative, NOT because
-- adoption proves the whole order is loaded. app/api/dispatch/routes/[id]/
-- scan/route.ts inserts stage:'adopted' on ONE scanned package barcode; for a
-- multi-bulto unplanned order that confirms exactly one box, not the order —
-- the same over-claim spec-74 exists to kill for `staged`. There is exactly
-- as much (zero) per-box evidence for `adopted` as for `staged`, so it gets
-- the same optimistic backfill rather than being left NULL (which would lock
-- every adopted route out of sealing under phase 3's rule). This is a
-- placeholder, not a resolution: phase 3's per-package recompute MUST also
-- cover `adopted` dispatches (not just `planned`/`partially_staged`/
-- `staged`), or an adopted 2-bulto order seals with a box still on the andén
-- — see docs/specs/spec-74-per-bulto-staging.md, phase 3 checklist.
--
-- No package-level status enum is added. Spec-74 Decision 3 + "Settled during
-- scoping" are explicit: en_carga stays order-level and out of scope here;
-- the per-box fact is a plain load timestamp + actor + provenance flag, not a
-- state machine of its own. A package is loaded onto exactly one route at a
-- time (many-packages-to-one-route), so this is a plain column set on
-- `packages`, not a join table — the same reasoning spec-71 Decision 4 used
-- for routes.load_position_id.
--
-- `dock_scans.load_position_id` (spec-71) is NOT touched and is NOT the
-- completeness gate (spec-74 Decision 4): the route-level scan path writes no
-- dock_scans row at all, so a gate built on it would lock out every
-- desktop-staged route. Phase 2 (app layer, a separate PR) writes
-- packages.loaded_at/loaded_by from BOTH scan paths.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. packages: per-box load state
-- ---------------------------------------------------------------------------

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS loaded_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS loaded_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS load_inferred BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.packages.loaded_at IS
  'spec-74. When this specific box was confirmed physically loaded onto a '
  'route. NULL means never confirmed loaded (still on the dock, or on a '
  '`planned` dispatch that has not been staged at all). Mirrors '
  'dispatches.staged_at, but per-package rather than per-order — the fact '
  'spec-74 exists to add, because staging one bulto of a multi-bulto order '
  'today incorrectly marks the whole order (and every one of its packages) '
  'loaded.';

COMMENT ON COLUMN public.packages.loaded_by IS
  'spec-74. The user whose scan confirmed this box onto the truck. Mirrors '
  'dispatches.staged_by''s actor-column convention (spec-70 phase 1) for a '
  'physical-confirmation event. NULL for a backfilled row (load_inferred = '
  'true) — no scan means no actor to record — and nullable generally, same '
  'as staged_by, so a deleted user does not block reads of history.';

COMMENT ON COLUMN public.packages.load_inferred IS
  'spec-74. true when loaded_at was written by the phase-1 migration''s '
  'optimistic backfill (an already-`staged`/`adopted` dispatch predating '
  'per-box scanning) rather than by a real scan. Lets a later report tell '
  'migrated assumption from observed evidence, per spec-74''s "Backfill is '
  'optimistic, and says so."';

-- An inferred row with no loaded_at would be a provenance flag pointing at
-- nothing to be provenance OF. A genuinely scanned row (load_inferred =
-- false) is unconstrained here: loaded_at is simply NULL until scanned.
ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_load_inferred_requires_loaded_at_chk,
  ADD  CONSTRAINT packages_load_inferred_requires_loaded_at_chk
       CHECK (NOT load_inferred OR loaded_at IS NOT NULL);

-- Symmetric gap: an actor recorded (loaded_by) for an event that, per
-- loaded_at, never happened. Same style as the constraint above.
ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_loaded_by_requires_loaded_at_chk,
  ADD  CONSTRAINT packages_loaded_by_requires_loaded_at_chk
       CHECK (loaded_by IS NULL OR loaded_at IS NOT NULL);

-- Phase 3's per-dispatch completeness recompute ("any live package of this
-- order still unloaded?") is the query this index serves — the partial
-- predicate matches exactly what that check filters on, the same shape as
-- spec-70's idx_dispatches_route_stage for its own gate query. Kept narrow
-- (order_id only) rather than composite: packages does not carry route_id,
-- only order_id, and the join to dispatches/routes happens at the query site.
CREATE INDEX IF NOT EXISTS idx_packages_order_unloaded
  ON public.packages (order_id)
  WHERE loaded_at IS NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. dispatches.stage: add 'partially_staged'
-- ---------------------------------------------------------------------------
--
-- `stage` is TEXT + CHECK, not an enum (20260825000002: "ALTER TYPE ... ADD
-- VALUE cannot be used in the same transaction that adds it, which makes
-- every future value a two-file dance"). Exactly the case that comment
-- anticipated: adding a value here is a plain DROP+ADD CONSTRAINT, in the
-- same transaction as everything else in this file — no enum two-step
-- required, unlike 20260825000001/2's route_status_enum labels.
ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_stage_check,
  ADD  CONSTRAINT dispatches_stage_check
       CHECK (stage IN ('planned', 'partially_staged', 'staged', 'adopted'));

COMMENT ON COLUMN public.dispatches.stage IS
  'spec-70/74. Local plan/load axis, ours: planned = on the plan, not '
  'physically confirmed; partially_staged = some but not all of this '
  'order''s live packages are physically confirmed loaded (spec-74 — the '
  'in-between state a per-order boolean could not represent); staged = '
  'every live package of this order is physically confirmed loaded; '
  'adopted = physically present but never planned. Distinct from `status`, '
  'which is the routing provider''s delivery outcome. Removal from a plan '
  'is a soft-delete plus removal_reason, not a stage. Phase 3 (app layer) '
  'recomputes this per package scan; nothing writes partially_staged yet.';

-- ---------------------------------------------------------------------------
-- 3. Backfill — optimistic, and says so (spec-74 "Settled during scoping")
-- ---------------------------------------------------------------------------
--
-- Every pre-existing `staged` dispatch predates per-box scanning, so no
-- evidence exists either way for its packages. Leaving loaded_at NULL would
-- flip every in-flight route to (a future) partially_staged and refuse seals
-- on boxes already sitting on trucks — the same failure mode spec-70's own
-- backfill comment describes for the exact same reason. So every live
-- package of a `staged` dispatch is backfilled loaded, flagged inferred.
--
-- `adopted` dispatches are backfilled the same way, but NOT because adoption
-- proves the order is loaded — it does not. A scan only ever adopts the ONE
-- package barcode that was scanned (app/api/dispatch/routes/[id]/scan/
-- route.ts); for a multi-bulto unplanned order that is one box confirmed, not
-- the order. There is, however, exactly as much (i.e. zero) per-box evidence
-- for `adopted` rows as for `staged` ones, and leaving them NULL would lock
-- every adopted route out of sealing under phase 3's rule the moment that
-- rule exists. So `adopted` gets the same optimistic, flagged backfill as
-- `staged` for lack of a better default — NOT as a claim that the order was
-- fully loaded. Phase 3 MUST recompute `adopted` dispatches too (not just
-- planned/partially_staged/staged), or this backfill's optimism becomes a
-- permanent lie for any adopted order with more than one bulto.
--
-- `planned` dispatches get nothing: a planned order has not been staged at
-- all, so "no evidence" correctly means "not loaded" rather than "assume
-- loaded". This is also what keeps the migration idempotent on a straight
-- re-run — see the `loaded_at IS NULL` guard, which only ever fills a package
-- once and never overwrites a genuine scan recorded after this ran.
--
-- Extracted into a function (rather than an inline DO block) for one reason:
-- the pgTAP suite calls this SAME function against its own fixtures instead
-- of pasting a second copy of the UPDATE that could silently drift from what
-- this migration actually runs. See spec74_package_load_state.test.sql's
-- header for the coverage this does and does not give.
--
-- Two defensive changes versus a naive `... FROM dispatches d WHERE
-- d.order_id = p.order_id`:
--   1. `d.order_id = p.order_id` alone is nondeterministic if an order ever
--      has two live staged/adopted dispatches at once — no unique constraint
--      forbids it (20260828000001:128-134 documents the gap). Aggregating to
--      one row per order_id (MIN(staged_at), the earliest confirmed load)
--      before the UPDATE makes the result deterministic regardless.
--   2. `d.staged_at IS NOT NULL` is added even though
--      `dispatches_staged_at_check` (20260825000002) already guarantees it
--      for every staged/adopted row today. Filtering for it here removes the
--      "migration aborts on a NULL staged_at" failure mode by construction,
--      rather than leaving it standing on a constraint three migrations away
--      that this file does not otherwise depend on.
CREATE OR REPLACE FUNCTION public.spec74_backfill_package_load_state()
RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
DECLARE
  backfilled BIGINT;
BEGIN
  UPDATE public.packages p
     SET loaded_at     = s.staged_at,
         load_inferred = true
    FROM (
      SELECT d.order_id, MIN(d.staged_at) AS staged_at
        FROM public.dispatches d
       WHERE d.stage      IN ('staged', 'adopted')
         AND d.deleted_at IS NULL
         AND d.staged_at  IS NOT NULL
       GROUP BY d.order_id
    ) s
   WHERE s.order_id      = p.order_id
     AND p.deleted_at    IS NULL
     AND p.loaded_at     IS NULL;
  GET DIAGNOSTICS backfilled = ROW_COUNT;
  RETURN backfilled;
END;
$fn$;

COMMENT ON FUNCTION public.spec74_backfill_package_load_state() IS
  'spec-74 phase 1. The one-time optimistic backfill rule (staged/adopted -> '
  'loaded, flagged inferred; planned untouched) extracted from this '
  'migration''s DO block so pgTAP can call the exact same logic the '
  'migration runs, rather than a pasted copy of it. Safe to call again: '
  'guarded by `loaded_at IS NULL`, so a genuine scan already recorded is '
  'never overwritten. Not part of any ongoing write path — phase 3 (app '
  'layer) is what keeps loaded_at current after this migration runs once.';

DO $$
DECLARE backfilled BIGINT;
BEGIN
  backfilled := public.spec74_backfill_package_load_state();
  RAISE NOTICE 'spec-74: backfilled % packages rows to loaded_at (inferred)', backfilled;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'loaded_at'
  ) THEN
    RAISE EXCEPTION 'packages.loaded_at not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'loaded_by'
  ) THEN
    RAISE EXCEPTION 'packages.loaded_by not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'load_inferred'
  ) THEN
    RAISE EXCEPTION 'packages.load_inferred not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.packages'::regclass
      AND conname = 'packages_loaded_by_requires_loaded_at_chk'
  ) THEN
    RAISE EXCEPTION 'packages_loaded_by_requires_loaded_at_chk not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'spec74_backfill_package_load_state'
  ) THEN
    RAISE EXCEPTION 'public.spec74_backfill_package_load_state() not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.dispatches'::regclass
      AND conname = 'dispatches_stage_check'
      AND pg_get_constraintdef(oid) LIKE '%partially_staged%'
  ) THEN
    RAISE EXCEPTION 'dispatches_stage_check does not allow partially_staged';
  END IF;
  RAISE NOTICE '✓ spec-74 phase 1 (package load state) migration complete';
END $$;

COMMIT;
