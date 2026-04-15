import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

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
    const { data: route } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    if (route.status !== 'draft' && route.status !== 'planned') {
      return NextResponse.json(
        { code: 'ALREADY_DISPATCHED', message: 'Solo se pueden eliminar rutas en borrador o planificadas.' },
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

      // 3. Reset packages back to 'asignado'
      const orderIds = dispatches.map((d) => d.order_id).filter((id): id is string => id != null);
      if (orderIds.length > 0) {
        await supabase
          .from('packages')
          .update({ status: 'asignado' })
          .in('order_id', orderIds)
          .eq('operator_id', operatorId)
          .eq('status', 'en_carga');
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
