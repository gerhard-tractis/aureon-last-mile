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
 * NOT revert. Fails OPEN (returns an empty set, logs the error) on a query
 * failure — the same standard the offset re-check (`check_load_position_conflict`)
 * already applies in both call sites: this is a defensive guard added on top
 * of existing behaviour, not a new hard failure mode.
 */
export async function findOrderIdsWithLiveDispatchOnOtherRoutes(
  supabase: SupabaseClient<Database>,
  params: { operatorId: string; orderIds: string[]; excludeRouteId: string; logPrefix: string },
): Promise<Set<string>> {
  const { operatorId, orderIds, excludeRouteId, logPrefix } = params;
  if (orderIds.length === 0) return new Set();

  const { data: siblingRows, error: siblingError } = await supabase
    .from('dispatches')
    .select('order_id')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds)
    .neq('route_id', excludeRouteId)
    .is('deleted_at', null);
  if (siblingError) {
    console.error(`[${logPrefix}] sibling dispatch check failed`, siblingError);
    return new Set();
  }
  return new Set((siblingRows ?? []).map((d) => d.order_id).filter((id): id is string => id != null));
}
