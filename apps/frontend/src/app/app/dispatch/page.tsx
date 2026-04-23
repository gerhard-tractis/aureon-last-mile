'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Plus, Route, Package, Truck, TrendingUp, Inbox } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCard } from '@/components/metrics/MetricCard';
import { EmptyState } from '@/components/EmptyState';
import { RouteListTile } from '@/components/dispatch/RouteListTile';
import { PreRouteTab } from '@/components/dispatch/pre-route/PreRouteTab';
import { useDispatchKPIs } from '@/hooks/dispatch/useDispatchKPIs';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { useOperatorId } from '@/hooks/useOperatorId';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import { useCreateRouteFromSelection } from '@/hooks/dispatch/pre-route/useCreateRouteFromSelection';

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

function DispatchOpenTab({
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
  const { data: routes, isLoading } = useDispatchRoutesByStatus(operatorId, ['draft', 'planned']);
  if (isLoading) return <RouteSkeleton />;
  if (!routes?.length) {
    return (
      <EmptyState
        icon={Route}
        title="Sin rutas abiertas"
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

function DispatchInProgressTab({
  operatorId,
  onNavigate,
}: {
  operatorId: string;
  onNavigate: (id: string) => void;
}) {
  const { data: routes, isLoading } = useDispatchRoutesByStatus(operatorId, ['in_progress']);
  if (isLoading) return <RouteSkeleton />;
  if (!routes?.length) {
    return (
      <EmptyState
        icon={Truck}
        title="Sin rutas en camino"
        description="Las rutas despachadas aparecerán aquí."
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

function DispatchCompletedTab({
  operatorId,
  onNavigate,
}: {
  operatorId: string;
  onNavigate: (id: string) => void;
}) {
  const { data: routes, isLoading } = useDispatchRoutesByStatus(
    operatorId,
    ['completed', 'cancelled'],
    sinceDateStr,
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

function DispatchPageContent() {
  const router   = useRouter();
  const params   = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const { operatorId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDispatchKPIs(operatorId);

  const today = new Date().toISOString().slice(0, 10);
  const { snapshot: preRouteSnapshot } = usePreRouteSnapshot(operatorId ?? null, today);

  const createRouteMutation = useCreateRouteFromSelection();

  const tab = params.get('tab') ?? 'pre-ruta';

  const setTab = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  const handleDeleteRoute = async (routeId: string) => {
    await fetch(`/api/dispatch/routes/${routeId}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: ['dispatch', 'routes'] });
  };

  const handleNewRoute = async () => {
    const res = await fetch('/api/dispatch/routes', { method: 'POST' });
    if (res.ok) {
      const json = await res.json();
      router.push(`/app/dispatch/${json.id}`);
    }
  };

  const handleCreateRoute = async (orderIds: string[]) => {
    try {
      const route = await createRouteMutation.mutateAsync({ orderIds });
      router.push(`/app/dispatch/${route.id}`);
    } catch (err) {
      console.error('[dispatch/page] handleCreateRoute failed', err);
    }
  };

  if (!operatorId) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpisLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))
        ) : (
          <>
            <MetricCard label="Sin rutear" value={preRouteSnapshot?.totals.order_count ?? 0} icon={Inbox} />
            <MetricCard label="Rutas abiertas" value={kpis?.openRoutes ?? 0} icon={Route} />
            <MetricCard label="Paquetes pendientes" value={kpis?.pendingPackages ?? 0} icon={Package} />
            <MetricCard label="Despachados hoy" value={kpis?.dispatchedToday ?? 0} icon={Truck} />
            <MetricCard label="En ruta ahora" value={kpis?.inRoute ?? 0} icon={TrendingUp} />
          </>
        )}
      </div>

      {/* Tabs — Pre-ruta is default */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pre-ruta">Pre-ruta</TabsTrigger>
          <TabsTrigger value="open">Abiertas</TabsTrigger>
          <TabsTrigger value="in_progress">En Ruta</TabsTrigger>
          <TabsTrigger value="completed">Completadas</TabsTrigger>
        </TabsList>

        <TabsContent value="pre-ruta" className="mt-4">
          <PreRouteTab onCreateRoute={handleCreateRoute} />
        </TabsContent>

        <TabsContent value="open" className="mt-4">
          <DispatchOpenTab
            operatorId={operatorId}
            onNewRoute={handleNewRoute}
            onNavigate={navigateToRoute}
            onDelete={handleDeleteRoute}
          />
        </TabsContent>

        <TabsContent value="in_progress" className="mt-4">
          <DispatchInProgressTab operatorId={operatorId} onNavigate={navigateToRoute} />
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          <DispatchCompletedTab operatorId={operatorId} onNavigate={navigateToRoute} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DispatchPage() {
  return (
    <Suspense>
      <DispatchPageContent />
    </Suspense>
  );
}
