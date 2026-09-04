'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { DispatchModuleHeader } from './DispatchModuleHeader';
import { PreRouteBoard } from './pre-route/PreRouteBoard';
import { DispatchOpenRoutesTab } from './DispatchOpenRoutesTab';
import { DispatchEnRutaTab } from './DispatchEnRutaTab';
import { DispatchCompletadasTab } from './DispatchCompletadasTab';
import { useDispatchKPIs } from '@/hooks/dispatch/useDispatchKPIs';
import { usePreRouteSnapshot } from '@/hooks/dispatch/pre-route/usePreRouteSnapshot';
import { useCreateRouteFromSelection } from '@/hooks/dispatch/pre-route/useCreateRouteFromSelection';
import { resolvePreRouteWindow } from '@/lib/dispatch/pre-route-window';
import { hasActivePreRouteFilters, parsePreRouteFilterState } from '@/lib/dispatch/pre-route-filters';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

/**
 * spec-76 review I1 — extracted out of `/app/dispatch/page.tsx` so the
 * desktop-only data hooks below (KPIs, pre-ruta snapshot, route creation)
 * live in a component that only ever mounts at/above `lg`. Same shape as
 * `DispatchRouteSurface`/`RouteBuilder` (spec-76, commit aeaefbb): the
 * branch decides which tree mounts, so the tree that loses never fetches
 * anything on a SETTLED render (see that file's doc comment on the one
 * transient first-commit exception `useIsBelowLg` cannot avoid).
 */
export interface DispatchDesktopBoardProps {
  operatorId: string;
}

export function DispatchDesktopBoard({ operatorId }: DispatchDesktopBoardProps) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();

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
  // spec-76 review M4 — `todayISOInTimezone()`, not
  // `new Date().toISOString().slice(0, 10)`: the UTC slice rolls the
  // calendar date over hours early in Santiago (the exact bug named in this
  // spec's own Lecciones aplicadas #9 / Añadido #3).
  const selectedDate = params.get('date') ?? todayISOInTimezone();
  const selectedWindow = resolvePreRouteWindow(params);
  const { snapshot: preRouteSnapshot } = usePreRouteSnapshot(
    operatorId,
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
      console.error('[DispatchDesktopBoard] handleCreateRoute failed', err);
    }
  };

  const navigateToRoute = (id: string) => router.push(`/app/dispatch/${id}`);

  const unrouted = preRouteSnapshot?.totals.order_count ?? 0;
  // I4 (spec-75) — SIN RUTEAR itself stays the RPC's date/ventana total (it
  // doesn't apply comuna/andén/cliente/problemas/búsqueda), but the
  // qualifier tells the operator that figure doesn't match what the
  // Pre-ruta board below is currently showing them.
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
        <DispatchEnRutaTab operatorId={operatorId} />
      </TabsContent>

      <TabsContent value="completed" className="mt-0 p-6">
        <DispatchCompletadasTab operatorId={operatorId} />
      </TabsContent>
    </Tabs>
  );
}
