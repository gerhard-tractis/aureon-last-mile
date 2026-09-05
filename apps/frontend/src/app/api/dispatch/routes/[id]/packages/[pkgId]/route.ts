import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canRemoveFromPlan } from '@/lib/permissions';
import { LOADED_ON_TRUCK_STATUSES } from '@/lib/dispatch/dispatch-local-completion';

const bodySchema = z.object({
  reason: z.string().trim().min(1),
});

interface RouteRow { status: string }

/**
 * Route states in which a stop may still be taken off the plan.
 *
 * spec-70 decision 3: removal is a manager action, not the scanner's, and it
 * exists precisely so a plan stays honest while it is being loaded. Once the
 * route is `loaded` the manifest is sealed — /seal has already confirmed every
 * remaining stop is staged or adopted — so a removal past that point would
 * silently reopen a promise DispatchTrack (or the driver) may already be
 * relying on. `dispatched` and beyond are refused for the same reason
 * DELETE /routes/[id] refuses them: the route is a one-way door past that
 * state (decision 6).
 */
const REMOVABLE_FROM = ['draft', 'planned', 'loading'] as const;

/**
 * Take one stop off a route's plan.
 *
 * spec-70 decisions 2 and 3: a plan is a commitment, and only a manager can
 * break it. This used to be reachable by whoever was holding the scanner —
 * the whole point of "a planned package goes on the truck unless removed" is
 * that the person doing the loading cannot be the one who shrinks the plan.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; pkgId: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const role: string | undefined = session.user.app_metadata?.claims?.role;
    if (!canRemoveFromPlan(role)) {
      return NextResponse.json(
        { code: 'FORBIDDEN', message: 'Solo un responsable puede quitar paradas de la planificación.' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Se requiere un motivo para quitar la parada.' },
        { status: 400 },
      );
    }

    const { pkgId: dispatchId } = await params;

    const { data: dispatch, error: dispatchError } = await supabase
      .from('dispatches')
      .select('id, order_id, route_id, routes(status)')
      .eq('id', dispatchId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    // PGRST116 ("no row matched") is a genuine 404; anything else is a query
    // that never ran, which must not be reported as "not found" — see
    // scan-validator.ts's header for why that confusion is dangerous here.
    if (dispatchError && dispatchError.code !== 'PGRST116') {
      console.error('[dispatch/packages DELETE] dispatch lookup failed', dispatchError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo verificar la parada' },
        { status: 500 },
      );
    }
    if (!dispatch) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    // Fail closed: ownsTheOrder (scan-validator.ts) makes the same call in
    // the same situation for the opposite reason — a route that cannot be
    // resolved is refused, not waved through. A `null` embed used to skip
    // this guard entirely and let the removal proceed, which is the wrong
    // default for a check that exists to stop a sealed manifest from quietly
    // losing a stop.
    const route = (Array.isArray(dispatch.routes) ? dispatch.routes[0] : dispatch.routes) as RouteRow | null;
    if (!route || !(REMOVABLE_FROM as readonly string[]).includes(route.status)) {
      return NextResponse.json(
        {
          code: 'ROUTE_SEALED',
          message: route
            ? `El manifiesto ya está sellado (estado: ${route.status}); no se puede quitar una parada.`
            : 'No se pudo verificar el estado de la ruta; no se puede quitar la parada.',
        },
        { status: 409 },
      );
    }

    const { error: delError } = await supabase
      .from('dispatches')
      .update({ deleted_at: new Date().toISOString(), removal_reason: parsed.data.reason })
      .eq('id', dispatchId)
      .eq('operator_id', operatorId);
    if (delError) throw delError;

    if (dispatch.order_id) {
      // 'sectorizado', not 'asignado' — breakage #9. Nothing writes 'asignado'
      // any more; see scan-validator.ts's header comment.
      //
      // spec-79 F4: widened from `.eq('status', 'en_carga')` alone. A route
      // can legally be unsealed `loaded -> loading` (spec-70,
      // 20260825000002:255), and by then its packages already moved to
      // `listo_para_despacho` by /seal (seal-route.ts) without moving back to
      // `en_carga`. Removing a stop only reverted the pre-seal case, so a
      // package removed from an unsealed-then-reopened route stranded at
      // `listo_para_despacho` with no route at all — the same status-scope
      // gap spec-79 H3 found in the dispatch handler
      // (dispatch-local-completion.ts's LOADED_ON_TRUCK_STATUSES).
      //
      // spec-79 review F6: `.is('deleted_at', null)` re-asserted on the
      // write itself, matching the same standard dispatch-local-completion.ts
      // applies to its own en_ruta write — a package soft-deleted during the
      // request should not be resurrected back to `sectorizado`.
      //
      // spec-79 review F7: `loaded_at`/`loaded_by`/`load_inferred` reset here
      // too. Leaving `loaded_at` set with `load_inferred = false` after this
      // write freed the box back to `sectorizado` but left scan-validator.ts's
      // ALREADY_STAGED check (`loaded_at && !load_inferred`) believing it was
      // already scanned — a box removed from route A and re-planned onto
      // route B could never be scanned again, permanently unloadable. This
      // write releases the box, so the per-box load fact must be released
      // with it.
      await supabase
        .from('packages')
        .update({ status: 'sectorizado', loaded_at: null, loaded_by: null, load_inferred: false })
        .eq('operator_id', operatorId)
        .eq('order_id', dispatch.order_id)
        .in('status', [...LOADED_ON_TRUCK_STATUSES])
        .is('deleted_at', null);
    }

    // Audit log — actual audit_logs schema: operator_id, user_id, action,
    // resource_type, resource_id, changes_json, ip_address. Mirrors the shape
    // used in [id]/dispatch/route.ts.
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: session.user.id,
      action: 'remove_from_plan',
      resource_type: 'dispatches',
      resource_id: dispatchId,
      changes_json: {
        route_id: dispatch.route_id,
        order_id: dispatch.order_id,
        reason: parsed.data.reason,
      },
      ip_address: 'unknown',
    }).then(() => null, () => null);

    // spec-71 Decision 7 residual risk: removing a stop changes this route's
    // dispatch set too. Note the direction, though: a removal can only ever
    // SHRINK the set of andenes this route sources from, so this re-check can
    // clear an existing conflict but can never introduce a new one — it is
    // not load-bearing for *detecting* a conflict the way the adopt-scan
    // re-check in [id]/scan/route.ts is (an adopt GROWS the set). It stays
    // here anyway so a route that was conflicting can be observed to clear.
    // Surfaced, not auto-fixed: no reassignment UI here.
    let loadPositionConflict = false;
    if (dispatch.route_id) {
      try {
        // check_load_position_conflict (20260827000003) raises ROUTE_NOT_FOUND
        // rather than returning no row when the route is missing / not this
        // operator's — but supabase-js resolves that as {data: null, error},
        // it does not reject. Checking `error` here (not just discarding it)
        // is what keeps that distinguishable: a missing-route/query failure
        // is logged, not silently coerced into the same `false` a genuine
        // "no conflict" result would produce.
        const { data: conflictResult, error: conflictError } = await supabase.rpc('check_load_position_conflict', {
          p_route_id: dispatch.route_id,
          p_operator_id: operatorId,
        });
        if (conflictError) {
          console.error('[dispatch/packages DELETE] check_load_position_conflict failed', conflictError);
        } else {
          loadPositionConflict = Boolean((conflictResult as { conflict?: boolean } | null)?.conflict);
        }
      } catch (conflictErr) {
        console.error('[dispatch/packages DELETE] check_load_position_conflict threw', conflictErr);
      }
    }

    // No UI consumes load_position_conflict yet — spec-71 phase 5 is
    // expected to surface it for a reassignment flow. Until then it is
    // carried through and logged, not acted on.
    return NextResponse.json({ ok: true, load_position_conflict: loadPositionConflict }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/packages DELETE]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
