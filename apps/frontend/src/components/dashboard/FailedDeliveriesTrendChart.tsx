'use client';

import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DailyMetricPoint, FailureReasonRow } from '@/hooks/useDashboardMetrics';
import { useFailureReasons } from '@/hooks/useDashboardMetrics';
import MetricDrillDownDialog from './MetricDrillDownDialog';

interface FailedDeliveriesTrendChartProps {
  data: DailyMetricPoint[];
  operatorId: string;
}

export default function FailedDeliveriesTrendChart({ data, operatorId }: FailedDeliveriesTrendChartProps) {
  const [selectedPoint, setSelectedPoint] = useState<DailyMetricPoint | null>(null);

  // Drill-down: fetch failure reasons for the selected day
  const dayQuery = useFailureReasons(
    selectedPoint ? operatorId : null,
    selectedPoint?.date ?? '',
    selectedPoint?.date ?? ''
  );

  const { peak, lowest } = useMemo(() => {
    if (!data || data.length === 0) return { peak: null, lowest: null };
    const p = data.reduce((max, d) => (d.value > max.value ? d : max), data[0]);
    const l = data.reduce((min, d) => (d.value < min.value ? d : min), data[0]);
    return { peak: p, lowest: l };
  }, [data]);

  const formatDateLabel = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'dd MMM', { locale: es });
    } catch {
      return dateStr;
    }
  };

  return (
    <>
      <div
        className="bg-card rounded-xl border border-border shadow-sm p-6"
        role="img"
        aria-label="Gráfico de tendencia de entregas fallidas por día"
      >
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Tendencia de Entregas Fallidas
        </h3>

        {data.length === 0 ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <span className="text-green-500 text-xl">✓</span>
            <p className="text-sm text-muted-foreground">Sin entregas fallidas en este periodo</p>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data} margin={{ top: 20, right: 20, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateLabel}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  labelFormatter={(label: string) => formatDateLabel(label)}
                  formatter={(value: number) => [`${value} fallos`, 'Entregas fallidas']}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fill="url(#failedGradient)"
                  activeDot={{
                    r: 6,
                    stroke: '#ef4444',
                    strokeWidth: 2,
                    fill: '#fff',
                    cursor: 'pointer',
                    onClick: (_e: unknown, payload: unknown) => {
                      const p = payload as { payload?: DailyMetricPoint };
                      if (p?.payload) setSelectedPoint(p.payload);
                    },
                  }}
                />
                {peak && (
                  <ReferenceDot
                    x={peak.date}
                    y={peak.value}
                    r={5}
                    fill="#ef4444"
                    stroke="#fff"
                    strokeWidth={2}
                    label={{
                      value: `Pico: ${formatDateLabel(peak.date)} (${peak.value} fallos)`,
                      position: 'top',
                      fontSize: 11,
                      fill: '#ef4444',
                      offset: 10,
                    }}
                  />
                )}
                {lowest && lowest.date !== peak?.date && (
                  <ReferenceDot
                    x={lowest.date}
                    y={lowest.value}
                    r={5}
                    fill="#10b981"
                    stroke="#fff"
                    strokeWidth={2}
                    label={{
                      value: `Mínimo: ${formatDateLabel(lowest.date)} (${lowest.value} fallos)`,
                      position: 'bottom',
                      fontSize: 11,
                      fill: '#10b981',
                      offset: 10,
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      <MetricDrillDownDialog
        open={!!selectedPoint}
        onOpenChange={open => { if (!open) setSelectedPoint(null); }}
        title={selectedPoint ? formatDateLabel(selectedPoint.date) : ''}
        description={selectedPoint ? `Detalle de entregas fallidas para ${formatDateLabel(selectedPoint.date)}` : ''}
      >
        {selectedPoint && (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Entregas fallidas</p>
              <p className="text-lg font-semibold text-foreground">{selectedPoint.value}</p>
            </div>
            {dayQuery.isLoading && <p className="text-sm text-muted-foreground">Cargando razones...</p>}
            {dayQuery.data && dayQuery.data.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground uppercase mb-2">Razones principales</p>
                <ul className="space-y-1">
                  {(dayQuery.data as FailureReasonRow[]).map((r) => (
                    <li key={r.reason} className="flex justify-between text-sm text-foreground">
                      <span>{r.reason}</span>
                      <span className="font-medium">{r.count} ({r.percentage.toFixed(1)}%)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </MetricDrillDownDialog>
    </>
  );
}
