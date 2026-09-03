'use client';

import { Route } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LoadingRouteCard } from './LoadingRouteCard';
import { ActiveCrewPanel } from './ActiveCrewPanel';
import { RouteSkeleton } from './RouteSkeleton';
import { useLoadingMonitor } from '@/hooks/dispatch/useLoadingMonitor';
import { useNowTick } from '@/hooks/dispatch/useNowTick';
import { deriveRouteLoadState, sortByUrgency } from '@/lib/dispatch/loading-monitor';
import { formatRouteHeaderDate } from '@/lib/utils/dateFormat';

/**
 * "En carga" tab — artboard `1b`. A live monitor of what each crew is
 * loading right now (spec-75 phase 3), replacing the flat RouteListTile
 * grid that used to live here. Still keyed on OPEN_ROUTE_STATUSES
 * (draft/planned/loading/loaded — see useLoadingMonitor.ts), just enriched
 * with per-route scan aggregates and rendered as one of four derived
 * states (loading-monitor.ts) instead of a bare status badge.
 *
 * No "Nueva ruta" button here — DispatchModuleHeader already renders one
 * for the whole module (rule 2: don't rebuild chrome one level up).
 */
export function DispatchOpenRoutesTab({
  operatorId,
  onNewRoute,
  onNavigate,
  onDelete,
}: {
  operatorId: string;
  onNewRoute: () => void;
  onNavigate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { data, isLoading } = useLoadingMonitor(operatorId);
  const now = useNowTick();

  if (isLoading) return <RouteSkeleton />;

  const routes = data?.routes ?? [];
  if (routes.length === 0) {
    return (
      <EmptyState
        icon={Route}
        title="Sin rutas en carga"
        description="No hay rutas pendientes de despacho."
        action={{ label: 'Crear ruta', onClick: onNewRoute }}
      />
    );
  }

  const crew = data?.crew ?? [];
  const packagesWaitingOnDock = data?.packagesWaitingOnDock ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  const sortedRoutes = sortByUrgency(routes, (r) =>
    deriveRouteLoadState(r.status, r.packagesLoaded, r.lastScanAtIso, now),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="font-heading text-lg font-semibold text-text">Rutas en carga</h2>
          <p className="text-xs text-text-secondary">
            {formatRouteHeaderDate(today)}
            <span className="mx-1.5">·</span>
            {packagesWaitingOnDock} paquetes en andén esperando
          </p>
        </div>
        <span className="font-mono text-[11px] font-medium leading-none text-text-secondary">
          CUADRILLAS <span className="font-semibold text-text">{crew.length}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-2">
          {sortedRoutes.map((route) => (
            <LoadingRouteCard
              key={route.id}
              route={route}
              state={deriveRouteLoadState(route.status, route.packagesLoaded, route.lastScanAtIso, now)}
              now={now}
              onNavigate={onNavigate}
              onDelete={onDelete}
            />
          ))}
        </div>
        <ActiveCrewPanel crew={crew} now={now} />
      </div>
    </div>
  );
}
