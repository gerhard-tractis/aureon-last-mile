import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDTRoute, type DTDispatch, type DTItem } from '@/lib/dispatchtrack-api';

interface SkuLine { sku?: unknown; description?: unknown; quantity?: unknown }
interface PackageRow { label: string | null; sku_items: unknown; deleted_at: string | null }

/**
 * The guide's contents, as DispatchTrack shows them.
 *
 * One item per package rather than per SKU line: `code` is DT's only unique
 * identifier slot on an item, and the package label is what the operator
 * actually handles and scans, so that is what belongs there. A package holding
 * several SKUs folds into one item — its codes and descriptions joined, its
 * quantities summed — which keeps every code unique within the guide.
 *
 * A package with no SKU data still produces an item, so a guide always lists
 * the packages it consists of.
 */
function buildItems(packages: PackageRow[] | null | undefined): DTItem[] {
  return (packages ?? [])
    .filter((p) => !p.deleted_at && p.label)
    .map((p) => {
      const lines: SkuLine[] = Array.isArray(p.sku_items) ? p.sku_items : [];
      const names: string[] = [];
      const descriptions: string[] = [];
      let quantity = 0;

      for (const line of lines) {
        if (typeof line?.sku === 'string' && line.sku) names.push(line.sku);
        if (typeof line?.description === 'string' && line.description) {
          descriptions.push(line.description);
        }
        quantity += typeof line?.quantity === 'number' ? line.quantity : 1;
      }

      const item: DTItem = { code: p.label as string };
      if (names.length) item.name = names.join(', ');
      if (descriptions.length) item.description = descriptions.join(', ');
      item.quantity = String(quantity || 1);
      return item;
    });
}

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
      .select('id, status, route_date, load_position_id')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    // PGRST116 ("no row matched") is a genuine 404; anything else is a query
    // that never ran, which the outer catch would otherwise misreport as a
    // DispatchTrack failure — it hasn't been called yet. See
    // scan-validator.ts's header for why silently treating a failed query as
    // "not found" is the specific bug class this guards against.
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
    // planned. `loaded` is what /seal writes once that holds; requiring
    // `draft` here (the pre-spec-70 check) let a route with unstaged stops
    // dispatch straight through.
    if (route.status !== 'loaded') {
      // The message is surfaced verbatim by RouteBuilder. Without it a
      // Despachar click on a stale cache showed only "Error al despachar",
      // which tells the operator nothing about what to do next.
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
    // The nested packages embed feeds dispatches.items — the guide's contents.
    // deleted_at comes along because a nested embed cannot be filtered from here.
    const { data: dispatches, error: dErr } = await supabase
      .from('dispatches')
      .select('id, order_id, orders(order_number, customer_name, delivery_address, customer_phone, packages(label, sku_items, deleted_at))')
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
        items: buildItems(ord?.packages as PackageRow[] | undefined),
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

    // DT confirmed — now update local state.
    const orderIds = dispatches.map((d) => d.order_id).filter(Boolean) as string[];

    // The status write goes through the state machine, not a raw UPDATE — the
    // RPC is the one place that owns which edges are legal, and `loaded ->
    // dispatched` is the only one this handler is allowed to take.
    const { error: transitionError } = await supabase.rpc('transition_route_status', {
      p_route_id: routeId,
      p_operator_id: operatorId,
      p_to_status: 'dispatched',
    });
    if (transitionError) throw transitionError;

    // spec-71 Decision 8: release happens at `dispatched`. Best-effort in
    // the sense that a route with no position (never assigned one) has
    // nothing to release — release_load_position is itself idempotent, but
    // skipping the call entirely when there is nothing to do avoids a
    // pointless RPC round-trip and a misleading audit_logs row.
    if (route.load_position_id) {
      try {
        const { error: releaseError } = await supabase.rpc('release_load_position', {
          p_route_id: routeId,
          p_operator_id: operatorId,
          p_user_id: session.user.id,
        });
        if (releaseError) {
          console.error('[dispatch/dispatch POST] release_load_position failed', releaseError);
        } else {
          // Audit log — actual audit_logs schema: operator_id, user_id,
          // action, resource_type, resource_id, changes_json, ip_address.
          // changes_json carries the before/after of the release itself
          // (Decision 4: load_position_id is LEFT SET, only the
          // released_at/_by pair moves from unset to stamped).
          await supabase.from('audit_logs').insert({
            operator_id: operatorId,
            user_id: session.user.id,
            action: 'release_load_position',
            resource_type: 'routes',
            resource_id: routeId,
            changes_json: {
              load_position_id: route.load_position_id,
              previous_state: 'occupied',
              new_state: 'released',
            },
            ip_address: 'unknown',
          }).then(() => null, () => null);

          // spec-71 phase 2's own bullet: a route left at load_position_id
          // NULL is "assigned a position later, whenever one is released."
          // This release just freed one, so sweep this operator's other
          // routes that missed out earlier — sweep_load_position_assignments
          // (packages/database/supabase/migrations/20260827000003) does the
          // scan/assign loop in one round-trip, bounded and oldest-created-
          // first; see that migration's header for the ordering/cap
          // rationale. The route being dispatched here can never be swept:
          // its load_position_id stays SET by release (Decision 4), so it
          // never matches the sweep's `load_position_id IS NULL` filter.
          // Best-effort like every other call in this block — never fails
          // the dispatch request.
          try {
            const { data: sweepResults, error: sweepError } = await supabase.rpc(
              'sweep_load_position_assignments',
              { p_operator_id: operatorId, p_user_id: session.user.id },
            );
            if (sweepError) {
              console.error('[dispatch/dispatch POST] sweep_load_position_assignments failed', sweepError);
            } else if (Array.isArray(sweepResults) && sweepResults.length) {
              // One audit_logs row per assignment the sweep actually made,
              // exactly like the existing assign_load_position call sites
              // (routes/route.ts, [id]/scan/route.ts).
              await Promise.all(
                (sweepResults as { route_id: string; load_position_id: string }[]).map((swept) =>
                  supabase.from('audit_logs').insert({
                    operator_id: operatorId,
                    user_id: session.user.id,
                    action: 'assign_load_position',
                    resource_type: 'routes',
                    resource_id: swept.route_id,
                    changes_json: { load_position_id: swept.load_position_id, via: 'sweep_after_release' },
                    ip_address: 'unknown',
                  }).then(() => null, () => null),
                ),
              );
            }
          } catch (sweepErr) {
            console.error('[dispatch/dispatch POST] sweep_load_position_assignments threw', sweepErr);
          }
        }
      } catch (releaseErr) {
        // The route has already transitioned to `dispatched` (and is about
        // to be confirmed at DT); a release failure must not surface as a
        // dispatch failure.
        console.error('[dispatch/dispatch POST] release_load_position threw', releaseErr);
      }
    }

    await Promise.all([
      supabase
        .from('routes')
        .update({
          external_route_id,
          vehicle_id: vehicle.id,
          driver_name: parsed.data.driver_identifier ?? null,
        })
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
