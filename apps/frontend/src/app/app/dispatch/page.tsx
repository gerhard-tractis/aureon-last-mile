'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { DispatchModuleHeader } from '@/components/dispatch/DispatchModuleHeader';
import { RouteSkeleton } from '@/components/dispatch/RouteSkeleton';
import { PreRouteBoard } from '@/components/dispatch/pre-route/PreRouteBoard';
import { DispatchOpenRoutesTab } from '@/components/dispatch/DispatchOpenRoutesTab';
import { DispatchInProgressTab } from '@/components/dispatch/DispatchInProgressTab';
import { DispatchCompletedRoutesTab } from '@/components/dispatch/DispatchCompletedRoutesTab';
import { useDispatchKPIs } from '@/hooks/dispatch/useDispatchKPIs';
import { useOperatorId } from '@/hooks/useOperatorId';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import { useCreateRouteFromSelection } from '@/hooks/dispatch/pre-route/useCreateRouteFromSelection';
import { resolvePreRouteWindow } from '@/lib/dispatch/pre-route-window';
import { hasActivePreRouteFilters, parsePreRouteFilterState } from '@/lib/dispatch/pre-route-filters';
import { useIsBelowLg } from '@/hooks/useViewport';
import { DispatchCrewMobileRoot } from '@/components/dispatch/mobile/DispatchCrewMobileRoot';

function DispatchPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  // spec-76 decision 1 — below `lg` (1024px) the dock crew gets its own
  // tree (2a/2b), not the three-column desktop board reflowed. The desktop-
  // only hooks below (KPIs, pre-ruta snapshot, route creation) still run
  // either way — Rules of Hooks, same as RouteReceptionPage's identical
  // branch — but the RETURN a few lines down never mounts their JSX (the
  // map, crew panel, KPI cards) on mobile: not hidden with CSS, not
  // rendered at all. `useOperatorId`'s `userId` (spec-61 Task 5) is what
  // tells the crew screen which route is genuinely "mine".
  const isBelowLg = useIsBelowLg();

  const { operatorId, userId } = useOperatorId();
  const { data: kpis, isLoading: kpisLoading } = useDispatchKPIs(operatorId);

  // QA finding #2: this used to hardcode `today` and pass no window bounds,
  // while PreRouteBoard reads both `?date=` and the ventana range — so the
  // "SIN RUTEAR" figure in the header answered for today's whole day even
  // when the board itself (via PreRouteFilters) was showing a narrower
  // slice. Reading both params here, through the same resolvePreRouteWindow
  // the board uses, is what makes the badge and the board unable to
  // disagree on either axis — and it makes this call share the board's
  // react-query cache key instead of firing a second RPC for the same data.
  //
  // spec-75 task 2b: `?window=` (a fixed Mañana/Tarde/Noche band) was
  // replaced by the free `?window_start=`/`?window_end=` range Ventana now
  // writes — resolvePreRouteWindow reads the params directly instead of a
  // band-name lookup, so this call site changed with it rather than
  // silently falling back to "todas" forever.
  const today = new Date().toISOString().slice(0, 10);
  const selectedDate = params.get('date') ?? today;
  const selectedWindow = resolvePreRouteWindow(params);
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
    // Matches the real shell (module header + route tiles) rather than the
    // 5-card KPI row this page no longer renders — that skeleton used to
    // flash a layout the loaded page never shows.
    return (
      <div className="flex min-h-0 flex-col">
        <div className="border-b border-border bg-surface px-6 py-3.5">
          <Skeleton className="h-10 w-full max-w-md rounded-md" />
        </div>
        <div className="p-6">
          <RouteSkeleton />
        </div>
      </div>
    );
  }

  // spec-76 Fase 1 — below `lg`, `DispatchCrewMobileRoot` owns the whole
  // screen (2a home / 2b route list). None of `PreRouteBoard`, the tabs, or
  // the KPI header below this point ever mount here.
  if (isBelowLg) {
    return <DispatchCrewMobileRoot operatorId={operatorId} userId={userId} />;
  }

  const navigateToRoute = (id: string) => router.push(`/app/dispatch/${id}`);

  const unrouted = preRouteSnapshot?.totals.order_count ?? 0;
  // I4 — SIN RUTEAR itself stays the RPC's date/ventana total (it doesn't
  // apply comuna/andén/cliente/problemas/búsqueda), but the qualifier tells
  // the operator that figure doesn't match what the Pre-ruta board below is
  // currently showing them.
  const hasActiveFilters = hasActivePreRouteFilters(parsePreRouteFilterState(params));

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <DispatchModuleHeader
        unrouted={unrouted}
        hasActiveFilters={hasActiveFilters}
        // `undefined` (still loading) must render no count, not a `0` that
        // reads as a real, briefly-wrong figure — don't collapse this to
        // `?? 0`.
        enCargaCount={kpisLoading ? undefined : kpis?.openRoutes}
        enRutaCount={kpisLoading ? undefined : kpis?.inRoute}
        onNewRoute={handleNewRoute}
      />

      <TabsContent value="pre-ruta" className="mt-0 min-h-0 flex-1">
        <PreRouteBoard onCreateRoute={handleCreateRoute} isCreating={createRouteMutation.isPending} />
      </TabsContent>

      <TabsContent value="open" className="mt-0 p-6">
        <DispatchOpenRoutesTab
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
        <DispatchCompletedRoutesTab operatorId={operatorId} onNavigate={navigateToRoute} />
      </TabsContent>
    </Tabs>
  );
}

export default function DispatchPage() {
  return (
    <Suspense>
      <DispatchPageContent />
    </Suspense>
  );
}
