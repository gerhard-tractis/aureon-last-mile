'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import { usePreRouteSelection } from '@/hooks/dispatch/pre-route/usePreRouteSelection';
import { PreRouteFilters } from './PreRouteFilters';
import { AndenCard } from './AndenCard';
import { PreRouteSelectionBar } from './PreRouteSelectionBar';

const WINDOW_TIME_MAP: Record<string, { start: string; end: string } | null> = {
  todas:  null,
  manana: { start: '00:00', end: '12:00' },
  tarde:  { start: '12:00', end: '17:00' },
  noche:  { start: '17:00', end: '24:00' },
};

type Props = {
  onCreateRoute: (orderIds: string[]) => void;
};

export function PreRouteTab({ onCreateRoute }: Props) {
  const { operatorId } = useOperatorId();
  const params          = useSearchParams();

  const today  = new Date().toISOString().slice(0, 10);
  const date   = params.get('date') ?? today;
  const window = params.get('window') ?? 'todas';
  const times  = WINDOW_TIME_MAP[window] ?? null;

  const { snapshot, isLoading } = usePreRouteSnapshot(
    operatorId,
    date,
    times?.start ?? null,
    times?.end   ?? null,
  );

  const {
    selectedAndenIds,
    toggleSelect,
    clearSelection,
    expandedAndenIds,
    toggleAndenExpansion,
    allSelected,
    toggleSelectAll,
  } = usePreRouteSelection();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Cargando...
      </div>
    );
  }

  const andenes = snapshot?.andenes ?? [];

  if (andenes.length === 0) {
    return (
      <div className="space-y-4">
        <PreRouteFilters totals={snapshot?.totals} />
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          No hay órdenes listas para rutear con estos filtros.
        </div>
      </div>
    );
  }

  const andenIds = andenes.map((a) => a.id);
  const isAllSelected = allSelected(andenIds);

  return (
    <div className="space-y-0">
      <PreRouteFilters totals={snapshot?.totals} />

      <div className="p-4 space-y-3">
        {andenIds.length >= 2 && (
          <div className="flex items-center gap-2 pb-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={() => toggleSelectAll(andenIds)}
                className="h-4 w-4 rounded border-border"
              />
              Seleccionar todos
            </label>
          </div>
        )}

        {andenes.map((anden) => (
          <AndenCard
            key={anden.id}
            anden={anden}
            isSelected={selectedAndenIds.has(anden.id)}
            isExpanded={expandedAndenIds.has(anden.id)}
            onToggleSelect={() => toggleSelect(anden.id)}
            onToggleExpand={() => toggleAndenExpansion(anden.id)}
            onCreateRoute={onCreateRoute}
          />
        ))}
      </div>

      <PreRouteSelectionBar
        andenes={andenes}
        selectedAndenIds={selectedAndenIds}
        onCreateRoute={onCreateRoute}
        onClear={clearSelection}
      />
    </div>
  );
}
