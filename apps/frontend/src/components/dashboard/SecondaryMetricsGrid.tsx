'use client';

import { Loader2 } from 'lucide-react';
import { getDashboardDates } from '@/hooks/useDashboardDates';
import {
  useSecondaryMetrics,
  useSecondaryMetricsPreviousPeriod,
} from '@/hooks/useDashboardMetrics';
import MetricsCard from './MetricsCard';
import MetricsCardSkeleton from './MetricsCardSkeleton';
import DashboardErrorBanner from './DashboardErrorBanner';

interface SecondaryMetricsGridProps {
  operatorId: string;
}

function getCapacityColor(value: number | null): string {
  if (value === null) return 'text-slate-400';
  if (value > 95 || value < 60) return 'text-[#ef4444]';
  if (value > 85) return 'text-[#f59e0b]';
  return 'text-[#10b981]';
}

function getOrdersPerHourColor(value: number | null): string {
  if (value === null) return 'text-slate-400';
  if (value >= 40) return 'text-[#10b981]';
  if (value >= 30) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}

function formatTrend(current: number | null, previous: number | null): { text: string; up: boolean } | null {
  if (current === null || previous === null || previous === 0) return null;
  const pctChange = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(pctChange) * 10) / 10;
  if (pctChange >= 0) {
    return { text: `↑ +${rounded}% vs semana anterior`, up: true };
  }
  return { text: `↓ -${rounded}% vs semana anterior`, up: false };
}

export default function SecondaryMetricsGrid({ operatorId }: SecondaryMetricsGridProps) {
  const { startDate, endDate, prevStartDate, prevEndDate } = getDashboardDates();

  const { data: current, isLoading, isError, isPlaceholderData } = useSecondaryMetrics(operatorId, startDate, endDate);
  const { data: previous } = useSecondaryMetricsPreviousPeriod(operatorId, prevStartDate, prevEndDate);

  if (isLoading) {
    return (
      <section>
        <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-4">
          MÉTRICAS SECUNDARIAS
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <MetricsCardSkeleton />
          <MetricsCardSkeleton />
        </div>
      </section>
    );
  }

  const capacityValue = current?.capacityPct;
  const ordersPerHourValue = current?.ordersPerHour;
  const capacityTrend = formatTrend(capacityValue ?? null, previous?.capacityPct ?? null);
  const ordersPerHourTrend = formatTrend(ordersPerHourValue ?? null, previous?.ordersPerHour ?? null);

  return (
    <section>
      <h2 className="text-xs font-bold tracking-widest text-slate-400 uppercase mb-4">
        MÉTRICAS SECUNDARIAS
      </h2>
      {isError && <DashboardErrorBanner />}
      <div className={`relative grid grid-cols-1 sm:grid-cols-2 gap-6 transition-all duration-300${isPlaceholderData ? ' opacity-60' : ''}`}>
        {isPlaceholderData && (
          <Loader2 className="absolute top-0 right-0 h-4 w-4 animate-spin text-slate-400" aria-label="Actualizando..." />
        )}
        <MetricsCard
          icon="📊"
          title="Capacidad Utilizada"
          value={capacityValue !== null && capacityValue !== undefined ? `${capacityValue}%` : 'N/A'}
          color={getCapacityColor(capacityValue ?? null)}
          trend={capacityTrend?.text ?? null}
          trendUp={capacityTrend?.up}
          context={`${current?.totalOrders ?? 0} pedidos en el período`}
          tooltipText={`Utilización: ${current?.totalOrders ?? 0} pedidos / ${(current?.capacityTarget ?? 1000) * (Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1))} capacidad`}
          ariaLabel={`Capacidad Utilizada: ${capacityValue !== null && capacityValue !== undefined ? `${capacityValue}%` : 'sin datos'}`}
          isStale={isError}
        />
        <MetricsCard
          icon="⏱️"
          title="Pedidos por Hora"
          value={ordersPerHourValue !== null && ordersPerHourValue !== undefined ? `${ordersPerHourValue}` : 'N/A'}
          color={getOrdersPerHourColor(ordersPerHourValue ?? null)}
          trend={ordersPerHourTrend?.text ?? null}
          trendUp={ordersPerHourTrend?.up}
          context={`Promedio por hora operativa`}
          tooltipText={`Total: ${current?.totalOrders ?? 0} pedidos en ${Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1) * 10} horas operativas`}
          ariaLabel={`Pedidos por Hora: ${ordersPerHourValue !== null && ordersPerHourValue !== undefined ? ordersPerHourValue : 'sin datos'}`}
          isStale={isError}
        />
      </div>
    </section>
  );
}

export { getCapacityColor, getOrdersPerHourColor, formatTrend };
