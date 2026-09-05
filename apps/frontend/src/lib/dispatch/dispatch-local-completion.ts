import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { DispatchRow } from '@/lib/dispatch/dispatch-dt-payload';
import { releaseLoadPosition } from '@/lib/dispatch/dispatch-local-release';

/**
 * Package statuses a box passes through while genuinely on the truck:
 * `en_carga` (just scanned, pre-seal) or `listo_para_despacho` (post-seal —
 * /seal moves every staged package to this status, seal-route.ts:284-288).
 * Shared with the write below so the SELECT-time filter and the UPDATE's own
 * source-status guard (spec-79 review F2) can never drift apart.
 */
export const LOADED_ON_TRUCK_STATUSES = ['en_carga', 'listo_para_despacho'] as const;

/**
 * spec-79 H3, moved here by review finding 8: which packages actually rode
 * the truck. This has nothing to do with the DT payload (dispatch-dt-payload.ts)
 * — it feeds the local `en_ruta` write below.
 *
 * Review finding 1 (CRITICAL): the only way a route reaches `loaded` is
 * /seal, and /seal moves every staged package OFF `en_carga` to
 * `listo_para_despacho` (seal-route.ts:284-288) before it flips
 * routes.status. Filtering on `en_carga` alone therefore matched NOTHING at
 * dispatch time — the premise "a loaded bulto is en_carga" is true when
 * /scan writes it, and already stale by the time /dispatch reads it. Both
 * statuses must be scoped in. A package still `asignado` (never scanned) or
 * `retenido` (held back in consolidation) must not be counted here, or it
 * will be written to `en_ruta` alongside boxes that never left the dock.
 *
 * spec-79 review F1 (CRITICAL, second pass): `status` alone is not enough,
 * because `listo_para_despacho` is not exclusively a post-seal marker — it
 * is ALSO the legacy dock-ready-but-unloaded status a package sits in before
 * ever being scanned (scan-validator.ts's DISPATCHABLE_STATUSES, and the
 * unrouted dock-ready cohort in 20260907000001). What makes a box's status
 * trustworthy here is spec-74's per-box load fact, not the status string:
 * `loaded_at` set AND `load_inferred` false means a real scan
 * (stage-dispatch.ts) put THIS box on THIS route. `load_inferred = true`
 * means spec-74's one-time migration backfilled loaded_at onto EVERY live
 * package of an already-staged/adopted order — including a sibling that
 * never left the dock, because no per-box evidence exists for legacy data
 * (20260901000001's own header says as much). Treating an inferred row as
 * loaded here would revive exactly the corruption this function exists to
 * prevent, just moved one migration later.
 *
 * The cost is real and deliberate: a route that was already `loaded` before
 * spec-74's app layer shipped, and whose packages were never re-scanned,
 * produces zero genuinely-loaded packages here forever — its boxes stay
 * `load_inferred = true` with no further write path to flip that. That is a
 * false negative (packages_dispatched undercounts, a `loaded` route that
 * dispatches with nothing marked en_ruta), not a false positive (a box on
 * the andén marked en_ruta). Between the two, only the false positive
 * corrupts data an operator relies on, so it is the one this function
 * refuses to produce. If any such pre-spec-74 sealed-but-undispatched routes
 * still exist in production, they need a one-time operational reconciliation
 * — a product decision, not a code change — and the warn below is what
 * surfaces them instead of letting them dispatch silently with 0 packages.
 */
export function loadedPackageIds(dispatches: DispatchRow[]): string[] {
  const loadedStatuses: readonly string[] = LOADED_ON_TRUCK_STATUSES;
  return dispatches.flatMap((d) => {
    const order = Array.isArray(d.orders) ? (d.orders[0] ?? null) : d.orders;
    const pkgs = order?.packages ?? [];
    return pkgs
      .filter((p) =>
        !p.deleted_at &&
        loadedStatuses.includes(p.status ?? '') &&
        p.loaded_at != null &&
        p.load_inferred === false)
      .map((p) => p.id);
  });
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
   * wrong, and the zero-loaded warn below must not fire for it.
   */
  isRetry: boolean;
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

  // spec-79 H3: scoped to the boxes actually on the truck (genuinely
  // scanned into `en_carga` or, post-seal, `listo_para_despacho` — see
  // loadedPackageIds above), not every package of every dispatched order. A
  // `loaded` route with nothing in either status is not a normal state
  // (review finding 1) unless this is the sanctioned retry (review F3) — it
  // skips the write (an empty `.in()` is meaningless) but must not do so
  // silently otherwise.
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
    // spec-79 review F2: the SELECT that built loadedPackageIds and this
    // UPDATE are separated by a network round-trip to DispatchTrack (and, on
    // the retry path, by however long the operator took to press the button
    // again). Re-asserting the source status here — not just operator_id and
    // id — is what makes the write TOCTOU-safe: if a box was marked
    // `dañado`/`retenido` in that window (e.g. by consolidation), this
    // filter excludes it instead of stamping `en_ruta` over it.
    // `.select('id')` is what makes a status change in that window
    // OBSERVABLE rather than silent: fewer rows returned than requested
    // means something changed underneath this write.
    const { data: updatedPackages, error: packagesError } = await supabase
      .from('packages')
      .update({ status: 'en_ruta' })
      .eq('operator_id', operatorId)
      .in('id', loadedPackageIds)
      .in('status', LOADED_ON_TRUCK_STATUSES)
      .select('id');
    if (packagesError) throw new DtAcceptedLocalFailedError(externalRouteId, packagesError);
    if ((updatedPackages?.length ?? 0) !== loadedPackageIds.length) {
      console.error(
        '[dispatch/dispatch POST] en_ruta write touched fewer packages than expected — ' +
          'a package\'s status changed between selection and write',
        { routeId, expectedCount: loadedPackageIds.length, updatedCount: updatedPackages?.length ?? 0 },
      );
    }
  } else if (!isRetry) {
    console.warn('[dispatch/dispatch POST] loaded route has no en_carga/listo_para_despacho packages', {
      routeId,
    });
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
