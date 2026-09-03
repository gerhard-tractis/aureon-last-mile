import type { PreRouteAnden } from '@/lib/types';

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

function encodeList(items: string[]): string {
  return items.map(encodeURIComponent).join(',');
}

function decodeList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').filter(Boolean).map(decodeURIComponent);
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
