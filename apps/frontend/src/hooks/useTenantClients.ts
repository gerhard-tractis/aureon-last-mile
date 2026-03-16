import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface TenantClient {
  id: string;
  name: string;
}

/**
 * useTenantClients — fetches tenant_clients for a given operator.
 * Used by components that need a retailer/client selector.
 */
export function useTenantClients(operatorId: string | null) {
  return useQuery<TenantClient[]>({
    queryKey: ['tenantClients', operatorId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any).from('tenant_clients')
        .select('id, name')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data as TenantClient[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 300_000,
  });
}
