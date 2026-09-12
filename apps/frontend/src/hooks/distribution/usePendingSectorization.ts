import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useDockZones } from './useDockZones';
import type { DockZoneRecord } from './useDockZones';
import { determineDockZone } from '@/lib/distribution/sectorization-engine';
import type { ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

/**
 * PostgREST's row cap (`packages/database/supabase/config.toml`'s
 * `max_rows`). A response landing on exactly this many rows must be
 * treated as truncated, not complete.
 *
 * Fase 8 review round 3 — this used to THROW (`assertNotTruncated`), which
 * fixed the andenes banner (a silently-wrong 0 is worse than an error on a
 * derived count) but broke the other three consumers of this same hook:
 * `/pendientes` (Fase 2) and quicksort are OPERATIONAL work queues, and
 * `/batch` needs the same rows to start a lote. At production scale a real
 * truncation would hard-error a crew that could perfectly well keep
 * working from the first 1000 pendientes — the `useEnRutaSnapshot.ts`
 * precedent this was copied from is a monitoring dashboard, where refusing
 * to show a number IS the safe failure; a work queue is the opposite case.
 *
 * So: report, don't throw. `queryFn` returns `{ groups, truncated }`, and
 * the four consumers that only destructure `data` (unchanged shape below)
 * never see `truncated` at all unless they ask for it — `/andenes` is the
 * only one that currently does, and treats it as "unknown", never zero.
 *
 * Open finding: `MAX_ROWS_PER_QUERY` is duplicated with
 * `hooks/dispatch/useEnRutaSnapshot.ts`'s own constant (not imported —
 * that hook doesn't export it, and `hooks/dispatch/` is a different
 * module this phase does not touch). Once this shape change and Fase 2/
 * Fase 4 are merged, a shared `lib/supabase/` module exposing BOTH a
 * `truncated` flag and a throwing `assertNotTruncated` variant is worth
 * building, with `useEnRutaSnapshot.ts` migrated onto it — the two hooks
 * want different failure behaviour (work queue vs. derived monitoring
 * number), not different math.
 */
const MAX_ROWS_PER_QUERY = 1000;

export interface SkuItem {
  sku: string;
  description: string;
  quantity: number;
}

export interface PendingPackage {
  id: string;
  label: string;
  order_id: string;
  orderNumber: string;
  comunaId: string | null;
  comunaName: string | null;
  delivery_date: string;
  skuItems: SkuItem[];
}

export interface OrderGroup {
  orderId: string;
  orderNumber: string;
  deliveryDate: string;
  comunaName: string | null;
  packages: PendingPackage[];
}

export interface ZoneGroup {
  /**
   * spec-68 Fase 3 review — this is a `DockZoneRecord` (from useDockZones),
   * not the narrower `DockZone` the sectorization engine's own params use.
   * It was mistyped as `DockZone` before, which silently dropped
   * `operator_id`/`capacity` from the type even though the runtime object
   * always carries them (`zones.find(...)` below reads straight off
   * useDockZones's data) — consumers that need `capacity` (SendToDockSheet)
   * were forced into an unsound cast to get it.
   */
  zone: DockZoneRecord;
  matchResult: ZoneMatchResult;
  orders: OrderGroup[];
}

interface RawSkuItem {
  sku?: unknown;
  description?: unknown;
  quantity?: unknown;
}

function normalizeSkuItems(raw: unknown): SkuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is RawSkuItem => typeof it === 'object' && it !== null)
    .map(it => ({
      sku: typeof it.sku === 'string' ? it.sku : '',
      description: typeof it.description === 'string' ? it.description : '',
      quantity: typeof it.quantity === 'number' ? it.quantity : 1,
    }));
}

interface PendingSectorizationResult {
  groups: ZoneGroup[];
  /** True when the `packages` fetch landed on PostgREST's row cap — see
   *  `MAX_ROWS_PER_QUERY`'s doc. `false` for every consumer that predates
   *  this field and never checks it; only `/andenes` reads it today. */
  truncated: boolean;
}

