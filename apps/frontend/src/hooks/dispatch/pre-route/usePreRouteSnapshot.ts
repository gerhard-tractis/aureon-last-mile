import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { PreRouteSnapshot } from '@/lib/types';

async function fetchSnapshot(
  operatorId: string,
  deliveryDate: string,
  windowStart: string | null,
  windowEnd: string | null,
): Promise<PreRouteSnapshot> {
  const client = createSPAClient();
  const { data, error } = await client.rpc('get_pre_route_snapshot', {
    p_operator_id: operatorId,
    p_delivery_date: deliveryDate,
    p_window_start: windowStart,
    p_window_end: windowEnd,
  });
  if (error) throw error;
  return data as PreRouteSnapshot;
}

export type PreRouteSnapshotResult = {
  snapshot: PreRouteSnapshot | null;
  isLoading: boolean;
  isError: boolean;
  fetchStatus: string;
  isSuccess: boolean;
};

export function usePreRouteSnapshot(
  operatorId: string | null,
  deliveryDate: string,
  windowStart: string | null = null,
  windowEnd: string | null = null,
): PreRouteSnapshotResult {
  const { data, isLoading, isError, fetchStatus, isSuccess } = useQuery({
    queryKey: ['dispatch', 'pre-route', operatorId, deliveryDate, windowStart, windowEnd],
    queryFn: () => fetchSnapshot(operatorId!, deliveryDate, windowStart, windowEnd),
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    snapshot: data ?? null,
    isLoading,
    isError,
    fetchStatus,
    isSuccess,
  };
}
