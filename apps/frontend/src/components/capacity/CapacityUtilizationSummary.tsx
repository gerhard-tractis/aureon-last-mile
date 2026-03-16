'use client';

import { useMemo } from 'react';
import { useCapacityUtilization } from '@/hooks/useCapacityUtilization';
import { Skeleton } from '@/components/ui/skeleton';

interface CapacityUtilizationSummaryProps {
  operatorId: string;
  month: string; // 'YYYY-MM'
}

interface RetailerSummary {
  clientId: string;
  retailerName: string;
  avgDailyOrders: number;
  avgCapacity: number;
  avgUtilization: number;
  daysOver100: number;
}

function getMonthDateRange(month: string) {
  const [year, mon] = month.split('-').map(Number);
  const dateFrom = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const dateTo = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { dateFrom, dateTo };
}

export default function CapacityUtilizationSummary({
  operatorId,
  month,
}: CapacityUtilizationSummaryProps) {
  const { dateFrom, dateTo } = getMonthDateRange(month);
  const { data, isLoading } = useCapacityUtilization(operatorId, dateFrom, dateTo);

  const summaries = useMemo<RetailerSummary[]>(() => {
    if (!data || data.length === 0) return [];

    // Group by client_id
    const byClient = new Map<string, typeof data>();
    for (const row of data) {
      const key = (row as unknown as { client_id: string }).client_id ?? 'unknown';
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key)!.push(row);
    }

    return Array.from(byClient.entries()).map(([clientId, rows]) => {
      const retailerName =
        (rows[0] as unknown as { retailer_name: string }).retailer_name ?? clientId;
      const totalOrders = rows.reduce((s, r) => s + (r.actual_orders ?? 0), 0);
      const totalCapacity = rows.reduce((s, r) => s + (r.daily_capacity ?? 0), 0);
      const totalUtil = rows.reduce((s, r) => s + (r.utilization_pct ?? 0), 0);
      const daysOver100 = rows.filter((r) => (r.utilization_pct ?? 0) > 100).length;

      return {
        clientId,
        retailerName,
        avgDailyOrders: rows.length > 0 ? Math.round(totalOrders / rows.length) : 0,
        avgCapacity: rows.length > 0 ? Math.round(totalCapacity / rows.length) : 0,
        avgUtilization: rows.length > 0 ? Math.round(totalUtil / rows.length) : 0,
        daysOver100,
      };
    });
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

  if (summaries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-4">
        Sin datos de utilización para este mes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-3 font-semibold text-foreground">Retailer</th>
            <th className="text-right p-3 font-semibold text-foreground">Promedio Diario</th>
            <th className="text-right p-3 font-semibold text-foreground">Capacidad Promedio</th>
            <th className="text-right p-3 font-semibold text-foreground">Utilización</th>
            <th className="text-right p-3 font-semibold text-foreground">Días &gt;100%</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.clientId} className="border-b hover:bg-muted/30 transition-colors">
              <td className="p-3 text-foreground font-medium">{s.retailerName}</td>
              <td className="p-3 text-right text-muted-foreground">{s.avgDailyOrders}</td>
              <td className="p-3 text-right text-muted-foreground">{s.avgCapacity}</td>
              <td className="p-3 text-right">
                <span
                  className={
                    s.avgUtilization > 100
                      ? 'text-red-600 font-semibold'
                      : s.avgUtilization >= 80
                        ? 'text-yellow-600 font-semibold'
                        : 'text-green-600'
                  }
                >
                  {s.avgUtilization}%
                </span>
              </td>
              <td className="p-3 text-right text-muted-foreground">{s.daysOver100}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
