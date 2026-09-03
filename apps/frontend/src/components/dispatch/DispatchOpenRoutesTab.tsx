'use client';

import { useCallback, useMemo } from 'react';
import { Route } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LoadingRouteCard } from './LoadingRouteCard';
import { ActiveCrewPanel } from './ActiveCrewPanel';
import { RouteSkeleton } from './RouteSkeleton';
import { useLoadingMonitor, type CrewMember } from '@/hooks/dispatch/useLoadingMonitor';
import { useNowTick } from '@/hooks/dispatch/useNowTick';
import { deriveRouteLoadState, sortByUrgency } from '@/lib/dispatch/loading-monitor';
import { formatRouteHeaderDate, todayISOInTimezone } from '@/lib/utils/dateFormat';

// I4 review — 30s, not 1s. The only thing on this tab that needs
// second-precision is <ScanFreshness>, which owns its own 1s tick
// internally now (see LoadingRouteCard.tsx / ScanFreshness.tsx). This
// slower tick only drives state derivation, sort order, and the rate
// figure — none of which need finer than useLoadingMonitor's own 30s
// refetch cadence — so the card list (including every ready/draft card
// with no time-dependent text at all) stops re-rendering every second.
const STATE_TICK_MS = 30_000;

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
  const now = useNowTick(STATE_TICK_MS);
  const crew = data?.crew ?? [];

  // I4 review — stable callback identity, paired with LoadingRouteCard's
  // own `memo`. This is scoped honestly: it stops THIS component's own
  // renders from handing every card a brand-new function, but it cannot
  // make onNavigate/onDelete themselves stable if the parent that passes
  // them in re-creates those on every render — memo + useCallback only
  // help as far up the tree as both are actually applied (rule 8).
  const handleNavigate = useCallback((id: string) => onNavigate(id), [onNavigate]);
  const handleDelete = useCallback((id: string) => onDelete(id), [onDelete]);

  // Grouped once per `crew` identity (stable across a tick that didn't
  // change the underlying query data), not recomputed into a fresh Map on
  // every render — the same reasoning as the callbacks above.
  const crewByRoute = useMemo(() => {
    const map = new Map<string, CrewMember[]>();
    for (const member of crew) {
      const list = map.get(member.routeId) ?? [];
      list.push(member);
      map.set(member.routeId, list);
    }
    return map;
  }, [crew]);

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

  const packagesWaitingOnDock = data?.packagesWaitingOnDock ?? 0;
  // I1 review — this used to be `new Date().toISOString().slice(0, 10)`
  // (UTC), which rolls to tomorrow's date from ~20:00 Chile time onward —
  // exactly the evening-shift window this screen matters most for.
  // `todayISOInTimezone()` resolves the civil date in America/Santiago.
  const today = todayISOInTimezone();

  // I5 review — derive each route's state ONCE into {route, state} and
  // sort/render that, instead of calling deriveRouteLoadState twice per
  // route per render (once in the sort comparator, again in the map).
  const routesWithState = routes.map((route) => ({
    route,
    state: deriveRouteLoadState(route.status, route.packagesLoaded, route.lastScanAtIso, now),
  }));
  const sortedRoutes = sortByUrgency(routesWithState, (r) => r.state, (r) => r.route.routeDate);

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
          {sortedRoutes.map(({ route, state }) => (
            <LoadingRouteCard
              key={route.id}
              route={route}
              state={state}
              now={now}
              today={today}
              crew={crewByRoute.get(route.id) ?? []}
              onNavigate={handleNavigate}
              onDelete={handleDelete}
            />
          ))}
        </div>
        <ActiveCrewPanel crew={crew} now={now} />
      </div>
    </div>
  );
}
