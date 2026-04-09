'use client';
import { useNorthStars } from '@/hooks/dashboard/useNorthStars';
import { NorthStarCard } from './NorthStarCard';
import { NORTH_STAR_LABELS } from '@/app/app/dashboard/lib/labels.es';
import { formatPercent, formatNumber } from '@/app/app/dashboard/lib/format';

interface NorthStarStripProps {
  operatorId: string;
  year: number;
  month: number;
}

export function NorthStarStrip({ operatorId, year, month }: NorthStarStripProps) {
  const { data } = useNorthStars(operatorId, year, month);

  const current = data?.current ?? null;
  const priorMonth = data?.priorMonth ?? null;
  const priorYear = data?.priorYear ?? null;

  const otifMom =
    current !== null && priorMonth !== null
      ? (current.otif_pct ?? 0) - (priorMonth.otif_pct ?? 0)
      : null;

  const otifYoy =
    current !== null && priorYear !== null
      ? (current.otif_pct ?? 0) - (priorYear.otif_pct ?? 0)
      : null;

  const ordersMom =
    current !== null && priorMonth !== null
      ? current.total_orders - priorMonth.total_orders
      : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:sticky md:top-0 bg-background z-10 py-3">
      <NorthStarCard
        mode="placeholder"
        label={NORTH_STAR_LABELS.cpo}
        placeholderHint="Requiere modelo de costos"
      />
      <NorthStarCard
        mode="live"
        label={NORTH_STAR_LABELS.otif}
        value={current?.otif_pct ?? null}
        formatter={formatPercent}
        momDelta={otifMom}
        yoyDelta={otifYoy}
      />
      <NorthStarCard
        mode="placeholder"
        label={NORTH_STAR_LABELS.nps}
        placeholderHint="Requiere captura de feedback"
      />
      <NorthStarCard
        mode="live"
        label={NORTH_STAR_LABELS.orders}
        value={current?.total_orders ?? null}
        formatter={formatNumber}
        momDelta={ordersMom}
        yoyDelta={null}
      />
    </div>
  );
}
