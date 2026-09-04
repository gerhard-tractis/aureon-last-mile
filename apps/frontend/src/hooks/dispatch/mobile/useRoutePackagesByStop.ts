'use client';

// apps/frontend/src/hooks/dispatch/mobile/useRoutePackagesByStop.ts
//
// spec-76 task 4 (2h) — fetching for "Paquetes en la ruta": every LOADED
// package belonging to an order on this route, plus every `retenido` one
// (the latter is what lets a stop show NO EMBARCADO, decision 5/8), plus
// the dispatch rows the grouping in route-packages-by-stop.ts needs. Same
// chunked-by-100-order-ids shape as useRoutePackages.ts/useRouteLoadBrief.ts
// (spec-74 phase 4 review item 6 — order ids in an `.in()` filter can
// exceed a request's query-string ceiling at ~200+ orders).
//
// spec-76 review I6 — the fetch is restricted client-side to those two
// cohorts (see the `.filter` below), not left open. Before this, EVERY
// live package on the route's orders came back regardless of status, and
// only `retenido` got a marker — a package that was `dañado`, `entregado`,
// `devuelto`, or simply not yet loaded (still `sectorizado`/`asignado`/
// `listo_para_despacho`, dispatchable but not on the truck yet) rendered
// as an ordinary, unlabelled row next to genuinely loaded ones, while the
// stop header's count (loaded-only) silently disagreed with the row count
// underneath it. `useRoutePackages.ts` already draws this same
// loaded-vs-not-yet-relevant line for 2e's own counts (its own doc
// comment: "A package counts toward the total when it is either already
// loaded ... or still eligible ... A package that is neither ... is
// excluded entirely") — this hook mirrors that boundary rather than
// inventing a third rule, adding only `retenido` on top because 2h,
// unlike 2e's totals, has to render it as NO EMBARCADO instead of hiding
// it.
//
// Note for the next reader (spec-76 review, minor): this queries the SAME
// `packages` rows `useRoutePackages.ts` already fetches for the SAME
// route, from a different query key. There is no shared source between
// them today — a status-cohort fix belongs in both places, and fixing
// only one here has already happened once (I6 itself).
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

      // I6 — keep only what 2h is actually allowed to render unambiguously:
      // already loaded (regardless of its CURRENT status — a package can
      // move on past `loaded_at` being set, same reasoning as
      // useRoutePackages.ts) or `retenido` (shown as NO EMBARCADO). A row
      // matching neither is dropped rather than shown unlabelled.
      const packages = packageChunks.flat().filter((p) => !!p.loaded_at || p.status === 'retenido');

      return { dispatches, packages };
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
