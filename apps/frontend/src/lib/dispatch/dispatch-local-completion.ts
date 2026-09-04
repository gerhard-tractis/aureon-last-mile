import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/**
 * spec-79 H2 / phase 3. Thrown by {@link completeLocalDispatch} for any of
 * the writes that MUST succeed once DispatchTrack has confirmed the route
 * (persisting `external_route_id`, `transition_route_status`, the scoped
 * `packages` update). `externalRouteId` travels with it so the caller can
 * log it and hand it back to the operator — DT already has this route; the
 * only open question is whether our own record of it is complete.
 *
 * Deliberately NOT thrown by the best-effort steps (`release_load_position`,
 * its sweep, either's `audit_logs` row) — those already swallow their own
 * errors, unchanged from before this spec, and must stay that way: hardening
 * them would fail dispatches over work that was always advisory.
 */
export class DtAcceptedLocalFailedError extends Error {
  constructor(public readonly externalRouteId: string, public readonly cause: unknown) {
    super('DispatchTrack accepted the route but a required local write failed');
    this.name = 'DtAcceptedLocalFailedError';
  }
}

export interface CompleteLocalDispatchParams {
  supabase: SupabaseClient<Database>;
  routeId: string;
  operatorId: string;
  userId: string;
  externalRouteId: string;
  vehicleId: string;
  driverIdentifier: string | null;
  loadPositionId: string | null;
  loadedPackageIds: string[];
  dispatchCount: number;
  truckIdentifier: string;
}

/**
 * Every local write spec-79 requires once DT has confirmed a route —
 * whether that confirmation just happened or was persisted on an earlier,
 * partially-failed attempt (the retry path in `route.ts`, which skips
 * calling DT again and comes straight here).
 *
 * Order matters (spec-79 Decision 2): `external_route_id` is persisted
 * FIRST, before any other local write, because it is the only proof DT
 * accepted. Everything after it can fail and still be reconciled — losing
 * it can't.
 */
export async function completeLocalDispatch(params: CompleteLocalDispatchParams): Promise<void> {
  const { supabase, routeId, operatorId, userId, externalRouteId, vehicleId, driverIdentifier,
    loadPositionId, loadedPackageIds, dispatchCount, truckIdentifier } = params;

  const { error: persistError } = await supabase
    .from('routes')
    .update({
      external_route_id: externalRouteId,
      vehicle_id: vehicleId,
      driver_name: driverIdentifier ?? null,
    })
    .eq('id', routeId)
    .eq('operator_id', operatorId);
  if (persistError) throw new DtAcceptedLocalFailedError(externalRouteId, persistError);

  // spec-79 H3: scoped to the boxes actually on the truck (`en_carga`), not
  // every package of every dispatched order. A route with nothing in
  // `en_carga` (shouldn't happen for a `loaded` route, but defensively)
  // skips the write rather than sending an empty `.in()`.
  //
  // Deliberately BEFORE transition_route_status: this is a must-succeed
  // write (spec-79 phase 2), and transition_route_status is what flips
  // `routes.status` away from `loaded` — the handler's own guard then 409s
  // any further attempt at this route (spec-79 phase 0, finding 2). Running
  // the packages write first means a failure here still leaves the route
  // retryable through the normal external_route_id-skips-DT path; putting it
  // after transition would strand a failed write behind a 409 no retry can
  // reach.
  if (loadedPackageIds.length) {
    const { error: packagesError } = await supabase
      .from('packages')
      .update({ status: 'en_ruta' })
      .eq('operator_id', operatorId)
      .in('id', loadedPackageIds);
    if (packagesError) throw new DtAcceptedLocalFailedError(externalRouteId, packagesError);
  }

  // The status change goes through the state machine, not a raw UPDATE — the
  // RPC is the one place that owns which edges are legal, and `loaded ->
  // dispatched` is the only one this handler is allowed to take. This is the
  // last must-succeed write and the one true point of no return: once it
  // succeeds, spec-79 phase 0 finding 2 established there is no remaining
  // duplicate-creation risk, because every step after this is best-effort.
  const { error: transitionError } = await supabase.rpc('transition_route_status', {
    p_route_id: routeId,
    p_operator_id: operatorId,
    p_to_status: 'dispatched',
  });
  if (transitionError) throw new DtAcceptedLocalFailedError(externalRouteId, transitionError);

  await releaseLoadPosition(supabase, { routeId, operatorId, userId, loadPositionId });

  // Audit log — actual audit_logs schema: operator_id, user_id, action,
  // resource_type, resource_id, changes_json, ip_address. Best-effort, like
  // every other audit row in this flow — it records the dispatch, it doesn't
  // gate it.
  await supabase.from('audit_logs').insert({
    operator_id: operatorId,
    user_id: userId,
    action: 'dispatch_route',
    resource_type: 'routes',
    resource_id: routeId,
    changes_json: {
      external_route_id: externalRouteId,
      packages_count: dispatchCount,
      truck_identifier: truckIdentifier,
    },
    ip_address: 'unknown',
  }).then(() => null, () => null);
}

