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

/**
 * A page-owned marker, outside Task 4's `OrdersListFilters` schema
 * entirely (same idea as `PAGE_PARAM`) — `filtros=0` on the URL.
 *
 * Why this needs to exist (controller review, round 4): Task 4's
 * `searchParamsToState` returns all-null filters for a bare query string,
 * and OrdersPage merges the active preset's own implied filters back in
 * whenever the URL's filters are empty (see `page.tsx`'s one-time
 * normalization). "Limpiar" also produces an all-null filter set — by
 * design, it means "no filters, even the preset's own." Without this
 * marker those two states are byte-identical on the wire
 * (`?vista=en-reparto`), so a cleared view, once shared, silently comes
 * back with the preset's filters re-applied for the recipient — exactly
 * the bug the URL-as-single-source-of-truth design exists to prevent.
 * `filtros=0` breaks the tie: present, it means "empty is deliberate,
 * don't merge"; absent, an empty filter set is interpreted as "not yet
 * decided," and the preset's own filters apply.
 */
export const CLEARED_PARAM = 'filtros';

export function isEmptyFilters(filters: OrdersListFilters): boolean {
  return Object.values(filters).every((v) => v === null);
}

/** True only for the exact marker `buildQueryString(..., { markCleared: true })` writes. */
export function isExplicitlyCleared(params: URLSearchParams): boolean {
  return params.get(CLEARED_PARAM) === '0';
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
  options?: { markCleared?: boolean },
): string {
  const params = filtersToSearchParams(presetId, filters);
  if (page > 0) params.set(PAGE_PARAM, String(page));
  if (options?.markCleared) params.set(CLEARED_PARAM, '0');
  return params.toString();
}

export function paginationLabel(page: number, rowsCount: number, totalCount: number): string {
  if (totalCount === 0) return '0 de 0';
  const start = page * ORDERS_LIST_PAGE_SIZE + 1;
  const end = start + rowsCount - 1;
  return `${start}–${end} de ${totalCount}`;
}

/**
 * A stale shared link (or a manually edited `pagina`) can point past the
 * last page a filtered view actually has — reachable in a feature built
 * around shareable links, not hypothetical (controller review, round 4).
 * `totalCount` is only known after the query returns, so the page
 * component clamps and redirects once data is in, rather than trying to
 * guess a valid page before asking.
 */
export function clampPage(page: number, totalCount: number): number {
  const totalPages = Math.max(1, Math.ceil(totalCount / ORDERS_LIST_PAGE_SIZE));
  return Math.min(page, totalPages - 1);
}

/**
 * `OrdersListFilters.search` (`p_search` on `get_orders_list`) is
 * deliberately never set from this screen — `3a` has no search input of
 * its own. The mock's "Buscar orden, paquete o RUT…" box is the spec-54
 * global topbar search, not a Pedidos control, so this filter exists
 * (and round-trips through the URL/chips) for whatever wires it later —
 * e.g. the inspector's own search/palette — not for this page to fill in.
 *
 * `downloadCurrentPageCsv` mirrors `OrdersBulkBar`'s own CSV download
 * (Task 5), duplicated rather than imported because that one is private to
 * the bulk bar and this is a second, independent export — of the current
 * *page's loaded rows* (up to `ORDERS_LIST_PAGE_SIZE`), not the *selected*
 * rows and NOT every row of `totalCount`. The header button is labelled
 * "Exportar página (N)" precisely so this scope is never implicit — a
 * label promising more than a 50-row page while `totalCount` reads in the
 * thousands is a trust bug a user only discovers after opening the file
 * (controller review, round 3).
 *
 * A true full-dataset export (every row of `totalCount`, regardless of
 * page) is real new logic, not wiring, and deliberately not built here.
 * Two ways to get there, for whoever picks this up:
 *   1. A server-side CSV RPC (e.g. `export_orders_list_csv` mirroring
 *      `get_orders_list`'s filters but no `p_limit`/`p_offset`) that
 *      streams/returns the formatted CSV directly from Postgres.
 *   2. A client-side loop calling `useOrdersList`-shaped queries page by
 *      page until `rows.length * pages >= totalCount`, concatenating.
 * Pick (1): a `totalCount` in the thousands means (2) would pull every
 * matching row's full row width across the network into the browser just
 * to re-serialize it as text the browser already had the columns for —
 * wasted bandwidth and a multi-second UI freeze on the client for
 * something Postgres can format in one pass. (1) also composes with the
 * existing RLS/`operator_id` scoping `get_orders_list` already has, where
 * (2) would just be that same RPC called N times from the client.
 */
export function downloadCurrentPageCsv(rows: OrdersListRow[]) {
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
