'use client';

import { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getDashboardDates } from '@/hooks/useDashboardDates';
import {
  useSlaMetric,
  useFadrMetric,
  usePerformanceMetricsSummary,
  useSlaPreviousPeriod,
} from '@/hooks/useDashboardMetrics';
import HeroSLASkeleton from './HeroSLASkeleton';
import SLADrillDownDialog from './SLADrillDownDialog';

interface HeroSLAProps {
  operatorId: string;
}

function getSlaColor(sla: number | null): string {
  if (sla === null) return 'text-slate-400';
  if (sla >= 95) return 'text-[#10b981]';
  if (sla >= 90) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

export default function HeroSLA({ operatorId }: HeroSLAProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { startDate, endDate, prevStartDate, prevEndDate } = useMemo(() => getDashboardDates(), []);

  const slaQuery = useSlaMetric(operatorId, startDate, endDate);
  const prevSlaQuery = useSlaPreviousPeriod(operatorId, prevStartDate, prevEndDate);
  const fadrQuery = useFadrMetric(operatorId, startDate, endDate);
  const perfQuery = usePerformanceMetricsSummary(operatorId, startDate, endDate);

  const isLoading =
    slaQuery.isLoading || prevSlaQuery.isLoading || fadrQuery.isLoading || perfQuery.isLoading;
  const hasError =
    slaQuery.isError || prevSlaQuery.isError || fadrQuery.isError || perfQuery.isError;

  if (isLoading) return <HeroSLASkeleton />;

  const sla = slaQuery.data ?? null;
  const prevSla = prevSlaQuery.data ?? null;
  const fadr = fadrQuery.data ?? null;
  const perf = perfQuery.data;

  const hasTrend = sla !== null && prevSla !== null;
  const trendDelta = hasTrend ? sla - prevSla : 0;
  const trendUp = trendDelta >= 0;

  const failurePercent =
    perf && perf.totalOrders > 0
      ? (perf.failedDeliveries / perf.totalOrders) * 100
      : null;

  const handleOpen = () => setDialogOpen(true);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setDialogOpen(true);
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label="Ver analisis detallado de SLA"
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        className="bg-white rounded-xl p-6 md:p-12 shadow-sm w-full cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.01] text-center"
      >
        {hasError && (
          <Alert variant="destructive" className="mb-4 max-w-[800px] mx-auto">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>Los datos pueden estar desactualizados</AlertDescription>
          </Alert>
        )}

        <h2 className="text-xl font-semibold text-slate-700 uppercase tracking-wide mb-4">
          Cumplimiento SLA - Ultimos 7 Dias
        </h2>

        {/* SLA Percentage */}
        <div className={`text-[4rem] md:text-[3rem] font-bold leading-none mb-2 ${getSlaColor(sla)}`}>
          {sla !== null ? `${sla.toFixed(1)}%` : 'N/A'}
        </div>

        {/* Trend */}
        {hasTrend && (
          <div className={`text-xl font-medium mb-4 ${trendUp ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
            {trendUp ? '↑' : '↓'} {trendUp ? '+' : ''}{trendDelta.toFixed(1)}% vs semana anterior
          </div>
        )}

        {/* Context Line */}
        <p className="text-2xl text-slate-600 mb-6">
          {perf
            ? `${perf.deliveredOrders} de ${perf.totalOrders} entregas cumplidas`
            : 'Sin datos para este periodo'}
        </p>

        {/* Progress Bar */}
        {sla !== null && (
          <div className="h-8 rounded-2xl max-w-[800px] mx-auto bg-slate-200 overflow-hidden mb-6">
            <div
              className="h-full rounded-2xl bg-gradient-to-r from-gold to-gold-light flex items-center justify-center text-slate-800 font-semibold text-sm transition-all duration-500"
              style={{ width: `${Math.min(sla, 100)}%` }}
            >
              {sla.toFixed(1)}%
            </div>
          </div>
        )}

        {/* Inline Sub-Metrics */}
        <div className="flex justify-center gap-12 text-lg text-slate-700">
          {fadr !== null && <span>Primera Entrega (FADR): {fadr.toFixed(1)}%</span>}
          {failurePercent !== null && perf && (
            <span>
              Fallos: {perf.failedDeliveries} ({failurePercent.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      <SLADrillDownDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
