import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canRemoveFromPlan } from '@/lib/permissions';

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

    const { data: dispatch } = await supabase
      .from('dispatches')
      .select('id, order_id, route_id, routes(status)')
      .eq('id', dispatchId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (!dispatch) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    const route = (Array.isArray(dispatch.routes) ? dispatch.routes[0] : dispatch.routes) as RouteRow | null;
    if (route && !(REMOVABLE_FROM as readonly string[]).includes(route.status)) {
      return NextResponse.json(
        {
          code: 'ROUTE_SEALED',
          message: `El manifiesto ya está sellado (estado: ${route.status}); no se puede quitar una parada.`,
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
      await supabase
        .from('packages')
        .update({ status: 'sectorizado' })
        .eq('operator_id', operatorId)
        .eq('order_id', dispatch.order_id)
        .eq('status', 'en_carga');
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

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/packages DELETE]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
