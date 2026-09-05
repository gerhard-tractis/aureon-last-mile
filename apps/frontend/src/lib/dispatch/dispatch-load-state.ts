import type { PackageRow } from '@/lib/dispatch/dispatch-dt-payload';

/**
 * spec-79 H3/F1, split out of dispatch-local-completion.ts so
 * dispatch-en-ruta-write.ts and dispatch-dt-payload.ts can both depend on it
 * without a circular value import between dispatch-local-completion.ts and
 * dispatch-en-ruta-write.ts (dispatch-local-completion.ts re-exports both
 * names below so no other call site has to change its import path).
 *
 * Package statuses a box passes through while genuinely on the truck:
 * `en_carga` (just scanned, pre-seal) or `listo_para_despacho` (post-seal —
 * /seal moves every staged package to this status, seal-route.ts:284-288).
 */
export const LOADED_ON_TRUCK_STATUSES = ['en_carga', 'listo_para_despacho'] as const;

/**
 * spec-79 H3/review F1: whether a box genuinely rode the truck — shared by
 * `dispatch-local-completion.ts`'s `loadedPackageIds` (the `en_ruta` write)
 * and `dispatch-dt-payload.ts`'s `buildItems` (review F5: the DT guide must
 * list the same set).
 *
 * `status` alone is not enough. /seal moves every staged package OFF
 * `en_carga` to `listo_para_despacho` (seal-route.ts:284-288) before flipping
 * `routes.status`, so at dispatch time BOTH statuses can mean "on the truck"
 * — but `listo_para_despacho` is ALSO the legacy dock-ready-but-unloaded
 * status a package sits in before ever being scanned
 * (scan-validator.ts's DISPATCHABLE_STATUSES). The trustworthy signal is
 * spec-74's per-box load fact: `loaded_at` set AND `load_inferred` false
 * means a real scan (stage-dispatch.ts) put THIS box on a truck.
 * `load_inferred = true` means spec-74's one-time migration backfilled
 * `loaded_at` onto EVERY live package of an already-staged/adopted order —
 * including a sibling that never left the dock — so it is not evidence of
 * loading.
 *
 * Deliberate cost: a route sealed before spec-74's app layer shipped, whose
 * packages were never re-scanned, produces zero genuinely-loaded packages
 * here forever (a false negative — undercounts, never lies). The
 * alternative — trusting `load_inferred = true` — would mark `en_ruta` a box
 * that never left the dock (a false positive, the exact corruption this
 * function exists to prevent). Between the two, only the false positive
 * corrupts data an operator relies on, so that is the one refused. Any such
 * pre-spec-74 routes need a one-time operational reconciliation, not a code
 * change.
 */
export function isGenuinelyLoadedPackage(p: PackageRow): boolean {
  const loadedStatuses: readonly string[] = LOADED_ON_TRUCK_STATUSES;
  return (
    !p.deleted_at &&
    loadedStatuses.includes(p.status ?? '') &&
    p.loaded_at != null &&
    p.load_inferred === false
  );
}
