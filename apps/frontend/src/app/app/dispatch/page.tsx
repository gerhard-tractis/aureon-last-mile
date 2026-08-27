'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Plus, Route, Package } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/EmptyState';
import { RouteListTile } from '@/components/dispatch/RouteListTile';
import { PreRouteBoard } from '@/components/dispatch/pre-route/PreRouteBoard';
import { DispatchInProgressTab } from '@/components/dispatch/DispatchInProgressTab';
import { useDispatchKPIs } from '@/hooks/dispatch/useDispatchKPIs';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { OPEN_ROUTE_STATUSES, FINISHED_ROUTE_STATUSES } from '@/lib/dispatch/types';
import { useOperatorId } from '@/hooks/useOperatorId';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import { useCreateRouteFromSelection } from '@/hooks/dispatch/pre-route/useCreateRouteFromSelection';
import { resolvePreRouteWindow } from '@/lib/dispatch/pre-route-window';

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
  const { data: routes, isLoading } = useDispatchRoutesByStatus(operatorId, [...OPEN_ROUTE_STATUSES]);
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

function DispatchCompletedTab({
  operatorId,
  onNavigate,
}: {
  operatorId: string;
  onNavigate: (id: string) => void;
}) {
  const { data: routes, isLoading } = useDispatchRoutesByStatus(
    operatorId,
    [...FINISHED_ROUTE_STATUSES],
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

  // QA finding #2: this used to hardcode `today` and pass no window bounds,
  // while PreRouteBoard reads both `?date=` and `?window=` — so the "SIN
  // RUTEAR" figure in the header answered for today's whole day even when
  // the board itself (via PreRouteFilters) was showing tomorrow's "Mañana"
  // slice. Reading both params here, through the same resolvePreRouteWindow
  // the board uses, is what makes the badge and the board unable to
  // disagree on either axis — and it makes this call share the board's
  // react-query cache key instead of firing a second RPC for the same data.
  const today = new Date().toISOString().slice(0, 10);
  const selectedDate = params.get('date') ?? today;
  const selectedWindow = resolvePreRouteWindow(params.get('window') ?? 'todas');
  const { snapshot: preRouteSnapshot } = usePreRouteSnapshot(
    operatorId ?? null,
    selectedDate,
    selectedWindow?.start ?? null,
    selectedWindow?.end ?? null,
  );

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

  const handleCreateRoute = async (orderIds: string[], routeDate: string) => {
    try {
      const route = await createRouteMutation.mutateAsync({ orderIds, routeDate });
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

  const unrouted = preRouteSnapshot?.totals.order_count ?? 0;

  return (
    <div className="flex min-h-0 flex-col">
      {/* Header — title, tabs as inline chips, and the unrouted count that the
          Pre-ruta tab is about. Replaces the KPI card row: five equal cards
          gave no clue which one the screen was for. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-surface px-6 py-3.5">
        <h1 className="font-heading text-lg font-semibold leading-none text-text">Despacho</h1>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pre-ruta">Pre-ruta</TabsTrigger>
            <TabsTrigger value="open">Abiertas {kpisLoading ? '' : kpis?.openRoutes ?? 0}</TabsTrigger>
            <TabsTrigger value="in_progress">En ruta {kpisLoading ? '' : kpis?.inRoute ?? 0}</TabsTrigger>
            <TabsTrigger value="completed">Completadas</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11px] font-medium leading-none text-text-secondary">
            SIN RUTEAR <span className="font-semibold text-text">{unrouted}</span>
          </span>
          <Button onClick={handleNewRoute} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Nueva ruta
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsContent value="pre-ruta" className="mt-0 min-h-0 flex-1">
          <PreRouteBoard onCreateRoute={handleCreateRoute} isCreating={createRouteMutation.isPending} />
        </TabsContent>

        <TabsContent value="open" className="mt-0 p-6">
          <DispatchOpenTab
            operatorId={operatorId}
            onNewRoute={handleNewRoute}
            onNavigate={navigateToRoute}
            onDelete={handleDeleteRoute}
          />
        </TabsContent>

        <TabsContent value="in_progress" className="mt-0 p-6">
          <DispatchInProgressTab operatorId={operatorId} />
        </TabsContent>

        <TabsContent value="completed" className="mt-0 p-6">
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
