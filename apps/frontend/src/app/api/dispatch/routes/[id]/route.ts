import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { OPEN_ROUTE_STATUSES } from '@/lib/dispatch/types';

export async function DELETE(
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

    // Fetch route — verify ownership and status
    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    // PGRST116 ("no row matched") is a genuine 404; anything else is a query
    // that never ran, which must not be reported as "not found" — see
    // scan-validator.ts's header for why that confusion is dangerous here.
    if (routeError && routeError.code !== 'PGRST116') {
      console.error('[dispatch/routes DELETE] route lookup failed', routeError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo verificar la ruta' },
        { status: 500 },
      );
    }
    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    // spec-70 decision 6: release is a one-way door. Once a route is
    // `dispatched` DispatchTrack already has it, and undoing that needs a
    // compensating cancel there — out of scope for this spec — not a local
    // soft-delete that lets the two sides silently diverge. OPEN_ROUTE_STATUSES
    // is `draft`/`planned`/`loading`/`loaded`; everything past it is refused.
    if (!(OPEN_ROUTE_STATUSES as readonly string[]).includes(route.status)) {
      return NextResponse.json(
        { code: 'ALREADY_DISPATCHED', message: 'Solo se pueden eliminar rutas que no han sido despachadas.' },
        { status: 403 },
      );
    }

    // 1. Get dispatches for this route to find affected orders
    const { data: dispatches } = await supabase
      .from('dispatches')
      .select('id, order_id')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);

    // 2. Soft-delete dispatches
    if (dispatches && dispatches.length > 0) {
      const dispatchIds = dispatches.map((d) => d.id);
      await supabase
        .from('dispatches')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', dispatchIds)
        .eq('operator_id', operatorId);

      // 3. Reset packages back to 'sectorizado' — breakage #9. Nothing writes
      // 'asignado' any more; the dock-scan trigger (see scan-validator.ts's
      // header comment) is what puts a package on an andén, and that is the
      // state it should return to once its route is gone.
      //
      // Both 'en_carga' and 'listo_para_despacho' are matched: OPEN_ROUTE_STATUSES
      // admits `loaded`, and /seal has already moved every staged package from
      // en_carga to listo_para_despacho by the time a loaded route reaches here.
      // Filtering on en_carga alone matched nothing for a sealed-then-deleted
      // route, stranding its packages at listo_para_despacho with no route.
      const orderIds = dispatches.map((d) => d.order_id).filter((id): id is string => id != null);
      if (orderIds.length > 0) {
        await supabase
          .from('packages')
          .update({ status: 'sectorizado' })
          .in('order_id', orderIds)
          .eq('operator_id', operatorId)
          .in('status', ['en_carga', 'listo_para_despacho']);
      }
    }

    // 4. Soft-delete the route
    const { error: delError } = await supabase
      .from('routes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', routeId)
      .eq('operator_id', operatorId);

    if (delError) throw delError;

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/routes DELETE]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
