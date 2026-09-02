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
 *
 * spec-72 phase 5 — planned-vs-actual, read-only presentation over
 * `dispatches.actual_sequence` (Decision 4). `compute_route_actual_sequence`
 * (packages/database, phase 5) writes that column once a route completes;
 * this hook does not write anything, only rolls it up to block granularity:
 * a block's `actualRank` is its member dispatches' EARLIEST actual_sequence
 * (the block's first stop to actually arrive), turned into a 1-based rank
 * among ONLY the blocks that have at least one dispatch with a non-NULL
 * actual_sequence — a route mid-delivery, where most blocks have no arrivals
 * yet, must not have those blocks' absence of data misread as "arrived
 * last". A block with zero ranked arrivals gets `actualRank: null`
 * ("no data yet"), never a fabricated trailing position.
 *
 * `outOfSequence` compares that `actualRank` against the block's PLANNED
 * rank — its 1-based position among the SAME population, i.e. among the
 * blocks that have arrival data, taken in `sequence_index` order. Both sides
 * of the comparison must be drawn from the ranked blocks only: a block with
 * no arrival at all (a skipped or failed stop, which a completed route can
 * legitimately contain) otherwise shifts every later block's planned
 * position by one, flagging a perfectly in-order route as out of sequence.
 * It is a POSITION either way, never the raw `sequence_index`, which is not
 * contiguous (a soft-deleted block leaves gaps like 1, 2, 4) and would make
 * an untouched block look "out of sequence" on a purely numerical mismatch
 * that has nothing to do with delivery order.
 *
 * Orphan exclusion (mandatory, matching the `unblocked` rule above): an
 * orphan dispatch (comuna_id set, no live block covering it) is never
 * pulled into ANY block's actual-rank rollup — it is filtered out at the
 * same `liveBlockComunaIds` check `unblocked` already uses, before the
 * per-block grouping happens. An order that was never in the planned
 * sequence must never register as "out of sequence" against it.
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
  actual_sequence: number | null;
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
          .select('id, order_id, actual_sequence, orders(id, order_number, comuna_id, chile_comunas(nombre))')
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

      // spec-72 phase 5 — one (comunaId, actualSequence) pair per live
      // dispatch, kept alongside `orders` (not folded into it) because
      // `actual_sequence` lives on the dispatch row, not the order. Orphan
      // dispatches (comuna_id null, or comuna_id not covered by any live
      // block) are excluded below, at the same `liveBlockComunaIds` check
      // `unblocked` uses — never rolled into a block's actual-rank rollup.

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

      // MANDATORY orphan/no-comuna surfacing — see header comment. The live
      // block list's comuna_id set is the only thing that decides "covered".
      // Computed before the block map below so phase 5's actual-rank rollup
      // can use the SAME set to exclude orphan dispatches.
      const liveBlockComunaIds = new Set(blockRows.map((b) => b.comuna_id));

      // spec-72 phase 5 — this route's earliest actual_sequence per comuna,
      // over LIVE, NON-ORPHAN dispatches only (a dispatch whose order has no
      // comuna_id, or a comuna_id no live block covers, is excluded — it was
      // never part of the planned sequence, so it must never count toward,
      // or be judged against, one). `Number.POSITIVE_INFINITY` sentinel
      // keeps this a plain min-reduce with no separate "seen" bookkeeping.
      const minActualByComuna = new Map<string, number>();
      for (const d of dispatchRows) {
        if (d.actual_sequence == null) continue;
        const order = firstOf(d.orders);
        const comunaId = order?.comuna_id ?? null;
        if (comunaId == null || !liveBlockComunaIds.has(comunaId)) continue;
        const prev = minActualByComuna.get(comunaId) ?? Number.POSITIVE_INFINITY;
        if (d.actual_sequence < prev) minActualByComuna.set(comunaId, d.actual_sequence);
      }

      // Rank ONLY the blocks that have at least one arrival so far — a block
      // with no data yet is "unknown", never assumed last. Ties (identical
      // earliest actual_sequence across two blocks — not produced by
      // compute_route_actual_sequence's own per-route ROW_NUMBER, but
      // actual_sequence is a plain integer column a correction or backfill
      // can duplicate) break by PLANNED order, so the result never depends on
      // the order the unordered dispatches query happened to return.
      const plannedOrderByComuna = new Map<string, number>();
      sortedBlockRows.forEach((b, i) => plannedOrderByComuna.set(b.comuna_id, i));
      const rankedComunaIds = [...minActualByComuna.entries()]
        .sort(
          (a, b) =>
            a[1] - b[1] ||
            (plannedOrderByComuna.get(a[0]) ?? 0) - (plannedOrderByComuna.get(b[0]) ?? 0),
        )
        .map(([comunaId]) => comunaId);
      const actualRankByComuna = new Map<string, number>();
      rankedComunaIds.forEach((comunaId, i) => actualRankByComuna.set(comunaId, i + 1));

      // REVIEW FIX — the planned side of the comparison must be drawn from the
      // SAME population as `actualRank`: the blocks that have arrival data.
      // `actualRank` is a rank among ranked blocks only, so comparing it to a
      // position in the FULL block list is an apples-to-oranges comparison —
      // one un-arrived block (a skipped or failed stop, which a completed
      // route can legitimately contain) shifts every later block's planned
      // position by one and flags a perfectly in-order route as out of
      // sequence (and, symmetrically, hides a real inversion). So: planned
      // rank = 1-based position among the RANKED blocks, in sequence_index
      // order. Still a position, never the raw `sequence_index`, which is not
      // contiguous after a soft delete.
      const plannedRankByComuna = new Map<string, number>();
      sortedBlockRows
        .filter((b) => actualRankByComuna.has(b.comuna_id))
        .forEach((b, i) => plannedRankByComuna.set(b.comuna_id, i + 1));

      const blocks: RouteBlockView[] = sortedBlockRows.map((b) => {
        const comuna = firstOf(b.chile_comunas);
        const comunaOrders = orders.filter((o) => o.comuna_id === b.comuna_id);
        const actualRank = actualRankByComuna.get(b.comuna_id) ?? null;
        const plannedRank = plannedRankByComuna.get(b.comuna_id) ?? null;
        return {
          id: b.id,
          comunaId: b.comuna_id,
          comunaName: comuna?.nombre ?? '—',
          sequenceIndex: b.sequence_index,
          sequenceSource: b.sequence_source,
          orderCount: comunaOrders.length,
          packageCount: comunaOrders.reduce((sum, o) => sum + (packageCounts.get(o.id) ?? 0), 0),
          actualRank,
          outOfSequence: actualRank != null && plannedRank != null && actualRank !== plannedRank,
        };
      });

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
