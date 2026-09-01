import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { canRemoveFromPlan } from '@/lib/permissions';

/**
 * spec-72 phase 3 review item 2 — the writer half of the orphan-surfacing
 * fix. `useRouteBlocks` (and `RouteBlockList`) already surface every order
 * whose comuna has no live block as an `orphan` row; until this endpoint,
 * there was no path to actually sequence one — an empty-draft route or a
 * route with scan-adopted orders rendered zero blocks and N orphans with no
 * button and no way to close the gap. This is a thin wrapper over
 * `seed_default_route_blocks` (migration 20260903000005), made re-runnable
 * for exactly this purpose: called again on an already-seeded route, it
 * APPENDS a block for every comuna with a live dispatch and no live block,
 * at `MAX(sequence_index) + 1..`, without touching any existing row
 * (manual or default).
 *
 * Same manager gate as the reorder endpoint (`blocks/[blockId]/route.ts`)
 * — `canRemoveFromPlan` / `PLAN_MANAGER_ROLES`, spec-72 Decision 2 — and the
 * same ROUTE_SEALED (P0001 -> 409) / ROUTE_NOT_FOUND (P0002 -> 404) mapping,
 * since the RPC enforces the identical draft/planned/loading window.
 */
export async function POST(
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
        { code: 'FORBIDDEN', message: 'Solo un responsable puede agregar órdenes a la secuencia.' },
        { status: 403 },
      );
    }

    const { id: routeId } = await params;

    const { error: rpcError } = await supabase.rpc('seed_default_route_blocks', {
      p_route_id: routeId,
      p_operator_id: operatorId,
    });

    if (rpcError) {
      if (rpcError.code === 'P0002' && rpcError.message?.startsWith('ROUTE_NOT_FOUND')) {
        return NextResponse.json({ code: 'ROUTE_NOT_FOUND' }, { status: 404 });
      }
      if (rpcError.code === 'P0001' && rpcError.message?.startsWith('ROUTE_SEALED')) {
        return NextResponse.json(
          { code: 'ROUTE_SEALED', message: 'El manifiesto ya está sellado; no se pueden agregar bloques.' },
          { status: 409 },
        );
      }
      console.error('[dispatch/blocks POST] seed_default_route_blocks failed', rpcError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo agregar a la secuencia.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/blocks POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
