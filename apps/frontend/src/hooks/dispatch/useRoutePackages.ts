import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RoutePackage } from '@/lib/dispatch/types';

export function useRoutePackages(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'packages', routeId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('id, order_id, status, orders(order_number, customer_name, delivery_address, customer_phone)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;
      return (data ?? []).map((d): RoutePackage => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          dispatch_id: d.id,
          order_id: d.order_id ?? '',
          order_number: ord?.order_number ?? '',
          contact_name: ord?.customer_name ?? null,
          contact_address: ord?.delivery_address ?? null,
          contact_phone: ord?.customer_phone ?? null,
          package_status: d.status as RoutePackage['package_status'],
        };
      });
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
