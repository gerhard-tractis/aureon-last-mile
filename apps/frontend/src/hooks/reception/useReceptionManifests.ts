import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ReceptionHubInfo {
  id: string;
  expected_count: number;
  received_count: number;
  status: string;
}

export interface ReceptionManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  total_packages: number | null;
  completed_at: string | null;
  reception_status: string | null;
  assigned_to_user_id: string | null;
  hub_receptions: ReceptionHubInfo[];
}

const RECEPTION_QUERY_OPTIONS = {
  staleTime: 15_000,
  refetchInterval: 30_000,
} as const;

export function useReceptionManifests(operatorId: string | null) {
  return useQuery({
    queryKey: ['reception', 'manifests', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifests')
        .select(
          `id, external_load_id, retailer_name, total_packages, completed_at,
           reception_status, assigned_to_user_id,
           hub_receptions(id, expected_count, received_count, status)`
        )
        .in('reception_status', ['awaiting_reception', 'reception_in_progress'])
        .is('deleted_at', null)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      return data as ReceptionManifest[];
    },
    enabled: !!operatorId,
    ...RECEPTION_QUERY_OPTIONS,
  });
}
