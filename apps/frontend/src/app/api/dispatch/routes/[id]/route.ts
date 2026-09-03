import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACTIVE_ROUTE_STATUSES, OPEN_ROUTE_STATUSES } from '@/lib/dispatch/types';
import { isCapacityConfigured } from '@/lib/dispatch/mobile/vehicle-picker';
import { routeCode } from '@/lib/dispatch/mobile/crew-board';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

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

const patchBodySchema = z.object({
  truck_identifier: z.string().min(1),
  driver_name: z.string().nullable().optional(),
});

/**
 * spec-76 task 2 (2d) — "Asignar camión y conductor". Persists
 * `routes.vehicle_id` / `routes.driver_name` at ASSIGNMENT time, not only at
 * dispatch. Before this, the only writer of either column was
 * `POST /api/dispatch/routes/[id]/dispatch`, which itself refuses to run
 * until the route is `loaded` — so every route 2a/2c can show had both
 * columns permanently NULL and rendered "Sin conductor"/"Sin asignar".
 *
 * `truck_identifier` is `fleet_vehicles.external_vehicle_id`, resolved here
 * exactly like the dispatch handler resolves it — the same string DispatchTrack
 * needs later, so what this endpoint accepts round-trips to that lookup.
 *
 * Gated the same way as DELETE (OPEN_ROUTE_STATUSES): once a route is
 * `dispatched` its vehicle/driver are already what DispatchTrack was told,
 * and this endpoint must never let that silently diverge locally.
 *
 * Two 422s that mirror spec-76 decision 6, checked server-side too (not
 * only hidden in the sheet's UI, defense in depth):
 *   - VEHICLE_NOT_FOUND — no live fleet_vehicles row for this operator.
 *   - VEHICLE_CAPACITY_NOT_CONFIGURED — capacity_packages IS NULL (or the
 *     same non-positive/non-finite values vehicle-capacity.ts already
 *     treats as unconfigured). Never accepted — never a fake bar downstream.
 * And a 409 VEHICLE_ALREADY_ASSIGNED_TODAY when the vehicle already carries
 * a DIFFERENT active route with today's route_date (Santiago civil date,
 * todayISOInTimezone) — the same "blocked, visible" rule the sheet renders,
 * enforced here so a stale sheet cannot double-book a truck.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;

    const body = await request.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 });

    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    // Same PGRST116 distinction as DELETE above — see that handler's comment.
    if (routeError && routeError.code !== 'PGRST116') {
      console.error('[dispatch/routes PATCH] route lookup failed', routeError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo verificar la ruta' },
        { status: 500 },
      );
    }
    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    if (!(OPEN_ROUTE_STATUSES as readonly string[]).includes(route.status)) {
      return NextResponse.json(
        {
          code: 'ALREADY_DISPATCHED',
          message: 'Solo se puede asignar camión y conductor antes del despacho.',
        },
        { status: 403 },
      );
    }

    const { data: vehicle } = await supabase
      .from('fleet_vehicles')
      .select('id, capacity_packages')
      .eq('external_vehicle_id', parsed.data.truck_identifier)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!vehicle) {
      return NextResponse.json({ code: 'VEHICLE_NOT_FOUND', message: 'Camión no encontrado' }, { status: 422 });
    }
    if (!isCapacityConfigured(vehicle.capacity_packages)) {
      return NextResponse.json(
        { code: 'VEHICLE_CAPACITY_NOT_CONFIGURED', message: 'Este camión no tiene capacidad configurada' },
        { status: 422 },
      );
    }

    const { data: busyRoute } = await supabase
      .from('routes')
      .select('id')
      .eq('operator_id', operatorId)
      .eq('route_date', todayISOInTimezone())
      .eq('vehicle_id', vehicle.id)
      .is('deleted_at', null)
      .neq('id', routeId)
      .in('status', ACTIVE_ROUTE_STATUSES)
      .maybeSingle();
    if (busyRoute) {
      return NextResponse.json(
        {
          code: 'VEHICLE_ALREADY_ASSIGNED_TODAY',
          message: `Este camión ya lleva otra ruta hoy (${routeCode(busyRoute.id)})`,
          route_id: busyRoute.id,
          route_code: routeCode(busyRoute.id),
        },
        { status: 409 },
      );
    }

    const driverName = parsed.data.driver_name ?? null;

    const { error: updateError } = await supabase
      .from('routes')
      .update({ vehicle_id: vehicle.id, driver_name: driverName })
      .eq('id', routeId)
      .eq('operator_id', operatorId);
    if (updateError) throw updateError;

    // Best-effort audit — same pattern as every other mutation in this
    // module (dispatch/route.ts, load-positions/scan, etc.): never fails
    // the request itself.
    supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: session.user.id,
      action: 'assign_vehicle_driver',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: { vehicle_id: vehicle.id, truck_identifier: parsed.data.truck_identifier, driver_name: driverName },
      ip_address: 'unknown',
    }).then(() => null, () => null);

    return NextResponse.json(
      { ok: true, vehicle_id: vehicle.id, external_vehicle_id: parsed.data.truck_identifier, driver_name: driverName },
      { status: 200 },
    );
  } catch (err) {
    console.error('[dispatch/routes PATCH]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
