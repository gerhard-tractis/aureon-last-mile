import type { ManifestRow } from '@/components/pickup/ManifestTable';
import type { TabKey } from '@/components/pickup/PickupDesktopView';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';
import type {
  CompletedManifest,
  InTransitManifest,
  PendingManifest,
} from '@/hooks/pickup/useManifests';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';
import { NO_CLIENT_LABEL } from '@/hooks/pickup/pickupSummary';

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
 * ronda 4 (review fase 2) — `clientBreakdown` (pickupSummary.ts) maps a
 * null `retailer_name` to the `NO_CLIENT_LABEL` chip, but a raw
 * `row.retailerName === selectedClient` comparison in the row filters
 * never matches: `null === 'Sin cliente'` is always false. Clicking that
 * chip emptied every tab, even the ones with unlabeled loads. This is the
 * one place both sides of that comparison have to agree — use it wherever
 * a row gets filtered by `selectedClient`, never a bare `===`.
 */
export function matchesClient(retailerName: string | null, selectedClient: string | null): boolean {
  if (!selectedClient) return true;
  return (retailerName ?? NO_CLIENT_LABEL) === selectedClient;
}

/**
 * spec-94 fase 2 — the routed tab's rows are `RoutedManifest`, not
 * `ManifestRow` (RoutedManifestTable reads them directly), so the search
 * bar needs its own matcher. Gains route code and driver name over
 * `matchesSearchTerm`: on this tab "which load" and "which truck" are the
 * same question, and searching only load/retailer/pickup-point would make
 * the shared search bar mean nothing on the one tab that's actually about
 * a route.
 */
export function matchesSearchTermRouted(row: RoutedManifest, term: string): boolean {
  if (!term) return true;
  const q = term.toLowerCase();
  return (
    row.external_load_id.toLowerCase().includes(q) ||
    (row.retailer_name ?? '').toLowerCase().includes(q) ||
    (row.pickup_point ?? '').toLowerCase().includes(q) ||
    row.route_code.toLowerCase().includes(q) ||
    (row.driver_name ?? '').toLowerCase().includes(q)
  );
}

/**
 * spec-94 fase 1 review: a `switch`, not a ternary chain — a ternary lets a
 * new `TabKey` fall through to the final `else` with no compiler error,
 * which is exactly how the routed tab would have silently rendered
 * Completados under its own label. `routed` returns `[]` on purpose: that
 * tab renders through `RoutedManifestTable`, never through this list.
 */
export function rowsForTab(
  tab: TabKey,
  pendingRows: ManifestRow[],
  inTransitRows: ManifestRow[],
  completedRows: ManifestRow[],
): ManifestRow[] {
  switch (tab) {
    case 'pending':
      return pendingRows;
    case 'routed':
      return [];
    case 'in_transit':
      return inTransitRows;
    case 'completed':
      return completedRows;
  }
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
    // spec-94 fase 1/2 review: NOT `?? 0`. openPendingManifest.ts forbids
    // turning a genuine unknown into zero — handleRowOpen (page.tsx) reads
    // these same fields to decide whether to include `counts` in that
    // write, so coalescing here would silently reintroduce the bug the RPC
    // fix closed.
    orderCount: m.order_count,
    packageCount: m.package_count,
    verifiedCount: m.verified_count,
    pickupWindowStart: m.pickup_window_start,
    pickupWindowEnd: m.pickup_window_end,
    pickupCutoffTime: m.pickup_cutoff_time,
  }));
}

// ronda 4 (review fase 2): NOT `?? 0`. The rule is written once, where it
// can be checked: the `?? 0` fallback lives in the RENDER (ManifestTable),
// never in a mapper. `total_orders`/`total_packages` are nullable — a load
// never opened (attached to a route while still 'pending') has them NULL —
// and handleRowOpen (page.tsx) reads THIS mapper's output to decide
// whether to include `counts` in openPendingManifest's write. Coalescing
// here made that guard blind on the in_transit/completed tabs: a click on
// such a row would write a fabricated total_orders=0/total_packages=0,
// permanently, exactly what corrección 4 (ronda anterior) closed for the
// pending tab and reopened here.
export function totalsToRows(rows: (CompletedManifest | InTransitManifest)[]): ManifestRow[] {
  return rows.map((m) => ({
    id: m.id,
    externalLoadId: m.external_load_id,
    pickupPoint: m.pickup_point,
    retailerName: m.retailer_name,
    orderCount: m.total_orders,
    packageCount: m.total_packages,
  }));
}
