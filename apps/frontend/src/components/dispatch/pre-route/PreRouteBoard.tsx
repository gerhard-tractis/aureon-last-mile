'use client';

import { useMemo, useState } from 'react';
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

/**
 * spec-54 phase 4.2 / spec-75 Task 2a — the Pre-ruta board.
 *
 * Replaces the stacked list with the three-column layout the mock calls for:
 * what is unrouted, what the plan looks like, and what the route will contain,
 * all visible while you decide. Below 1024px the columns stack, per the
 * handoff's responsive rule.
 *
 * spec-75: selection now lives at the order level. Order ids are stable
 * across both groupings (an order's id never changes whether the board
 * groups por andén or por comuna), so — unlike the old group-id selection —
 * switching groupBy no longer needs to clear the selection.
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
  const windowKey = params.get('window') ?? 'todas';
  const times = resolvePreRouteWindow(windowKey);

  const { snapshot, isLoading } = usePreRouteSnapshot(
    operatorId,
    date,
    times?.start ?? null,
    times?.end ?? null,
  );

  const [groupBy, setGroupBy] = useState<GroupBy>('anden');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => buildGroups(snapshot?.andenes ?? [], groupBy),
    [snapshot, groupBy],
  );
  const summary = useMemo(
    () => summariseOrderSelection(groups, selectedOrderIds),
    [groups, selectedOrderIds],
  );

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleGroup(group: UnroutedGroup) {
    setSelectedOrderIds((prev) => toggleGroupSelection(group, prev));
  }

  function selectAll() {
    setSelectedOrderIds(new Set(allOrderIds(groups)));
  }

  function clearSelection() {
    setSelectedOrderIds(new Set());
  }

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
      {/* Date and delivery-window filters stay as they were — the board reads
          both from the URL, so removing the only control that sets them would
          have stranded the operator on today/todas. */}
      <PreRouteFilters totals={snapshot?.totals} />
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
          operatorId={operatorId}
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
