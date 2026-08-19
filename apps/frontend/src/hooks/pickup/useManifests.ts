import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';

export interface PendingManifest {
  /** NULL until a manifests row exists for the load (spec-53) — the operator
   * has not opened the scan flow yet, so there is nothing to print labels for. */
  id: string | null;
  external_load_id: string;
  retailer_name: string | null;
  order_count: number;
  package_count: number;
  created_at: string;
  pickup_point: string | null;
  /** Count of pickup_scans with scan_result='verified' for this load. >0 = in progress. */
  verified_count: number;
  /** spec-53 — set once a label print job has been dispatched for this manifest. */
  labels_printed_at: string | null;
  labels_printed_by_name: string | null;
}

export interface CompletedManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_orders: number | null;
  total_packages: number | null;
  completed_at: string;
  created_at: string;
  pickup_point: string | null;
  labels_printed_at: string | null;
  labels_printed_by_name: string | null;
}

export interface InTransitManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_orders: number | null;
  total_packages: number | null;
  reception_status: string;
  updated_at: string;
  created_at: string;
  pickup_point: string | null;
  labels_printed_at: string | null;
  labels_printed_by_name: string | null;
}

const PICKUP_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchInterval: 60_000,
} as const;

export function usePendingManifests(operatorId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'manifests', 'pending', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await callRpc<PendingManifest[]>(supabase, 'get_pending_manifests');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    ...PICKUP_QUERY_OPTIONS,
  });
}

export function useCompletedManifests(operatorId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'manifests', 'completed', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await callRpc<CompletedManifest[]>(supabase, 'get_completed_manifests');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    ...PICKUP_QUERY_OPTIONS,
  });
}

/**
 * `enabled` (default `true`) — spec-54 3h review fix, item 8. The mobile
 * pickup landing has no "en tránsito" tab (it's a start-of-shift screen —
 * 3h deliberately narrower than 1l's admin-style tabs) and never reads this
 * hook's data, so `page.tsx` passes `enabled: !isBelowLg` to skip the
 * RPC call entirely on a phone instead of fetching and discarding it.
 */
export function useInTransitManifests(operatorId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['pickup', 'manifests', 'in_transit', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await callRpc<InTransitManifest[]>(supabase, 'get_in_transit_manifests');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId && enabled,
    ...PICKUP_QUERY_OPTIONS,
  });
}
