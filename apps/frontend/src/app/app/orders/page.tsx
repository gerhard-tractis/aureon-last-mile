'use client';

/**
 * `/app/orders` — spec-65 Task 6, the Pedidos global order list (mock `3a`).
 * Assembles Task 3's hook, Task 4's URL serialization and Task 5's five
 * components. Every one of those is imported, never modified.
 *
 * The URL is the single source of truth for view state (preset, filters,
 * page). This component never keeps a parallel copy: every read comes from
 * `searchParamsToState`, every write goes through `router.replace`. The one
 * piece of local React state is row selection, which is UI-only and not
 * part of the shareable view.
 *
 * `useSearchParams` requires a Suspense boundary or the production build
 * fails at prerender — see `OrdersPage` at the bottom.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useActiveRoutes } from '@/hooks/useActiveRoutes';
import {
  useOrdersList,
  EMPTY_ORDERS_LIST_FILTERS,
  ORDERS_LIST_PAGE_SIZE,
  type OrdersListFilters,
} from '@/hooks/useOrdersList';
import {
  resolvePreset,
  filtersToSearchParams,
  searchParamsToState,
  type OrderViewPresetId,
} from '@/lib/orders/order-view-presets';
import { getStatusLabel } from '@/components/StatusBadge';
import OrdersClientGate from './_client-gate';
import { OrderViewTabs } from './components/OrderViewTabs';
import { OrderFilterRail, type StatusFilterOption, type RouteFilterOption } from './components/OrderFilterRail';
import { ActiveFilterChips } from './components/ActiveFilterChips';
import { OrdersDataTable } from './components/OrdersDataTable';
import { OrdersBulkBar } from './components/OrdersBulkBar';

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
 * page load). `count: 0` is a placeholder forced by OrderFilterRail's
 * `StatusFilterOption.count: number`, which is required and always
 * rendered — there is no "omit the count" path in that component the way
 * OrderViewTabs has one for `presetCounts`. This is a known, reported gap:
 * it reads as "zero of this status", not "unknown", which is exactly the
 * kind of wrong-not-absent number the brief calls out. See Task 6 report.
 */
const STATUS_OPTIONS: StatusFilterOption[] = ORDER_STATUS_ENUM_VALUES.map((status) => ({
  status,
  label: getStatusLabel(status, 'order'),
  count: 0,
}));

const PAGE_PARAM = 'pagina';

function isEmptyFilters(filters: OrdersListFilters): boolean {
  return Object.values(filters).every((v) => v === null);
}

