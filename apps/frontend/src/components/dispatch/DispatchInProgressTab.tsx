'use client';

import { useState } from 'react';
import { Truck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { RouteActivityRow } from './RouteActivityRow';

function RouteSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function DispatchInProgressTab({ operatorId }: { operatorId: string }) {
  const [openRouteId, setOpenRouteId] = useState<string | null>(null);
  const { data: routes, isLoading } = useDispatchRoutesByStatus(operatorId, ['in_progress']);

  if (isLoading) return <RouteSkeleton />;
  if (!routes?.length) {
    return (
      <EmptyState icon={Truck} title="Sin rutas en camino" description="Las rutas despachadas aparecerán aquí." />
    );
  }

  const handleToggle = (routeId: string) => {
    setOpenRouteId((prev) => (prev === routeId ? null : routeId));
  };

  const totalPlanned   = routes.reduce((s, r) => s + r.planned_stops, 0);
  const totalCompleted = routes.reduce((s, r) => s + r.completed_stops, 0);
  const avgCumplimiento = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 1000) / 10 : 0;

  return (
    <div className="space-y-3">
      <div data-testid="fleet-summary" className="flex flex-wrap gap-5 px-4 py-3 bg-surface border border-border rounded-lg text-sm">
        <span><strong className="text-text">{routes.length}</strong> <span className="text-text-secondary">vehículos en ruta</span></span>
        <span><strong className="text-green-500">{totalCompleted}</strong> <span className="text-text-secondary">entregadas*</span></span>
        <span><strong data-testid="fleet-cumplimiento" className="text-text">{avgCumplimiento}%</strong> <span className="text-text-secondary">cumplimiento promedio</span></span>
        <span className="text-text-secondary text-xs self-end">* Fallidas y pendientes disponibles al expandir la ruta</span>
      </div>
      {routes.map((route) => (
        <RouteActivityRow
          key={route.id}
          route={route}
          operatorId={operatorId}
          isOpen={openRouteId === route.id}
          onToggle={() => handleToggle(route.id)}
        />
      ))}
    </div>
  );
}