interface ReleaseParams {
  routeId: string;
  operatorId: string;
  userId: string;
  loadPositionId: string | null;
}

/**
 * spec-71 Decision 8: release happens at `dispatched`. Best-effort in the
 * sense that a route with no position (never assigned one) has nothing to
 * release — release_load_position is itself idempotent, but skipping the
 * call entirely when there is nothing to do avoids a pointless RPC
 * round-trip and a misleading audit_logs row. Unchanged by spec-79: this
 * whole block already swallowed its errors, and spec-79 phase 3 requires it
 * stay that way.
 */
async function releaseLoadPosition(
  supabase: SupabaseClient<Database>,
  { routeId, operatorId, userId, loadPositionId }: ReleaseParams,
): Promise<void> {
  if (!loadPositionId) return;

  try {
    const { error: releaseError } = await supabase.rpc('release_load_position', {
      p_route_id: routeId,
      p_operator_id: operatorId,
      p_user_id: userId,
    });
    if (releaseError) {
      console.error('[dispatch/dispatch POST] release_load_position failed', releaseError);
      return;
    }

    // changes_json carries the before/after of the release itself (Decision
    // 4: load_position_id is LEFT SET, only the released_at/_by pair moves
    // from unset to stamped).
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'release_load_position',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        load_position_id: loadPositionId,
        previous_state: 'occupied',
        new_state: 'released',
      },
      ip_address: 'unknown',
    }).then(() => null, () => null);

    // spec-71 phase 2's own bullet: a route left at load_position_id NULL is
    // "assigned a position later, whenever one is released." This release
    // just freed one, so sweep this operator's other routes that missed out
    // earlier — sweep_load_position_assignments does the scan/assign loop in
    // one round-trip, bounded and oldest-created-first. Best-effort like
    // every other call in this block — never fails the dispatch request.
    try {
      const { data: sweepResults, error: sweepError } = await supabase.rpc(
        'sweep_load_position_assignments',
        { p_operator_id: operatorId, p_user_id: userId },
      );
      if (sweepError) {
        console.error('[dispatch/dispatch POST] sweep_load_position_assignments failed', sweepError);
        return;
      }
      if (Array.isArray(sweepResults) && sweepResults.length) {
        // One audit_logs row per assignment the sweep actually made, exactly
        // like the existing assign_load_position call sites.
        await Promise.all(
          (sweepResults as { route_id: string; load_position_id: string }[]).map((swept) =>
            supabase.from('audit_logs').insert({
              operator_id: operatorId,
              user_id: userId,
              action: 'assign_load_position',
              resource_type: 'routes',
              resource_id: swept.route_id,
              changes_json: { load_position_id: swept.load_position_id, via: 'sweep_after_release' },
              ip_address: 'unknown',
            }).then(() => null, () => null),
          ),
        );
      }
    } catch (sweepErr) {
      console.error('[dispatch/dispatch POST] sweep_load_position_assignments threw', sweepErr);
    }
  } catch (releaseErr) {
    // The route has already transitioned to `dispatched` (and DT already
    // has it); a release failure must not surface as a dispatch failure.
    console.error('[dispatch/dispatch POST] release_load_position threw', releaseErr);
  }
}
