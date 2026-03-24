import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDTRoute, type DTDispatch } from '@/lib/dispatchtrack-api';

const bodySchema = z.object({
  truck_identifier: z.string().min(1),
  driver_identifier: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: routeId } = await params;
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 });

    const { data: route } = await supabase
      .from('routes')
      .select('id, status, route_date')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    if (route.status !== 'draft') {
      return NextResponse.json({ code: 'INVALID_STATE' }, { status: 409 });
    }

    // orders columns: customer_name, customer_phone, delivery_address (no contact_email)
    const { data: dispatches, error: dErr } = await supabase
      .from('dispatches')
      .select('id, order_id, orders(order_number, customer_name, delivery_address, customer_phone)')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);
    if (dErr) throw dErr;
    if (!dispatches?.length) {
      return NextResponse.json({ code: 'EMPTY_ROUTE' }, { status: 422 });
    }

    const dtDispatches: DTDispatch[] = dispatches.map((d) => {
      const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
      return {
        identifier: parseInt(ord?.order_number?.replace(/\D/g, '') ?? '0', 10),
        contact_name: ord?.customer_name ?? null,
        contact_address: ord?.delivery_address ?? null,
        contact_phone: ord?.customer_phone ?? null,
        contact_email: null,
        current_state: 1,
      };
    });

    const apiToken = process.env.DT_API_KEY;
    if (!apiToken) throw new Error('DT_API_KEY not configured');

    // Call DT API — if this throws, nothing local changes
    const { external_route_id } = await createDTRoute({
      truck_identifier: parsed.data.truck_identifier,
      route_date: route.route_date,
      driver_identifier: parsed.data.driver_identifier ?? null,
      dispatches: dtDispatches,
    }, apiToken);

    // DT confirmed — now update local state
    const orderIds = dispatches.map((d) => d.order_id).filter(Boolean) as string[];

    await Promise.all([
      supabase
        .from('routes')
        .update({ status: 'planned', external_route_id })
        .eq('id', routeId)
        .eq('operator_id', operatorId),
      supabase
        .from('packages')
        .update({ status: 'en_ruta' })
        .eq('operator_id', operatorId)
        .in('order_id', orderIds),
    ]);

    // Audit log — use actual audit_logs schema:
    // columns: operator_id, user_id, action, resource_type, resource_id, changes_json, ip_address
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: session.user.id,
      action: 'dispatch_route',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        external_route_id,
        packages_count: dispatches.length,
        truck_identifier: parsed.data.truck_identifier,
      },
      ip_address: 'unknown',
    }).then(() => null, () => null);

    return NextResponse.json({ ok: true, external_route_id, packages_dispatched: dispatches.length }, { status: 200 });
  } catch (err) {
    // DT API failure — log but don't change local state
    try {
      const supabase = await createSSRClient();
      const { data: { session: errSession } } = await supabase.auth.getSession();
      if (errSession) {
        const errOperatorId: string | undefined = errSession.user.app_metadata?.claims?.operator_id;
        if (errOperatorId) {
          await supabase.from('audit_logs').insert({
            operator_id: errOperatorId,
            user_id: errSession.user.id,
            action: 'dispatch_failed',
            resource_type: 'routes',
            resource_id: routeId,
            changes_json: { dt_error: String(err) },
            ip_address: 'unknown',
          });
        }
      }
    } catch { /* ignore audit failure */ }

    console.error('[dispatch/dispatch POST]', err);
    const message = err instanceof Error ? err.message : 'DT API error';
    return NextResponse.json({ code: 'DT_API_ERROR', message }, { status: 502 });
  }
}
