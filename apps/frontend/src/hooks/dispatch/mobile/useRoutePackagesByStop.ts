'use client';

// apps/frontend/src/hooks/dispatch/mobile/useRoutePackagesByStop.ts
//
// spec-76 task 4 (2h) — fetching for "Paquetes en la ruta": every package
// belonging to an order on this route (loaded AND retenido — the latter is
// what lets a stop show NO EMBARCADO, decision 5/8), plus the dispatch
// rows the grouping in route-packages-by-stop.ts needs. Same
// chunked-by-100-order-ids shape as useRoutePackages.ts/useRouteLoadBrief.ts
// (spec-74 phase 4 review item 6 — order ids in an `.in()` filter can
// exceed a request's query-string ceiling at ~200+ orders).
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RawDispatchRow, RawPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

const ID_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface RoutePackagesByStopData {
  dispatches: RawDispatchRow[];
  packages: RawPackageRow[];
}

const EMPTY: RoutePackagesByStopData = { dispatches: [], packages: [] };

export function useRoutePackagesByStop(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'mobile', 'route-packages-by-stop', routeId, operatorId],
    queryFn: async (): Promise<RoutePackagesByStopData> => {
      const supabase = createSPAClient();

      const { data: dispatchRows, error: dispatchError } = await supabase
        .from('dispatches')
        .select('id, order_id, orders(order_number, delivery_address, customer_name)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (dispatchError) throw dispatchError;

      const rows = dispatchRows ?? [];
      if (rows.length === 0) return EMPTY;

      const dispatches: RawDispatchRow[] = rows.map((d) => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          dispatch_id: d.id,
          order_id: d.order_id as string,
          order_number: ord?.order_number ?? '',
          contact_address: ord?.delivery_address ?? null,
          client_name: ord?.customer_name ?? null,
        };
      });

      const orderIds = [...new Set(dispatches.map((d) => d.order_id))];
      const packageChunks = await Promise.all(
        chunk(orderIds, ID_CHUNK_SIZE).map(async (ids) => {
          const { data, error } = await supabase
            .from('packages')
            .select('id, order_id, label, package_number, status, loaded_at')
            .in('order_id', ids)
            .eq('operator_id', operatorId!)
            .is('deleted_at', null);
          if (error) throw error;
          return (data ?? []) as RawPackageRow[];
        }),
      );

      return { dispatches, packages: packageChunks.flat() };
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
