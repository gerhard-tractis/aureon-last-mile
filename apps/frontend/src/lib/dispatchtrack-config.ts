/**
 * spec-79 M1 (review round 7): `dispatchtrack-api.ts` used to define
 * `dtBaseUrl`/`DT_FETCH_TIMEOUT_MS` itself and re-export `findExistingDTRoute`
 * from `dt-list-routes.ts`, which in turn imported `dtBaseUrl`/
 * `DT_FETCH_TIMEOUT_MS` back FROM `dispatchtrack-api.ts` — a circular import.
 * It only worked because both references happened to sit where the bundler's
 * hoisting papered over the cycle; this spec created `dispatch-load-state.ts`
 * in Fase 1d for exactly this reason and that standard applies here too.
 * These two are tenant/timeout config shared by both `createDTRoute` and
 * `findExistingDTRoute` — pulled out to a leaf module neither of the other
 * two depends on, so the dependency graph is one-directional:
 * `dt-list-routes.ts` and `dispatchtrack-api.ts` both import FROM here;
 * neither imports from the other's actual logic.
 */

/**
 * DispatchTrack is tenant-per-subdomain. Transportes Musan is the only tenant
 * this product talks to, and it is the host scripts/sync-pending-orders.mjs and
 * the dispatchtrack-route-poll edge function already use.
 *
 * Overridable so QA can be aimed at a sandbox tenant if one is ever issued.
 * Read per call rather than at module load so the value tracks the environment.
 */
const DEFAULT_DT_BASE_URL = 'https://transportesmusan.dispatchtrack.com';

export function dtBaseUrl(): string {
  const configured = process.env.DISPATCHTRACK_BASE_URL?.trim();
  return (configured || DEFAULT_DT_BASE_URL).replace(/\/+$/, '');
}

/**
 * spec-79 H-1 (review round 6): bounds every DT call so a genuinely in-flight
 * request cannot outlive `DISPATCH_CLAIM_STALE_MS` (dispatch-retry-claim.ts,
 * 2 minutes) — the claim's staleness window is what lets a crashed request's
 * lock be reclaimed, and without a hard upper bound on how long a call can
 * run, "crashed" and "still legitimately working" are indistinguishable.
 * This repo also runs self-hosted (the QA VPS has no serverless-function
 * timeout), so the bound has to come from the fetch call itself, not from
 * the hosting platform.
 */
export const DT_FETCH_TIMEOUT_MS = 30_000;
