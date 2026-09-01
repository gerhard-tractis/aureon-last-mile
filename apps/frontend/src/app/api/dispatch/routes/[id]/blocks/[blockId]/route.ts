import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canRemoveFromPlan } from '@/lib/permissions';

const bodySchema = z.object({
  direction: z.enum(['up', 'down']),
});

/**
 * spec-72 phase 3 — the manager reorder writer's HTTP face.
 *
 * Thin wrapper over `move_route_block` (migration
 * 20260903000003_spec72_phase3_reorder_route_block.sql): resolve the
 * session, gate on the same role list as removing a stop from the plan
 * (reordering the delivery sequence is a manager action, per spec-72
 * Decision 2 — `PLAN_MANAGER_ROLES` via `canRemoveFromPlan`, not a new
 * vocabulary), validate the body, then delegate every actual invariant
 * (route/block existence, operator scoping, the edge no-op, the
 * unique-index-safe offset swap) to the RPC itself.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; blockId: string }> },
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
        { code: 'FORBIDDEN', message: 'Solo un responsable puede reordenar la secuencia de entrega.' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Dirección inválida (se espera "up" o "down").' },
        { status: 400 },
      );
    }

    const { id: routeId, blockId } = await params;

    const { error: rpcError } = await supabase.rpc('move_route_block', {
      p_route_id: routeId,
      p_operator_id: operatorId,
      p_block_id: blockId,
      p_direction: parsed.data.direction,
    });

    if (rpcError) {
      // move_route_block (P0002) prefixes its message with the specific
      // reason — ROUTE_NOT_FOUND vs BLOCK_NOT_FOUND — both mapped to 404 so
      // the client can distinguish "route gone" from "block gone" without
      // parsing free text, while nothing else about the raw Postgres error
      // (which can carry internal detail) reaches the response body.
      if (rpcError.code === 'P0002' && rpcError.message?.startsWith('ROUTE_NOT_FOUND')) {
        return NextResponse.json({ code: 'ROUTE_NOT_FOUND' }, { status: 404 });
      }
      if (rpcError.code === 'P0002' && rpcError.message?.startsWith('BLOCK_NOT_FOUND')) {
        return NextResponse.json({ code: 'BLOCK_NOT_FOUND' }, { status: 404 });
      }
      // Review item 1: reordering is only allowed while the route is still
      // in draft/planned/loading (same window packages/[pkgId] DELETE
      // gates on). move_route_block (P0001) prefixes this one distinctly
      // from the P0002 pair above, so it maps to 409 — "exists, but closed
      // for editing" — never 404.
      if (rpcError.code === 'P0001' && rpcError.message?.startsWith('ROUTE_SEALED')) {
        return NextResponse.json(
          { code: 'ROUTE_SEALED', message: 'El manifiesto ya está sellado; no se puede reordenar la secuencia.' },
          { status: 409 },
        );
      }
      console.error('[dispatch/blocks PATCH] move_route_block failed', rpcError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo reordenar el bloque.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/blocks PATCH]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
