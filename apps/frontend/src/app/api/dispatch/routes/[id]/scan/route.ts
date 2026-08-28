import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateScan } from '@/lib/dispatch/scan-validator';
import { stageDispatch, advancePackagesToEnCarga, LOADING_WALK } from '@/lib/dispatch/stage-dispatch';

const bodySchema = z.object({
  code: z.string().min(1),
  // Only read when the scan turns out to be unplanned. The operator is not
  // asked for it up front — at the dock, a prompt before every scan is a
  // prompt nobody reads.
  reason: z.string().trim().min(1).optional(),
});

/** What an unplanned scan records when the operator offered no explanation. */
const DEFAULT_ADOPTION_REASON = 'Escaneado sin estar en la planificación';

// `LOADING_WALK` (route states in which stops may still be added, and the
// walk each one needs to reach `loading`) now lives in
// `lib/dispatch/stage-dispatch.ts`, shared with the position-scan handler's
// route-status guard (review item 5) instead of a second local copy here.
//
// `draft -> loading` is not a legal edge: a manually created empty route has to
// pass through `planned` first, which is precisely what adding its first stop
// means. `loaded` and beyond are absent — once the manifest is sealed, a stop
// appearing out of nowhere is an exception to be handled, not a silent append.

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

    // The route gate runs before the scan lookup, so a sealed or dispatched
    // route costs one query rather than four and the operator gets the reason
    // that actually applies.
    const { data: route } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    const walk = LOADING_WALK[route.status];
    if (walk === undefined) {
      return NextResponse.json(
        {
          code: 'ROUTE_NOT_OPEN',
          // RouteBuilder surfaces `message` verbatim.
          message: `La ruta ya no admite carga (estado: ${route.status})`,
        },
        { status: 409 },
      );
    }

    const validation = await validateScan(supabase, { code: parsed.data.code, routeId, operatorId });
    if (!validation.ok) {
      return NextResponse.json({ code: validation.code, message: validation.message }, { status: 422 });
    }

    const now = new Date().toISOString();
    let dispatchId: string;

    if (validation.action.kind === 'stage') {
      // The row Pre-ruta seeded is updated in place. Inserting a second row
      // here is what made the plan and the load indistinguishable.
      await stageDispatch(supabase, {
        dispatchId: validation.action.dispatchId,
        orderId: validation.package.order_id,
        operatorId,
        userId: session.user.id,
      });
      dispatchId = validation.action.dispatchId;
    } else {
      const { data: inserted, error: adoptError } = await supabase
        .from('dispatches')
        .insert({
          operator_id: operatorId,
          route_id: routeId,
          order_id: validation.package.order_id,
          provider: 'dispatchtrack',
          status: 'pending',
          stage: 'adopted',
          staged_at: now,
          staged_by: session.user.id,
          adopted_reason: parsed.data.reason ?? DEFAULT_ADOPTION_REASON,
        })
        .select('id')
        .single();
      if (adoptError) throw adoptError;
      dispatchId = inserted.id;

      // `stageDispatch` above bundles this same advance with its dispatch
      // update; the adopt branch INSERTs instead, so it takes just this half.
      await advancePackagesToEnCarga(supabase, { operatorId, orderId: validation.package.order_id });
    }

    // planned_stops is deliberately not touched. It drifted precisely because
    // this handler incremented it while removal never decremented; spec-70
    // derives the counts from the route_stop_counts view instead.
    for (const to of walk) {
      const { error: transitionError } = await supabase.rpc('transition_route_status', {
        p_route_id: routeId,
        p_operator_id: operatorId,
        p_to_status: to,
      });
      if (transitionError) throw transitionError;

      // spec-71 Decision 8: a route reaching `planned` here (the draft ->
      // planned leg of the walk, taken on a manually created empty route's
      // first stop) gets the same best-effort load-position assignment
      // create_seeded_route's caller gets. No position free is not an error.
      if (to === 'planned') {
        try {
          const { data: assignedPositionId, error: assignError } = await supabase.rpc('assign_load_position', {
            p_route_id: routeId,
            p_operator_id: operatorId,
            p_user_id: session.user.id,
          });
          if (assignError) {
            console.error('[dispatch/scan POST] assign_load_position failed', assignError);
          } else if (assignedPositionId) {
            await supabase.from('audit_logs').insert({
              operator_id: operatorId,
              user_id: session.user.id,
              action: 'assign_load_position',
              resource_type: 'routes',
              resource_id: routeId,
              changes_json: { load_position_id: assignedPositionId },
              ip_address: 'unknown',
            }).then(() => null, () => null);
          }
        } catch (assignErr) {
          console.error('[dispatch/scan POST] assign_load_position threw', assignErr);
        }
      }
    }

    // spec-71 Decision 7 residual risk: an adopted scan just changed this
    // route's dispatch set, which can introduce a new source andén that
    // conflicts with its already-assigned position. The `stage` path does
    // not change the dispatch set (it updates a row already counted), so it
    // is not re-checked. Surfaced, not auto-fixed — no reassignment UI here.
    let loadPositionConflict = false;
    if (validation.action.kind === 'adopt') {
      try {
        // check_load_position_conflict (20260827000003) raises ROUTE_NOT_FOUND
        // rather than returning no row when the route is missing / not this
        // operator's — but supabase-js resolves that as {data: null, error},
        // it does not reject. Checking `error` here (not just discarding it)
        // is what keeps that distinguishable: a missing-route/query failure
        // is logged, not silently coerced into the same `false` a genuine
        // "no conflict" result would produce.
        const { data: conflictResult, error: conflictError } = await supabase.rpc('check_load_position_conflict', {
          p_route_id: routeId,
          p_operator_id: operatorId,
        });
        if (conflictError) {
          console.error('[dispatch/scan POST] check_load_position_conflict failed', conflictError);
        } else {
          loadPositionConflict = Boolean((conflictResult as { conflict?: boolean } | null)?.conflict);
        }
      } catch (conflictErr) {
        console.error('[dispatch/scan POST] check_load_position_conflict threw', conflictErr);
      }
    }

    return NextResponse.json(
      {
        ...validation.package,
        dispatch_id: dispatchId,
        stage: validation.action.kind === 'stage' ? 'staged' : 'adopted',
        // The validator can't honestly claim this — see ScanResult.package's
        // Omit — but by here the update above has just written it.
        package_status: 'en_carga',
        // No UI consumes this yet — spec-71 phase 5 is expected to surface it
        // for a reassignment flow. Until then it is carried through and
        // logged, not acted on.
        load_position_conflict: loadPositionConflict,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dispatch/scan POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
