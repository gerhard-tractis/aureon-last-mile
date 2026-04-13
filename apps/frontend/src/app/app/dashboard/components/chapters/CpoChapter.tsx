import { Chapter } from '@/app/app/dashboard/components/Chapter';
import { ChapterPlaceholder } from '@/app/app/dashboard/components/ChapterPlaceholder';
import { FadrCard } from '@/app/app/dashboard/components/tactical/FadrCard';
import { RouteKmCard } from '@/app/app/dashboard/components/tactical/RouteKmCard';
import { KmPerStopCard } from '@/app/app/dashboard/components/tactical/KmPerStopCard';
import { OrdersPerRouteCard } from '@/app/app/dashboard/components/tactical/OrdersPerRouteCard';
import { GasPlaceholderCard } from '@/app/app/dashboard/components/tactical/GasPlaceholderCard';
import { CHAPTER_LABELS, PLACEHOLDER_COPY } from '@/app/app/dashboard/lib/labels.es';
import { useCpoChapter } from '@/hooks/dashboard/useCpoChapter';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

interface CpoChapterProps {
  operatorId: string;
  period: DashboardPeriod;
}

export function CpoChapter({ operatorId, period }: CpoChapterProps) {
  const { routeTactics, isLoading } = useCpoChapter(operatorId, period);

  return (
    <Chapter
      headline={CHAPTER_LABELS.cpo}
    >
      <ChapterPlaceholder reason={PLACEHOLDER_COPY.cpo} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <FadrCard data={routeTactics} isLoading={isLoading} />
        <RouteKmCard data={routeTactics} isLoading={isLoading} />
        <KmPerStopCard data={routeTactics} isLoading={isLoading} />
        <OrdersPerRouteCard data={routeTactics} isLoading={isLoading} />
        <GasPlaceholderCard />
      </div>
    </Chapter>
  );
}
