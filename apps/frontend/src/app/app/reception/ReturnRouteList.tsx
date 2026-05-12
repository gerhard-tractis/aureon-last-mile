'use client';

import { Package, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { useReturnRoutes } from '@/hooks/reception/useReturnRoutes';

interface ReturnRouteListProps {
  operatorId: string | null;
  onSelectRoute: (externalRouteId: string) => void;
}

export function ReturnRouteList({ operatorId, onSelectRoute }: ReturnRouteListProps) {
  const { data, isLoading } = useReturnRoutes(operatorId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const sorted = [...data].sort(
    (a, b) =>
      new Date(a.oldestStatusUpdatedAt).getTime() -
      new Date(b.oldestStatusUpdatedAt).getTime()
  );

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin retornos pendientes"
        description="No hay rutas con paquetes pendientes de retorno en este momento."
      />
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((route) => (
        <div
          key={route.externalRouteId}
          className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between gap-3"
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-text font-mono">{route.externalRouteId}</p>
            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
              <Truck className="h-3 w-3 shrink-0" />
              {route.driverName ?? 'Sin conductor'}
            </p>
            <p className="text-xs text-text-secondary flex items-center gap-1 mt-1">
              <Package className="h-3 w-3 shrink-0" />
              {route.packageCount} paquetes por recibir
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => onSelectRoute(route.externalRouteId)}
          >
            Iniciar recepción
          </Button>
        </div>
      ))}
    </div>
  );
}
