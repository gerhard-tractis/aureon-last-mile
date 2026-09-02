import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { canRemoveFromPlan } from '@/lib/permissions';

/**
 * spec-73 phase 4 — top-up candidate suggestions.
 *
 * Thin wrapper over `get_topup_candidates` (migration
 * 20260906000001_spec73_phase4_topup_suggestions.sql). Same manager gate as
 * every other plan-shaping action in this route family (removal, reorder,
 * adjacency management) — `PLAN_MANAGER_ROLES` via `canRemoveFromPlan` — a
 * top-up suggestion is presentation, but accepting one shapes the plan, and
 * this project's convention is to gate the read alongside the write rather
 * than let a non-manager see an action they cannot take.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
        { code: 'FORBIDDEN', message: 'Solo un responsable puede ver sugerencias de relleno.' },
        { status: 403 },
      );
    }

    const { id: routeId } = await params;

    const { data, error: rpcError } = await supabase.rpc('get_topup_candidates', {
      p_route_id: routeId,
      p_operator_id: operatorId,
    });

    if (rpcError) {
      if (rpcError.code === 'P0002' && rpcError.message?.startsWith('ROUTE_NOT_FOUND')) {
        return NextResponse.json({ code: 'ROUTE_NOT_FOUND' }, { status: 404 });
      }
      console.error('[dispatch/topup GET] get_topup_candidates failed', rpcError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudieron calcular sugerencias de relleno.' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('[dispatch/topup GET]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
