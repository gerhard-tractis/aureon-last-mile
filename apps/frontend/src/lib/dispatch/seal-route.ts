import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { RouteStatus } from './types';

/**
 * spec-71 phase 4 — the route-level seal's core logic, extracted verbatim
 * (behaviour unchanged) so the position-level seal can call the exact same
 * event instead of inventing a parallel one. Spec-71 Decision 3: sealing a
 * position IS sealing the route that occupies it — a position hosts at
 * most one live route (Decision 4's occupancy predicate), so there is no
 * second "is this loaded yet" fact to keep in sync. `[id]/seal/route.ts`
 * (auth + params) and the new `load-positions/seal/route.ts` (auth +
 * position/route resolution) both reduce to calling this.
 *
 * States a route may be sealed from, and what each means — moved here
 * unchanged from the original header:
 *   draft    — a route this deploy finds sitting there. The old builder left
 *              routes at `draft` through its whole scan flow, and phase 1's
 *              backfill moved their dispatch rows straight to `staged`
 *              without touching route status. Without this, every such route
 *              is unsealable and undispatchable forever — refused here in the
 *              same way `planned` is, walking the same three-step path.
 *   planned  — orders assigned, nothing staged. Always refuses (every stop is
 *              pending), except the empty-route case which gets its own code.
 *   loading  — the normal path.
 *   loaded   — already sealed. Idempotent success; the button is at a dock and
 *              gets double-tapped.
 */
const SEALABLE_FROM: readonly string[] = ['draft', 'planned', 'loading'];

/** planned/draft -> loaded is not a legal edge; it goes through loading. */
const SEAL_WALK: Record<string, readonly RouteStatus[]> = {
  draft: ['planned', 'loading', 'loaded'],
  // Unreachable insurance, not a real path: a `planned` route can only carry
  // staged rows if the scan handler's stage RPC succeeded, and that RPC is
  // what moves the route off `planned` in the first place — a throw on that
  // RPC aborts the scan handler before any row is staged. Kept anyway so a
  // route arriving here at `planned` (a hand-edited row, a future caller)
  // still walks a real path instead of getting stuck one step short of
  // `loaded`.
  planned: ['loading', 'loaded'],
  loading: ['loaded'],
};

export type SealRouteResult =
  | { ok: true; already_sealed: true }
  | { ok: true; already_sealed: false; sealed_stops: number; orders_closed: number }
  | {
      ok: false;
      status: number;
      code: 'NOT_FOUND' | 'QUERY_FAILED' | 'ROUTE_NOT_OPEN' | 'EMPTY_ROUTE' | 'UNSEALED_STOPS';
      message?: string;
      pending_count?: number;
      pending?: string[];
    };

export interface SealRouteInput {
  routeId: string;
  operatorId: string;
}

/**
 * Seals a route: refuses while any stop is still `planned` (spec-70
 * decision 2), advances staged/adopted packages to
 * `listo_para_despacho`, and walks `routes.status` to `loaded` via
 * `transition_route_status`. Does not touch the request/session — callers
 * own auth and turn this result into an HTTP response.
 */
export async function sealRoute(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId }: SealRouteInput,
): Promise<SealRouteResult> {
  const { data: route, error: routeError } = await supabase
    .from('routes')
    .select('id, status')
    .eq('id', routeId)
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .single();

  // PGRST116 is "no row matched" — a genuine 404. Anything else is a query
  // that failed to run at all, which is not the same fact and must not be
  // reported as one.
  if (routeError && routeError.code !== 'PGRST116') {
    console.error('[sealRoute] route lookup failed', routeError);
    return { ok: false, status: 500, code: 'QUERY_FAILED', message: 'No se pudo verificar la ruta' };
  }
  if (!route) return { ok: false, status: 404, code: 'NOT_FOUND' };

  if (route.status === 'loaded') {
    return { ok: true, already_sealed: true };
  }

  if (!SEALABLE_FROM.includes(route.status)) {
    return {
      ok: false,
      status: 409,
      code: 'ROUTE_NOT_OPEN',
      message: `La ruta no se puede cerrar en estado ${route.status}`,
    };
  }

  // Counts come from the view, never from routes.planned_stops — that
  // column drifted by construction and is what made EMPTY_ROUTE unreliable.
  const { data: counts, error: countsError } = await supabase
    .from('route_stop_counts')
    .select('total_stops, pending_stops, staged_stops, adopted_stops')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    .maybeSingle();

  if (countsError) {
    console.error('[sealRoute] route_stop_counts query failed', countsError);
    return {
      ok: false,
      status: 500,
      code: 'QUERY_FAILED',
      message: 'No se pudo verificar el estado de la ruta',
    };
  }

  const total = counts?.total_stops ?? 0;
  const pendingCount = counts?.pending_stops ?? 0;

  if (total === 0) {
    return {
      ok: false,
      status: 422,
      code: 'EMPTY_ROUTE',
      message: 'No se puede cerrar una ruta sin paradas',
    };
  }

  if (pendingCount > 0) {
    const { data: pendingRows } = await supabase
      .from('dispatches')
      .select('order_id, orders(order_number)')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .eq('stage', 'planned')
      .is('deleted_at', null);

    const pending = (pendingRows ?? []).map((r) => {
      const ord = Array.isArray(r.orders) ? r.orders[0] : r.orders;
      return ord?.order_number ?? r.order_id;
    });

    return {
      ok: false,
      status: 409,
      code: 'UNSEALED_STOPS',
      pending_count: pendingCount,
      pending,
      // RouteBuilder surfaces `message` verbatim.
      message:
        `Faltan ${pendingCount} parada(s) por estibar. ` +
        'Escanéalas o pide a un responsable que las quite de la planificación.',
    };
  }

  const { data: sealedRows } = await supabase
    .from('dispatches')
    .select('order_id')
    .eq('route_id', routeId)
    .eq('operator_id', operatorId)
    .in('stage', ['staged', 'adopted'])
    .is('deleted_at', null);

  const orderIds = (sealedRows ?? [])
    .map((d) => d.order_id)
    .filter((id): id is string => id != null);

  if (orderIds.length > 0) {
    const { error: pkgError } = await supabase
      .from('packages')
      .update({ status: 'listo_para_despacho' })
      .eq('operator_id', operatorId)
      .eq('status', 'en_carga')
      .in('order_id', orderIds);
    if (pkgError) throw pkgError;
  }

  for (const to of SEAL_WALK[route.status] ?? []) {
    const { error: transitionError } = await supabase.rpc('transition_route_status', {
      p_route_id: routeId,
      p_operator_id: operatorId,
      p_to_status: to,
    });
    if (transitionError) throw transitionError;
  }

  return { ok: true, already_sealed: false, sealed_stops: total, orders_closed: orderIds.length };
}
