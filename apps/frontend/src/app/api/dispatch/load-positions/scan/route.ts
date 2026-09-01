import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validatePositionScan } from '@/lib/dispatch/load-position-scan';
import { stageDispatch, isRouteOpenForLoading } from '@/lib/dispatch/stage-dispatch';

const bodySchema = z.object({
  packageCode: z.string().min(1),
  positionCode: z.string().min(1),
});

/**
 * spec-71 phase 3 — the staging pass's scan endpoint.
 *
 * "Scan package, then scan destination" (spec-68's `useQuickSortFlow`)
 * repointed at a second destination kind: a `load_positions` row instead of
 * a `dock_zones` row. The validation itself — package found, correct
 * status, planned on the route this destination resolves to — is
 * `validatePositionScan`, which reuses spec-70 phase 2's `validateScan`
 * pointed at the route the scanned position resolves to
 * (`load_positions.id -> routes.load_position_id`). This handler is only
 * the write path, mirroring `[id]/scan/route.ts`'s 'stage' branch:
 * `dispatches.stage = 'staged'` (spec-71 Decision 5 — no parallel
 * `load_positions`-side status), the same `packages.status = 'en_carga'`
 * advance, and — new here — a `dock_scans` row carrying
 * `load_position_id` (phase 1's per-package staging audit column;
 * ordinary andén scans never set this column).
 *
 * spec-71 phase 3 review item 5 — the route-level handler 409s
 * `ROUTE_NOT_OPEN` for a sealed/dispatched route before it writes anything;
 * this handler had no equivalent gate at all. Low exploitability in
 * practice (a position only occupies a route that is still open — see
 * `validatePositionScan`'s occupancy predicate — and nothing here advances
 * the route's own status the way the route-level handler's `LOADING_WALK`
 * does), but the absence was accidental, not a deliberate call, so the
 * same guard is added here too, sharing `isRouteOpenForLoading` with the
 * route-level handler's own check.
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

    const validation = await validatePositionScan(supabase, {
      packageCode: parsed.data.packageCode,
      positionCode: parsed.data.positionCode,
      operatorId,
    });

    if (!validation.ok) {
      // Review fix — QUERY_FAILED is not "the scanned code did not resolve",
      // it's a query that never ran to completion; reporting it as the same
      // 422 as a genuine refusal was wrong, and its message carries the raw
      // driver text, which must not reach the client. Logged here instead,
      // matching seal-load-position.ts's own QUERY_FAILED handling.
      if (validation.code === 'QUERY_FAILED') {
        console.error('[dispatch/load-positions/scan POST] position/route resolution query failed', validation.message);
        return NextResponse.json(
          { code: validation.code, message: 'No se pudo validar la posición' },
          { status: 500 },
        );
      }
      return NextResponse.json({ code: validation.code, message: validation.message }, { status: 422 });
    }

    // Review item 5 — the route-status guard [id]/scan/route.ts already
    // has, added here too rather than left accidental. Runs before any
    // write, same as the route-level handler's own gate.
    const { data: route } = await supabase
      .from('routes')
      .select('id, status')
      .eq('id', validation.routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();

    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    if (!isRouteOpenForLoading(route.status)) {
      return NextResponse.json(
        {
          code: 'ROUTE_NOT_OPEN',
          message: `La ruta ya no admite carga (estado: ${route.status})`,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    // The row Pre-ruta/the route-level scan already seeded is updated in
    // place — never a second insert. Exactly [id]/scan/route.ts's 'stage'
    // branch, pointed at the dispatch validatePositionScan resolved.
    const finalStage = await stageDispatch(supabase, {
      dispatchId: validation.dispatchId,
      orderId: validation.package.order_id,
      packageId: validation.packageId,
      operatorId,
      userId: session.user.id,
      // spec-74 phase 2 review item 3 — lets stageDispatch preserve
      // `adopted` instead of overwriting it to `staged`.
      currentStage: validation.currentStage,
    });

    // spec-71 phase 1's per-package staging audit column. batch_id and
    // dock_zone_id are both left unset (nullable — the same
    // manual-override precedent that made dock_scans.batch_id nullable,
    // 20260504000002): this scan has no dock_batches row and did not stage
    // the package onto an andén, so it must not read as one.
    const { error: dockScanError } = await supabase.from('dock_scans').insert({
      operator_id: operatorId,
      package_id: validation.packageId,
      barcode: parsed.data.packageCode,
      scan_result: 'accepted',
      scanned_by: session.user.id,
      scanned_at: now,
      load_position_id: validation.positionId,
    });
    if (dockScanError) throw dockScanError;

    // spec-74 phase 2 review item 3 / phase 3. `finalStage` (above) is now
    // stageDispatch's own return value — the real recompute result
    // ('adopted', 'partially_staged', or 'staged'), not a caller-side guess
    // that predates `partially_staged` and would otherwise still claim
    // `staged` for a scan that left a sibling bulto outstanding.
    return NextResponse.json(
      {
        dispatch_id: validation.dispatchId,
        order_id: validation.package.order_id,
        order_number: validation.package.order_number,
        contact_name: validation.package.contact_name,
        contact_address: validation.package.contact_address,
        contact_phone: validation.package.contact_phone,
        stage: finalStage,
        package_status: 'en_carga',
        position_code: validation.positionCode,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dispatch/load-positions/scan POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
