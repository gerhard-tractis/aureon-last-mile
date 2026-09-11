-- spec-58 fase 5: atomic claim of a geocode work-queue batch.
-- (docs/specs/spec-58-geocoding-foundation.md, "Fase 5")
--
-- NOT in fase 5's own **Archivos:** list, added because the phase's own
-- text requires it: "FOR UPDATE SKIP LOCKED is not optional. Without it a
-- run that outlives its ten-minute cron window -- or any BullMQ retry --
-- re-selects the identical 200 rows and pays the provider for them twice."
-- PostgREST (the only interface apps/agents talks to Postgres through --
-- there is no `pg` client in this app) has no locking clause on its query
-- builder, so the claim has to live behind a Postgres function the worker
-- calls via `.rpc()`.
--
-- This is a single atomic statement, not a SELECT ... FOR UPDATE followed
-- by a separate UPDATE: an UPDATE ... FROM (SELECT ... FOR UPDATE SKIP
-- LOCKED) is itself one statement, so Postgres's own implicit
-- single-statement transaction covers both the row lock and the lease
-- write. That matters because the FOR UPDATE lock only lasts as long as
-- the transaction holding it -- and this run's actual work (geocoding 200
-- addresses against a real HTTP provider) happens AFTER this function
-- returns, well outside any transaction. What protects the batch for that
-- window is the LEASE this statement writes (bumping
-- geocode_next_attempt_at p_lease_minutes into the future), not the lock:
-- a concurrent claim's own WHERE clause
-- (geocode_next_attempt_at IS NULL OR geocode_next_attempt_at <= now())
-- excludes these rows until the lease expires, whether or not this run
-- finished writing real results by then.
--
-- SECURITY INVOKER (the default -- no SECURITY DEFINER here), deliberately:
-- unlike get_active_routes_with_dispatches / get_unmatched_comunas
-- (20260729000001), this function needs no elevated privilege. Called by
-- the agents worker's service-role key, RLS does not apply and every
-- pending/fallback row across every tenant is eligible, matching fase 1's
-- own documented operator_id exception for this exact maintenance query.
--
-- Supabase's own default privileges GRANT EXECUTE on every new public-schema
-- function to anon/authenticated/service_role -- verified against this
-- container: a bare `CREATE FUNCTION` here left `authenticated` able to call
-- it and silently succeed (RLS reduced it to zero rows, which is SAFE but
-- not the intended surface -- this table-maintenance RPC has no business
-- being reachable outside the worker at all, matching the "only the service
-- role touches this" rule geocode_cache already lives under). Explicit
-- REVOKEs below close that off up front rather than leaning on RLS
-- containment as the only guard.


BEGIN;

-- p_lease_minutes default is 15, not the */10 cron's own interval: a lease
-- exactly equal to the cron cadence has zero margin. Safe today only
-- because WORKER_CONFIGS['geocode.enrich'].concurrency is 1 in
-- orchestration/workers.ts (a single process, one run at a time) -- the
-- lease exists for when that assumption breaks (two processes sharing
-- Redis by accident, or a concurrency bump later), and 15 minutes costs
-- nothing extra against a 10-minute cron.
CREATE OR REPLACE FUNCTION public.claim_geocode_batch(
  p_limit INT DEFAULT 200,
  p_lease_minutes INT DEFAULT 15
)
RETURNS SETOF public.orders
LANGUAGE sql
AS $$
  UPDATE public.orders o
     SET geocode_next_attempt_at = now() + (p_lease_minutes || ' minutes')::interval
    FROM (
      SELECT id
        FROM public.orders
       WHERE geocode_status IN ('pending', 'fallback')
         AND deleted_at IS NULL
         AND (geocode_next_attempt_at IS NULL OR geocode_next_attempt_at <= now())
       ORDER BY geocode_next_attempt_at NULLS FIRST, created_at
       LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    ) claimed
   WHERE o.id = claimed.id
  RETURNING o.*;
$$;

COMMENT ON FUNCTION public.claim_geocode_batch(INT, INT) IS
  'spec-58 fase 5: atomically claims up to p_limit orders due for '
  'geocoding, leasing them for p_lease_minutes via geocode_next_attempt_at '
  'so a second concurrent run cannot re-claim them before this run '
  'finishes writing real results. Service-role only -- no operator_id '
  'predicate, matching fase 1''s documented exception for this same '
  'maintenance query.';

REVOKE ALL ON FUNCTION public.claim_geocode_batch(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_geocode_batch(INT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_geocode_batch(INT, INT) TO service_role;

COMMIT;
