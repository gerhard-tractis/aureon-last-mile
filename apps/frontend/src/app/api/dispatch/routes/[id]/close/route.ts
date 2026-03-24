import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

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

    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id, status, planned_stops')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (routeError || !route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    if (route.status !== 'draft') {
      return NextResponse.json({ code: 'INVALID_STATE', message: 'Route is not in draft status' }, { status: 409 });
    }
    if (route.planned_stops === 0) {
      return NextResponse.json({ code: 'EMPTY_ROUTE', message: 'Cannot close an empty route' }, { status: 422 });
    }

    const { data: dispatches, error: dispError } = await supabase
      .from('dispatches')
      .select('order_id')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);
    if (dispError) throw dispError;

    const orderIds = (dispatches ?? []).map((d) => d.order_id).filter(Boolean) as string[];

    if (orderIds.length > 0) {
      const { error: pkgError } = await supabase
        .from('packages')
        .update({ status: 'listo_para_despacho' })
        .eq('operator_id', operatorId)
        .eq('status', 'en_carga')
        .in('order_id', orderIds);
      if (pkgError) throw pkgError;
    }

    return NextResponse.json({ ok: true, packages_closed: orderIds.length }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/close POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
