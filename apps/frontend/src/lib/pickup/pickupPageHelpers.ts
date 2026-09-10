import type { ManifestRow } from '@/components/pickup/ManifestTable';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';
import type {
  CompletedManifest,
  InTransitManifest,
  PendingManifest,
} from '@/hooks/pickup/useManifests';

/**
 * Extracted from page.tsx (spec-54 3h review fix, item 6) to keep the page
 * under the 300-line guideline — pure, presentation-agnostic helpers with
 * no hook/router/Supabase dependency, so they belong in `lib/`, not the
 * page itself.
 */

export function todayLabel(now: Date): string {
  const text = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ManifestsAvailability = 'loading' | 'unknown' | 'error' | 'known';

/**
 * spec-80 fase 2b (ronda 2) — a query's `data ?? []` collapses THREE
 * distinct states into one empty array: an ordinary brief initial load, a
 * real network pause (this repo's default `networkMode: 'online'` PAUSES a
 * query with no signal instead of erroring — `isPending: true`,
 * `fetchStatus: 'paused'`), and retries genuinely exhausted (`isError:
 * true`, `data: undefined`). Ronda 1 of this fase only checked `isPending`,
 * which is ALSO true during ordinary loading (`fetchStatus: 'fetching'`) —
 * that read as "we don't know, revisa tu conexión" on every normal screen
 * open — and never checked `isError` at all, so a real failure after
 * retries silently read as "known, nothing to rescue" (the exact bug
 * spec-61 already fixed once for `useActivePickupRoute`, by reading
 * `isError` — page.tsx's `activeRouteUnknown`).
 */
export function manifestsAvailability(state: {
  isPending: boolean;
  isError: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}): ManifestsAvailability {
  if (state.isError) return 'error';
  if (state.isPending) return state.fetchStatus === 'paused' ? 'unknown' : 'loading';
  return 'known';
}

/**
 * spec-80 fase 2b (ronda 2) — the mobile rescue entry moved from
 * `useRouteManifests` (route-scoped: unreachable the instant a rescue
 * exists, because `trg_route_receptions_status_sync` also flips the route
 * itself to `status: 'received'` in the same statement) to
 * `get_completed_manifests` (operator-wide — the same source desktop's
 * Completados tab uses, which stays reachable regardless of route state).
 * Filters to rows missing a signature and maps them into the
 * `RouteManifestRow` shape `PickupMobileCompactRow`'s `needsSignature`
 * variant already knows how to render.
 */
export function rescueRowsFromCompleted(manifests: CompletedManifest[]): RouteManifestRow[] {
  return manifests
    .filter((m) => m.signature_operator === null)
    .map((m) => ({
      id: m.id,
      external_load_id: m.external_load_id,
      retailer_name: m.retailer_name,
      pickup_location: m.pickup_point,
      total_orders: m.total_orders,
      total_packages: m.total_packages,
      // Not fetched by get_completed_manifests and not rendered by the
      // needsSignature row variant — a placeholder, not a real count.
      verified_count: 0,
      status: 'completed',
      completed_at: m.completed_at,
      // get_completed_manifests does not fetch discrepancy_notes (a
      // different query — see useRouteManifests.ts). undefined renders as
      // "—", never a fabricated 0/count. missing_count is a DIFFERENT
      // metric (open 'missing' discrepancies) and must not be relabelled
      // "notas" here.
      discrepancy_count: undefined,
      signature_operator: m.signature_operator,
    }));
}

export function matchesSearchTerm(row: ManifestRow, term: string): boolean {
  if (!term) return true;
  const q = term.toLowerCase();
  return (
    row.externalLoadId.toLowerCase().includes(q) ||
    (row.retailerName ?? '').toLowerCase().includes(q) ||
    (row.pickupPoint ?? '').toLowerCase().includes(q)
  );
}


/**
 * The three manifest shapes the page renders through one table.
 *
 * Moved out of page.tsx (spec-61 Task 5) for the same reason the two helpers
 * above were: the page had to grow to carry `role`, `userId` and the failed-
 * lookup branch, and these mappings are pure.
 *
 * `pending` really does use different column names — `get_pending_manifests`
 * returns `order_count`/`package_count`, the other two return
 * `total_orders`/`total_packages` — which is why there are two functions and
 * not one generic mapper.
 */
export function pendingToRows(rows: PendingManifest[]): ManifestRow[] {
  return rows.map((m) => ({
    id: m.id,
    externalLoadId: m.external_load_id,
    pickupPoint: m.pickup_point,
    retailerName: m.retailer_name,
    orderCount: m.order_count ?? 0,
    packageCount: m.package_count ?? 0,
    verifiedCount: m.verified_count,
    pickupWindowStart: m.pickup_window_start,
    pickupWindowEnd: m.pickup_window_end,
    pickupCutoffTime: m.pickup_cutoff_time,
  }));
}

export function totalsToRows(rows: (CompletedManifest | InTransitManifest)[]): ManifestRow[] {
  return rows.map((m) => ({
    id: m.id,
    externalLoadId: m.external_load_id,
    pickupPoint: m.pickup_point,
    retailerName: m.retailer_name,
    orderCount: m.total_orders ?? 0,
    packageCount: m.total_packages ?? 0,
  }));
}
