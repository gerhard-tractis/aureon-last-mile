import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

/**
 * Fetches all manifests linked to the given pickup_route plus their verified
 * pickup_scan counts. Pure client-side join: pull manifests by FK, then
 * batch-fetch verified pickup_scans grouped client-side. Kept here instead
 * of an RPC because the active-route page already calls 4 hooks and this
 * one is short-lived (driver tabs in for a minute).
 */
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
        .select('id, external_load_id, retailer_name, total_orders, total_packages')
        .eq('operator_id', operatorId!)
        .eq('pickup_route_id', routeId!)
        .is('deleted_at', null);
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

      return (manifests ?? []).map((m) => ({
        id: m.id,
        external_load_id: m.external_load_id,
        retailer_name: m.retailer_name,
        total_orders: m.total_orders,
        total_packages: m.total_packages,
        verified_count: verifiedByManifest.get(m.id)?.size ?? 0,
      }));
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