function getPageFromParams(params: URLSearchParams): number {
  const raw = params.get(PAGE_PARAM);
  const parsed = raw ? Number(raw) : 0;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function buildQueryString(
  presetId: OrderViewPresetId,
  filters: OrdersListFilters,
  page: number,
): string {
  const params = filtersToSearchParams(presetId, filters);
  if (page > 0) params.set(PAGE_PARAM, String(page));
  return params.toString();
}

function paginationLabel(page: number, rowsCount: number, totalCount: number): string {
  if (totalCount === 0) return '0 de 0';
  const start = page * ORDERS_LIST_PAGE_SIZE + 1;
  const end = start + rowsCount - 1;
  return `${start}–${end} de ${totalCount}`;
}

function OrdersPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { operatorId } = useOperatorId();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { preset, filters: urlFilters } = searchParamsToState(searchParams);
  const page = getPageFromParams(searchParams);

  // One-time-per-mount normalization: a bare URL (nothing but maybe `vista`)
  // doesn't carry the active preset's own implied filters — Task 4's
  // searchParamsToState deliberately returns all-null filters for an empty
  // query string, it does not merge resolvePreset in (see order-view-presets
  // round-trip tests). Without this, landing on the default "SLA en riesgo"
  // tab would query with NO sla filter at all, showing every order instead
  // of the QA-documented zero.
  //
  // `hasNormalized` gates BOTH the derived value below and the effect that
  // writes it back to the URL, and is flipped exactly once. That is load
  // bearing: a naive "merge in preset defaults whenever filters are empty"
  // would also fire right after "Limpiar" (which intentionally produces an
  // all-null filter set), silently re-applying the preset's own filters and
  // undoing the clear. Gating on a one-time ref makes the merge apply only
  // to the URL a person actually landed on, never to one this page produced
  // itself by clearing filters mid-session.
  const hasNormalized = useRef(false);
  const useDefaultsForThisRender = !hasNormalized.current && isEmptyFilters(urlFilters);
  const filters = useDefaultsForThisRender
    ? ({ ...EMPTY_ORDERS_LIST_FILTERS, ...resolvePreset(preset, today) } as OrdersListFilters)
    : urlFilters;

  useEffect(() => {
    if (hasNormalized.current) return;
    hasNormalized.current = true;
    if (!isEmptyFilters(urlFilters)) return;
    const resolved: OrdersListFilters = { ...EMPTY_ORDERS_LIST_FILTERS, ...resolvePreset(preset, today) };
    if (isEmptyFilters(resolved)) return; // preset implies nothing (e.g. "todas") — the bare URL is already canonical
    router.replace(`${pathname}?${buildQueryString(preset, resolved, page)}`);
    // Intentionally runs once, against the values the page mounted with —
    // see the block comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading } = useOrdersList(operatorId, filters, page);
  const { data: activeRoutes } = useActiveRoutes(operatorId ?? '');

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ORDERS_LIST_PAGE_SIZE));

  const routeOptions: RouteFilterOption[] = (activeRoutes ?? []).map((r) => ({
    id: r.id,
    label: r.external_route_id,
  }));

  function navigate(nextPreset: OrderViewPresetId, nextFilters: OrdersListFilters, nextPage: number) {
    setSelectedIds([]);
    router.replace(`${pathname}?${buildQueryString(nextPreset, nextFilters, nextPage)}`);
  }

  const handleSelectPreset = (nextPreset: OrderViewPresetId) => {
    navigate(nextPreset, { ...EMPTY_ORDERS_LIST_FILTERS, ...resolvePreset(nextPreset, today) }, 0);
  };

  const handleFiltersChange = (nextFilters: OrdersListFilters) => {
    navigate(preset, nextFilters, 0);
  };

  const handleClearAll = () => {
    navigate(preset, EMPTY_ORDERS_LIST_FILTERS, 0);
  };

  const handleCopyShareableUrl = () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success('Enlace copiado'))
      .catch((err) => {
        console.error('[orders/page] copy shareable url failed', err);
        toast.error('No se pudo copiar el enlace');
      });
  };

  // Task 8 attaches the Order Inspector to this. Left as a clearly-named
  // no-op rather than navigating anywhere, so a row is visibly clickable
  // without pretending to do something it doesn't yet.
  const handleRowClick = (_orderId: string) => {
    // TODO(Task 8): open the Order Inspector for this order id.
  };

  const handleToggleSelect = (id: string, selected: boolean) => {
    setSelectedIds((prev) => (selected ? [...prev, id] : prev.filter((x) => x !== id)));
  };

  const handleToggleSelectAll = (selected: boolean) => {
    setSelectedIds(selected ? rows.map((r) => r.id) : []);
  };

  const selectedRows = rows.filter((r) => selectedIds.includes(r.id));

  if (!operatorId) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col overflow-hidden">
      <OrderViewTabs
        activePreset={preset}
        presetCounts={data ? { [preset]: totalCount } : {}}
        onSelectPreset={handleSelectPreset}
      />

      <div className="flex min-h-0 flex-1">
        <OrderFilterRail
          filters={filters}
          onFiltersChange={handleFiltersChange}
          statusOptions={STATUS_OPTIONS}
          routeOptions={routeOptions}
          today={today}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ActiveFilterChips
            filters={filters}
            resultCount={totalCount}
            onFiltersChange={handleFiltersChange}
            onClearAll={handleClearAll}
            onCopyShareableUrl={handleCopyShareableUrl}
          />

          <div className="flex-1 overflow-y-auto">
            <OrdersDataTable
              rows={rows}
              isLoading={isLoading}
              selectedIds={selectedIds}
              onRowClick={handleRowClick}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
            />
          </div>

          <div className="flex items-center justify-between border-t border-border-subtle bg-surface px-6 py-2">
            <span className="font-mono text-[10.5px] text-text-muted">
              {paginationLabel(page, rows.length, totalCount)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => navigate(preset, filters, page - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => navigate(preset, filters, page + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>

          <OrdersBulkBar selectedRows={selectedRows} />
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <OrdersClientGate>
      <Suspense>
        <OrdersPageContent />
      </Suspense>
    </OrdersClientGate>
  );
}
