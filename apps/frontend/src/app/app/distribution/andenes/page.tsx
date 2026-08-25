'use client';

import { useRouter } from 'next/navigation';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { DockListMobile } from '@/components/distribution/DockListMobile';
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
 */
export default function AndenesPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { data: zones = [], isLoading: zonesLoading } = useDockZones(operatorId);
  const { data: sectorizedCounts = {} } = useSectorizedByZone(operatorId);

  const activeCount = zones.filter((z) => z.is_active).length;

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px]">
      <DistributionMobileHeader
        variant="titled"
        title="Andenes"
        subtitle={`${activeCount} ${activeCount === 1 ? 'andén activo' : 'andenes activos'}`}
        onBack={() => router.push('/app/distribution')}
      />

      {zonesLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <DockListMobile zones={zones} sectorizedCounts={sectorizedCounts} />
      )}
    </div>
  );
}
