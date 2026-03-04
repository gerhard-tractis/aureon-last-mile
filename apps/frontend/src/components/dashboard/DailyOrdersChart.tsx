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
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
      <h3 className="text-lg font-semibold text-slate-700 mb-4">
        Evolución Diaria de Órdenes Cargadas
      </h3>

      {isLoading ? (
        <div className="h-64 animate-pulse bg-slate-100 rounded-lg" />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
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
