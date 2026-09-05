import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { type DispatchRow } from '@/lib/dispatch/dispatch-dt-payload';
import {
  completeLocalDispatch,
  DtAcceptedLocalFailedError,
  loadedPackageIds,
  alreadyDispatchedPackageCount,
  logAcceptedLocalFailed,
} from '@/lib/dispatch/dispatch-local-completion';
import { isConfirmedExternalRouteId } from '@/lib/dispatch/dispatch-external-route-id';
import { claimDispatchAttempt, releaseDispatchClaim } from '@/lib/dispatch/dispatch-retry-claim';
import { resolveExternalRouteIdForDispatch } from '@/lib/dispatch/dispatch-resolve-external-route-id';

const bodySchema = z.object({
  truck_identifier: z.string().min(1),
  driver_identifier: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: routeId } = await params;
  let claimTaken = false;
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
      .select('id, status, route_date, load_position_id, external_route_id, provider, driver_name')
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

    // spec-79 Fase 4, review finding 4: claims this route for THIS request
    // before anything that could call DispatchTrack — see
    // dispatch-retry-claim.ts's header for the fresh/stale/refuse reasoning.
    const claim = await claimDispatchAttempt(supabase, { routeId, operatorId });
    if (!claim.claimed) {
      return NextResponse.json(
        {
          code: 'DISPATCH_IN_PROGRESS',
          message: 'Ya hay un intento de despacho en curso para esta ruta.',
        },
        { status: 409 },
      );
    }
    claimTaken = true;

    // Releases the claim (best-effort, never throws) before responding,
    // except where `release: false` is passed (RECONCILIATION_REQUIRED).
    const respond = async (body: Record<string, unknown>, status: number, release = true) => {
      if (release) await releaseDispatchClaim(supabase, { routeId, operatorId });
      return NextResponse.json(body, { status });
    };

    // Breakage #10: vehicle and driver used to live only in React state and
    // never reached the database. truck_identifier is the vehicle's
    // external_vehicle_id (what the <select> in RoutePanel sends) —
    // resolved here to the fleet_vehicles row so routes.vehicle_id can hold
    // a real foreign key.
    //
    // spec-79 H5b: fleet_vehicles is UNIQUE(operator_id, provider,
    // external_vehicle_id), not (operator_id, external_vehicle_id) — scoped
    // by this route's own provider (same fix as PATCH
    // /api/dispatch/routes/[id], Review C2). `error` is destructured and
    // checked — same fail-closed precedent as
    // findOrderIdsWithLiveDispatchOnOtherRoutes (spec-79 M-2 addendum): a
    // guard that treats "the query failed" the same as "no match" is not a
    // guard. A genuine 0-row "not found" still has `error: null`.
    const { data: vehicle, error: vehicleError } = await supabase
      .from('fleet_vehicles')
      .select('id')
      .eq('external_vehicle_id', parsed.data.truck_identifier)
      .eq('operator_id', operatorId)
      .eq('provider', route.provider)
      .is('deleted_at', null)
      .maybeSingle();
    if (vehicleError) {
      console.error('[dispatch/dispatch POST] vehicle lookup failed', vehicleError);
      return respond({ code: 'QUERY_FAILED', message: 'No se pudo verificar el camión' }, 500);
    }
    if (!vehicle) {
      return respond({ code: 'VEHICLE_NOT_FOUND', message: 'Camión no encontrado' }, 422);
    }

    // orders columns: customer_name, customer_phone, delivery_address (no contact_email).
    // The nested packages embed feeds dispatches.items (the guide's contents)
    // and, via `status`/`loaded_at`/`load_inferred`, spec-79 H3's en_ruta
    // scoping (dispatch-local-completion.ts's loadedPackageIds). deleted_at
    // comes along because a nested embed cannot be filtered from here.
    const { data: dispatches, error: dErr } = await supabase
      .from('dispatches')
      .select('id, order_id, orders(order_number, customer_name, delivery_address, customer_phone, packages(id, label, sku_items, status, deleted_at, loaded_at, load_inferred, loaded_route_id))')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);
    // spec-79 review finding 3: a failed query here must not fall into the
    // outer catch, which reports every error as DT_API_ERROR (a DispatchTrack
    // rejection) — DT hasn't been called yet at this point. Mirrors the
    // routes lookup above.
    if (dErr) {
      console.error('[dispatch/dispatch POST] dispatches lookup failed', dErr);
      return respond({ code: 'QUERY_FAILED', message: 'No se pudo verificar los despachos' }, 500);
    }
    if (!dispatches?.length) {
      return respond({ code: 'EMPTY_ROUTE' }, 422);
    }
    const dispatchRows = dispatches as unknown as DispatchRow[];

    // spec-79 phase 3: a route that already carries a CONFIRMED
    // external_route_id was accepted by DT on a previous attempt (persisted
    // by completeLocalDispatch below, before anything else — see its
    // header). DT has no idempotency key (phase 0, finding 1), so calling
    // it again would create a second route. Skip straight to finishing the
    // local work that failed last time.
    //
    // Coordinator finding (post-phase-3 blocker): `routes.external_route_id`
    // is NOT NULL and every route is CREATED with a `draft_<uuid>`
    // placeholder before DispatchTrack ever sees it — a bare `Boolean(...)`
    // read that as "DT already confirmed" on every never-dispatched route.
    // See dispatch-external-route-id.ts.
    //
    // spec-79 Fase 4: review finding 4's concurrency gap (this guard is a
    // READ, nothing claims the route in between) is now closed above by
    // `claimDispatchAttempt` — a genuinely concurrent second request already
    // got DISPATCH_IN_PROGRESS before reaching this line. `claim.wasStale`
    // is what's left: a retry recovering from a crashed request, where DT
    // might already have accepted the route. `isRetry` may still flip true
    // below, via the GET pre-check finding that route.
    let isRetry = isConfirmedExternalRouteId(route.external_route_id);
    let externalRouteId: string;
    if (isRetry) {
      externalRouteId = route.external_route_id as string;
    } else {
      // DISPATCHTRACK_API_KEY is the name every other consumer uses;
      // DT_API_KEY stays as a fallback. spec-79 review finding 3: a missing
      // token is a server misconfiguration, not a DispatchTrack rejection.
      const apiToken = process.env.DISPATCHTRACK_API_KEY || process.env.DT_API_KEY;
      if (!apiToken) {
        console.error('[dispatch/dispatch POST] DISPATCHTRACK_API_KEY not configured');
        return respond({ code: 'QUERY_FAILED', message: 'DispatchTrack no está configurado' }, 500);
      }

      // spec-79 phases 1-3 + Fase 4: MISSING_ORDER_NUMBER, EMPTY_MANIFEST,
      // and the GET pre-check's reuse/create/refuse decision — extracted to
      // keep this handler under the 300-line cap.
      const resolved = await resolveExternalRouteIdForDispatch({
        dispatchRows,
        routeId,
        routeDate: route.route_date,
        truckIdentifier: parsed.data.truck_identifier,
        driverIdentifier: parsed.data.driver_identifier ?? null,
        wasStale: claim.wasStale,
        apiToken,
      });
      if (!resolved.ok) {
        return respond(
          { code: resolved.code, message: resolved.message, ...(resolved.count !== undefined ? { count: resolved.count } : {}) },
          resolved.status,
          resolved.release !== false,
        );
      }
      externalRouteId = resolved.externalRouteId;
      isRetry = resolved.isRetry;
    }

    // DT has confirmed this route — now or on a previous attempt. Every
    // error from here on means "DT accepted, our record of it is
    // incomplete", never "DT rejected" — see the catch block below.
    const loadedIds = loadedPackageIds(dispatchRows, routeId);
    let writtenCount: number;
    try {
      ({ dispatchedCount: writtenCount } = await completeLocalDispatch({
        supabase,
        routeId,
        operatorId,
        userId: session.user.id,
        externalRouteId,
        vehicleId: vehicle.id,
        // spec-79 H5a: `driver_identifier` is optional in the dispatch body
        // (desktop dispatch may not send one at all). Falling straight to
        // `null` overwrote whatever real name the crew already saved at
        // assignment time (spec-76 2d, PATCH /api/dispatch/routes/[id]) with
        // nothing. Fall back to the route's own already-persisted
        // `driver_name` first — only `null` when NEITHER exists.
        driverIdentifier: parsed.data.driver_identifier ?? route.driver_name ?? null,
        loadPositionId: route.load_position_id,
        loadedPackageIds: loadedIds,
        dispatchCount: dispatchRows.length,
        truckIdentifier: parsed.data.truck_identifier,
        isRetry,
      }));
    } catch (localErr) {
      if (localErr instanceof DtAcceptedLocalFailedError) {
        await logAcceptedLocalFailed(supabase, operatorId, session.user.id, routeId, localErr);
        // DT already accepted this route — external_route_id is persisted
        // (completeLocalDispatch's own ordering), so a future retry is safe
        // regardless of claim state via isConfirmedExternalRouteId. Release
        // now so that retry doesn't need to wait out the staleness window.
        return respond(
          {
            code: 'DT_ACCEPTED_LOCAL_FAILED',
            external_route_id: localErr.externalRouteId,
            message: 'DispatchTrack ya recibió la ruta; falta completar el registro local.',
          },
          502,
        );
      }
      throw localErr;
    }

    // spec-79 review F2: `writtenCount` (what completeLocalDispatch actually
    // wrote THIS call) is reported here, never `loadedIds.length` (merely
    // requested) — those two can differ.
    // spec-79 review M-1: on a sanctioned retry, every genuinely-loaded box
    // is already `en_ruta` from the earlier attempt, so `writtenCount` alone
    // is legitimately 0 — that would answer `packages_dispatched: 0` for a
    // route carrying 40 boxes. `alreadyDispatchedPackageCount` adds those
    // already-written boxes so the total is honest on every path.
    const dispatchedCount = alreadyDispatchedPackageCount(dispatchRows, routeId) + writtenCount;
    return NextResponse.json(
      { ok: true, external_route_id: externalRouteId, packages_dispatched: dispatchedCount },
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
          // spec-79 Fase 4: DT definitively rejected (or was never reached),
          // so this route did not just leave a claim behind — safe to
          // release now rather than wait out the staleness window.
          if (claimTaken) {
            await releaseDispatchClaim(supabase, { routeId, operatorId: errOperatorId });
          }
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
