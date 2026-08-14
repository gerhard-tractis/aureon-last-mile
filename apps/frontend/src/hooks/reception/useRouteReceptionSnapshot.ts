import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface RouteReceptionRouteHeader {
  id: string;
  code: string;
  driver_id: string;
  driver_name: string | null;
  /**
   * The truck's registered plate, joined from `vehicles` by the RPC.
   *
   * NOT `pickup_routes.vehicle_label`. Since spec-52 a route carries
   * `vehicle_id` and the plate is `vehicles.plate`; `vehicle_label` survives
   * only as an expand-phase mirror written so the pre-switch UI would not go
   * blank, and it is dropped in the contract phase. Null only for a route
   * whose vehicle row was removed.
   */
  plate: string | null;
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
    /**
     * How many of `received_count` arrived with NO verified pickup scan on
     * this route — packages physically present that the driver never scanned.
     * Derived server-side by the counting trigger (spec-52), never
     * client-attested, and reaches us for free through `to_jsonb(rr.*)`.
     *
     * `expected_count` and `received_count` therefore count DIFFERENT
     * populations. The honest fraction is `received_count - unexpected_count`
     * over `expected_count`; a bare `received_count !== expected_count` lets an
     * absent package and an extra one cancel each other out.
     */
    unexpected_count: number;
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
