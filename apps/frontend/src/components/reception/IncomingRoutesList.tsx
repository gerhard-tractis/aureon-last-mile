'use client';

import { useRouter } from 'next/navigation';
import { Truck, Package, Layers, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import type {
  IncomingRoute,
  IncomingRouteStatus,
} from '@/hooks/reception/useIncomingRoutes';

interface IncomingRoutesListProps {
  routes: IncomingRoute[];
  /** Lifecycle status of the rows — decides where a tap goes. */
  status?: IncomingRouteStatus;
}

/**
 * Navigation is status-dependent, and that is the whole safety story.
 *
 * `in_progress` rows are trucks still out collecting: they go to the read-only
 * preview, which has no side effect. Only the QR scan or the confirmed
 * "Recibir sin QR" on that page may open a reception — a row tap must never
 * stamp an arrival or lock the driver out mid-route.
 *
 * `in_transit` (and `received`) rows already have a batch, so they go straight
 * into the reception session.
 */
export function IncomingRoutesList({
  routes,
  status = 'in_transit',
}: IncomingRoutesListProps) {
  const router = useRouter();
  const isOnTheRoad = status === 'in_progress';

  if (routes.length === 0) {
    return isOnTheRoad ? (
      <EmptyState
        icon={Truck}
        title="Sin rutas en camino"
        description="Las rutas que los choferes tengan en retiro aparecerán aquí."
      />
    ) : (
      <EmptyState
        icon={Truck}
        title="Sin rutas entrantes"
        description="Las rutas en tránsito aparecerán aquí cuando un chofer cierre el retiro."
      />
    );
  }

  return (
    <div className="space-y-3">
      {routes.map((route) => (
        <div
          key={route.id}
          data-testid="incoming-route-card"
          className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between gap-3"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <p className="font-mono text-base font-semibold text-text">{route.code}</p>
            {route.driver_name && (
              <p className="text-xs text-text-secondary flex items-center gap-1">
                <Truck className="h-3 w-3" />
                {route.driver_name}
                {route.vehicle_label ? ` · ${route.vehicle_label}` : ''}
              </p>
            )}
            <p className="text-xs text-text-secondary flex items-center gap-1">
              <Layers className="h-3 w-3" />
              {route.manifest_count} manifiesto{route.manifest_count === 1 ? '' : 's'}
              <span className="mx-1">·</span>
              <Package className="h-3 w-3" />
              {route.expected_packages} paquetes
            </p>
            {(isOnTheRoad ? route.started_at : route.in_transit_at) && (
              <p className="text-xs text-text-muted flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {isOnTheRoad ? 'Inició' : 'Salió'}{' '}
                {new Date(
                  (isOnTheRoad ? route.started_at : route.in_transit_at)!,
                ).toLocaleString('es-CL', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant={isOnTheRoad ? 'outline' : 'default'}
            onClick={() =>
              router.push(
                isOnTheRoad
                  ? `/app/reception/route/${route.id}/preview`
                  : `/app/reception/route/${route.id}`,
              )
            }
          >
            {isOnTheRoad ? 'Ver detalle' : 'Iniciar recepción'}
          </Button>
        </div>
      ))}
    </div>
  );
}
