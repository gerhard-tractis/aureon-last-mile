import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RouteManifestRow, ManifestStatus } from '@/components/pickup/RouteManifestList';

/**
 * Fetches all manifests linked to the given pickup_route plus their verified
 * pickup_scan counts. Pure client-side join: pull manifests by FK, then
 * batch-fetch verified pickup_scans grouped client-side. Kept here instead
 * of an RPC because the active-route page already calls 4 hooks and this
 * one is short-lived (driver tabs in for a minute).
 *
 * spec-54 phase 4.6 fix: this query previously had no `.order(...)`, so
 * Postgres row order was arbitrary and could change between refetches (this
 * hook refetches on window focus). The mobile "next manifest" highlight
 * reads array position, so an unordered result meant the highlighted card
 * — and its position badge — could jump between manifests for no reason.
 *
 * Ordered `created_at ASCENDING` — oldest (first attached) first. This is a
 * work QUEUE, not a history listing: `handleAdd` on this same screen attaches
 * a manifest to the route and invalidates this query while the driver is
 * looking at it. Newest-first (the direction the sibling manifest-listing
 * RPCs use — see `20260428000001_sort_manifests_by_created_at.sql`, a
 * different kind of screen showing recently-arrived loads) would put a
 * freshly-added manifest at position 0, bump it straight to "Siguiente
 * manifiesto", and renumber every badge on screen — reintroducing the exact
 * instability this order clause exists to remove. Ascending keeps a
 * manifest's position fixed once it's attached.
 *
 * Also selects `pickup_location` (a plain TEXT column on `manifests`, no
 * join needed) so the driver can see, and navigate to, where the manifest
 * actually is.
 *
 * spec-54 QA-CARGA-C fix: `manifests.total_packages` is nullable and, per
 * `20260814000001_manifest_row_per_carga.sql`, deliberately left NULL when
 * the manifest row is created — "the pickup RPCs compute those from orders,
 * so a stale denormalised count would be worse than none." The only writer
 * that ever populates it (`expand_carton`/`delete_minted_carton` in
 * `20260814000002_spec55_carton_expansion.sql`) sets it to exactly
 * `COUNT(packages)` joined through `orders.external_load_id` — the same
 * number desktop's `get_pending_manifests` computes directly and shows in
 * its `PAQ.` column. So a NULL here does not mean "a different, unknown
 * quantity" — it means "nobody has (re)computed the real count yet", and
 * the real count is one query away. When `total_packages` is NULL for a
 * manifest, this hook now derives the same COUNT(real, non-deleted package
 * rows) desktop already shows, instead of leaving mobile stuck on "—" for a
 * manifest with real, already-ingested packages. A manifest with NO package
 * rows still renders "—" (see `deriveTotalPackages` below) — a genuine 0
 * package rows is indistinguishable from "not ingested yet", so it is never
 * shown as a trustworthy denominator, matching `isManifestComplete`'s
 * existing "0 means not counted, not empty" rule in `manifestProgress.ts`.
 */
async function deriveTotalPackages(
  supabase: ReturnType<typeof createSPAClient>,
  operatorId: string,
  externalLoadIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (externalLoadIds.length === 0) return result;

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, external_load_id')
    .eq('operator_id', operatorId)
    .in('external_load_id', externalLoadIds)
    .is('deleted_at', null);
  if (ordersErr) throw ordersErr;

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length === 0) return result;

  const loadIdByOrderId = new Map<string, string>();
  for (const o of orders ?? []) {
    if (!o.external_load_id) continue;
    loadIdByOrderId.set(o.id, o.external_load_id);
  }

  const { data: packages, error: packagesErr } = await supabase
    .from('packages')
    .select('order_id')
    .eq('operator_id', operatorId)
    .in('order_id', orderIds)
    .is('deleted_at', null);
  if (packagesErr) throw packagesErr;

  for (const p of packages ?? []) {
    const loadId = p.order_id ? loadIdByOrderId.get(p.order_id) : undefined;
    if (!loadId) continue;
    result.set(loadId, (result.get(loadId) ?? 0) + 1);
  }

  return result;
}
export function useRouteManifests(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'route-manifests', routeId],
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<RouteManifestRow[]> => {
      const supabase = createSPAClient();
      const { data: manifests, error } = await supabase
        .from('manifests')
        .select(
          'id, external_load_id, retailer_name, pickup_location, total_orders, total_packages, status',
        )
        .eq('operator_id', operatorId!)
        .eq('pickup_route_id', routeId!)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const ids = (manifests ?? []).map((m) => m.id);
      if (ids.length === 0) return [];

      const { data: scans, error: scanErr } = await supabase
        .from('pickup_scans')
        .select('manifest_id, package_id')
        .eq('operator_id', operatorId!)
        .in('manifest_id', ids)
        .eq('scan_result', 'verified')
        .is('deleted_at', null);
      if (scanErr) throw scanErr;

      const verifiedByManifest = new Map<string, Set<string>>();
      for (const s of scans ?? []) {
        if (!s.manifest_id || !s.package_id) continue;
        if (!verifiedByManifest.has(s.manifest_id)) {
          verifiedByManifest.set(s.manifest_id, new Set());
        }
        verifiedByManifest.get(s.manifest_id)!.add(s.package_id);
      }

      // Only chase the derived count for manifests that actually need it —
      // most manifests already carry a real total_packages, and skipping
      // the extra queries entirely for a fully-populated route keeps this
      // hook at its original 2-query cost in the common case.
      const missingLoadIds = (manifests ?? [])
        .filter((m) => m.total_packages == null)
        .map((m) => m.external_load_id);
      const derivedByLoadId =
        missingLoadIds.length > 0
          ? await deriveTotalPackages(supabase, operatorId!, missingLoadIds)
          : new Map<string, number>();

      return (manifests ?? []).map((m) => {
        // A derived 0 (real orders, zero package rows) is not a trustworthy
        // denominator — never distinguishable from "not ingested yet" — so
        // it stays NULL/"—" rather than becoming a fabricated "0".
        const derived = derivedByLoadId.get(m.external_load_id);
        const totalPackages = m.total_packages ?? (derived && derived > 0 ? derived : null);
        return {
          id: m.id,
          external_load_id: m.external_load_id,
          retailer_name: m.retailer_name,
          pickup_location: m.pickup_location,
          total_orders: m.total_orders,
          total_packages: totalPackages,
          verified_count: verifiedByManifest.get(m.id)?.size ?? 0,
          status: m.status as ManifestStatus | undefined,
        };
      });
    },
  });
}

/**
 * Manifests not yet linked to any pickup_route (pickup_route_id IS NULL)
 * and not completed — fodder for the AddManifestSheet picker.
 */
export function useUnassignedManifests(operatorId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'unassigned-manifests', operatorId],
    enabled: !!operatorId,
    staleTime: 10_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifests')
        .select('id, external_load_id, retailer_name, total_packages')
        .eq('operator_id', operatorId!)
        .is('pickup_route_id', null)
        .is('deleted_at', null)
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}
