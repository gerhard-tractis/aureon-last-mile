import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { ForceSealReasonCode } from './force-seal-reasons';

export interface ForceSealAuditInput {
  routeId: string;
  operatorId: string;
  /** Author of the force-seal, for the audit row. */
  userId?: string;
  reasonCode: ForceSealReasonCode;
  note?: string;
  releasedCount: number;
  releasedOrderIds: string[];
  splitCount: number;
  splitOrderIds: string[];
}

/**
 * spec-77 — one `audit_logs` row per force-seal call, covering both the
 * fully-`planned` stops released and the `partially_staged` stops split
 * (spec-77 phase 1b), so a mixed force call leaves exactly one authored
 * trace, not two. Extracted out of `force-seal-release.ts` — that file used
 * to write this itself, but the split path (`force-seal-split.ts`) needs the
 * same row and neither release nor split should decide alone whether to
 * write it; `seal-route.ts` calls this once after both have run.
 *
 * Same mechanism the manager's `DELETE /packages/[pkgId]` removal uses,
 * distinguished from it by `action`. Errors are swallowed exactly as before
 * (`.then(() => null, () => null)`) — an audit-write failure must not turn
 * an otherwise-successful seal into a 500.
 *
 * spec-77 review B1 correction: this is called from `applyPendingStopsPlan`
 * (`seal-pending-stops.ts`), which only ever runs after every gate that can
 * REFUSE the seal — `planPendingStopsResolution`'s own checks and, above
 * all, `checkAdoptedCompleteness` — has already run and passed. So by the
 * time this writes, the release/split it is recording cannot be undone by a
 * later refusal; what is NOT yet true at this point is that the seal is
 * fully committed — `transition_route_status` still has to walk the route
 * to `loaded`, and that RPC (unlike everything before it) throws instead of
 * refusing. This audit row can therefore exist for a force call whose
 * route-status transition later fails; that is expected and recoverable (a
 * retry re-finds the same rows, now already released/split, and simply
 * re-attempts the transition), not the "already succeeded" claim this
 * comment used to make.
 */
export async function writeForceSealAudit(
  supabase: SupabaseClient<Database>,
  {
    routeId,
    operatorId,
    userId,
    reasonCode,
    note,
    releasedCount,
    releasedOrderIds,
    splitCount,
    splitOrderIds,
  }: ForceSealAuditInput,
): Promise<void> {
  await supabase
    .from('audit_logs')
    .insert({
      operator_id: operatorId,
      user_id: userId ?? 'unknown',
      action: 'force_seal_route',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        reason_code: reasonCode,
        note: note ?? null,
        released_count: releasedCount,
        released_order_ids: releasedOrderIds,
        split_count: splitCount,
        split_order_ids: splitOrderIds,
      },
      ip_address: 'unknown',
    })
    .then(() => null, () => null);
}
