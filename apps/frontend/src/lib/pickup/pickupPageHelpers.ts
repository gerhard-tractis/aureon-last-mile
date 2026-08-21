import type { ManifestRow } from '@/components/pickup/ManifestTable';
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
