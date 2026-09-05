'use client';

import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { buildRetryChecklist, type RetryChecklist } from '@/lib/dispatch/mobile/dispatch-retry-checklist';

/**
 * spec-77 Fase 3, item 15 — the data `2k`'s "Antes de reintentar" checklist
 * needs, fetched only when it is actually shown (`DT_API_ERROR`, decision
 * 6's own scoping). Mirrors `useRouteDispatches.ts`'s query shape
 * (`dispatches` -> `orders(delivery_address, customer_phone)`) rather than
 * inventing a second one — every order on the route has an address by
 * construction (required at order creation), so `hasAddress` is always
 * true here; only the phone genuinely varies.
 */
export function useDispatchRetryChecklist(
  routeId: string | null,
  operatorId: string | null,
  vehicleAssigned: boolean,
  driverAssigned: boolean,
) {
  return useQuery<RetryChecklist>({
    queryKey: ['dispatch', 'mobile', 'retry-checklist', routeId, operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('order_id, orders(delivery_address, customer_phone)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;

      const stops = (data ?? []).map((d) => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          hasAddress: !!ord?.delivery_address,
          hasPhone: !!ord?.customer_phone,
        };
      });

      return buildRetryChecklist({ vehicleAssigned, driverAssigned, stops });
    },
    enabled: !!routeId && !!operatorId,
  });
}
