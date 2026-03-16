'use client';

import { useActiveRoutes } from '@/hooks/useActiveRoutes';
import RouteProgressCard from './RouteProgressCard';

interface ActiveRoutesSectionProps {
  operatorId: string;
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="routes-skeleton">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="bg-card rounded-xl border border-border p-4 animate-pulse">
          <div className="h-4 w-32 bg-muted rounded mb-3" />
          <div className="h-2 bg-muted rounded mb-4" />
          <div className="h-3 w-24 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}

export default function ActiveRoutesSection({ operatorId }: ActiveRoutesSectionProps) {
  const { data: routes, isLoading, isError } = useActiveRoutes(operatorId);

  return (
    <div data-testid="active-routes-section">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Rutas Activas — Hoy
        </h2>
        {routes && routes.length > 0 && (
          <span className="text-xs text-muted-foreground">{routes.length} rutas en curso</span>
        )}
      </div>

      {isLoading && <LoadingSkeleton />}

      {isError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" data-testid="routes-error">
          No se pudieron cargar las rutas activas.
        </div>
      )}

      {!isLoading && !isError && routes && routes.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-6 py-8 text-center" data-testid="routes-empty">
          <p className="text-sm text-muted-foreground">Sin rutas activas para hoy</p>
        </div>
      )}

      {!isLoading && routes && routes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {routes.map(route => (
            <RouteProgressCard key={route.id} route={route} />
          ))}
        </div>
      )}
    </div>
  );
}
