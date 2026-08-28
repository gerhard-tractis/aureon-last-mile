import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { sealRoute } from '@/lib/dispatch/seal-route';

/**
 * Seal the manifest.
 *
 * This replaces `/close`, which was not a state at all: it advanced package
 * rows and returned, while "closed" lived in a React `useState` that a page
 * reload wiped. `/dispatch` then only required `draft`, so closing was
 * decorative.
 *
 * Sealing is where spec-70 decision 2 is enforced. **A plan is a commitment**:
 * the seal refuses while any stop is still merely `planned`. There is no
 * auto-release — a stop the manager did not explicitly remove has to go on the
 * truck. The refusal names the offending orders, because a refusal an operator
 * cannot act on is worse than none.
 *
 * spec-71 phase 4 — the guard/write logic now lives in `sealRoute`
 * (`lib/dispatch/seal-route.ts`), shared with the position-level seal
 * (`load-positions/seal/route.ts`): sealing a position IS sealing the route
 * that occupies it, the same event, not a parallel one (Decision 3/5). This
 * handler is only auth + params + turning the result into a response —
 * behaviour is unchanged from before the extraction.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;

    const result = await sealRoute(supabase, { routeId, operatorId });

    if (!result.ok) {
      const body: Record<string, unknown> = { code: result.code };
      if (result.message !== undefined) body.message = result.message;
      if (result.pending_count !== undefined) body.pending_count = result.pending_count;
      if (result.pending !== undefined) body.pending = result.pending;
      return NextResponse.json(body, { status: result.status });
    }

    if (result.already_sealed) {
      return NextResponse.json({ ok: true, already_sealed: true }, { status: 200 });
    }

    return NextResponse.json(
      { ok: true, sealed_stops: result.sealed_stops, orders_closed: result.orders_closed },
      { status: 200 },
    );
  } catch (err) {
    console.error('[dispatch/seal POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
