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

function getSlaColor(sla: number | null): string {
  if (sla === null) return 'text-muted-foreground';
  if (sla >= 95) return 'text-[#10b981]';
  if (sla >= 90) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

function computeSla(delivered: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((delivered / total) * 10000) / 100;
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

  const failurePercent =
    otif && otif.total_orders > 0
      ? (otif.failed_orders / otif.total_orders) * 100
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
      {hasError && <DashboardErrorBanner />}
      <div
        role="button"
        tabIndex={0}
        aria-label="Ver analisis detallado de SLA"
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        className={`relative bg-card rounded-xl p-6 md:p-12 shadow-sm w-full cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-[1.01] text-center${isPlaceholderData ? ' opacity-60' : ''}`}
      >
        {isPlaceholderData && (
          <Loader2 className="absolute top-4 right-4 h-4 w-4 animate-spin text-muted-foreground" aria-label="Actualizando..." />
        )}

        <h2 className="text-xl font-semibold text-foreground uppercase tracking-wide mb-4">
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
        <p className="text-2xl text-muted-foreground mb-6">
          {otif
            ? `${otif.delivered_orders} de ${otif.total_orders} entregas cumplidas`
            : 'Sin datos para este periodo'}
        </p>

        {/* Progress Bar */}
        {sla !== null && (
          <div className="h-8 rounded-2xl max-w-[800px] mx-auto bg-muted overflow-hidden mb-6">
            <div
              className="h-full rounded-2xl bg-gradient-to-r from-gold to-gold-light flex items-center justify-center text-foreground font-semibold text-sm transition-all duration-500"
              style={{ width: `${Math.min(sla, 100)}%` }}
            >
              {sla.toFixed(1)}%
            </div>
          </div>
        )}

        {/* Inline Sub-Metrics */}
        <div className="flex justify-center gap-12 text-lg text-foreground">
          {fadr !== null && <span>Primera Entrega (FADR): {fadr.toFixed(1)}%</span>}
          {failurePercent !== null && otif && (
            <span>
              Fallos: {otif.failed_orders} ({failurePercent.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      <SLADrillDownDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
