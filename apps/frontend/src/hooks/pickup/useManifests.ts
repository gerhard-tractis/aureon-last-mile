import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface PendingManifest {
  external_load_id: string;
  retailer_name: string | null;
  order_count: number;
  package_count: number;
}

export interface CompletedManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_orders: number | null;
  total_packages: number | null;
  completed_at: string;
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
      const { data, error } = await (supabase.rpc as CallableFunction)('get_pending_manifests');
      if (error) throw error;
      return data as PendingManifest[];
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
      const { data, error } = await (supabase.rpc as CallableFunction)('get_completed_manifests');
      if (error) throw error;
      return data as CompletedManifest[];
    },
    enabled: !!operatorId,
    ...PICKUP_QUERY_OPTIONS,
  });
}
