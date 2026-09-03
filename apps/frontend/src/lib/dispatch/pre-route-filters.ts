import type { PreRouteAnden, PreRouteSnapshot } from '@/lib/types';

/**
 * spec-75 task 2b — the pre-ruta filter set beyond date/window: comuna,
 * andén, cliente, "sólo con problemas" and free-text búsqueda. Unlike the
 * date and window filters, `get_pre_route_snapshot` has no RPC params for
 * these — the whole snapshot for the day/window comes back and this module
 * narrows it client-side, purely so the logic is unit-testable apart from
 * any component.
 *
 * Filtering happens on the andén → comuna → orders tree the snapshot
 * returns, not on the flattened `UnroutedGroup` rows `useUnroutedGroups`
 * builds — `buildGroups` runs on the *filtered* tree, so PreRouteBoard
 * calls `applyPreRouteFilters` before `buildGroups`, not after.
 *
 * order_count/package_count on a comuna or andén are the RPC's own figures
 * for the *unfiltered* snapshot. Once an order-level filter (cliente,
 * onlyProblems, search) drops orders out of a comuna, those counts would
 * lie about what's actually left — so this module recomputes both from the
 * filtered `orders` arrays rather than carrying the RPC's numbers forward.
 *
 * `onlyProblems` ("sólo con problemas") only ever narrows to
 * `has_split_dock_zone` orders — it cannot also surface the unmapped
 * comunas the spec mentions alongside it. `unmapped_comunas` in the
 * snapshot is `{id, name, order_count, package_count}[]`: it carries no
 * `orders` array, so there is nothing to filter *to* — those comunas were
 * never routable rows to begin with. `UnmappedComunasNotice` (rendered
 * unconditionally above the board) is the coverage for that half; this
 * toggle doesn't hide or show it.
 */

export interface PreRouteFilterState {
  comunaIds: string[];
  andenIds: string[];
  clientes: string[];
  onlyProblems: boolean;
  search: string;
}

export interface FilterOption {
  id: string;
  name: string;
}

/** Distinct comunas across every andén, in first-seen order (de-duplicated by id). */
export function collectComunaOptions(andenes: PreRouteAnden[]): FilterOption[] {
  const seen = new Map<string, FilterOption>();
  for (const anden of andenes) {
    for (const comuna of anden.comunas) {
      if (!seen.has(comuna.id)) seen.set(comuna.id, { id: comuna.id, name: comuna.name });
    }
  }
  return [...seen.values()];
}

/** One option per andén. */
export function collectAndenOptions(andenes: PreRouteAnden[]): FilterOption[] {
  return andenes.map((a) => ({ id: a.id, name: a.name }));
}

