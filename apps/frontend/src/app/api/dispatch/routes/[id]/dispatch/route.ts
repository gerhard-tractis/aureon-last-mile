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

    // dispatches.identifier is DT's guide number, and order_number IS that
    // number: the inbound beetrack-webhook matches on `order_number =
    // body.identifier`, and scripts/sync-pending-orders.mjs looks guides up as
    // GET /dispatches/:order_number. So it goes out verbatim.
    //
    // Guide numbers are not always numeric — the format follows Musan's client,
    // so some are digits and some are alphanumeric strings. DT's docs type the
    // field Integer, but its own webhooks send it as a string ("2916967493"),
    // and the string form is what both sides already match on. Numeric ones are
    // sent as numbers to match the documented type; anything else goes as the
    // string it is. What must never happen is the previous behaviour,
    // parseInt(order_number.replace(/\D/g, '')), which invented a different
    // number for non-numeric guides and NaN (JSON null) for those with no
    // digits — a guide matching nothing on either side.
    const missingOrderNumbers = dispatches.filter((d) => {
      const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
      return !ord?.order_number?.trim();
    });

    if (missingOrderNumbers.length) {
      return NextResponse.json(
        {
          code: 'MISSING_ORDER_NUMBER',
          count: missingOrderNumbers.length,
          // RouteBuilder surfaces `message` verbatim.
          message:
            `${missingOrderNumbers.length} orden(es) de la ruta no tienen número de guía; no se puede despachar.`,
        },
        { status: 422 },
      );
    }

    const dtDispatches: DTDispatch[] = dispatches.map((d) => {
      const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
      const orderNumber = (ord?.order_number ?? '').trim();
      const asNumber = Number(orderNumber);
      return {
        identifier:
          /^\d+$/.test(orderNumber) && Number.isSafeInteger(asNumber)
            ? asNumber
            : orderNumber,
        contact_name: ord?.customer_name ?? null,
        contact_address: ord?.delivery_address ?? null,
        contact_phone: ord?.customer_phone ?? null,
        contact_email: null,
        current_state: 1,
      };
    });

    // DISPATCHTRACK_API_KEY is the name every other consumer uses (the
    // scripts/*.mjs backfills, the dispatchtrack-route-poll edge function).
    // This handler read DT_API_KEY, which nothing sets anywhere, so every
    // dispatch failed here before reaching DT. The old name stays as a
    // fallback in case a deployed environment still carries it.
    const apiToken = process.env.DISPATCHTRACK_API_KEY || process.env.DT_API_KEY;
    if (!apiToken) throw new Error('DISPATCHTRACK_API_KEY not configured');

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
