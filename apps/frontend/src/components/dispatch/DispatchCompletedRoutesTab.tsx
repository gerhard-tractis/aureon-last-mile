'use client';

import { Package } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { RouteListTile } from './RouteListTile';
import { RouteSkeleton } from './RouteSkeleton';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { FINISHED_ROUTE_STATUSES } from '@/lib/dispatch/types';
import { daysAgoISO } from '@/lib/dispatch/days-ago';

/** "Completadas" tab — finished routes from the last 7 days (FINISHED_ROUTE_STATUSES). */
export function DispatchCompletedRoutesTab({
  operatorId,
  onNavigate,
}: {
  operatorId: string;
  onNavigate: (id: string) => void;
}) {
  const { data: routes, isLoading } = useDispatchRoutesByStatus(
    operatorId,
    [...FINISHED_ROUTE_STATUSES],
    daysAgoISO(7),
  );
  if (isLoading) return <RouteSkeleton />;
  if (!routes?.length) {
    return (
      <EmptyState
        icon={Package}
        title="Sin rutas completadas"
        description="Las rutas completadas en los últimos 7 días aparecerán aquí."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {routes.map((route) => (
        <RouteListTile key={route.id} route={route} onClick={() => onNavigate(route.id)} />
      ))}
    </div>
  );
}
