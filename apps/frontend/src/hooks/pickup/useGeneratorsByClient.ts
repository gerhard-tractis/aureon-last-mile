import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface Generator {
  id: string;
  name: string;
}

/**
 * useGeneratorsByClient — fetches active generators (pickup points) for
 * a given operator + tenant client combination.
 */
export function useGeneratorsByClient(
  operatorId: string | null,
  clientId: string | null
) {
  return useQuery<Generator[]>({
    queryKey: ['generators', operatorId, clientId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any)
        .from('generators')
        .select('id, name')
        .eq('operator_id', operatorId!)
        .eq('tenant_client_id', clientId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data as Generator[]) ?? [];
    },
    enabled: !!operatorId && !!clientId,
    staleTime: 300_000,
  });
}
