'use client';

import { useRouter } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { DockListMobile } from '@/components/distribution/DockListMobile';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useOperatorId } from '@/hooks/useOperatorId';

/**
 * spec-68 Fase 6 (Decisión 3) — `/app/distribution/andenes`. The list
 * `4c`'s PROCESOS DE LA NAVE row promises and the canvas never drew.
 *
 * NOT immersive (Decisión 2) — no fixed footer, so it does not join
 * `MOBILE_IMMERSIVE_PREFIXES`; the global `MobileTabBar` stays.
 *
 * No injectable props needed for testing (no clock, no seam like
 * `ConsolidationPageContent`'s `now`), so — unlike `/consolidacion` — the
 * page owns its data-fetching directly rather than delegating to a
 * `*PageContent` component. It still exports only the default page
 * function and nothing else, per the Next Page-contract rule.
 *
 * Fase 6 review (finding #1) — `useDockZones` is `enabled: !!operatorId`,
 * and `GlobalContext` initialises `operatorId` to `null` while `AppLayout`
 * renders children unconditionally. React Query v5's `isLoading` is
 * `isPending && isFetching`, and a DISABLED query reports `isFetching:
 * false` — so on every cold load the old `zonesLoading` gate read false
 * too, rendering `DockListMobile` on the `zones = []` default and
 * flashing "Sin andenes configurados" at a crew standing in front of a
 * fully configured warehouse. Worse, that state was PERMANENT on a real
 * query failure (offline warehouse, RLS): `isLoading` false, `data`
 * undefined forever, same empty screen. "No hay andenes" and "no pude
 * cargar los andenes" are different facts and must not share a screen —
 * `isError` is checked FIRST and returns a distinct error state; loading
 * is then gated on `!operatorId || !zones` itself (the same pattern
 * `quicksort/page.tsx` already uses), not on `isLoading`.
 */
export default function AndenesPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { data: zones, isError: zonesIsError } = useDockZones(operatorId);
  const { data: sectorizedCounts = {} } = useSectorizedByZone(operatorId);

  const goBack = () => router.push('/app/distribution');

  if (zonesIsError) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileHeader variant="titled" title="Andenes" onBack={goBack} />
        <EmptyState
          icon={WifiOff}
          title="No pudimos cargar los andenes"
          description="Revisa tu conexión e intenta de nuevo. Los andenes reales no cambiaron — es la pantalla la que no pudo leerlos."
        />
      </div>
    );
  }

  if (!operatorId || !zones) {
    return (
      <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
        <DistributionMobileHeader variant="titled" title="Andenes" onBack={goBack} />
        <Skeleton data-testid="andenes-skeleton" className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const activeCount = zones.filter((z) => z.is_active).length;

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
      <DistributionMobileHeader
        variant="titled"
        title="Andenes"
        subtitle={`${activeCount} ${activeCount === 1 ? 'andén activo' : 'andenes activos'}`}
        onBack={goBack}
      />

      <DockListMobile zones={zones} sectorizedCounts={sectorizedCounts} />
    </div>
  );
}