export function usePendingSectorization(operatorId: string | null, now: Date = new Date()) {
  const { data: zones } = useDockZones(operatorId);

  const query = useQuery({
    queryKey: ['distribution', 'pending-sectorization', operatorId],
    queryFn: async (): Promise<PendingSectorizationResult> => {
      const supabase = createSPAClient();
      // spec-68 Fase 3 review — this was the UTC date, the same bug
      // Fase 2 fixed in DistributionMobileView's todayISOFrom. Pre-existing
      // here (predates this branch), fixed in passing because it directly
      // degrades the pendientes screen this branch ships.
      //
      // Direction, worked through against isDeliveryDateActive: Santiago
      // is UTC-4/-3, so it is never AHEAD of UTC — the UTC calendar date
      // can only equal or lead the Santiago one, never trail it. So the
      // old `today` could only be advanced relative to the real Santiago
      // "today", never behind it, which can only make the `delivery <=
      // tomorrow` active-window cutoff MORE permissive, never less. Net
      // effect: during the Santiago evening rollover window, a delivery
      // genuinely two-plus days out (which should read `future_date` and
      // stay in consolidation) fell inside the artificially-advanced
      // window and got routed to a live andén a day early — packages
      // escaping consolidation too soon, not being pushed into it. See
      // the regression test below.
      const today = todayISOInTimezone(now);

      const { data, error } = await supabase
        .from('packages')
        .select(
          'id, label, order_id, sku_items, orders!inner(order_number, comuna_id, delivery_date, chile_comunas(nombre))'
        )
        .eq('operator_id', operatorId!)
        .eq('status', 'en_bodega')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (!data || !zones || zones.length === 0) return { groups: [], truncated: false };
      const truncated = data.length >= MAX_ROWS_PER_QUERY;

      // Pass 1: group packages into zone buckets
      const zoneMap = new Map<string, { zone: DockZoneRecord; matchResult: ZoneMatchResult; orderMap: Map<string, OrderGroup> }>();

      for (const pkg of data) {
        const order = pkg.orders as {
          order_number: string;
          comuna_id: string | null;
          delivery_date: string;
          chile_comunas: { nombre: string } | null;
        };
        const matchResult = determineDockZone(
          { comunaId: order.comuna_id, delivery_date: order.delivery_date },
          zones,
          today
        );

        let zoneBucket = zoneMap.get(matchResult.zone_id);
        if (!zoneBucket) {
          const zone = zones.find(z => z.id === matchResult.zone_id)!;
          zoneBucket = { zone, matchResult, orderMap: new Map() };
          zoneMap.set(matchResult.zone_id, zoneBucket);
        }

        const pendingPkg: PendingPackage = {
          id: pkg.id,
          label: pkg.label,
          order_id: pkg.order_id,
          orderNumber: order.order_number,
          comunaId: order.comuna_id,
          comunaName: order.chile_comunas?.nombre ?? null,
          delivery_date: order.delivery_date,
          skuItems: normalizeSkuItems(pkg.sku_items),
        };

        let orderGroup = zoneBucket.orderMap.get(pkg.order_id);
        if (!orderGroup) {
          orderGroup = {
            orderId: pkg.order_id,
            orderNumber: order.order_number,
            deliveryDate: order.delivery_date,
            comunaName: order.chile_comunas?.nombre ?? null,
            packages: [],
          };
          zoneBucket.orderMap.set(pkg.order_id, orderGroup);
        }
        orderGroup.packages.push(pendingPkg);
      }

      // Pass 2: sort packages within each order (label ASC), sort orders by deliveryDate ASC
      const groups = Array.from(zoneMap.values()).map(({ zone, matchResult, orderMap }) => {
        const orders = Array.from(orderMap.values());
        for (const og of orders) {
          og.packages.sort((a, b) => a.label.localeCompare(b.label));
        }
        orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
        return { zone, matchResult, orders };
      });
      return { groups, truncated };
    },
    enabled: !!operatorId && !!zones && zones.length > 0,
    staleTime: 15_000,
  });

  // Unwrap `{ groups, truncated }` back to a plain `ZoneGroup[]` on `data`
  // — every existing consumer (`/pendientes`, quicksort, `/batch`, `/batch/
  // [batchId]`) destructures `data` expecting exactly that shape and never
  // asks about truncation; they get the same rows they always did, silently
  // unaffected. `truncated` is additive, read today only by `/andenes`.
  return {
    ...query,
    data: query.data?.groups,
    truncated: query.data?.truncated ?? false,
  };
}
