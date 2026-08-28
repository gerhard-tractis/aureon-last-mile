import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sealLoadPosition } from '@/lib/dispatch/seal-load-position';

const bodySchema = z.object({
  positionCode: z.string().min(1),
});

/**
 * spec-71 phase 4 — the position seal.
 *
 * One scan/tap per position, refusing while any dispatch on the route
 * occupying it is still `stage='planned'` — the position-level analogue of
 * spec-70's `/seal` `UNSEALED_STOPS` guard (Decision 3). All of the guard,
 * write, and idempotency logic lives in `sealLoadPosition`, which resolves
 * the scanned code to its occupying route and calls the exact same
 * `sealRoute` the route-level `/seal` endpoint calls — sealing a position
 * IS sealing the route occupying it (Decision 4/5: one position hosts at
 * most one live route, so there is no second "is this loaded" fact to
 * record). This handler is only auth + body parsing + turning the result
 * into a response, mirroring `[id]/seal/route.ts` and
 * `load-positions/scan/route.ts`.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const result = await sealLoadPosition(supabase, {
      positionCode: parsed.data.positionCode,
      operatorId,
    });

    if (!result.ok) {
      const responseBody: Record<string, unknown> = { code: result.code };
      if (result.message !== undefined) responseBody.message = result.message;
      if (result.pending_count !== undefined) responseBody.pending_count = result.pending_count;
      if (result.pending !== undefined) responseBody.pending = result.pending;
      return NextResponse.json(responseBody, { status: result.status });
    }

    if (result.already_sealed) {
      return NextResponse.json(
        { ok: true, already_sealed: true, position_code: result.positionCode },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        already_sealed: false,
        sealed_stops: result.sealed_stops,
        orders_closed: result.orders_closed,
        position_code: result.positionCode,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[dispatch/load-positions/seal POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
