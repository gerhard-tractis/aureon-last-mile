import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateScan, DISPATCHABLE_STATUSES } from '@/lib/dispatch/scan-validator';
import type { RouteStatus } from '@/lib/dispatch/types';

const bodySchema = z.object({
  code: z.string().min(1),
  // Only read when the scan turns out to be unplanned. The operator is not
  // asked for it up front — at the dock, a prompt before every scan is a
  // prompt nobody reads.
  reason: z.string().trim().min(1).optional(),
});

/** What an unplanned scan records when the operator offered no explanation. */
const DEFAULT_ADOPTION_REASON = 'Escaneado sin estar en la planificación';

/**
 * Route states in which stops may still be added, and the walk each one needs
 * to reach `loading`.
 *
 * `draft -> loading` is not a legal edge: a manually created empty route has to
 * pass through `planned` first, which is precisely what adding its first stop
 * means. `loaded` and beyond are absent — once the manifest is sealed, a stop
 * appearing out of nowhere is an exception to be handled, not a silent append.
 */
const LOADING_WALK: Record<string, readonly RouteStatus[]> = {
  draft: ['planned', 'loading'],
  planned: ['loading'],
  loading: [],
};

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
      const { error: stageError } = await supabase
        .from('dispatches')
        .update({ stage: 'staged', staged_at: now, staged_by: session.user.id })
        .eq('id', validation.action.dispatchId)
        .eq('operator_id', operatorId);
      if (stageError) throw stageError;
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
    }

    // Whatever state the validator accepted is what has to advance. Filtering
    // on 'asignado' alone would leave a package scanned in from an andén
    // sitting at 'sectorizado' while its dispatch row already said staged.
    await supabase
      .from('packages')
      .update({ status: 'en_carga' })
      .eq('operator_id', operatorId)
      .eq('order_id', validation.package.order_id)
      .in('status', [...DISPATCHABLE_STATUSES]);

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
    }

    return NextResponse.json(
      {
        ...validation.package,
        dispatch_id: dispatchId,
        stage: validation.action.kind === 'stage' ? 'staged' : 'adopted',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dispatch/scan POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
