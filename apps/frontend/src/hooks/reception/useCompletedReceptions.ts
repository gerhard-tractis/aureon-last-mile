import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { fetchPickupPointMap, type ReceptionManifest } from './useReceptionManifests';

export function useCompletedReceptions(operatorId: string | null) {
  return useQuery({
    queryKey: ['reception', 'completed', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifests')
        .select(
          `id, external_load_id, retailer_name, pickup_location, total_packages, completed_at,
           reception_status, assigned_to_user_id,
           hub_receptions(id, expected_count, received_count, status, completed_at)`
        )
        .eq('reception_status', 'received')
        .is('deleted_at', null)
        .order('completed_at', { ascending: false });

      if (error) throw error;
      const manifests = (data ?? []) as unknown as ReceptionManifest[];
      const pickupMap = await fetchPickupPointMap(
        supabase,
        manifests.map((m) => m.external_load_id).filter(Boolean),
      );
      return manifests.map((m) => ({
        ...m,
        pickup_point_name: pickupMap.get(m.external_load_id) ?? null,
      }));
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}
