import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: 'up' | 'down' | 'flat';
    value: string;
    favorable: boolean;
  };
  sparklineData?: number[];
  icon?: LucideIcon;
  href?: string;
  className?: string;
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} width={w} height={h} fill="none">
      <polyline points={points} stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TREND_ARROWS: Record<string, string> = { up: '▲', down: '▼', flat: '→' };

// TODO: implement href drill-down wrapping in phase 2 (spec-13b)
export function MetricCard({ label, value, trend, sparklineData, icon: Icon, className }: MetricCardProps) {
  const trendColor = trend
    ? trend.favorable
      ? 'text-status-success'
      : 'text-status-error'
    : '';

  return (
    <div className={cn('bg-surface border border-border rounded-md p-3', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            {Icon && <Icon className="h-3.5 w-3.5 text-text-muted" />}
            <span className="text-xs text-text-muted uppercase tracking-wide truncate">{label}</span>
          </div>
          <div data-value className="font-mono text-xl font-semibold text-text">{value}</div>
          {trend && (
            <div data-trend className={cn('text-xs mt-0.5', trendColor)}>
              <span>{TREND_ARROWS[trend.direction]}</span>{' '}
              <span>{trend.value}</span>
            </div>
          )}
        </div>
        {sparklineData && sparklineData.length >= 2 && (
          <div className="ml-2 mt-1">
            <Sparkline data={sparklineData} />
          </div>
        )}
      </div>
    </div>
  );
}
