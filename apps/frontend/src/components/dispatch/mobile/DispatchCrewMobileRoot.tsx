'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCrewLoadingBoard } from '@/hooks/dispatch/mobile/useCrewLoadingBoard';
import { useCurrentUserName } from '@/hooks/useCurrentUserName';
import { DispatchCrewMobileHeader } from './DispatchCrewMobileHeader';
import { DispatchCrewHome } from './DispatchCrewHome';
import { DispatchCrewRouteList } from './DispatchCrewRouteList';

type CrewView = 'home' | 'routes';

/**
 * spec-76 phase 1-2 — the mobile branch's entry point at `/app/dispatch`
 * below `lg`. `2a` (home) and `2b` (route list) are one URL per the spec's
 * scope table, so this owns which of the two is on screen rather than a
 * second Next.js route — the same one-screen-two-states pattern
 * `PickupMobileView.tsx` uses for `3h`/`3j`.
 */
export interface DispatchCrewMobileRootProps {
  operatorId: string | null;
  userId: string | null;
}

export function DispatchCrewMobileRoot({ operatorId, userId }: DispatchCrewMobileRootProps) {
  const router = useRouter();
  const [view, setView] = useState<CrewView>('home');
  const { data: board, isLoading } = useCrewLoadingBoard(operatorId, userId);
  const { data: currentUserName } = useCurrentUserName();

  const openRoute = (routeId: string) => router.push(`/app/dispatch/${routeId}`);

  const routes = board?.routes ?? [];
  const packagesOnDock = board?.packagesOnDock ?? 0;

  // spec-76 review M2 — DispatchCrewMobileHeader (EN LÍNEA) hoisted above
  // the 2a/2b view switch so the route list keeps it too, not just home.
  // It used to live only in the `home` branch's returned tree.
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="dispatch-crew-mobile-root">
      <DispatchCrewMobileHeader driverName={currentUserName ?? null} />
      {view === 'routes' ? (
        <DispatchCrewRouteList
          routes={routes}
          packagesOnDock={packagesOnDock}
          onOpenRoute={openRoute}
          onBack={() => setView('home')}
        />
      ) : (
        <DispatchCrewHome
          isLoading={isLoading}
          myTask={board?.myTask ?? null}
          queue={board?.queue ?? []}
          shift={board?.shift ?? { scannedToday: 0, ratePerHour: null }}
          lastDispatched={board?.lastDispatched ?? null}
          onContinueTask={openRoute}
          onChooseRoute={() => setView('routes')}
        />
      )}
    </div>
  );
}
