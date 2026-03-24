import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useDockZones } from './useDockZones';
import { determineDockZone } from '@/lib/distribution/sectorization-engine';
import type { DockZone, ZoneMatchResult } from '@/lib/distribution/sectorization-engine';

export interface PendingPackage {
  id: string;
  label: string;
  order_id: string;
  comunaId: string | null;
  delivery_date: string;
}

export interface ZoneGroup {
  zone: DockZone;
  matchResult: ZoneMatchResult;
  packages: PendingPackage[];
}

export function usePendingSectorization(operatorId: string | null) {
  const { data: zones } = useDockZones(operatorId);

  return useQuery({
    queryKey: ['distribution', 'pending-sectorization', operatorId],
    queryFn: async (): Promise<ZoneGroup[]> => {
      const supabase = createSPAClient();
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('packages')
        .select('id, label, order_id, orders!inner(comuna_id, delivery_date)')
        .eq('operator_id', operatorId!)
        .eq('status', 'en_bodega')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (!data || !zones || zones.length === 0) return [];

      const groupMap = new Map<string, ZoneGroup>();

      for (const pkg of data) {
        const order = pkg.orders as { comuna_id: string | null; delivery_date: string };
        const matchResult = determineDockZone(
          { comunaId: order.comuna_id, delivery_date: order.delivery_date },
          zones,
          today
        );
        const existing = groupMap.get(matchResult.zone_id);
        const pendingPkg: PendingPackage = {
          id: pkg.id,
          label: pkg.label,
          order_id: pkg.order_id,
          comunaId: order.comuna_id,
          delivery_date: order.delivery_date,
        };
        if (existing) {
          existing.packages.push(pendingPkg);
        } else {
          const zone = zones.find(z => z.id === matchResult.zone_id)!;
          groupMap.set(matchResult.zone_id, { zone, matchResult, packages: [pendingPkg] });
        }
      }

      return Array.from(groupMap.values());
    },
    enabled: !!operatorId && !!zones && zones.length > 0,
    staleTime: 15_000,
  });
}
