'use client';

import { useRouter } from 'next/navigation';
import { Plus, Route, Package, Truck, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCard } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { RouteListTile } from '@/components/dispatch/RouteListTile';
import { useDispatchKPIs } from '@/hooks/dispatch/useDispatchKPIs';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { useOperatorId } from '@/hooks/useOperatorId';

const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
const sinceDateStr = sevenDaysAgo.toISOString().split('T')[0];

function RouteSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default function DispatchPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDispatchKPIs(operatorId);
  const { data: openRoutes, isLoading: openLoading } = useDispatchRoutesByStatus(operatorId, ['draft', 'planned']);
  const { data: inProgressRoutes, isLoading: inProgressLoading } = useDispatchRoutesByStatus(operatorId, ['in_progress']);
  const { data: completedRoutes, isLoading: completedLoading } = useDispatchRoutesByStatus(operatorId, ['completed', 'cancelled'], sinceDateStr);

  const handleNewRoute = async () => {
    const res = await fetch('/api/dispatch/routes', { method: 'POST' });
    if (res.ok) {
      const json = await res.json();
      router.push(`/app/dispatch/${json.id}`);
    }
  };

  if (!operatorId) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const navigateToRoute = (id: string) => router.push(`/app/dispatch/${id}`);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">Despacho</h1>
        <Button onClick={handleNewRoute} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nueva Ruta
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpisLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))
        ) : (
          <>
            <MetricCard label="Rutas abiertas" value={kpis?.openRoutes ?? 0} icon={Route} />
            <MetricCard label="Paquetes pendientes" value={kpis?.pendingPackages ?? 0} icon={Package} />
            <MetricCard label="Despachados hoy" value={kpis?.dispatchedToday ?? 0} icon={Truck} />
            <MetricCard label="En ruta ahora" value={kpis?.inRoute ?? 0} icon={TrendingUp} />
          </>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Abiertas</TabsTrigger>
          <TabsTrigger value="in_progress">En Ruta</TabsTrigger>
          <TabsTrigger value="completed">Completadas</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="mt-4">
          {openLoading ? <RouteSkeleton /> : !openRoutes?.length ? (
            <EmptyState
              icon={Route}
              title="Sin rutas abiertas"
              description="No hay rutas pendientes de despacho."
              action={{ label: 'Crear ruta', onClick: handleNewRoute }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {openRoutes.map((route) => (
                <RouteListTile key={route.id} route={route} onClick={() => navigateToRoute(route.id)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="in_progress" className="mt-4">
          {inProgressLoading ? <RouteSkeleton /> : !inProgressRoutes?.length ? (
            <EmptyState
              icon={Truck}
              title="Sin rutas en camino"
              description="Las rutas despachadas aparecerán aquí."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {inProgressRoutes.map((route) => (
                <RouteListTile key={route.id} route={route} onClick={() => navigateToRoute(route.id)} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {completedLoading ? <RouteSkeleton /> : !completedRoutes?.length ? (
            <EmptyState
              icon={Package}
              title="Sin rutas completadas"
              description="Las rutas completadas en los últimos 7 días aparecerán aquí."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {completedRoutes.map((route) => (
                <RouteListTile key={route.id} route={route} onClick={() => navigateToRoute(route.id)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
