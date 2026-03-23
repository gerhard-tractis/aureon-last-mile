'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getDashboardDates } from '@/hooks/useDashboardDates';
import DashboardErrorBanner from './DashboardErrorBanner';
import { useFadrMetric } from '@/hooks/useDashboardMetrics';
import { useOtifMetrics } from '@/hooks/useDeliveryMetrics';
import HeroSLASkeleton from './HeroSLASkeleton';
import SLADrillDownDialog from './SLADrillDownDialog';

interface HeroSLAProps {
  operatorId: string;
  startDate?: string;
  endDate?: string;
}

function computeSla(delivered: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((delivered / total) * 10000) / 100;
}

function HeroSparkline({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} width={w} height={h} fill="none">
      <polyline
        points={points}
        className="stroke-white dark:stroke-accent"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HeroSLA({ operatorId, startDate: startDateProp, endDate: endDateProp }: HeroSLAProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const defaults = useMemo(() => getDashboardDates(), []);
  const startDate = startDateProp ?? defaults.startDate;
  const endDate = endDateProp ?? defaults.endDate;
  const { prevStartDate, prevEndDate } = defaults;

  const otifQuery = useOtifMetrics(operatorId, startDate, endDate);
  const prevOtifQuery = useOtifMetrics(operatorId, prevStartDate, prevEndDate);
  const fadrQuery = useFadrMetric(operatorId, startDate, endDate);

  const isLoading = otifQuery.isLoading || prevOtifQuery.isLoading || fadrQuery.isLoading;
  const hasError = otifQuery.isError || prevOtifQuery.isError || fadrQuery.isError;
  const isPlaceholderData =
    otifQuery.isPlaceholderData || prevOtifQuery.isPlaceholderData || fadrQuery.isPlaceholderData;

  if (isLoading) return <HeroSLASkeleton />;

  const otif = otifQuery.data;
  const prevOtif = prevOtifQuery.data;
  const fadr = fadrQuery.data ?? null;

  const sla = otif ? computeSla(otif.delivered_orders, otif.total_orders) : null;
  const prevSla = prevOtif ? computeSla(prevOtif.delivered_orders, prevOtif.total_orders) : null;

  const hasTrend = sla !== null && prevSla !== null;
  const trendDelta = hasTrend ? sla - prevSla : 0;
  const trendUp = trendDelta >= 0;

  const handleOpen = () => setDialogOpen(true);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setDialogOpen(true);
    }
  };

  return (
    <>
      {hasError && <DashboardErrorBanner />}
      <div
        role="button"
        tabIndex={0}
        aria-label="Ver analisis detallado de SLA"
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        className={[
          'relative rounded-md p-4 w-full cursor-pointer transition-opacity hover:opacity-90',
          /* Light: solid gold bg with white text */
          'bg-accent text-white',
          /* Dark: subtle gold-tinted surface with gold text */
          'dark:bg-accent-muted dark:border dark:border-accent/25 dark:text-accent',
          isPlaceholderData ? 'opacity-60' : '',
        ].join(' ')}
      >
        {isPlaceholderData && (
          <Loader2 className="absolute top-3 right-3 h-4 w-4 animate-spin text-white/60 dark:text-accent/40" aria-label="Actualizando..." />
        )}

        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/80 dark:text-text-secondary mb-1">
              Cumplimiento SLA
            </h2>
            <div className="font-mono text-[28px] font-bold leading-none text-white dark:text-accent">
              {sla !== null ? `${sla.toFixed(1)}%` : 'N/A'}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-white/80 dark:text-text-muted">
              {otif && (
                <span>Meta: 95%</span>
              )}
              {hasTrend && (
                <span>
                  {trendUp ? '▲' : '▼'} {trendUp ? '+' : ''}{trendDelta.toFixed(1)}% vs anterior
                </span>
              )}
              {fadr !== null && (
                <span>FADR: {fadr.toFixed(1)}%</span>
              )}
            </div>
          </div>
          <div className="ml-3">
            <HeroSparkline />
          </div>
        </div>
      </div>

      <SLADrillDownDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
