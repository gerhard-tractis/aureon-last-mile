import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import type { RouteStatus } from '@/lib/dispatch/types';

/**
 * Seal the manifest.
 *
 * This replaces `/close`, which was not a state at all: it advanced package
 * rows and returned, while "closed" lived in a React `useState` that a page
 * reload wiped. `/dispatch` then only required `draft`, so closing was
 * decorative.
 *
 * Sealing is where spec-70 decision 2 is enforced. **A plan is a commitment**:
 * the seal refuses while any stop is still merely `planned`. There is no
 * auto-release — a stop the manager did not explicitly remove has to go on the
 * truck. The refusal names the offending orders, because a refusal an operator
 * cannot act on is worse than none.
 *
 * States the seal may be reached from, and what each means:
 *   planned  — orders assigned, nothing staged. Always refuses (every stop is
 *              pending), except the empty-route case which gets its own code.
 *   loading  — the normal path.
 *   loaded   — already sealed. Idempotent success; the button is at a dock and
 *              gets double-tapped.
 */
const SEALABLE_FROM: readonly string[] = ['planned', 'loading'];

/** planned -> loaded is not a legal edge; it goes through loading. */
const SEAL_WALK: Record<string, readonly RouteStatus[]> = {
  planned: ['loading', 'loaded'],
  loading: ['loaded'],
};

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;

    const { data: route } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    if (route.status === 'loaded') {
      return NextResponse.json({ ok: true, already_sealed: true }, { status: 200 });
    }

    if (!SEALABLE_FROM.includes(route.status)) {
      return NextResponse.json(
        {
          code: 'ROUTE_NOT_OPEN',
          message: `La ruta no se puede cerrar en estado ${route.status}`,
        },
        { status: 409 },
      );
    }

    // Counts come from the view, never from routes.planned_stops — that column
    // drifted by construction and is what made EMPTY_ROUTE unreliable.
    const { data: counts } = await supabase
      .from('route_stop_counts')
      .select('total_stops, pending_stops, staged_stops, adopted_stops')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .maybeSingle();

    const total = counts?.total_stops ?? 0;
    const pendingCount = counts?.pending_stops ?? 0;

    if (total === 0) {
      return NextResponse.json(
        { code: 'EMPTY_ROUTE', message: 'No se puede cerrar una ruta sin paradas' },
        { status: 422 },
      );
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

      return NextResponse.json(
        {
          code: 'UNSEALED_STOPS',
          pending_count: pendingCount,
          pending,
          // RouteBuilder surfaces `message` verbatim.
          message:
            `Faltan ${pendingCount} parada(s) por estibar. ` +
            'Escanéalas o pide a un responsable que las quite de la planificación.',
        },
        { status: 409 },
      );
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

    return NextResponse.json(
      { ok: true, sealed_stops: total, orders_closed: orderIds.length },
      { status: 200 },
    );
  } catch (err) {
    console.error('[dispatch/seal POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
