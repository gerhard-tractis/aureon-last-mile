import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RoutePackage } from '@/lib/dispatch/types';
import { DISPATCHABLE_STATUSES } from '@/lib/dispatch/scan-validator';

// spec-74 phase 4 review item 6. `.in('order_id', orderIds)` puts one UUID
// (~36 chars) per order straight into the request's query string/header. A
// route with ~200+ orders approaches the ~8k ceiling most stacks enforce on
// a single request, which fails the WHOLE query (414) rather than degrading
// — and because this query feeds every row's box counts, that blanks the
// entire package list, not just the counts. Chunk well under any plausible
// ceiling and merge the results; 100 UUIDs per request stays comfortably
// inside it (~4k characters at most).
const ORDER_ID_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function useRoutePackages(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'packages', routeId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('id, order_id, status, stage, orders(order_number, customer_name, delivery_address, customer_phone)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;

      const rows = data ?? [];

      // spec-74 phase 4. `dispatches.stage` is per-ORDER; the per-BOX fact
      // (packages.loaded_at, phase 1) is what lets RouteBuilder/PackageRow
      // tell "1 of 3 bultos loaded" from "0 of 1". A second query, not a
      // nested embed: `packages` has no direct FK to `dispatches` — both
      // point at `orders` — so PostgREST cannot embed it through one round
      // trip from the query above. Same operator_id scoping and
      // deleted_at-is-null filter as the dispatches query.
      //
      // spec-74 phase 4 review item 3. `packages.status` is now selected
      // too. The seal (seal-route.ts) only ever treats a package as
      // "outstanding" when it is BOTH unloaded AND in DISPATCHABLE_STATUSES
      // — a `dañado` or `retenido` box must not block a seal, so the seal
      // never counts it. Before this, boxesTotal/boxesLoaded were
      // status-agnostic, so a stuck non-dispatchable box (a) inflated the
      // screen's "faltan" count above what the seal actually refuses over,
      // and (b) permanently capped the row below "N of N" — it could never
      // reach complete, because nothing can ever set that box's loaded_at.
      const orderIds = [...new Set(rows.map((d) => d.order_id).filter((id): id is string => !!id))];
      const boxesByOrder = new Map<string, { total: number; loaded: number }>();
      if (orderIds.length > 0) {
        const chunks = chunk(orderIds, ORDER_ID_CHUNK_SIZE);
        for (const ids of chunks) {
          const { data: pkgRows, error: pkgError } = await supabase
            .from('packages')
            .select('order_id, loaded_at, load_inferred, status')
            .in('order_id', ids)
            .eq('operator_id', operatorId!)
            .is('deleted_at', null);
          // M7: a swallowed error here is silent data loss, not a thrown
          // failure — pkgRows would come back undefined/null and every
          // order in this chunk would render as if it had zero live
          // packages, hiding a route the seal will still refuse (item 2's
          // failure shape, reached a different way). Regression-tested in
          // useRoutePackages.test.ts.
          if (pkgError) throw pkgError;
          for (const p of pkgRows ?? []) {
            // A package counts toward the total when it is either already
            // loaded (loaded_at set — it may since have moved OUT of
            // DISPATCHABLE_STATUSES, e.g. to `en_carga`, and must not drop
            // out of the denominator for that) or still eligible to be
            // loaded (status in DISPATCHABLE_STATUSES). A package that is
            // neither — dañado, retenido, entregado, etc., never loaded —
            // is excluded entirely: it cannot become loaded, so counting it
            // would both overstate "faltan" and make the row unable to ever
            // reach "N of N", exactly the seal-vs-screen disagreement this
            // phase exists to remove.
            const dispatchable = (DISPATCHABLE_STATUSES as readonly string[]).includes(p.status);
            if (!p.loaded_at && !dispatchable) continue;
            const entry = boxesByOrder.get(p.order_id) ?? { total: 0, loaded: 0 };
            entry.total += 1;
            // spec-77 review MEDIUM: `loaded_at` alone is not "genuinely
            // loaded" — spec-74's backfill set it with `load_inferred: true`
            // on packages that were never actually scanned onto the truck.
            // The seal's own gates (force-seal-split.ts,
            // seal-adopted-completeness.ts) use `loaded_at IS NOT NULL AND
            // load_inferred = false` as the one discriminator for "genuinely
            // loaded"; this screen must agree, or its "cargados" count
            // promises a box travels when the seal's final
            // `UPDATE packages ... WHERE status = 'en_carga'` leaves it on
            // the dock.
            if (p.loaded_at && !p.load_inferred) entry.loaded += 1;
            boxesByOrder.set(p.order_id, entry);
          }
        }
      }

      return rows.map((d): RoutePackage => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        const stage = d.stage as RoutePackage['stage'];
        const boxes = boxesByOrder.get(d.order_id ?? '') ?? { total: 0, loaded: 0 };
        // spec-74 phase 4 review item 2. `route_stop_counts` (what the seal's
        // first gate reads) counts a non-staged order as pending purely from
        // `dispatches.stage`, with no regard for how many `packages` rows it
        // has — an order planned before `expand_carton` minted its packages,
        // or one whose packages were all later soft-deleted, is reachable
        // and still refused by the seal. Before this floor, such an order's
        // boxesTotal/boxesLoaded came back 0/0, RouteBuilder's pendingCount
        // summed in a 0 for it, and the "faltan por estibar" banner hid
        // exactly the route the seal was about to refuse. Flooring at 1
        // whenever the order is not `staged` and has no countable live
        // package makes the screen say "at least one box outstanding" —
        // which is never wrong (a non-staged order is, by definition, not
        // known-complete) even though it cannot show a real box count for
        // an order with no live packages to count.
        const total = stage !== 'staged' && boxes.total === 0 ? 1 : boxes.total;
        return {
          dispatch_id: d.id,
          order_id: d.order_id ?? '',
          order_number: ord?.order_number ?? '',
          contact_name: ord?.customer_name ?? null,
          contact_address: ord?.delivery_address ?? null,
          contact_phone: ord?.customer_phone ?? null,
          status: d.status as RoutePackage['status'],
          // spec-70 decision 4: the plan/load gap has to be visible while
          // loading, not just at the seal refusal — this is what lets
          // RouteBuilder show "faltan N por estibar" live.
          stage,
          // spec-74 phase 4.
          boxesTotal: total,
          boxesLoaded: boxes.loaded,
        };
      });
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
