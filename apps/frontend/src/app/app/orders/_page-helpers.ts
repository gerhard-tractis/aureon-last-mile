/**
 * spec-65 Task 6 — pure, non-JSX helpers for `/app/orders`'s `page.tsx`.
 *
 * Split out purely to keep `page.tsx` under the project's 300-line limit —
 * none of this depends on React. `page.test.tsx` already exercises all of
 * it indirectly through the page; the direct unit tests here are for the
 * edge cases (malformed `pagina` params, zero-result pagination labels)
 * that are awkward to provoke through a full page render.
 */

import { ORDERS_LIST_PAGE_SIZE, type OrdersListFilters, type OrdersListRow } from '@/hooks/useOrdersList';
import { filtersToSearchParams, type OrderViewPresetId } from '@/lib/orders/order-view-presets';
import { getStatusLabel } from '@/components/StatusBadge';
import { ordersToCsv } from '@/lib/orders/orders-csv';
import type { StatusFilterOption } from './components/OrderFilterRail';

/** The eleven `order_status_enum` values (lib/types.ts) — not a facet count query, just the label list. */
const ORDER_STATUS_ENUM_VALUES = [
  'ingresado',
  'verificado',
  'en_bodega',
  'asignado',
  'en_carga',
  'listo_para_despacho',
  'en_ruta',
  'entregado',
  'cancelado',
  'en_retorno',
  'parcialmente_entregado',
] as const;

/**
 * No facet-count RPC produces a per-status total over the whole dataset
 * (spec-65 Task 6 ruling — getting all eleven would mean eleven queries per
 * page load). `count` is simply omitted — `StatusFilterOption.count` is
 * optional precisely so the rail can render the label alone instead of a
 * fabricated `0`, which would read as "zero orders of this status" and be
 * false. (Controller review, round 2: this was originally `count: 0`; the
 * fix was to make the field optional in OrderFilterRail itself, not to
 * patch around it here.)
 */
export const STATUS_OPTIONS: StatusFilterOption[] = ORDER_STATUS_ENUM_VALUES.map((status) => ({
  status,
  label: getStatusLabel(status, 'order'),
}));

/**
 * `useActiveRoutes` only covers routes with dispatches today/in progress,
 * not the full historical route universe an order-list filter might
 * reasonably want. Shown to the user via `routeOptionsNote` on
 * `OrderFilterRail` rather than left silent — a route missing from the
 * list should read as "this view doesn't cover it," not "no such route
 * exists" (spec-65 Task 6 ruling, round 2).
 */
export const ROUTE_OPTIONS_NOTE = 'Solo rutas activas';

export const PAGE_PARAM = 'pagina';

export function isEmptyFilters(filters: OrdersListFilters): boolean {
  return Object.values(filters).every((v) => v === null);
}

export function getPageFromParams(params: URLSearchParams): number {
  const raw = params.get(PAGE_PARAM);
  const parsed = raw ? Number(raw) : 0;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function buildQueryString(
  presetId: OrderViewPresetId,
  filters: OrdersListFilters,
  page: number,
): string {
  const params = filtersToSearchParams(presetId, filters);
  if (page > 0) params.set(PAGE_PARAM, String(page));
  return params.toString();
}

export function paginationLabel(page: number, rowsCount: number, totalCount: number): string {
  if (totalCount === 0) return '0 de 0';
  const start = page * ORDERS_LIST_PAGE_SIZE + 1;
  const end = start + rowsCount - 1;
  return `${start}–${end} de ${totalCount}`;
}

/**
 * `OrdersListFilters.search` (`p_search` on `get_orders_list`) is
 * deliberately never set from this screen — `3a` has no search input of
 * its own. The mock's "Buscar orden, paquete o RUT…" box is the spec-54
 * global topbar search, not a Pedidos control, so this filter exists
 * (and round-trips through the URL/chips) for whatever wires it later —
 * e.g. the inspector's own search/palette — not for this page to fill in.
 *
 * `downloadCurrentViewCsv` mirrors `OrdersBulkBar`'s own CSV download
 * (Task 5), duplicated rather than imported because that one is private to
 * the bulk bar and this is a second, independent export of the *current
 * filtered view* (all loaded rows) rather than the *selected* rows.
 */
export function downloadCurrentViewCsv(rows: OrdersListRow[]) {
  const csv = ordersToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pedidos-vista-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
