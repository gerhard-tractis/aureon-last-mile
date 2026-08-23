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
 *
 * Non-JSX helpers (URL param parsing, the CSV download, the static status
 * option list) live in `_page-helpers.ts`, and the header block lives in
 * `_orders-header.tsx` — both split out purely to keep this file under the
 * project's 300-line limit.
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
  searchParamsToState,
  type OrderViewPresetId,
} from '@/lib/orders/order-view-presets';
import OrdersClientGate from './_client-gate';
import { OrdersPageHeader } from './_orders-header';
import {
  STATUS_OPTIONS,
  ROUTE_OPTIONS_NOTE,
  isEmptyFilters,
  getPageFromParams,
  buildQueryString,
  paginationLabel,
  downloadCurrentViewCsv,
} from './_page-helpers';
import { OrderViewTabs } from './components/OrderViewTabs';
import { OrderFilterRail, type RouteFilterOption } from './components/OrderFilterRail';
import { ActiveFilterChips } from './components/ActiveFilterChips';
import { OrdersDataTable } from './components/OrdersDataTable';
import { OrdersBulkBar } from './components/OrdersBulkBar';

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
      <OrdersPageHeader
        totalCount={totalCount}
        onExportCurrentView={() => downloadCurrentViewCsv(rows)}
        onCopyShareableUrl={handleCopyShareableUrl}
      />

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
          routeOptionsNote={ROUTE_OPTIONS_NOTE}
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
