'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { RouteSkeleton } from '@/components/dispatch/RouteSkeleton';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useIsBelowLg } from '@/hooks/useViewport';
import { DispatchCrewMobileRoot } from '@/components/dispatch/mobile/DispatchCrewMobileRoot';
import { DispatchDesktopBoard } from '@/components/dispatch/DispatchDesktopBoard';

function DispatchPageContent() {
  // spec-76 decision 1 / review I1 — below `lg` (1024px) the dock crew
  // gets its own tree (2a/2b). The desktop board's own data hooks (KPIs,
  // pre-ruta snapshot, route creation) now live inside
  // `DispatchDesktopBoard`, not here — a phone's SETTLED render never
  // triggers them at all (see that file's doc comment on the one
  // unavoidable transient first-commit fetch `useIsBelowLg` cannot skip,
  // covered in `page.viewport-hydration.test.tsx`).
  const isBelowLg = useIsBelowLg();
  const { operatorId, userId } = useOperatorId();

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

  if (isBelowLg) {
    return <DispatchCrewMobileRoot operatorId={operatorId} userId={userId} />;
  }

  return <DispatchDesktopBoard operatorId={operatorId} />;
}

export default function DispatchPage() {
  return (
    <Suspense>
      <DispatchPageContent />
    </Suspense>
  );
}
