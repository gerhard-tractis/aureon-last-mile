import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ReceptionHubInfo {
  id: string;
  expected_count: number;
  received_count: number;
  status: string;
  delivered_by_user?: { full_name: string } | null;
}

export interface ReceptionManifest {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  pickup_location: string | null;
  pickup_point_name: string | null;
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

type OrderPickupRow = {
  external_load_id: string | null;
  pickup_point: { name: string | null } | null;
};

async function fetchPickupPointMap(
  supabase: ReturnType<typeof createSPAClient>,
  externalLoadIds: string[],
): Promise<Map<string, string>> {
  if (externalLoadIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('orders')
    .select('external_load_id, pickup_point:pickup_points(name)')
    .in('external_load_id', externalLoadIds)
    .not('pickup_point_id', 'is', null)
    .is('deleted_at', null);
  if (error) throw error;
  const rows = (data ?? []) as unknown as OrderPickupRow[];
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.external_load_id || !row.pickup_point?.name) continue;
    if (!map.has(row.external_load_id)) {
      map.set(row.external_load_id, row.pickup_point.name);
    }
  }
  return map;
}

export function useReceptionManifests(operatorId: string | null) {
  return useQuery({
    queryKey: ['reception', 'manifests', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifests')
        .select(
          `id, external_load_id, retailer_name, pickup_location, total_packages, completed_at,
           reception_status, assigned_to_user_id,
           hub_receptions(id, expected_count, received_count, status,
             delivered_by_user:users!hub_receptions_delivered_by_fkey(full_name)
           )`
        )
        .in('reception_status', ['awaiting_reception', 'reception_in_progress'])
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
    ...RECEPTION_QUERY_OPTIONS,
  });
}

export { fetchPickupPointMap };
