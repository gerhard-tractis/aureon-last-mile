// apps/frontend/src/hooks/dispatch/mobile/useRouteScanOrderContext.ts
//
// spec-76 phase 4 (2e/2f) — one route-scoped fetch of the per-order context
// the scan loop's last-read card and history rows need but the scan
// response itself (ScanApiResponse) does not carry: comuna and retailer
// ("client" in the mock — `orders.retailer_name`, a real column, not the
// delivery recipient), plus a derived stop index (route-load-brief.ts's
// `stopIndexByOrder` — see that function's own comment on why it is a
// grouping index, not a claim about the driver's real visiting order).
// Fetched once per route/operator, not per scan: none of these three
// values change while the crew is loading.
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { stopIndexByOrder, type BriefDispatchRow } from '@/lib/dispatch/mobile/route-load-brief';

export interface RouteScanOrderContext {
  comuna: string | null;
  retailerName: string | null;
  stopIndex: number | null;
}

interface Options {
  enabled?: boolean;
}

export function useRouteScanOrderContext(
  routeId: string | null,
  operatorId: string | null,
  options: Options = {},
) {
  const enabled = (options.enabled ?? true) && !!routeId && !!operatorId;
  return useQuery({
    queryKey: ['dispatch', 'mobile', 'route-scan-context', routeId, operatorId],
    queryFn: async (): Promise<Map<string, RouteScanOrderContext>> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('order_id, orders(comuna, retailer_name, delivery_address)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;

      const rows = data ?? [];
      const dispatches: BriefDispatchRow[] = rows.map((d) => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          order_id: d.order_id as string,
          order_number: '',
          contact_address: ord?.delivery_address ?? null,
        };
      });
      const stopIndex = stopIndexByOrder(dispatches);

      const out = new Map<string, RouteScanOrderContext>();
      for (const d of rows) {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        const orderId = d.order_id as string;
        out.set(orderId, {
          comuna: ord?.comuna ?? null,
          retailerName: ord?.retailer_name ?? null,
          stopIndex: stopIndex.get(orderId) ?? null,
        });
      }
      return out;
    },
    enabled,
    staleTime: 30_000,
  });
}
