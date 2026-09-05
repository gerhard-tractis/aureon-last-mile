import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { LOADED_ON_TRUCK_STATUSES } from '@/lib/dispatch/dispatch-load-state';

/**
 * spec-79 H3/F1-F2/F6, split out of dispatch-local-completion.ts (same
 * reason as dispatch-local-release.ts: that file grows past 300 lines once
 * every review fix lands). The single must-succeed write that marks a box
 * `en_ruta`, scoped to the boxes genuinely on the truck.
 *
 * Deliberately called BEFORE transition_route_status by the caller: this is
 * a must-succeed write (spec-79 phase 2), and transition_route_status is
 * what flips `routes.status` away from `loaded` — the handler's own guard
 * then 409s any further attempt at this route (spec-79 phase 0, finding 2).
 * A failure here still leaves the route retryable through the normal
 * external_route_id-skips-DT path; running it after the transition would
 * strand a failed write behind a 409 no retry can reach.
 */
export interface WriteEnRutaParams {
  supabase: SupabaseClient<Database>;
  routeId: string;
  operatorId: string;
  userId: string;
  loadedPackageIds: string[];
  /**
   * spec-79 review F3: true on the sanctioned retry after
   * DT_ACCEPTED_LOCAL_FAILED, where the packages were already written on the
   * attempt that got this far — an empty `loadedPackageIds` here is
   * legitimate, not a sign anything is wrong, and must not trip the
   * zero-loaded warn below.
   */
  isRetry: boolean;
}

/** @returns how many packages this write actually touched — spec-79 review
 * F2: the caller's `packages_dispatched` must report this, never
 * `loadedPackageIds.length` (what was merely requested). */
export async function writeEnRuta(params: WriteEnRutaParams): Promise<number> {
  const { supabase, routeId, operatorId, userId, loadedPackageIds, isRetry } = params;

  if (!loadedPackageIds.length) {
    if (!isRetry) {
      console.warn('[dispatch/dispatch POST] loaded route has no en_carga/listo_para_despacho packages', {
        routeId,
      });
    }
    return 0;
  }

  // spec-79 review F2: the SELECT that built loadedPackageIds and this
  // UPDATE are separated by a network round-trip to DispatchTrack (and, on
  // the retry path, by however long the operator took to press the button
  // again). Re-asserting the source status here — not just operator_id and
  // id — is what makes the write TOCTOU-safe: if a box was marked
  // `dañado`/`retenido` in that window, this filter excludes it instead of
  // stamping `en_ruta` over it. `.is('deleted_at', null)` (review F6): the
  // guard re-asserted `status` but not `deleted_at` — a package soft-deleted
  // in the same window would otherwise get `en_ruta` written onto a deleted
  // row. `.select('id')` makes a status change in that window OBSERVABLE
  // rather than silent: fewer rows returned than requested means something
  // changed underneath this write.
  const { data: updatedPackages, error: packagesError } = await supabase
    .from('packages')
    .update({ status: 'en_ruta' })
    .eq('operator_id', operatorId)
    .in('id', loadedPackageIds)
    .in('status', LOADED_ON_TRUCK_STATUSES)
    .is('deleted_at', null)
    .select('id');
  if (packagesError) throw packagesError;

  const dispatchedCount = updatedPackages?.length ?? 0;
  if (dispatchedCount !== loadedPackageIds.length) {
    console.error(
      '[dispatch/dispatch POST] en_ruta write touched fewer packages than expected — ' +
        'a package\'s status changed between selection and write',
      { routeId, expectedCount: loadedPackageIds.length, updatedCount: dispatchedCount },
    );
    // spec-79 review F2: every other notable event in this flow gets its own
    // audit_logs row; this disagreement was console-only before. Best-effort
    // like every other audit row in this flow — records the mismatch, does
    // not gate the dispatch.
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: userId,
      action: 'dispatch_en_ruta_count_mismatch',
      resource_type: 'routes',
      resource_id: routeId,
      changes_json: { expected_count: loadedPackageIds.length, updated_count: dispatchedCount },
      ip_address: 'unknown',
    }).then(() => null, () => null);
  }

  return dispatchedCount;
}
