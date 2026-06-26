'use client';

import { useRouter } from 'next/navigation';
import { Truck, Package, Layers, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

interface IncomingRoutesListProps {
  routes: IncomingRoute[];
}

export function IncomingRoutesList({ routes }: IncomingRoutesListProps) {
  const router = useRouter();

  if (routes.length === 0) {
    return (
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
            {route.in_transit_at && (
              <p className="text-xs text-text-muted flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Salió {new Date(route.in_transit_at).toLocaleString('es-CL', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => router.push(`/app/reception/route/${route.id}`)}
          >
            Iniciar recepción
          </Button>
        </div>
      ))}
    </div>
  );
}
