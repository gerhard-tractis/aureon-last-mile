import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface RoutePreview {
  id: string;
  code: string;
  status: string;
  started_at: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
  manifest_count: number;
  scanned_count: number;
}

interface PickupRoutePreviewRow {
  id: string;
  code: string;
  status: string;
  started_at: string | null;
  driver: { full_name: string | null } | null;
  vehicle: { plate: string | null } | null;
  manifests: { id: string }[] | null;
}

/**
 * Read-only header for a pickup route the hub is *watching*, not receiving.
 *
 * `get_route_reception_snapshot` cannot serve this: an `in_progress` route has
 * no `route_receptions` row yet. So this reads the route plus its driver,
 * vehicle plate, linked cargas and the distinct packages verified so far —
 * enough for the receptionist to recognise the truck at the gate. Deliberately
 * a query and nothing else: nothing here opens a batch or stamps an arrival.
 */
export function useRoutePreview(routeId: string | null, operatorId: string | null) {
  return useQuery<RoutePreview | null>({
    queryKey: ['reception', 'route-preview', routeId],
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('pickup_routes')
        .select(`
          id, code, status, started_at,
          driver:users!pickup_routes_driver_id_fkey(full_name),
          vehicle:vehicles(plate),
          manifests(id)
        `)
        .eq('id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const route = data as unknown as PickupRoutePreviewRow;
      const manifestIds = (route.manifests ?? []).map((m) => m.id);

      let scannedCount = 0;
      if (manifestIds.length > 0) {
        const { data: scans, error: scanError } = await supabase
          .from('pickup_scans')
          .select('manifest_id, package_id')
          .eq('operator_id', operatorId!)
          .in('manifest_id', manifestIds)
          .eq('scan_result', 'verified')
          .is('deleted_at', null);
        if (scanError) throw scanError;
        const distinct = new Set<string>();
        for (const scan of scans ?? []) {
          if (scan.package_id) distinct.add(scan.package_id);
        }
        scannedCount = distinct.size;
      }

      return {
        id: route.id,
        code: route.code,
        status: route.status,
        started_at: route.started_at,
        driver_name: route.driver?.full_name ?? null,
        vehicle_plate: route.vehicle?.plate ?? null,
        manifest_count: manifestIds.length,
        scanned_count: scannedCount,
      };
    },
  });
}
