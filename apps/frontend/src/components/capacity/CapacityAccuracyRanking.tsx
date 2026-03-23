'use client';

import { useMemo } from 'react';
import { useForecastAccuracy } from '@/hooks/useForecastAccuracy';
import { Skeleton } from '@/components/ui/skeleton';

interface CapacityAccuracyRankingProps {
  operatorId: string;
  month: string; // 'YYYY-MM'
}

interface RetailerAccuracy {
  clientId: string;
  retailerName: string;
  accuracyPct: number;
  avgVariancePct: number;
  daysMeasured: number;
}

function getMonthDateRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { dateFrom, dateTo };
}

export default function CapacityAccuracyRanking({
  operatorId,
  month,
}: CapacityAccuracyRankingProps) {
  const { dateFrom, dateTo } = getMonthDateRange(month);
  const { data, isLoading } = useForecastAccuracy(operatorId, dateFrom, dateTo);

  const rankings = useMemo<RetailerAccuracy[]>(() => {
    if (!data || data.length === 0) return [];

    // get_forecast_accuracy RPC returns one aggregated row per retailer
    return data
      .map((r) => ({
        clientId: r.client_id,
        retailerName: r.retailer_name,
        accuracyPct: Math.round(r.accuracy_score ?? 0),
        avgVariancePct: Math.round((r.avg_variance_pct ?? 0) * 10) / 10,
        daysMeasured: r.days_measured ?? 0,
      }))
      .sort((a, b) => b.accuracyPct - a.accuracyPct);
  }, [data]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (rankings.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-4">
        Sin datos de precisión para este mes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-semibold text-foreground">Retailer</th>
            <th className="text-right p-3 font-semibold text-foreground">Precisión</th>
            <th className="text-right p-3 font-semibold text-foreground">Varianza Promedio</th>
            <th className="text-right p-3 font-semibold text-foreground">Días Medidos</th>
          </tr>
        </thead>
        <tbody>
          {rankings.map((r, idx) => (
            <tr key={r.clientId} className="border-b hover:bg-muted/30 transition-colors">
              <td className="p-3 text-foreground font-medium">
                <span className="text-muted-foreground mr-2">#{idx + 1}</span>
                {r.retailerName}
              </td>
              <td className="p-3 text-right">
                <span
                  className={
                    r.accuracyPct >= 90
                      ? 'text-status-success font-semibold'
                      : r.accuracyPct >= 70
                        ? 'text-status-warning font-semibold'
                        : 'text-status-error font-semibold'
                  }
                >
                  {r.accuracyPct}%
                </span>
              </td>
              <td className="p-3 text-right text-muted-foreground">{r.avgVariancePct}%</td>
              <td className="p-3 text-right text-muted-foreground">{r.daysMeasured}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
