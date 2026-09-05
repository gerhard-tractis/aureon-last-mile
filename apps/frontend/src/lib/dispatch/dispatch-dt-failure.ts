import { DTRejectedError } from '@/lib/dispatchtrack-api';
import { releaseDispatchClaim } from '@/lib/dispatch/dispatch-retry-claim';
import { createSSRClient } from '@/lib/supabase/server';

/**
 * spec-79 H-1 (review round 6): moved out of route.ts's own outer catch to
 * keep that file under the 300-line cap once the DTRejectedError-vs-ambiguous
 * distinction was added.
 *
 * DT rejected the request outright (`DTRejectedError`) — DT received it and
 * definitively said no, so nothing was created there, and it is safe to
 * release the dispatch claim immediately. Any OTHER throw (a network failure
 * or timeout before any response arrived, an unparsable body — see
 * dispatchtrack-api.ts) means the outcome is UNKNOWN: DT may have received
 * and accepted the request even though we never found out. Releasing the
 * claim in that case would let the very next retry skip straight to a fresh
 * claim and call DT again, creating a duplicate route — exactly the risk
 * this claim exists to prevent. Only a definite rejection is safe to release
 * early; anything ambiguous is left to expire naturally via
 * `DISPATCH_CLAIM_STALE_MS`, whose stale reclaim runs the GET pre-check
 * before ever calling DT again.
 *
 * Best-effort — logs, never throws (matches every other error-path audit
 * write in this flow).
 */
export async function handleDispatchOuterCatch(params: {
  err: unknown;
  routeId: string;
  claimAttemptToken: string | null;
}): Promise<void> {
  const { err, routeId, claimAttemptToken } = params;
  const definitelyRejected = err instanceof DTRejectedError;

  try {
    const supabase = await createSSRClient();
    const { data: { session: errSession } } = await supabase.auth.getSession();
    if (!errSession) return;
    const errOperatorId: string | undefined = errSession.user.app_metadata?.claims?.operator_id;
    if (!errOperatorId) return;

    if (claimAttemptToken && definitelyRejected) {
      await releaseDispatchClaim(supabase, { routeId, operatorId: errOperatorId, attemptToken: claimAttemptToken });
    }
    await supabase.from('audit_logs').insert({
      operator_id: errOperatorId,
      user_id: errSession.user.id,
      action: 'dispatch_failed',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: { dt_error: String(err), definitely_rejected: definitelyRejected },
      ip_address: 'unknown',
    });
  } catch { /* ignore audit failure */ }
}
