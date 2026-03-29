import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface PickupPoint {
  id: string;
  name: string;
}

export function usePickupPointsByClient(
  operatorId: string | null,
  clientId: string | null
) {
  return useQuery<PickupPoint[]>({
    queryKey: ['pickup_points', operatorId, clientId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any)
        .from('pickup_points')
        .select('id, name')
        .eq('operator_id', operatorId!)
        .eq('tenant_client_id', clientId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data as PickupPoint[]) ?? [];
    },
    enabled: !!operatorId && !!clientId,
    staleTime: 300_000,
  });
}
