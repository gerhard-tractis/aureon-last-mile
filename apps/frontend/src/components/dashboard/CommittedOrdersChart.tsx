'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useCommittedOrdersDaily } from '@/hooks/useLoadingMetrics';

interface CommittedOrdersChartProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

export default function CommittedOrdersChart({ operatorId, startDate, endDate }: CommittedOrdersChartProps) {
  const { data, isLoading } = useCommittedOrdersDaily(operatorId, startDate, endDate);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((d) => ({
      ...d,
      day: d.day.slice(5).replace('-', '-'), // MM-DD
    }));
  }, [data]);

  return (
    <div className="bg-surface border border-border rounded-md p-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase mb-3">Órdenes Comprometidas por Día</h3>

      {isLoading ? (
        <div className="h-64 animate-pulse bg-muted rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
            <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-border)' }} />
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={{ fill: 'var(--color-accent)', r: 3 }}
              name="Órdenes"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
