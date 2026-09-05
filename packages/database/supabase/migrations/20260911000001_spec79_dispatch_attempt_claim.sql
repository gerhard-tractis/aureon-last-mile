-- =============================================================================
-- spec-79 Fase 4 — H2, the concurrent-dispatch gap (review finding 4).
--
-- `POST /api/dispatch/routes/[id]/dispatch` guards a sequential retry with a
-- READ (`external_route_id` / `isConfirmedExternalRouteId`) acted on much
-- later, once DispatchTrack has been called. A sequential retry is safe: the
-- second request reads what the first one persisted. Two CONCURRENT
-- requests — a double-tap on the crew tablet, a client retry racing a slow
-- DT call, two devices — can both read "not yet confirmed" and both call
-- DispatchTrack's Create Route, which has no idempotency key (spec-79 Fase 0
-- finding 1) and so creates two routes for the same manifest.
--
-- `dispatch_attempt_at` is a one-shot claim, NOT a new state-machine edge —
-- spec-79's own no-goals rule out touching `transition_route_status`'s
-- edges, and this column is never read or written by that function.
-- `claimDispatchAttempt`/`releaseDispatchClaim`
-- (apps/frontend/src/lib/dispatch/dispatch-retry-claim.ts) are the only
-- application code that touches it: an atomic conditional UPDATE claims it
-- before calling DT, and a best-effort UPDATE releases it on every terminal
-- path that did not leave DT in an unknown state. A claim whose owner
-- crashed (no release ever runs) is reclaimed once it is older than
-- DISPATCH_CLAIM_STALE_MS (2 minutes) — see that module's own header for
-- the full reasoning, including why the reclaim path re-checks with
-- DispatchTrack's `GET /routes?date=` before ever calling Create Route
-- again.
--
-- Cost at production scale: `routes` (not `dispatches`/`packages`, where
-- this series has twice hit statement_timeout) holds one row per route, not
-- per stop or per box — orders of magnitude smaller than the ~112k
-- dispatches / ~61k packages this spec's own Riesgos section warns about.
-- A single nullable timestamptz column with no default and no backfill is a
-- metadata-only change on this table.
-- =============================================================================

BEGIN;

ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS dispatch_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN public.routes.dispatch_attempt_at IS
  'spec-79 Fase 4. One-shot claim taken by claimDispatchAttempt before '
  'POST /api/dispatch/routes/[id]/dispatch calls DispatchTrack, released by '
  'releaseDispatchClaim on any terminal path that did not leave DT in an '
  'unknown state. NOT a routes.status edge and not read by '
  'transition_route_status. A claim older than DISPATCH_CLAIM_STALE_MS '
  '(dispatch-retry-claim.ts, 2 minutes) is reclaimable, gated behind a GET '
  '/routes?date= pre-check against DispatchTrack — see that module''s '
  'header for the full reasoning.';

COMMIT;
