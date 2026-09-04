import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDTRoute } from '@/lib/dispatchtrack-api';
import {
  buildDtDispatches,
  findMissingOrderNumbers,
  loadedPackageIds,
  type DispatchRow,
} from '@/lib/dispatch/dispatch-dt-payload';
import { completeLocalDispatch, DtAcceptedLocalFailedError } from '@/lib/dispatch/dispatch-local-completion';

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

    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id, status, route_date, load_position_id, external_route_id')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    // PGRST116 ("no row matched") is a genuine 404; anything else is a query
    // that never ran, which the outer catch would otherwise misreport as a
    // DispatchTrack failure — it hasn't been called yet.
    if (routeError && routeError.code !== 'PGRST116') {
      console.error('[dispatch/dispatch POST] route lookup failed', routeError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo verificar la ruta' },
        { status: 500 },
      );
    }
    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    // spec-70 decision 2: a route may only reach DispatchTrack once its
    // manifest is sealed — every stop staged or adopted, none merely
    // planned. `loaded` is what /seal writes once that holds. This guard is
    // also what makes a retry after a successful transition 409 instead of
    // re-running anything (spec-79 phase 0 finding 2): once status leaves
    // `loaded`, this handler refuses to touch the route again.
    if (route.status !== 'loaded') {
      return NextResponse.json(
        {
          code: 'INVALID_STATE',
          message: `La ruta debe estar cerrada para despachar (estado: ${route.status})`,
        },
        { status: 409 },
      );
    }

    // Breakage #10: vehicle and driver used to live only in React state and
    // never reached the database, so there was no record of who drove.
    // truck_identifier is the vehicle's external_vehicle_id (what the <select>
    // in RoutePanel sends) — resolved here to the fleet_vehicles row so
    // routes.vehicle_id can hold a real foreign key.
    const { data: vehicle } = await supabase
      .from('fleet_vehicles')
      .select('id')
      .eq('external_vehicle_id', parsed.data.truck_identifier)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!vehicle) {
      return NextResponse.json({ code: 'VEHICLE_NOT_FOUND', message: 'Camión no encontrado' }, { status: 422 });
    }

    // orders columns: customer_name, customer_phone, delivery_address (no contact_email).
    // The nested packages embed feeds dispatches.items (the guide's contents)
    // and, via `status`, spec-79 H3's en_ruta scoping. deleted_at comes along
    // because a nested embed cannot be filtered from here.
    const { data: dispatches, error: dErr } = await supabase
      .from('dispatches')
      .select('id, order_id, orders(order_number, customer_name, delivery_address, customer_phone, packages(id, label, sku_items, status, deleted_at))')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);
    if (dErr) throw dErr;
    if (!dispatches?.length) {
      return NextResponse.json({ code: 'EMPTY_ROUTE' }, { status: 422 });
    }
    const dispatchRows = dispatches as unknown as DispatchRow[];

    // spec-79 phase 3: a route that already carries an external_route_id has
    // been accepted by DT on a previous attempt (persisted by
    // completeLocalDispatch below, before anything else — see its header).
    // DT has no idempotency key (spec-79 phase 0, finding 1), so calling it
    // again here would create a second route in DispatchTrack. Skip straight
    // to finishing the local work that failed last time.
    let externalRouteId: string;
    if (route.external_route_id) {
      externalRouteId = route.external_route_id;
    } else {
      const missingOrderNumbers = findMissingOrderNumbers(dispatchRows);
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

      // DISPATCHTRACK_API_KEY is the name every other consumer uses. This
      // handler used to read DT_API_KEY, which nothing sets anywhere. The
      // old name stays as a fallback in case a deployed environment still
      // carries it.
      const apiToken = process.env.DISPATCHTRACK_API_KEY || process.env.DT_API_KEY;
      if (!apiToken) throw new Error('DISPATCHTRACK_API_KEY not configured');

      // Call DT API — if this throws, nothing local has changed yet.
      const created = await createDTRoute({
        truck_identifier: parsed.data.truck_identifier,
        route_date: route.route_date,
        driver_identifier: parsed.data.driver_identifier ?? null,
        dispatches: buildDtDispatches(dispatchRows),
      }, apiToken);
      externalRouteId = created.external_route_id;
    }

    // DT has confirmed this route — now or on a previous attempt. Every
    // error from here on means "DT accepted, our record of it is
    // incomplete", never "DT rejected" — see the catch block below.
    try {
      await completeLocalDispatch({
        supabase,
        routeId,
        operatorId,
        userId: session.user.id,
        externalRouteId,
        vehicleId: vehicle.id,
        driverIdentifier: parsed.data.driver_identifier ?? null,
        loadPositionId: route.load_position_id,
        loadedPackageIds: loadedPackageIds(dispatchRows),
        dispatchCount: dispatchRows.length,
        truckIdentifier: parsed.data.truck_identifier,
      });
    } catch (localErr) {
      if (localErr instanceof DtAcceptedLocalFailedError) {
        await logAcceptedLocalFailed(supabase, operatorId, session.user.id, routeId, localErr);
        return NextResponse.json(
          {
            code: 'DT_ACCEPTED_LOCAL_FAILED',
            external_route_id: localErr.externalRouteId,
            message: 'DispatchTrack ya recibió la ruta; falta completar el registro local.',
          },
          { status: 502 },
        );
      }
      throw localErr;
    }

    return NextResponse.json(
      { ok: true, external_route_id: externalRouteId, packages_dispatched: dispatchRows.length },
      { status: 200 },
    );
  } catch (err) {
    // DT rejected, or never got the chance to run — log but don't change
    // local state.
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

/**
 * spec-79 H2/phase 3: its own audit_logs action, distinct from
 * `dispatch_route` and `dispatch_failed`, carrying `external_route_id` so
 * the route is reconcilable against DT even though our local record of it
 * is incomplete. Best-effort — a failure here must not turn a
 * DT_ACCEPTED_LOCAL_FAILED response into an unhandled 500.
 */
async function logAcceptedLocalFailed(
  supabase: Awaited<ReturnType<typeof createSSRClient>>,
  operatorId: string,
  userId: string,
  routeId: string,
  err: DtAcceptedLocalFailedError,
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'dispatch_accepted_local_failed',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        external_route_id: err.externalRouteId,
        local_error: String(err.cause),
      },
      ip_address: 'unknown',
    });
  } catch (auditErr) {
    console.error('[dispatch/dispatch POST] dispatch_accepted_local_failed audit insert threw', auditErr);
  }
}
