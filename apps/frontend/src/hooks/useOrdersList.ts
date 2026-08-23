'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';

/**
 * spec-65 Task 3 — the Pedidos global order list.
 *
 * Wraps get_orders_list (20260823000002), which takes 14 positional
 * parameters and returns a page plus `total_count` (a COUNT(*) OVER(), the
 * filtered/unpaginated total repeated on every row) in one round trip.
 *
 * `filters` maps 1:1 onto the RPC's own parameters — no extras invented here.
 * NULL means "no filter" for every one of them, exactly as the RPC expects,
 * so EMPTY_ORDERS_LIST_FILTERS is all-null rather than empty arrays/strings.
 *
 * p_sla is TEXT[], not a scalar: the "SLA en riesgo" view (and the nav badge
 * it must agree with) needs `sla_status IN ('late', 'at_risk')` in one call.
 */

export interface OrdersListFilters {
  dateFrom: string | null;
  dateTo: string | null;
  statuses: string[] | null;
  sla: string[] | null;
  routeIds: string[] | null;
  driver: string | null;
  client: string | null;
  comunas: string[] | null;
  hasPod: boolean | null;
  minAttempts: number | null;
  search: string | null;
}

// Frozen: this is a shared module-level object that callers pass straight into
// the query key. A caller mutating it in place would silently poison every
// other consumer's cache key rather than just their own — freezing turns that
// into a thrown TypeError (strict mode) instead of a hard-to-trace cache bug.
export const EMPTY_ORDERS_LIST_FILTERS: OrdersListFilters = Object.freeze({
  dateFrom: null,
  dateTo: null,
  statuses: null,
  sla: null,
  routeIds: null,
  driver: null,
  client: null,
  comunas: null,
  hasPod: null,
  minAttempts: null,
  search: null,
});

export interface OrdersListRow {
  id: string;
  order_number: string;
  customer_name: string;
  leading_status: string;
  comuna: string;
  package_count: number;
  route_label: string | null;
  driver_name: string | null;
  sla_status: string;
  minutes_remaining: number | null;
  last_event_at: string | null;
  last_event_label: string | null;
  has_pod: boolean;
  total_count: number;
}

export interface OrdersListPage {
  rows: OrdersListRow[];
  totalCount: number;
}

export const ORDERS_LIST_PAGE_SIZE = 50;

export function useOrdersList(operatorId: string | null, filters: OrdersListFilters, page: number) {
  return useQuery<OrdersListPage>({
    queryKey: ['orders-list', operatorId, filters, page],
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await callRpc<OrdersListRow[]>(
        createSPAClient(),
        'get_orders_list',
        {
          p_operator_id: operatorId!,
          p_date_from: filters.dateFrom,
          p_date_to: filters.dateTo,
          p_statuses: filters.statuses,
          p_sla: filters.sla,
          p_route_ids: filters.routeIds,
          p_driver: filters.driver,
          p_client: filters.client,
          p_comunas: filters.comunas,
          p_has_pod: filters.hasPod,
          p_min_attempts: filters.minAttempts,
          p_search: filters.search,
          p_limit: ORDERS_LIST_PAGE_SIZE,
          p_offset: page * ORDERS_LIST_PAGE_SIZE,
        },
      );
      if (error) throw error;

      const rows = data ?? [];
      return { rows, totalCount: rows[0]?.total_count ?? 0 };
    },
  });
}
