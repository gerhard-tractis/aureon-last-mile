import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateScan } from '@/lib/dispatch/scan-validator';

const bodySchema = z.object({ code: z.string().min(1) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const validation = await validateScan({ code: parsed.data.code, routeId, operatorId });
    if (!validation.ok) {
      return NextResponse.json({ code: validation.code, message: validation.message }, { status: 422 });
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from('dispatches')
      .insert({
        operator_id: operatorId,
        route_id: routeId,
        order_id: validation.package.order_id,
        provider: 'dispatchtrack',
        status: 'pending',
      })
      .select('id')
      .single();
    if (dispatchError) throw dispatchError;

    await supabase
      .from('packages')
      .update({ status: 'en_carga' })
      .eq('operator_id', operatorId)
      .eq('order_id', validation.package.order_id)
      .eq('status', 'asignado');

    // Increment planned_stops
    const { data: currentRoute } = await supabase
      .from('routes')
      .select('planned_stops')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .single();

    if (currentRoute) {
      await supabase
        .from('routes')
        .update({ planned_stops: (currentRoute.planned_stops ?? 0) + 1 })
        .eq('id', routeId)
        .eq('operator_id', operatorId);
    }

    return NextResponse.json(
      { ...validation.package, dispatch_id: dispatch.id },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dispatch/scan POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
