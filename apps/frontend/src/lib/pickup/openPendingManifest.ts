import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';

/**
 * Extracted from page.tsx (spec-54 3h review fix, item 6 — page.tsx over
 * the 300-line guideline). Navigation stays in the page (the app layer);
 * this is only the Supabase write. Shared by BOTH the desktop pending-table
 * open path and the mobile route-card open path (page.tsx's
 * handleRowOpen / handleRouteManifestOpen) so they cannot drift into two
 * copies of this statement again — see the review round that found the
 * mobile path had silently dropped it entirely.
 *
 * If the manifest for `externalLoadId` is still 'pending' (every CARGA gets
 * a 'pending' manifests row at ingest — see migration 20260814000001),
 * flips it to 'in_progress' and stamps `started_at`. `started_at` has no
 * other writer anywhere in the app and drives the pickup-duration figure on
 * `pickup/complete/[loadId]/page.tsx` (renders "—" when null) — dropping
 * this write is a real, user-visible regression, not just bookkeeping.
 *
 * `counts`, when passed, ALSO records `total_orders`/`total_packages`. Pass
 * it ONLY with real, non-null aggregate counts — `get_pending_manifests` /
 * the desktop pending tab always provide them (`ManifestRow.orderCount` /
 * `packageCount`). NEVER derive `counts` from the nullable
 * `manifests.total_orders`/`total_packages` columns (e.g. a
 * `RouteManifestRow` from `useRouteManifests`) coalesced with `?? 0` —
 * coalescing a genuine NULL (intake never recorded a count) through this
 * write would permanently turn "unknown" into "zero" in the database. This
 * is why the mobile route-card path omits `counts`: its totals come from
 * exactly those nullable columns.
 */
export async function openPendingManifest(
  supabase: SupabaseClient<Database>,
  operatorId: string,
  externalLoadId: string,
  counts?: { orderCount: number; packageCount: number },
): Promise<void> {
  const { data: existing } = await supabase
    .from('manifests')
    .select('id, status')
    .eq('operator_id', operatorId)
    .eq('external_load_id', externalLoadId)
    .is('deleted_at', null)
    .limit(1);

  if (existing?.[0]?.status === 'pending') {
    await supabase
      .from('manifests')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
        ...(counts
          ? { total_orders: counts.orderCount, total_packages: counts.packageCount }
          : {}),
      })
      .eq('id', existing[0].id);
  }
}
