'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  filterRouteCards,
  routeTabCounts,
  type RouteCard,
  type RouteTab,
} from '@/lib/dispatch/mobile/crew-board';
import { DispatchCrewRouteFilters } from './DispatchCrewRouteFilters';
import { DispatchCrewRouteCard } from './DispatchCrewRouteCard';

/**
 * spec-76 2b — Rutas para cargar. Header names the day's total, filters
 * partition it, one card per route (state ordered by `buildRouteCards`'s
 * chip, spec-76 Fase 2 test 5).
 */
export interface DispatchCrewRouteListProps {
  routes: RouteCard[];
  packagesOnDock: number;
  onOpenRoute: (routeId: string) => void;
  onBack: () => void;
}

export function DispatchCrewRouteList({ routes, packagesOnDock, onOpenRoute, onBack }: DispatchCrewRouteListProps) {
  const [tab, setTab] = useState<RouteTab>('todas');
  const counts = routeTabCounts(routes);
  const visible = filterRouteCards(routes, tab);

  return (
    <div className="flex flex-col gap-3 p-4" data-testid="dispatch-crew-route-list">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="grid h-11 w-11 place-items-center rounded-full text-text-muted active:opacity-80"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="font-heading text-[17px] font-semibold text-text">Rutas para cargar</h1>
          <p className="text-[12px] text-text-secondary">
            {routes.length} {routes.length === 1 ? 'ruta' : 'rutas'} del día · {packagesOnDock} paquetes en andén
          </p>
        </div>
      </div>

      <DispatchCrewRouteFilters active={tab} counts={counts} onChange={setTab} />

      <ul className="flex flex-col gap-2.5">
        {visible.map((route) => (
          <li key={route.id}>
            <DispatchCrewRouteCard route={route} onOpen={onOpenRoute} />
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="py-8 text-center text-[13px] text-text-muted">No hay rutas en este filtro.</p>
      )}
    </div>
  );
}
