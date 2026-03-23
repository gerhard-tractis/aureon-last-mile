'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { useDailyOrdersByClient } from '@/hooks/useLoadingMetrics';

interface DailyOrdersChartProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

const CLIENT_COLORS: Record<string, string> = {
  Paris: '#0ea5e9',
  Easy: '#10b981',
  'Sin cliente': '#94a3b8',
};
const DEFAULT_COLORS = ['#8b5cf6', '#f97316', '#ec4899', '#14b8a6'];

function getColor(client: string, index: number): string {
  return CLIENT_COLORS[client] ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export default function DailyOrdersChart({ operatorId, startDate, endDate }: DailyOrdersChartProps) {
  const { data, isLoading } = useDailyOrdersByClient(operatorId, startDate, endDate);

  // Group by day, pivot retailers into columns
  const dayMap = new Map<string, Record<string, string | number>>();
  const clientSet = new Set<string>();

  for (const row of data ?? []) {
    const dayLabel = row.day.slice(5); // MM-DD
    if (!dayMap.has(dayLabel)) dayMap.set(dayLabel, { day: dayLabel });
    dayMap.get(dayLabel)![row.retailer_name] = row.count;
    clientSet.add(row.retailer_name);
  }

  const chartData = Array.from(dayMap.values());
  const clients = Array.from(clientSet);

  return (
    <div className="bg-surface border border-border rounded-md p-3">
      <h3 className="text-xs font-semibold text-text-muted uppercase mb-3">
        Evolución Diaria de Órdenes Cargadas
      </h3>

      {isLoading ? (
        <div className="h-64 animate-pulse bg-muted rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
            <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-border)' }} />
            <Legend />
            {clients.map((client, i) => (
              <Bar
                key={client}
                dataKey={client}
                stackId="orders"
                fill={getColor(client, i)}
                radius={i === clients.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
