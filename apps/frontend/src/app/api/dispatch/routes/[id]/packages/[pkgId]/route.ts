import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; pkgId: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { pkgId: dispatchId } = await params;

    const { data: dispatch } = await supabase
      .from('dispatches')
      .select('id, order_id, route_id')
      .eq('id', dispatchId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (!dispatch) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    const { error: delError } = await supabase
      .from('dispatches')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', dispatchId)
      .eq('operator_id', operatorId);
    if (delError) throw delError;

    if (dispatch.order_id) {
      await supabase
        .from('packages')
        .update({ status: 'asignado' })
        .eq('operator_id', operatorId)
        .eq('order_id', dispatch.order_id)
        .eq('status', 'en_carga');
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/packages DELETE]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
