'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { FailureReasonRow } from '@/hooks/useDashboardMetrics';
import MetricDrillDownDialog from './MetricDrillDownDialog';

interface FailureReasonsChartProps {
  data: FailureReasonRow[];
  totalFailures: number;
}

function getBarColor(count: number): string {
  if (count > 50) return '#ef4444';
  if (count >= 20) return '#f59e0b';
  return '#94a3b8';
}

export default function FailureReasonsChart({ data, totalFailures }: FailureReasonsChartProps) {
  const [selectedReason, setSelectedReason] = useState<FailureReasonRow | null>(null);

  const top5 = data
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const chartHeight = Math.max(200, top5.length * 44 + 40);

  return (
    <>
      <div
        className="bg-card rounded-xl border border-border shadow-sm p-6"
        role="img"
        aria-label="Gráfico de barras mostrando las principales razones de fallo en entregas"
      >
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Top 5 Razones de Fallo
        </h3>

        {top5.length === 0 ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <span className="text-green-500 text-xl">✓</span>
            <p className="text-sm text-muted-foreground">Sin entregas fallidas en este periodo</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={top5}
              layout="vertical"
              margin={{ left: 10, right: 60, top: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="reason"
                width={110}
                tick={{ fontSize: 12, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value: number, _name: string, props: { payload?: FailureReasonRow }) => [
                  `${value} (${props.payload?.percentage.toFixed(1) ?? ''}%)`,
                  'Fallos',
                ]}
                cursor={{ fill: 'rgba(0,0,0,0.05)' }}
              />
              <Bar
                dataKey="count"
                radius={[0, 6, 6, 0]}
                animationDuration={600}
                barSize={32}
                onClick={(_data: FailureReasonRow, index: number) => setSelectedReason(top5[index])}
                style={{ cursor: 'pointer' }}
                label={{
                  position: 'right',
                  formatter: (value: number) => `${value}`,
                  fontSize: 12,
                  fill: '#64748b',
                }}
              >
                {top5.map((entry, i) => (
                  <Cell key={i} fill={getBarColor(entry.count)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <MetricDrillDownDialog
        open={!!selectedReason}
        onOpenChange={open => { if (!open) setSelectedReason(null); }}
        title={selectedReason?.reason ?? ''}
        description={`Detalle de razón de fallo: ${selectedReason?.reason ?? ''}`}
      >
        {selectedReason && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Cantidad</p>
                <p className="text-lg font-semibold text-foreground">{selectedReason.count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Porcentaje</p>
                <p className="text-lg font-semibold text-foreground">{selectedReason.percentage.toFixed(1)}%</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {selectedReason.count} de {totalFailures} entregas fallidas en este periodo
            </p>
          </div>
        )}
      </MetricDrillDownDialog>
    </>
  );
}
