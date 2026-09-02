import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canRemoveFromPlan } from '@/lib/permissions';

const bodySchema = z.object({
  donor_route_id: z.string().uuid(),
  comuna_id: z.string().uuid(),
  reason: z.string().trim().min(1),
});

/**
 * spec-73 phase 4 — accept a top-up suggestion.
 *
 * Thin wrapper over `accept_topup_block` (migration
 * 20260906000001_spec73_phase4_topup_suggestions.sql), which is where every
 * Decision 5/6 rule is actually enforced (re-checked under row locks against
 * fresh state, never trusting the GET .../topup suggestion this call is
 * presumably following). This endpoint's only job is auth, the manager gate,
 * body validation, and translating the RPC's domain errors into HTTP status
 * codes — same shape as every sibling route in this family
 * (packages/[pkgId] DELETE, blocks/[blockId] PATCH).
 *
 * `[id]` in the URL is the RECEIVING route (the under-filled one accepting a
 * top-up) — consistent with every other route in this `[id]` family being
 * scoped to "the route this URL is about".
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
        { code: 'FORBIDDEN', message: 'Solo un responsable puede aceptar un relleno de camión.' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          message: 'Se requiere donor_route_id, comuna_id y un motivo para aceptar el relleno.',
        },
        { status: 400 },
      );
    }

    const { id: receivingRouteId } = await params;

    const { data, error: rpcError } = await supabase.rpc('accept_topup_block', {
      p_receiving_route_id: receivingRouteId,
      p_donor_route_id: parsed.data.donor_route_id,
      p_comuna_id: parsed.data.comuna_id,
      p_operator_id: operatorId,
      p_user_id: session.user.id,
      p_reason: parsed.data.reason,
    });

    if (rpcError) {
      if (rpcError.code === 'P0002' && rpcError.message?.startsWith('ROUTE_NOT_FOUND')) {
        return NextResponse.json({ code: 'ROUTE_NOT_FOUND' }, { status: 404 });
      }
      if (rpcError.code === 'P0002' && rpcError.message?.startsWith('BLOCK_NOT_FOUND')) {
        return NextResponse.json({ code: 'BLOCK_NOT_FOUND' }, { status: 404 });
      }
      // Every other domain rule (donor not raidable, receiving not
      // loadable, already has a top-up, at max_drops, not adjacent, over
      // the ~25% cap, missing reason) is a 409 — the request is well-formed
      // and both routes exist, but the move is refused by a business rule,
      // never a 4xx that implies the client sent something malformed.
      const P0001_CODES: Record<string, string> = {
        DONOR_ROUTE_NOT_RAIDABLE: 'DONOR_ROUTE_NOT_RAIDABLE',
        RECEIVING_ROUTE_NOT_LOADABLE: 'RECEIVING_ROUTE_NOT_LOADABLE',
        ALREADY_HAS_TOPUP: 'ALREADY_HAS_TOPUP',
        AT_MAX_DROPS: 'AT_MAX_DROPS',
        NOT_ADJACENT: 'NOT_ADJACENT',
        OVER_TOPUP_CAP: 'OVER_TOPUP_CAP',
        // Review fix (Decision 5.5): the block is already being loaded onto
        // its own donor's truck, so it can no longer be moved by a scan.
        BLOCK_ALREADY_STAGED: 'BLOCK_ALREADY_STAGED',
      };
      const matchedCode = Object.keys(P0001_CODES).find((code) => rpcError.message?.startsWith(code));
      if (matchedCode) {
        return NextResponse.json({ code: matchedCode }, { status: 409 });
      }
      if (rpcError.message?.startsWith('REASON_REQUIRED')) {
        return NextResponse.json({ code: 'REASON_REQUIRED' }, { status: 400 });
      }
      // Review fix (security): the RPC now carries the manager gate itself
      // (`GRANT EXECUTE ... TO authenticated` means PostgREST exposes it
      // past this handler). A 42501 from it is the same refusal the role
      // check above makes, reached by a caller that never came through
      // here — surfaced as the same 403 rather than an opaque 500.
      if (rpcError.code === '42501' || rpcError.message?.startsWith('FORBIDDEN')) {
        return NextResponse.json(
          { code: 'FORBIDDEN', message: 'Solo un responsable puede aceptar un relleno de camión.' },
          { status: 403 },
        );
      }
      // A malformed move the client should not retry unchanged.
      if (rpcError.message?.startsWith('INVALID_TOPUP')) {
        return NextResponse.json({ code: 'INVALID_TOPUP' }, { status: 400 });
      }
      console.error('[dispatch/topup/accept POST] accept_topup_block failed', rpcError);
      return NextResponse.json(
        { code: 'QUERY_FAILED', message: 'No se pudo aceptar el relleno.' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('[dispatch/topup/accept POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
