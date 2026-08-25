'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import {
  buildGroups,
  summariseSelection,
  type GroupBy,
} from '@/hooks/dispatch/pre-route/useUnroutedGroups';
import { Skeleton } from '@/components/ui/skeleton';
import { UnroutedColumn } from './UnroutedColumn';
import { RoutePlanCanvas } from './RoutePlanCanvas';
import { RouteDraftPanel } from './RouteDraftPanel';
import { UnmappedComunasNotice } from './UnmappedComunasNotice';
import { PreRouteFilters } from './PreRouteFilters';

/**
 * spec-54 phase 4.2 — the Pre-ruta board (mock 1c).
 *
 * Replaces the stacked list with the three-column layout the mock calls for:
 * what is unrouted, what the plan looks like, and what the route will contain,
 * all visible while you decide. Below 1024px the columns stack, per the
 * handoff's responsive rule.
 */

const WINDOW_TIME_MAP: Record<string, { start: string; end: string } | null> = {
  todas: null,
  manana: { start: '00:00', end: '12:00' },
  tarde: { start: '12:00', end: '17:00' },
  noche: { start: '17:00', end: '24:00' },
};

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
  const times = WINDOW_TIME_MAP[windowKey] ?? null;

  const { snapshot, isLoading } = usePreRouteSnapshot(
    operatorId,
    date,
    times?.start ?? null,
    times?.end ?? null,
  );

  const [groupBy, setGroupBy] = useState<GroupBy>('anden');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => buildGroups(snapshot?.andenes ?? [], groupBy),
    [snapshot, groupBy],
  );
  const summary = useMemo(() => summariseSelection(groups, selectedIds), [groups, selectedIds]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group ids mean different things per grouping, so a selection carried
  // across would silently point at nothing.
  function changeGroupBy(next: GroupBy) {
    setGroupBy(next);
    setSelectedIds(new Set());
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
          onGroupByChange={changeGroupBy}
          selectedIds={selectedIds}
          onToggle={toggle}
          summary={summary}
          onBuildRoute={buildRoute}
          isBuilding={isCreating}
        />

        <RoutePlanCanvas summary={summary} />

        <RouteDraftPanel
          groups={groups}
          selectedIds={selectedIds}
          summary={summary}
          onBuildRoute={buildRoute}
          onClear={() => setSelectedIds(new Set())}
          isBuilding={isCreating}
        />
      </div>
    </div>
  );
}
