import { findExistingDTRoute } from '@/lib/dispatchtrack-api';

/**
 * spec-79 Fase 4: wires `claimDispatchAttempt`'s `wasStale` signal
 * (dispatch-retry-claim.ts) to the `GET /routes?date=` pre-check
 * (`findExistingDTRoute`, dispatchtrack-api.ts) — the only idempotency
 * cover DT offers (Fase 0, findings 1 and 3).
 *
 * - `wasStale: false` (genuine first attempt, or a clean retry after a
 *   definite terminal failure): never call DT for a pre-check — it would
 *   add a round trip and a failure mode for no benefit on the one path that
 *   is already provably safe (`skip_precheck`).
 * - `wasStale: true` (recovery after a crashed request — see
 *   dispatch-retry-claim.ts's header for why this is the ONLY signal that
 *   distinguishes "maybe DT already has this" from "definitely doesn't"):
 *   run the pre-check.
 *     - `not_found` → safe to create (`create`).
 *     - `found` → DT already has this route; reuse its id instead of
 *       creating a second one (`reuse`).
 *     - `ambiguous`, or the pre-check itself throwing (network failure,
 *       unexpected shape, rate limit) → refuse (`refuse`). Fase 0's own
 *       words: "a pre-check that fails open is worse than none" — this
 *       never falls back to creating when it cannot confirm safety.
 */
export type PrecheckDecision =
  | { action: 'skip_precheck' }
  | { action: 'create' }
  | { action: 'reuse'; externalRouteId: string }
  | { action: 'refuse' };

export async function decidePrecheck(params: {
  wasStale: boolean;
  routeDate: string;
  identifiers: Array<string | number>;
  apiToken: string;
}): Promise<PrecheckDecision> {
  if (!params.wasStale) return { action: 'skip_precheck' };

  try {
    const match = await findExistingDTRoute(
      { routeDate: params.routeDate, identifiers: params.identifiers },
      params.apiToken,
    );
    if (match.status === 'not_found') return { action: 'create' };
    if (match.status === 'found') return { action: 'reuse', externalRouteId: match.external_route_id };
    return { action: 'refuse' };
  } catch (err) {
    console.error('[dispatch-retry-precheck] GET pre-check failed — refusing to create, not falling back', err);
    return { action: 'refuse' };
  }
}