/** Distinct customer names across every order, alphabetically. */
export function collectClienteOptions(andenes: PreRouteAnden[]): string[] {
  const names = new Set<string>();
  for (const anden of andenes) {
    for (const comuna of anden.comunas) {
      for (const order of comuna.orders) names.add(order.customer_name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function matchesSearch(search: string, orderNumber: string, address: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return orderNumber.toLowerCase().includes(needle) || address.toLowerCase().includes(needle);
}

/**
 * Narrows the snapshot's andén → comuna → orders tree by comuna, andén,
 * cliente, "sólo con problemas" and búsqueda (order number + address; SKU
 * search is not possible — `sku_items` is not part of the snapshot).
 * Filters combine with AND. Andenes/comunas left with zero orders after an
 * order-level filter are dropped rather than rendered empty.
 */
export function applyPreRouteFilters(
  andenes: PreRouteAnden[],
  filters: PreRouteFilterState,
): PreRouteAnden[] {
  const result: PreRouteAnden[] = [];

  for (const anden of andenes) {
    if (filters.andenIds.length > 0 && !filters.andenIds.includes(anden.id)) continue;

    const comunas = [];
    for (const comuna of anden.comunas) {
      if (filters.comunaIds.length > 0 && !filters.comunaIds.includes(comuna.id)) continue;

      const orders = comuna.orders.filter((order) => {
        if (filters.clientes.length > 0 && !filters.clientes.includes(order.customer_name)) return false;
        if (filters.onlyProblems && !order.has_split_dock_zone) return false;
        if (!matchesSearch(filters.search, order.order_number, order.delivery_address)) return false;
        return true;
      });
      if (orders.length === 0) continue;

      comunas.push({
        ...comuna,
        orders,
        order_count: orders.length,
        package_count: orders.reduce((sum, o) => sum + o.package_count, 0),
      });
    }
    if (comunas.length === 0) continue;

    result.push({
      ...anden,
      comunas,
      order_ids: comunas.flatMap((c) => c.orders.map((o) => o.id)),
      order_count: comunas.reduce((sum, c) => sum + c.order_count, 0),
      package_count: comunas.reduce((sum, c) => sum + c.package_count, 0),
    });
  }

  return result;
}

/**
 * Whether any comuna/andén/cliente/problems/búsqueda filter is currently
 * narrowing the view (date and ventana don't count — they're the RPC's own
 * cohort, not a client-side narrowing of it). Drives the "Mostrando X de Y"
 * qualifier on the filter bar's totals and the header's SIN RUTEAR figure.
 */
export function hasActivePreRouteFilters(filters: PreRouteFilterState): boolean {
  return (
    filters.comunaIds.length > 0 ||
    filters.andenIds.length > 0 ||
    filters.clientes.length > 0 ||
    filters.onlyProblems ||
    filters.search.trim() !== ''
  );
}

/**
 * Totals for the *filtered* andén→comuna→orders tree, in the same shape as
 * `PreRouteSnapshot['totals']` — so PreRouteFilters can show "Mostrando X
 * de Y" against the RPC's own unfiltered totals without a second,
 * differently-shaped totals type. Code-review finding: the filter bar's
 * totals line used to just echo the unfiltered snapshot totals, sitting
 * inline with the very controls that had just narrowed the view without
 * ever reflecting them.
 */
export function summariseFilteredTotals(andenes: PreRouteAnden[]): PreRouteSnapshot['totals'] {
  let order_count = 0;
  let package_count = 0;
  let split_dock_zone_order_count = 0;
  for (const anden of andenes) {
    for (const comuna of anden.comunas) {
      for (const order of comuna.orders) {
        order_count += 1;
        package_count += order.package_count;
        if (order.has_split_dock_zone) split_dock_zone_order_count += 1;
      }
    }
  }
  return { order_count, package_count, anden_count: andenes.length, split_dock_zone_order_count };
}

function encodeList(items: string[]): string {
  return items.map(encodeURIComponent).join(',');
}

/** decodeURIComponent throws on a malformed percent-escape (e.g. a lone
 *  trailing `%` from a URL truncated in a chat paste). This runs in
 *  PreRouteBoard's render body, so an uncaught throw here would take the
 *  whole Pre-ruta screen to the error boundary — precisely the sharing
 *  case URL-encoded filter state exists to support. Fall back to the raw
 *  (still-encoded) segment for that one entry instead of failing the whole
 *  list. */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function decodeList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').filter(Boolean).map(decodeSegment);
}

/** Reads the comuna/andén/cliente/problems/búsqueda filters out of the URL. */
export function parsePreRouteFilterState(params: URLSearchParams): PreRouteFilterState {
  return {
    comunaIds: decodeList(params.get('comunas')),
    andenIds: decodeList(params.get('andenes')),
    clientes: decodeList(params.get('clientes')),
    onlyProblems: params.get('problems') === '1',
    search: params.get('q') ?? '',
  };
}

/** Writes a full filter state out as a fresh URLSearchParams (empty/false fields omitted). */
export function serializePreRouteFilterState(state: PreRouteFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.comunaIds.length > 0) params.set('comunas', encodeList(state.comunaIds));
  if (state.andenIds.length > 0) params.set('andenes', encodeList(state.andenIds));
  if (state.clientes.length > 0) params.set('clientes', encodeList(state.clientes));
  if (state.onlyProblems) params.set('problems', '1');
  if (state.search) params.set('q', state.search);
  return params;
}
