import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { findOrderIdsWithLiveDispatchOnOtherRoutes } from '@/lib/dispatch/dispatch-cross-route-orders';
import { LOADED_ON_TRUCK_STATUSES } from '@/lib/dispatch/dispatch-local-completion';

/**
 * `DELETE /routes/[id]`'s dispatch-and-package cleanup, extracted so that
 * handler stays under the repo's 300-line cap after spec-79 BLOCKER added
 * `loaded_route_id` to the revert write. Soft-deletes every live dispatch on
 * this route, then reverts each affected order's packages back to
 * `sectorizado` — excluding any order that still carries a live dispatch on
 * a DIFFERENT route (spec-79 review M-2: two live dispatches per order are
 * explicitly permitted, and a box physically loaded on that other route
 * must not be wiped by this route's own deletion).
 */
export async function releaseRouteDispatches(
  supabase: SupabaseClient<Database>,
  params: { routeId: string; operatorId: string; userId: string },
): Promise<void> {
  const { routeId, operatorId, userId } = params;

  const { data: dispatches } = await supabase
    .from('dispatches')
    .select('id, order_id')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    .is('deleted_at', null);

  if (!dispatches || dispatches.length === 0) return;

  const dispatchIds = dispatches.map((d) => d.id);
  await supabase
    .from('dispatches')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', dispatchIds)
    .eq('operator_id', operatorId);

  const orderIds = dispatches.map((d) => d.order_id).filter((id): id is string => id != null);
  if (orderIds.length === 0) return;

  const ordersOnOtherRoutes = await findOrderIdsWithLiveDispatchOnOtherRoutes(supabase, {
    operatorId, userId, orderIds, excludeRouteId: routeId, logPrefix: 'dispatch/routes DELETE',
  });
  const safeOrderIds = orderIds.filter((id) => !ordersOnOtherRoutes.has(id));
  if (safeOrderIds.length === 0) return;

  // spec-79 F6/F7 reset deleted_at and the per-box load fact too; BLOCKER
  // adds loaded_route_id to that reset (see packages/[pkgId]/route.ts's
  // identical comment). L-3: shares LOADED_ON_TRUCK_STATUSES instead of a
  // second hardcoded copy of the status set.
  await supabase
    .from('packages')
    .update({
      status: 'sectorizado',
      loaded_at: null,
      loaded_by: null,
      load_inferred: false,
      loaded_route_id: null,
    })
    .in('order_id', safeOrderIds)
    .eq('operator_id', operatorId)
    .in('status', [...LOADED_ON_TRUCK_STATUSES])
    .is('deleted_at', null);
}
