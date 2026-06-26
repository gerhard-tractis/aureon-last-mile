import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface RouteReceptionRouteHeader {
  id: string;
  code: string;
  driver_id: string;
  driver_name: string | null;
  vehicle_label: string | null;
  status: string;
  in_transit_at: string | null;
}

export interface RouteReceptionManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
}

export interface RouteReceptionExpectedPackage {
  id: string;
  label: string;
  order_id: string;
  order_number: string;
  manifest_id: string;
  status: string;
}

export interface RouteReceptionScan {
  id: string;
  barcode: string;
  scan_result: 'received' | 'not_found' | 'duplicate' | 'route_mismatch';
  package_id: string | null;
  scanned_at: string;
}

export interface RouteReceptionDiscrepancy {
  barcode: string;
  scanned_at: string;
}

export interface RouteReceptionSnapshot {
  route: RouteReceptionRouteHeader;
  route_reception: {
    id: string;
    status: string;
    expected_count: number;
    received_count: number;
    started_at: string | null;
    completed_at: string | null;
    discrepancy_notes: string | null;
  };
  manifests: RouteReceptionManifest[];
  expected_packages: RouteReceptionExpectedPackage[];
  scans: RouteReceptionScan[];
  discrepancies: RouteReceptionDiscrepancy[];
}

/**
 * React-Query wrapper around `get_route_reception_snapshot(p_route_id)`.
 * One round-trip returns the route header, every linked manifest, every
 * expected package (joined to its order) and every reception_scan that's
 * been written so far — exactly the shape the consolidated reception page
 * needs to render the order-grouped list, the progress bar and the
 * discrepancy section without further fetches. Mirrors the pattern used by
 * `useOpsControlSnapshot`.
 */
export function useRouteReceptionSnapshot(routeId: string | null) {
  return useQuery<RouteReceptionSnapshot | null>({
    queryKey: ['reception', 'route-snapshot', routeId],
    enabled: !!routeId,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('get_route_reception_snapshot', {
        p_route_id: routeId!,
      });
      if (error) throw error;
      return (data ?? null) as RouteReceptionSnapshot | null;
    },
  });
}
