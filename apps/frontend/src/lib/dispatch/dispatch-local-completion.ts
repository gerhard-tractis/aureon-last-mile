import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { DispatchRow } from '@/lib/dispatch/dispatch-dt-payload';
import { releaseLoadPosition } from '@/lib/dispatch/dispatch-local-release';
import { writeEnRuta } from '@/lib/dispatch/dispatch-en-ruta-write';
import { LOADED_ON_TRUCK_STATUSES, isGenuinelyLoadedPackage } from '@/lib/dispatch/dispatch-load-state';

// Re-exported so every existing import site (dispatch-dt-payload.ts,
// packages/[pkgId]/route.ts, routes/[id]/route.ts) keeps working unchanged —
// spec-79 review F1/F5's shared predicate now lives in dispatch-load-state.ts
// to avoid a circular value import with dispatch-en-ruta-write.ts below.
export { LOADED_ON_TRUCK_STATUSES, isGenuinelyLoadedPackage };

/**
 * spec-79 H3, moved here by review finding 8: which packages actually rode
 * the truck. Feeds the local `en_ruta` write below; has nothing to do with
 * the DT payload (dispatch-dt-payload.ts's own buildItems shares the same
 * predicate — see dispatch-load-state.ts).
 *
 * spec-79 review F4: a `Set`, not a flat array — two live dispatches for the
 * same `order_id` on one route are permitted (20260901000001…:186-190), so
 * the same package embeds twice and produced the same id twice here.
 * `.in('id', [x, x])` still returns one row, so the array shape reported
 * "expected 2 / updated 1" and tripped the F2 mismatch alarm on a healthy
 * write, doubling `packages_dispatched`.
 *
 * Corrected claim: this does NOT prove "scanned onto THIS route" — `packages`
 * carries no route linkage (lib/types.ts) and `loaded_at`/`loaded_by` record
 * none either. It proves only "a real scan put this box on *a* truck"; a box
 * scanned onto route A whose order also carries a dispatch on route B is
 * included in route B's set too.
 */
export function loadedPackageIds(dispatches: DispatchRow[]): string[] {
  const ids = new Set<string>();
  for (const d of dispatches) {
    const order = Array.isArray(d.orders) ? (d.orders[0] ?? null) : d.orders;
    const pkgs = order?.packages ?? [];
    for (const p of pkgs) {
      if (isGenuinelyLoadedPackage(p)) ids.add(p.id);
    }
  }
  return [...ids];
}

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
  /**
   * spec-79 review F3: true when this call is the sanctioned retry after
   * `DT_ACCEPTED_LOCAL_FAILED` (route.ts skipped calling DT again because
   * `external_route_id` was already persisted). On that path the packages
   * were already written to `en_ruta` on the attempt that got this far, so
   * `loadedPackageIds` is legitimately empty here — not a sign anything is
   * wrong, and the zero-loaded warn must not fire for it.
   */
  isRetry: boolean;
}

export interface CompleteLocalDispatchResult {
  /**
   * spec-79 review F2: how many packages the `en_ruta` UPDATE actually
   * touched, not how many were requested. `route.ts`'s
   * `packages_dispatched` response field must report this, never
   * `loadedPackageIds.length` — the whole point of the TOCTOU guard is that
   * those two numbers can legitimately differ.
   */
  dispatchedCount: number;
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
 * it can't. The `en_ruta` write (`writeEnRuta`, dispatch-en-ruta-write.ts)
 * runs BEFORE `transition_route_status` for the same reason its own header
 * explains: a failure there must leave the route retryable, not stranded
 * behind this handler's own `status !== 'loaded'` 409 guard.
 */
export async function completeLocalDispatch(
  params: CompleteLocalDispatchParams,
): Promise<CompleteLocalDispatchResult> {
  const { supabase, routeId, operatorId, userId, externalRouteId, vehicleId, driverIdentifier,
    loadPositionId, loadedPackageIds, dispatchCount, truckIdentifier, isRetry } = params;

  // spec-79 H5: this clobbers whatever driver_name the crew already saved at
  // assignment time (spec-76 2d) with a DT identifier, or null when none is
  // sent. Out of scope for this review pass — see spec-79 H5a. Left as a
  // marker so the next reader doesn't have to re-find it.
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

  let dispatchedCount: number;
  try {
    dispatchedCount = await writeEnRuta({ supabase, routeId, operatorId, userId, loadedPackageIds, isRetry });
  } catch (packagesError) {
    throw new DtAcceptedLocalFailedError(externalRouteId, packagesError);
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

  return { dispatchedCount };
}

/**
 * spec-79 H2/phase 3, moved here from route.ts (F6: that file was one line
 * under its 300-line cap). Its own audit_logs action, distinct from
 * `dispatch_route` and `dispatch_failed`, carrying `external_route_id` so
 * the route is reconcilable against DT even though our local record of it
 * is incomplete. Best-effort — a failure here must not turn a
 * DT_ACCEPTED_LOCAL_FAILED response into an unhandled 500.
 *
 * spec-79 review finding 2: supabase-js RESOLVES `{data, error}` on a DB
 * rejection, it does not reject the promise — a try/catch around the
 * `.insert()` alone never sees an RLS violation, constraint failure, or
 * timeout. This row is the only local trace of a route that exists at
 * DispatchTrack, so its own error must be checked and logged, not just
 * whatever the call throws.
 */
export async function logAcceptedLocalFailed(
  supabase: SupabaseClient<Database>,
  operatorId: string,
  userId: string,
  routeId: string,
  err: DtAcceptedLocalFailedError,
): Promise<void> {
  try {
    const { error: insertError } = await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'dispatch_accepted_local_failed',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: {
        external_route_id: err.externalRouteId,
        local_error: String(err.cause),
      },
      ip_address: 'unknown',
    });
    if (insertError) {
      console.error('[dispatch/dispatch POST] dispatch_accepted_local_failed audit insert failed', {
        externalRouteId: err.externalRouteId,
        insertError,
      });
    }
  } catch (auditErr) {
    console.error('[dispatch/dispatch POST] dispatch_accepted_local_failed audit insert threw', auditErr);
  }
}
