'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRoutePackagesByStop } from '@/hooks/dispatch/mobile/useRoutePackagesByStop';
import { useRemovePackageFromRoute } from '@/hooks/dispatch/mobile/useRemovePackageFromRoute';
import {
  groupPackagesByStop,
  groupPackagesByHour,
  findIncompleteFilterState,
  filterStopGroupsToIncomplete,
  filterHourGroupsToIncomplete,
  type StopPackageRow,
} from '@/lib/dispatch/mobile/route-packages-by-stop';
import { DispatchPackageGroupList, type PackageGroupSection } from './DispatchPackageGroupList';
import { DispatchRemovePackageSheet } from './DispatchRemovePackageSheet';

export interface DispatchPackagesByStopProps {
  routeId: string;
  operatorId: string;
  routeCode: string;
  ordersCount: number;
  stopsCount: number;
  /** "Volver al escaneo" — back to 2e. */
  onBack: () => void;
}

type GroupMode = 'parada' | 'hora';

function toStopSections(groups: ReturnType<typeof groupPackagesByStop>): PackageGroupSection[] {
  return groups.map((g) => ({
    key: `stop-${g.stopIndex}`,
    title: `Parada ${String(g.stopIndex).padStart(2, '0')}`,
    subtitle: g.address,
    count: g.packageCount,
    packages: g.packages,
  }));
}

function toHourSections(groups: ReturnType<typeof groupPackagesByHour>): PackageGroupSection[] {
  return groups.map((g) => ({
    key: `hour-${g.hourLabel ?? 'retenidos'}`,
    title: g.hourLabel ?? 'Retenidos en consolidación',
    subtitle: null,
    count: g.packages.length,
    packages: g.packages,
  }));
}

/**
 * spec-76 task 4 (2h) — "Paquetes en la ruta", grouped by stop. Reached
 * from 2e's "Ver los N" (DispatchRouteSurface swaps its own state, same
 * mechanism "Empezar a escanear" already uses); "Volver al escaneo"
 * (`onBack`) returns there.
 */
export function DispatchPackagesByStop({
  routeId,
  operatorId,
  routeCode,
  ordersCount,
  stopsCount,
  onBack,
}: DispatchPackagesByStopProps) {
  const [mode, setMode] = useState<GroupMode>('parada');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StopPackageRow | null>(null);

  const { data, isLoading, isError, refetch } = useRoutePackagesByStop(routeId, operatorId);
  // Stable empty-array identity so downstream useMemo hooks below do not
  // recompute on every render just because `data` is undefined while
  // loading/erroring — `?? []` alone allocates a fresh array each time.
  const dispatches = useMemo(() => data?.dispatches ?? [], [data]);
  const packages = useMemo(() => data?.packages ?? [], [data]);

  const removeMutation = useRemovePackageFromRoute(operatorId);

  const packagesByOrder = useMemo(() => {
    const map = new Map<string, { order_id: string; status: string; loaded_at: string | null }[]>();
    for (const p of packages) {
      const list = map.get(p.order_id) ?? [];
      list.push(p);
      map.set(p.order_id, list);
    }
    return map;
  }, [packages]);

  const { incompleteOrders, incompleteOrderIds } = useMemo(
    () => findIncompleteFilterState(dispatches, packagesByOrder),
    [dispatches, packagesByOrder],
  );

  const loadedCount = useMemo(() => packages.filter((p) => !!p.loaded_at).length, [packages]);

  const sections = useMemo((): PackageGroupSection[] => {
    if (mode === 'parada') {
      let groups = groupPackagesByStop(dispatches, packages);
      if (incompleteOnly) groups = filterStopGroupsToIncomplete(groups, incompleteOrderIds);
      return toStopSections(groups);
    }
    let groups = groupPackagesByHour(dispatches, packages);
    if (incompleteOnly) groups = filterHourGroupsToIncomplete(groups, incompleteOrderIds);
    return toHourSections(groups);
  }, [mode, dispatches, packages, incompleteOnly, incompleteOrderIds]);

  // Lecciones aplicadas #8 — stable identity (deps: [], `setRemoveTarget`
  // is itself stable) so DispatchPackageRow's memo actually skips
  // re-rendering the ~148 rows this screen can hold. Deliberately does NOT
  // depend on `removeMutation` — that object is not reference-stable
  // across renders (same reasoning useRouteScanSession.ts's header gives
  // for not wrapping `submitScan` in useCallback), and pulling it in here
  // would undo the memo on every mutation state change.
  const handleRemove = useCallback((pkg: StopPackageRow) => setRemoveTarget(pkg), []);

  const handleConfirmRemove = useCallback(
    (reason: string) => {
      if (!removeTarget) return;
      removeMutation.mutate(
        { routeId, dispatchId: removeTarget.dispatchId, reason },
        { onSuccess: () => setRemoveTarget(null) },
      );
    },
    [removeMutation, removeTarget, routeId],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center" data-testid="dispatch-packages-by-stop-loading">
        <p className="text-[13px] text-text-secondary">Cargando paquetes…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center" data-testid="dispatch-packages-by-stop-error">
        <p className="text-[13.5px] text-status-error-text">No pudimos cargar los paquetes de la ruta.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-[44px] rounded-[10px] border border-border px-4 text-[13.5px] font-medium text-text active:opacity-90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col" data-testid="dispatch-packages-by-stop">
      <header className="flex flex-col gap-2 p-4">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] self-start text-[12.5px] font-medium text-text-secondary underline decoration-dotted underline-offset-4"
        >
          Volver al escaneo
        </button>
        <h1 className="font-heading text-[20px] font-semibold text-text">{loadedCount} paquetes cargados</h1>
        <p className="text-[12.5px] text-text-secondary">
          {routeCode} · {ordersCount} {ordersCount === 1 ? 'orden' : 'órdenes'} · {stopsCount}{' '}
          {stopsCount === 1 ? 'parada' : 'paradas'}
        </p>

        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('parada')}
            aria-pressed={mode === 'parada'}
            className={`min-h-[36px] rounded-full border px-3 text-[12.5px] font-medium ${mode === 'parada' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
          >
            Por parada
          </button>
          <button
            type="button"
            onClick={() => setMode('hora')}
            aria-pressed={mode === 'hora'}
            className={`min-h-[36px] rounded-full border px-3 text-[12.5px] font-medium ${mode === 'hora' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-secondary'}`}
          >
            Por hora
          </button>
          <button
            type="button"
            onClick={() => setIncompleteOnly((v) => !v)}
            aria-pressed={incompleteOnly}
            className={`min-h-[36px] rounded-full border px-3 text-[12.5px] font-medium ${incompleteOnly ? 'border-status-error-border bg-status-error-bg text-status-error-text' : 'border-border text-text-secondary'}`}
          >
            Incompletas ({incompleteOrders.length})
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 pt-0">
        <DispatchPackageGroupList
          sections={sections}
          onRemove={handleRemove}
          emptyMessage={incompleteOnly ? 'No hay órdenes incompletas.' : 'No hay paquetes en esta ruta.'}
        />
      </div>

      <DispatchRemovePackageSheet
        target={removeTarget}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            // Clears any error from this attempt so it does not bleed into
            // the next package the crew tries to remove.
            removeMutation.reset();
          }
        }}
        onConfirm={handleConfirmRemove}
        isPending={removeMutation.isPending}
        errorMessage={(removeMutation.error as { message: string } | null)?.message ?? null}
      />
    </div>
  );
}
