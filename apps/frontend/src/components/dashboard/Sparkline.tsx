'use client';

import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export type SparklinePoint = {
  date: string;
  value: number;
};

interface SparklineProps {
  data: SparklinePoint[];
  color: string;
}

export default function Sparkline({ data, color }: SparklineProps) {
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data}>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.2}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
