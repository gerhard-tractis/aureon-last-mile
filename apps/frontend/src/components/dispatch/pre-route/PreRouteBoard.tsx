'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import {
  allOrderIds,
  buildGroups,
  summariseOrderSelection,
  toggleGroupSelection,
  type GroupBy,
  type UnroutedGroup,
} from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import { Skeleton } from '@/components/ui/skeleton';
import { UnroutedColumn } from './UnroutedColumn';
import { RoutePlanCanvas } from './RoutePlanCanvas';
import { RouteDraftPanel } from './RouteDraftPanel';
import { UnmappedComunasNotice } from './UnmappedComunasNotice';
import { PreRouteFilters } from './PreRouteFilters';
import { resolvePreRouteWindow } from '@/lib/dispatch/pre-route-window';
import {
  applyPreRouteFilters,
  parsePreRouteFilterState,
  summariseFilteredTotals,
} from '@/lib/dispatch/pre-route-filters';

/**
 * spec-54 phase 4.2 — the Pre-ruta board.
 *
 * Replaces the stacked list with the three-column layout the mock calls for:
 * what is unrouted, what the plan looks like, and what the route will contain,
 * all visible while you decide. Below 1024px the columns stack, per the
 * handoff's responsive rule.
 *
 * Selection lives at the order level. Order ids are stable across both
 * groupings (an order's id doesn't change whether the board groups por
 * andén or por comuna), so switching groupBy doesn't need to clear it.
 */

interface PreRouteBoardProps {
  onCreateRoute: (orderIds: string[], routeDate: string) => void;
  isCreating?: boolean;
}

export function PreRouteBoard({ onCreateRoute, isCreating = false }: PreRouteBoardProps) {
  const { operatorId } = useOperatorId();
  const params = useSearchParams();

  const today = new Date().toISOString().slice(0, 10);
  const date = params.get('date') ?? today;
  const times = resolvePreRouteWindow(params);

  const { snapshot, isLoading } = usePreRouteSnapshot(
    operatorId,
    date,
    times?.start ?? null,
    times?.end ?? null,
  );

  const [groupBy, setGroupBy] = useState<GroupBy>('anden');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  // spec-75 task 2b — comuna/andén/cliente/"sólo con problemas"/búsqueda
  // narrow the snapshot client-side (date and ventana are the only filters
  // the RPC itself applies). Filtering happens on the raw andén → comuna →
  // orders tree *before* buildGroups, not on the flattened UnroutedGroup
  // rows — see the reasoning in lib/dispatch/pre-route-filters.ts.
  //
  // Code-review finding (M9): the memo used to key off each filter array
  // joined with ',', which mis-keys when a value itself contains a comma
  // (a cliente named "Soto, Ana Ltda" can collapse to the same joined
  // string as an unrelated filter state) and needed an eslint-disable to
  // hide the resulting exhaustive-deps warning. `paramsKey` is the
  // unambiguous source every filter field is parsed from, and the memo
  // callback closes over `paramsKey` (not `params`) to rebuild a
  // `URLSearchParams` internally — so it's the only external value the
  // callback reads, exhaustive-deps is satisfied honestly, and no
  // eslint-disable is needed.
  const paramsKey = params.toString();
  const filteredAndenes = useMemo(
    () => applyPreRouteFilters(snapshot?.andenes ?? [], parsePreRouteFilterState(new URLSearchParams(paramsKey))),
    [snapshot?.andenes, paramsKey],
  );

  const groups = useMemo(
    // snapshot's object identity changes on every refetch even when
    // `andenes` itself is unchanged; keying off `snapshot` would churn
    // `groups`' identity (and every row's, through it) on each background
    // refetch and defeat UnroutedOrderRow's memo below it.
    () => buildGroups(filteredAndenes, groupBy),
    [filteredAndenes, groupBy],
  );
  // I4 — what the filter bar's own totals line shows once any client-side
  // filter narrows the view; see summariseFilteredTotals's docblock.
  const filteredTotals = useMemo(() => summariseFilteredTotals(filteredAndenes), [filteredAndenes]);
  const summary = useMemo(
    () => summariseOrderSelection(groups, selectedOrderIds),
    [groups, selectedOrderIds],
  );

  const toggleOrder = useCallback((orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: UnroutedGroup) => {
    setSelectedOrderIds((prev) => toggleGroupSelection(group, prev));
  }, []);

  const selectAll = useCallback(() => {
    setSelectedOrderIds(new Set(allOrderIds(groups)));
  }, [groups]);

  const clearSelection = useCallback(() => {
    setSelectedOrderIds(new Set());
  }, []);

  function buildRoute() {
    if (summary.orderIds.length === 0) return;
    // The date the board is filtered by IS the route's date. Reading it from the
    // server clock instead is what dated tomorrow's wave today.
    onCreateRoute(summary.orderIds, date);
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 p-4 lg:grid-cols-[330px_1fr_322px] lg:gap-0 lg:p-0">
        <Skeleton className="h-[520px] rounded-none" />
        <Skeleton className="hidden h-[520px] rounded-none lg:block" />
        <Skeleton className="hidden h-[520px] rounded-none lg:block" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* andenes here is the RAW (unfiltered) snapshot tree — PreRouteFilters
          builds its comuna/andén/cliente option lists off it so choosing one
          filter never shrinks what the others can offer. filteredTotals is
          the narrowed-tree figures (I4) — shown instead of totals once any
          client-side filter is active. */}
      <PreRouteFilters
        totals={snapshot?.totals}
        filteredTotals={filteredTotals}
        andenes={snapshot?.andenes ?? []}
      />
      <UnmappedComunasNotice comunas={snapshot?.unmapped_comunas ?? []} />

      <div className="grid min-h-0 flex-1 lg:grid-cols-[330px_1fr_322px]">
        <UnroutedColumn
          groups={groups}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          selectedOrderIds={selectedOrderIds}
          onToggleOrder={toggleOrder}
          onToggleGroup={toggleGroup}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          summary={summary}
          onBuildRoute={buildRoute}
          isBuilding={isCreating}
        />

        <RoutePlanCanvas summary={summary} />

        <RouteDraftPanel
          groups={groups}
          selectedOrderIds={selectedOrderIds}
          summary={summary}
          onBuildRoute={buildRoute}
          onClear={clearSelection}
          isBuilding={isCreating}
        />
      </div>
    </div>
  );
}
