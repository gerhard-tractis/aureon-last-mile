import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DispatchStatus, RouteDispatchSummary } from '@/lib/dispatch/types';

const BUCKET: Record<DispatchStatus, number> = {
  failed: 0,
  pending: 1,
  partial: 1,
  delivered: 2,
};

export function useRouteDispatches(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'routes', routeId, 'dispatches'],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('id, order_id, status, orders(order_number, customer_name, delivery_address, customer_phone)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;

      const rows = (data ?? []).map((d): RouteDispatchSummary => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          dispatch_id: d.id,
          order_id: d.order_id ?? '',
          order_number: ord?.order_number ?? '',
          contact_name: ord?.customer_name ?? null,
          contact_address: ord?.delivery_address ?? null,
          contact_phone: ord?.customer_phone ?? null,
          status: d.status as DispatchStatus,
        };
      });

      return rows.sort((a, b) => {
        const d = BUCKET[a.status] - BUCKET[b.status];
        if (d !== 0) return d;
        return a.order_number.localeCompare(b.order_number);
      });
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
