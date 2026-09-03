'use client';

import { Route } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { RouteListTile } from './RouteListTile';
import { RouteSkeleton } from './RouteSkeleton';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { OPEN_ROUTE_STATUSES } from '@/lib/dispatch/types';

/** "En carga" tab — routes not yet released to the provider (OPEN_ROUTE_STATUSES). */
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
  const { data: routes, isLoading } = useDispatchRoutesByStatus(operatorId, [...OPEN_ROUTE_STATUSES]);
  if (isLoading) return <RouteSkeleton />;
  if (!routes?.length) {
    return (
      <EmptyState
        icon={Route}
        title="Sin rutas en carga"
        description="No hay rutas pendientes de despacho."
        action={{ label: 'Crear ruta', onClick: onNewRoute }}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {routes.map((route) => (
        <RouteListTile
          key={route.id}
          route={route}
          onClick={() => onNavigate(route.id)}
          onDelete={() => onDelete(route.id)}
        />
      ))}
    </div>
  );
}
