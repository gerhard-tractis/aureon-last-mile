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
    <div className="bg-card rounded-xl p-6 shadow-sm border border-border">
      <h3 className="text-lg font-semibold text-foreground mb-4">Órdenes Comprometidas por Día</h3>

      {isLoading ? (
        <div className="h-64 animate-pulse bg-muted rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#e6c15c"
              strokeWidth={2}
              dot={{ fill: '#e6c15c', r: 3 }}
              name="Órdenes"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
