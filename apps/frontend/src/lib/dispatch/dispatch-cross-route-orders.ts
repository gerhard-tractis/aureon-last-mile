import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/**
 * spec-79 review M-2. `packages` carries no route linkage (see
 * dispatch-load-state.ts's own header comment), so a caller reverting boxes
 * back to `sectorizado` by `order_id` alone reaches every box of that order —
 * including one physically loaded on a DIFFERENT still-live route for the
 * same order. Two live dispatches per order are explicitly permitted
 * (20260901000001_spec74_package_load_state.sql:181-183): order O planned on
 * routes A and B, a box scanned onto A, a manager removes O's stop from B —
 * without this check the box, physically on truck A, gets wiped back to
 * `sectorizado` with its load fact cleared, and A can no longer seal (both
 * `recompute_dispatch_stage` and the seal completeness check read
 * `loaded_at IS NULL` as outstanding).
 *
 * Shared by the two revert sites that had this bug (`packages/[pkgId]/route.ts`
 * removing one stop, `routes/[id]/route.ts` deleting a whole route) so the
 * scoping rule lives in exactly one place — the same lesson `LOADED_ON_TRUCK_STATUSES`
 * already forced onto this module (see review L-3).
 *
 * @returns the subset of `orderIds` that carry a live (`deleted_at IS NULL`)
 * dispatch on a route OTHER than `excludeRouteId` — the ones a caller must
 * NOT revert.
 *
 * Fails CLOSED on a query failure — corrected from an earlier version of
 * this function that returned an empty set on error, i.e. "no cross-route
 * orders exist", indistinguishable from a genuine clean check. That is
 * exactly the M-2 defect this function exists to fix, just moved one level
 * up: a lookup that cannot run is not evidence the box is safe to revert.
 * The `check_load_position_conflict` precedent cited to justify the
 * fail-open default does not actually support it — that guard is
 * best-effort in the other direction (a failure there can only miss
 * SURFACING an existing conflict for observability; nothing downstream acts
 * on it) and was itself never reviewed as a "fail open is fine" pattern to
 * copy. Here a failure controls whether data gets wiped. On error, every
 * requested `orderId` is returned (i.e. "assume every one of them might
 * have a live dispatch elsewhere, revert none of them") — the box's load
 * fact stays intact and the operator can retry, versus silently corrupting
 * a second route's state with no signal. Logged loudly (`console.error`,
 * unchanged) AND recorded (`audit_logs`, best-effort, new) so the failure
 * is observable after the fact, not just in server logs at the moment it
 * happened.
 */
export async function findOrderIdsWithLiveDispatchOnOtherRoutes(
  supabase: SupabaseClient<Database>,
  params: { operatorId: string; userId: string; orderIds: string[]; excludeRouteId: string; logPrefix: string },
): Promise<Set<string>> {
  const { operatorId, userId, orderIds, excludeRouteId, logPrefix } = params;
  if (orderIds.length === 0) return new Set();

  const { data: siblingRows, error: siblingError } = await supabase
    .from('dispatches')
    .select('order_id')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds)
    .neq('route_id', excludeRouteId)
    .is('deleted_at', null);
  if (siblingError) {
    console.error(`[${logPrefix}] sibling dispatch check failed — failing closed, reverting nothing`, siblingError);
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'cross_route_lookup_failed',
      resource_type: 'dispatches',
      resource_id: excludeRouteId,
      changes_json: { order_ids: orderIds, error: String(siblingError) },
      ip_address: 'unknown',
    }).then(() => null, () => null);
    return new Set(orderIds);
  }
  return new Set((siblingRows ?? []).map((d) => d.order_id).filter((id): id is string => id != null));
}
