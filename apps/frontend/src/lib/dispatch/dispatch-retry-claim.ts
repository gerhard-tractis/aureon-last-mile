import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/**
 * spec-79 Fase 4, review finding 4: `route.external_route_id` (and, after
 * the coordinator's blocker fix, `isConfirmedExternalRouteId`) is a READ
 * acted on much later in the handler, with nothing claiming the route in
 * between. A SEQUENTIAL retry is safe — the second request reads what the
 * first one persisted. Two CONCURRENT POSTs — a double-tap on the crew
 * tablet, a client retry racing a slow DT call, two devices — can both read
 * "not yet confirmed" and both call `createDTRoute`, creating two routes at
 * DispatchTrack (which has no idempotency key — spec-79 Fase 0, finding 1).
 *
 * `dispatch_attempt_at` (20260910000001) is a one-shot claim, not a new
 * state-machine edge — spec-79's own no-goals rule out touching
 * `transition_route_status`'s edges, and this doesn't: `routes.status`
 * never changes here.
 *
 * Two-step reasoning, both atomic conditional UPDATEs:
 *
 * 1. FRESH claim — `dispatch_attempt_at IS NULL`. Succeeds for a genuine
 *    first attempt, or for any retry after a request that reached a
 *    definite terminal state and released its own claim
 *    (`releaseDispatchClaim`). `wasStale: false` — nothing to reconcile,
 *    the caller can go straight to (or skip, per the existing
 *    `isConfirmedExternalRouteId` check) calling DT.
 *
 * 2. STALE reclaim — only reachable when the fresh claim found the column
 *    already set, meaning some request holds (or held) it. If that request
 *    is still genuinely in flight, its `dispatch_attempt_at` is recent and
 *    this reclaim correctly fails too — `{ claimed: false }`, the caller
 *    refuses (409). If instead that request crashed — died between
 *    DispatchTrack confirming and this process ever persisting or
 *    releasing anything — its claim is now older than
 *    `DISPATCH_CLAIM_STALE_MS` with nobody left to release it. Without a
 *    staleness escape hatch, that claim is permanent: "a claim that can
 *    never be released is its own outage" (the brief's own words). The
 *    stale reclaim succeeds and reports `wasStale: true`, which is the
 *    caller's signal to run the `GET` pre-check (dispatchtrack-api.ts's
 *    `findExistingDTRoute`) before ever calling `createDTRoute` again —
 *    the crash could have happened AFTER DT already accepted the route.
 *
 * `DISPATCH_CLAIM_STALE_MS` = 2 minutes: comfortably longer than a single
 * DT HTTP call plus this handler's own DB writes (which normally complete
 * in well under Vercel's shortest serverless function timeout), short
 * enough that an operator whose request genuinely crashed is not locked out
 * for long. It is a safety valve, not a rate limit — DT's own 1 req/sec,
 * 1000/day limit is enforced by only ever running the pre-check on this
 * stale-reclaim path, never on every request.
 */
export const DISPATCH_CLAIM_STALE_MS = 120_000;

export type DispatchClaimResult =
  | { claimed: true; wasStale: boolean }
  | { claimed: false };

export async function claimDispatchAttempt(
  supabase: SupabaseClient<Database>,
  params: { routeId: string; operatorId: string },
): Promise<DispatchClaimResult> {
  const { routeId, operatorId } = params;
  const nowIso = new Date().toISOString();

  const fresh = await supabase
    .from('routes')
    .update({ dispatch_attempt_at: nowIso })
    .eq('id', routeId)
    .eq('operator_id', operatorId)
    .is('dispatch_attempt_at', null)
    .is('deleted_at', null)
    .select('id');
  if (fresh.error) {
    console.error('[dispatch-retry-claim] fresh claim query failed — failing closed, refusing to dispatch', fresh.error);
    return { claimed: false };
  }
  if (fresh.data && fresh.data.length > 0) {
    return { claimed: true, wasStale: false };
  }

  // Someone already holds (or held) the claim. Reclaim ONLY if it is old
  // enough that no legitimately in-flight request could still own it — see
  // this module's header for the full reasoning.
  const cutoffIso = new Date(Date.now() - DISPATCH_CLAIM_STALE_MS).toISOString();
  const stale = await supabase
    .from('routes')
    .update({ dispatch_attempt_at: nowIso })
    .eq('id', routeId)
    .eq('operator_id', operatorId)
    .lt('dispatch_attempt_at', cutoffIso)
    .is('deleted_at', null)
    .select('id');
  if (stale.error) {
    console.error('[dispatch-retry-claim] stale reclaim query failed — failing closed, refusing to dispatch', stale.error);
    return { claimed: false };
  }
  if (stale.data && stale.data.length > 0) {
    return { claimed: true, wasStale: true };
  }

  return { claimed: false };
}

/**
 * Releases a claim taken by {@link claimDispatchAttempt} on any terminal
 * path that did NOT leave DispatchTrack in an unknown state — a definite
 * rejection (`DT_API_ERROR`), a definite local-failure-after-DT-accepted
 * (`DT_ACCEPTED_LOCAL_FAILED`, which persists `external_route_id` before
 * this ever runs, so a future retry is already safe via the existing
 * `isConfirmedExternalRouteId` check regardless of claim state), or any
 * refusal before DT was ever called (`MISSING_ORDER_NUMBER`,
 * `EMPTY_MANIFEST`, `VEHICLE_NOT_FOUND`, a failed lookup). Deliberately NOT
 * called when the pre-check itself comes back ambiguous or failed
 * (`RECONCILIATION_REQUIRED`) — see route.ts's own comment at that call
 * site: releasing there would let the NEXT request skip straight to a
 * fresh claim and call DT directly, exactly the risk the pre-check exists
 * to intercept.
 *
 * Best-effort — logs, never throws. Same pattern as every other release in
 * this flow (`releaseLoadPosition`).
 */
export async function releaseDispatchClaim(
  supabase: SupabaseClient<Database>,
  params: { routeId: string; operatorId: string },
): Promise<void> {
  // route.ts calls this from early-exit paths still inside its own outer
  // try/catch — an uncaught throw here (not just an `error` field) would
  // otherwise propagate up and get misreported as DT_API_ERROR. Wrapped so
  // this can never do that, matching its own "never throws" doc promise.
  try {
    const { error } = await supabase
      .from('routes')
      .update({ dispatch_attempt_at: null })
      .eq('id', params.routeId)
      .eq('operator_id', params.operatorId);
    if (error) {
      console.error('[dispatch-retry-claim] failed to release dispatch attempt claim', error);
    }
  } catch (err) {
    console.error('[dispatch-retry-claim] releasing dispatch attempt claim threw', err);
  }
}
