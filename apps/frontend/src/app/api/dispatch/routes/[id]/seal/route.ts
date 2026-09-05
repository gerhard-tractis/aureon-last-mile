import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sealRoute } from '@/lib/dispatch/seal-route';
import { FORCE_SEAL_REASON_CODES } from '@/lib/dispatch/force-seal-reasons';

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
 *
 * spec-77 — an optional body now carries the force path: `{ force: true,
 * reason_code, note? }`. Absent or `force: false`, behaviour is byte-for-byte
 * what it always was — `sealRoute` itself defaults `force` to `false`. This
 * is deliberately NOT gated by `canRemoveFromPlan` (`lib/permissions.ts`):
 * the crew is exactly who spec-70 decision 3 denied that door to, and the
 * user's decision here is that accountability comes from the recorded
 * reason, not from a role check.
 */
const bodySchema = z
  .object({
    force: z.boolean().optional(),
    reason_code: z.enum(FORCE_SEAL_REASON_CODES).optional(),
    note: z.string().trim().optional(),
  })
  .refine((b) => b.reason_code !== 'otro' || (b.note && b.note.length > 0), {
    message: 'Se requiere una nota cuando el motivo es "otro".',
    path: ['note'],
  })
  .optional();

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

    // No body is the common case (the button at the dock, no payload) — a
    // JSON parse failure on an empty request must not be reported as a
    // validation error against a body nobody sent.
    const rawBody = await request.json().catch(() => undefined);
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Cuerpo inválido.' },
        { status: 400 },
      );
    }

    const { id: routeId } = await params;

    const result = await sealRoute(supabase, {
      routeId,
      operatorId,
      force: parsed.data?.force ?? false,
      forceReasonCode: parsed.data?.reason_code,
      forceNote: parsed.data?.note,
      userId: session.user.id,
    });

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
      {
        ok: true,
        sealed_stops: result.sealed_stops,
        orders_closed: result.orders_closed,
        ...(result.forced ? { forced: result.forced } : {}),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[dispatch/seal POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
