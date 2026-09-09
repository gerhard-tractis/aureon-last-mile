-- =============================================================================
-- spec-87 fase 4 — batched, resumable driver for
-- spec79_backfill_loaded_route_id() (20260909000001, fixed by 20260910000001).
--
-- Why this migration exists: that function is a single UPDATE, no LIMIT/
-- OFFSET, driven by one GROUP BY sweep of the FULL dispatches table (~112k
-- rows documented in its own comment, at production scale). Its own migration
-- (20260909000001:122-133) deliberately never calls it, citing this exact
-- table pair's prior statement_timeout history in this series. The user has
-- now authorized running the backfill against production; running the
-- existing function unmeasured and un-batched would repeat the failure mode
-- its own author refused to risk. This migration does NOT change that
-- function's definition (it stays exactly as 20260910000001 left it, still
-- callable standalone for a small/QA-scale database) — it adds a separate
-- driver, split into the expensive part (paid once) and the repeatable part
-- (paid per batch), matching the design spec-87 fase 4 already argued for and
-- deferred pending a real production row count:
--
--   spec79_loaded_route_backfill_candidates            -- staging table
--   spec79_populate_loaded_route_backfill_candidates() -- one-time INSERT
--   spec79_backfill_loaded_route_id_batch(p_batch_size) -- repeatable UPDATE
--
-- Why splitting like this, not `UPDATE ... LIMIT n` repeated: Postgres has no
-- LIMIT on UPDATE, and wrapping the existing subquery in a LIMIT would still
-- re-pay the full `dispatches` GROUP BY on every single call — N calls, N
-- full sweeps, which does not reduce per-call timeout risk proportionally to
-- batch size, only relocates it. Populating a staging table pays that sweep
-- exactly once; every later batch call only touches the staging table (its
-- own primary key) and a LIMIT-bounded slice of `packages`.
--
-- Idempotent and resumable by construction, not by assumption (verified in
-- packages/database/supabase/tests/spec87_fase4_backfill_batching.test.sql):
--   - `spec79_populate_...()` uses `INSERT ... ON CONFLICT (order_id) DO
--     NOTHING` — calling it again after a partial run does not duplicate a
--     candidate row.
--   - `spec79_backfill_loaded_route_id_batch()` DELETEs the batch it consumes
--     from the staging table in the SAME statement as the UPDATE (a
--     DELETE ... RETURNING CTE feeding the UPDATE's FROM), so a candidate is
--     never processed twice even across many separate calls/connections —
--     exactly the "commit between batches, not one long transaction" shape
--     spec-87 fase 4 asked for: each call is its own statement, driven by a
--     bash loop of separate `psql -c` invocations (autocommit), never one
--     multi-statement transaction wrapping every batch.
--   - The UPDATE itself keeps the original function's own idempotency guard
--     (`p.loaded_route_id IS NULL`), so even a candidate re-inserted by a
--     second `populate()` call is a correctly-computed no-op against a
--     package already written.
--
-- `operator_id` on the new table, per repo rule (no exception for a staging
-- table): sourced from `orders.operator_id` at populate time, even though
-- `order_id` alone is already enough to join back to `packages` — it lets a
-- human dimension or clear the backlog per operator if that is ever needed,
-- and keeps this table consistent with every other one in the schema.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.spec79_loaded_route_backfill_candidates (
  order_id    UUID NOT NULL PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  route_id    UUID NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.spec79_loaded_route_backfill_candidates IS
  'spec-87 fase 4. One-time-populated staging table for the batched '
  'loaded_route_id backfill: one row per order that has exactly one '
  'DISTINCT live active route among its dispatches (same eligibility as '
  'spec79_backfill_loaded_route_id(), 20260910000001). A row''s presence '
  'here is exactly "not yet drained by a batch call" -- COUNT(*) on this '
  'table is the backfill''s remaining-work counter. Not RLS-protected: no '
  'anon/authenticated grant is issued on it (see migration footer), it is '
  'only ever touched by a service-role connection running the batch driver '
  'by hand.';

-- No RLS policy is added deliberately: this table is never queried through
-- PostgREST/the app, only via a service-role psql session running the batch
-- driver (see the workflow this migration ships alongside). Revoke the
-- default PUBLIC grants so an unexpected future PostgREST exposure fails
-- closed, matching spec-88's anon/authenticated audit posture for any new
-- table that is not meant to be end-user-reachable.
REVOKE ALL ON public.spec79_loaded_route_backfill_candidates FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step 1 (pay once): populate the staging table from the same eligibility
-- query 20260910000001's spec79_backfill_loaded_route_id() uses internally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spec79_populate_loaded_route_backfill_candidates()
RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_inserted BIGINT;
BEGIN
  INSERT INTO public.spec79_loaded_route_backfill_candidates (order_id, route_id, operator_id)
  SELECT d.order_id, d.route_id, o.operator_id
    FROM (
      SELECT dd.order_id, MIN(dd.route_id::text)::uuid AS route_id
        FROM public.dispatches dd
        JOIN public.routes r ON r.id = dd.route_id
       WHERE dd.deleted_at IS NULL
         AND r.deleted_at  IS NULL
         AND r.status IN ('draft', 'planned', 'loading', 'loaded',
                           'dispatched', 'in_transit', 'in_progress')
       GROUP BY dd.order_id
      HAVING COUNT(DISTINCT dd.route_id) = 1
    ) d
    JOIN public.orders o ON o.id = d.order_id
  ON CONFLICT (order_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$fn$;

COMMENT ON FUNCTION public.spec79_populate_loaded_route_backfill_candidates() IS
  'spec-87 fase 4. Pays the one expensive dispatches/routes GROUP BY sweep '
  'exactly once, writing every unambiguous order into the staging table. '
  'Safe to call more than once (ON CONFLICT DO NOTHING): re-running it after '
  'a partial batch drain does not duplicate a candidate, and an order that '
  'has since become ambiguous simply stops being (re-)inserted -- it is '
  'never removed from here for that reason, matching the original function''s '
  'own "false negative, never false positive" posture. Call this exactly '
  'once per backfill attempt, before looping spec79_backfill_loaded_route_id_batch().';

-- ---------------------------------------------------------------------------
-- Step 2 (pay per batch): drain up to p_batch_size candidates, write
-- loaded_route_id, and remove them from the staging table in the same
-- statement. Call repeatedly (each call its own transaction/commit) until
-- remaining_count = 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spec79_backfill_loaded_route_id_batch(p_batch_size INT DEFAULT 2000)
RETURNS TABLE(updated_count BIGINT, remaining_count BIGINT)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_updated   BIGINT;
  v_remaining BIGINT;
BEGIN
  WITH batch AS (
    DELETE FROM public.spec79_loaded_route_backfill_candidates
     WHERE order_id IN (
       SELECT order_id
         FROM public.spec79_loaded_route_backfill_candidates
        ORDER BY order_id
        LIMIT GREATEST(p_batch_size, 0)
     )
    RETURNING order_id, route_id
  )
  UPDATE public.packages p
     SET loaded_route_id = batch.route_id
    FROM batch
   WHERE batch.order_id     = p.order_id
     AND p.deleted_at       IS NULL
     AND p.loaded_at        IS NOT NULL
     AND p.load_inferred    = false
     AND p.loaded_route_id  IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*) INTO v_remaining FROM public.spec79_loaded_route_backfill_candidates;

  RETURN QUERY SELECT v_updated, v_remaining;
END;
$fn$;

COMMENT ON FUNCTION public.spec79_backfill_loaded_route_id_batch(INT) IS
  'spec-87 fase 4. Drains up to p_batch_size candidates from '
  'spec79_loaded_route_backfill_candidates in one statement (a DELETE ... '
  'RETURNING CTE feeding the UPDATE, so a candidate is consumed exactly '
  'once even across separate calls/connections), writing loaded_route_id '
  'onto packages that still qualify per the original function''s own guard '
  '(loaded_at IS NOT NULL, load_inferred = false, loaded_route_id IS NULL, '
  'deleted_at IS NULL). Returns (updated_count, remaining_count); '
  'remaining_count = 0 means the backlog is drained. Call this in a loop, '
  'each call its own transaction (autocommit) -- never wrap multiple calls '
  'in one BEGIN/COMMIT, which would just recreate the single-shot timeout '
  'risk this driver exists to avoid.';

COMMIT;
