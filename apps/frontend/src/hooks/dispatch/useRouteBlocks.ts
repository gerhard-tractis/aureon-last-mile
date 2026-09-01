import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RouteBlocksResult, RouteBlockView, UnblockedOrder, SequenceSource } from '@/lib/dispatch/types';

/**
 * spec-72 phase 3 — manager review data for the route builder's block list.
 *
 * Two queries, mirroring useRoutePackages.ts's shape (PostgREST cannot embed
 * `route_blocks` and `dispatches` in one round trip — they share no direct
 * FK, both point at the route independently):
 *
 *   1. `route_blocks` — the live (deleted_at IS NULL) blocks for this route,
 *      in `sequence_index` order, with the comuna name embedded via the
 *      `chile_comunas` FK.
 *   2. `dispatches` — every live dispatch on this route, with its order's
 *      `comuna_id`/`order_number` embedded via the `orders` FK.
 *
 * A third, chunked `packages` query (same 100-id chunking as
 * useRoutePackages.ts, same reason: `.in('order_id', ...)` in one request
 * risks the URL/header length ceiling on a route with ~200+ orders) supplies
 * the package count per order, summed per block.
 *
 * MANDATORY per spec-72 phase 3 (see docs/specs/spec-72-blocks-delivery-sequence.md,
 * the "Known gap carried in from phase 2" note): this hook does NOT trust
 * `route_blocks` as a complete manifest of the route's orders. Every live
 * dispatch's order is independently checked against the live block list by
 * `comuna_id`:
 *   - `comuna_id IS NULL`               -> "sin comuna" (already planned)
 *   - `comuna_id IS NOT NULL`, no block -> orphan (scan-adopt / empty-draft gap)
 * Both surface in `unblocked`, distinguished by `reason`, so neither is ever
 * silently dropped from the screen — the exact silent-drop spec-72's
 * data-model section forbids.
 */
const ORDER_ID_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface RawBlockRow {
  id: string;
  comuna_id: string;
  sequence_index: number;
  sequence_source: SequenceSource;
  chile_comunas: { nombre: string } | { nombre: string }[] | null;
}

interface RawDispatchOrder {
  id: string;
  order_number: string;
  comuna_id: string | null;
  chile_comunas: { nombre: string } | { nombre: string }[] | null;
}

interface RawDispatchRow {
  id: string;
  order_id: string;
  orders: RawDispatchOrder | RawDispatchOrder[] | null;
}

function firstOf<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

export function useRouteBlocks(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'route-blocks', routeId],
    queryFn: async (): Promise<RouteBlocksResult> => {
      const supabase = createSPAClient();

      const [blocksRes, dispatchesRes] = await Promise.all([
        supabase
          .from('route_blocks')
          .select('id, comuna_id, sequence_index, sequence_source, chile_comunas(nombre)')
          .eq('route_id', routeId!)
          .eq('operator_id', operatorId!)
          .order('sequence_index', { ascending: true })
          .is('deleted_at', null),
        supabase
          .from('dispatches')
          .select('id, order_id, orders(id, order_number, comuna_id, chile_comunas(nombre))')
          .eq('route_id', routeId!)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null),
      ]);
      if (blocksRes.error) throw blocksRes.error;
      if (dispatchesRes.error) throw dispatchesRes.error;

      const blockRows = (blocksRes.data ?? []) as RawBlockRow[];
      const dispatchRows = (dispatchesRes.data ?? []) as RawDispatchRow[];

      const orders = dispatchRows
        .map((d) => firstOf(d.orders))
        .filter((o): o is RawDispatchOrder => !!o);

      // Package count per order — same chunking rationale as useRoutePackages.ts.
      const orderIds = [...new Set(orders.map((o) => o.id))];
      const packageCounts = new Map<string, number>();
      if (orderIds.length > 0) {
        for (const ids of chunk(orderIds, ORDER_ID_CHUNK_SIZE)) {
          const { data: pkgRows, error: pkgError } = await supabase
            .from('packages')
            .select('order_id')
            .in('order_id', ids)
            .eq('operator_id', operatorId!)
            .is('deleted_at', null);
          if (pkgError) throw pkgError;
          for (const p of pkgRows ?? []) {
            packageCounts.set(p.order_id, (packageCounts.get(p.order_id) ?? 0) + 1);
          }
        }
      }

      // Defensive client-side sort — the query already orders by
      // sequence_index, but this keeps the contract ("blocks render in
      // sequence_index order") true regardless of transport/query-layer
      // behaviour, not solely dependent on the ORDER BY reaching the client
      // unchanged.
      const sortedBlockRows = [...blockRows].sort((a, b) => a.sequence_index - b.sequence_index);

      const blocks: RouteBlockView[] = sortedBlockRows.map((b) => {
        const comuna = firstOf(b.chile_comunas);
        const comunaOrders = orders.filter((o) => o.comuna_id === b.comuna_id);
        return {
          id: b.id,
          comunaId: b.comuna_id,
          comunaName: comuna?.nombre ?? '—',
          sequenceIndex: b.sequence_index,
          sequenceSource: b.sequence_source,
          orderCount: comunaOrders.length,
          packageCount: comunaOrders.reduce((sum, o) => sum + (packageCounts.get(o.id) ?? 0), 0),
        };
      });

      // MANDATORY orphan/no-comuna surfacing — see header comment. The live
      // block list's comuna_id set is the only thing that decides "covered".
      const liveBlockComunaIds = new Set(blockRows.map((b) => b.comuna_id));
      const unblocked: UnblockedOrder[] = orders
        .filter((o) => o.comuna_id == null || !liveBlockComunaIds.has(o.comuna_id))
        .map((o) => ({
          orderId: o.id,
          orderNumber: o.order_number,
          comunaName: firstOf(o.chile_comunas)?.nombre ?? null,
          reason: o.comuna_id == null ? 'noComuna' : 'orphan',
        }));

      return { blocks, unblocked };
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
