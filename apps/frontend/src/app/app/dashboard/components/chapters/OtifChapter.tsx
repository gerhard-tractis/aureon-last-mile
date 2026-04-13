import { Chapter } from '@/app/app/dashboard/components/Chapter';
import { ChapterHeroBand } from '@/app/app/dashboard/components/ChapterHeroBand';
import { OtifByRegion } from '@/app/app/dashboard/components/tactical/OtifByRegion';
import { OtifByCustomer } from '@/app/app/dashboard/components/tactical/OtifByCustomer';
import { LateReasonsSummary } from '@/app/app/dashboard/components/tactical/LateReasonsSummary';
import { CHAPTER_LABELS } from '@/app/app/dashboard/lib/labels.es';
import { formatPercent } from '@/app/app/dashboard/lib/format';
import { useNorthStars } from '@/hooks/dashboard/useNorthStars';
import { useOtifChapter } from '@/hooks/dashboard/useOtifChapter';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

interface OtifChapterProps {
  operatorId: string;
  period: DashboardPeriod;
}

export function OtifChapter({ operatorId, period }: OtifChapterProps) {
  const northStars = useNorthStars(operatorId, period.year, period.month);
  const { byRegion, byCustomer, lateReasons, isLoading } = useOtifChapter(operatorId, period);

  const nsData = northStars.data;
  const current = nsData?.current ?? null;
  const priorMonth = nsData?.priorMonth ?? null;
  const priorYear = nsData?.priorYear ?? null;

  const heroValue = formatPercent(current?.otif_pct ?? null);

  const momDelta =
    current?.otif_pct != null && priorMonth?.otif_pct != null
      ? current.otif_pct - priorMonth.otif_pct
      : null;

  const yoyDelta =
    current?.otif_pct != null && priorYear?.otif_pct != null
      ? current.otif_pct - priorYear.otif_pct
      : null;

  return (
    <Chapter
      headline={CHAPTER_LABELS.otif}
    >
      <ChapterHeroBand
        value={heroValue}
        momDelta={momDelta}
        yoyDelta={yoyDelta}
        meta="meta 95%"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <OtifByRegion data={byRegion} isLoading={isLoading} />
        <OtifByCustomer data={byCustomer} isLoading={isLoading} />
        <LateReasonsSummary data={lateReasons} isLoading={isLoading} />
      </div>
    </Chapter>
  );
}
