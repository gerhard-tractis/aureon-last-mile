'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { subDays, format } from 'date-fns';
import {
  useFailureReasons,
  useDailyMetricsSeries,
} from '@/hooks/useDashboardMetrics';
import FailureReasonsChart from './FailureReasonsChart';
import FailedDeliveriesTrendChart from './FailedDeliveriesTrendChart';
import DashboardErrorBanner from './DashboardErrorBanner';

interface FailedDeliveriesAnalysisProps {
  operatorId: string;
}

type DateRangeOption = '7' | '30' | '90';

export default function FailedDeliveriesAnalysis({ operatorId }: FailedDeliveriesAnalysisProps) {
  const [dateRange, setDateRange] = useState<DateRangeOption>('30');

  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const end = format(today, 'yyyy-MM-dd');
    const start = format(subDays(today, Number(dateRange) - 1), 'yyyy-MM-dd');
    return { startDate: start, endDate: end };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  const reasonsQuery = useFailureReasons(operatorId, startDate, endDate);
  const trendQuery = useDailyMetricsSeries(operatorId, startDate, endDate, 'failed_deliveries');

  const isLoading = reasonsQuery.isLoading || trendQuery.isLoading;
  const isError = reasonsQuery.isError || trendQuery.isError;
  const isPlaceholderData = reasonsQuery.isPlaceholderData || trendQuery.isPlaceholderData;

  const totalFailures = useMemo(() => {
    if (!reasonsQuery.data) return 0;
    return reasonsQuery.data.reduce((sum, r) => sum + r.count, 0);
  }, [reasonsQuery.data]);

  const dateRangeLabels: Record<string, string> = {
    '7': 'Últimos 7 días',
    '30': 'Últimos 30 días',
    '90': 'Últimos 90 días',
  };

  return (
    <div className="relative">
      {isPlaceholderData && (
        <Loader2 className="absolute top-0 right-0 h-4 w-4 animate-spin text-slate-400" aria-label="Actualizando..." />
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
          Análisis de Entregas Fallidas
        </h2>
        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value as DateRangeOption)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.entries(dateRangeLabels).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Error banner */}
      {isError && <DashboardErrorBanner />}

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="h-5 w-48 bg-slate-200 rounded animate-pulse mb-4" />
            <div className="h-52 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="h-5 w-48 bg-slate-200 rounded animate-pulse mb-4" />
            <div className="h-72 bg-slate-200 rounded animate-pulse" />
          </div>
        </div>
      ) : (
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-6 transition-all duration-300${isPlaceholderData ? ' opacity-60' : ''}`}>
          <FailureReasonsChart
            data={reasonsQuery.data ?? []}
            totalFailures={totalFailures}
          />
          <FailedDeliveriesTrendChart
            data={trendQuery.data ?? []}
            operatorId={operatorId}
          />
        </div>
      )}
    </div>
  );
}
