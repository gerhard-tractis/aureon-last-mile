'use client';

import { useState, useCallback } from 'react';
import Sparkline, { type SparklinePoint } from './Sparkline';

export type ColorThresholds = {
  green: number;
  yellow: number;
  direction: 'higher-better' | 'lower-better';
};

export function getMetricColor(value: number | null, thresholds: ColorThresholds): string {
  if (value === null || isNaN(value)) return 'text-muted-foreground';
  const { green, yellow, direction } = thresholds;
  if (direction === 'higher-better') {
    if (value >= green) return 'text-[var(--color-status-success)]';
    if (value >= yellow) return 'text-[var(--color-status-warning)]';
    return 'text-[var(--color-status-error)]';
  }
  if (value <= green) return 'text-[var(--color-status-success)]';
  if (value <= yellow) return 'text-[var(--color-status-warning)]';
  return 'text-[var(--color-status-error)]';
}

export function getMetricHexColor(value: number | null, thresholds: ColorThresholds): string {
  if (value === null || isNaN(value)) return '#94a3b8';
  const { green, yellow, direction } = thresholds;
  if (direction === 'higher-better') {
    if (value >= green) return '#10b981';
    if (value >= yellow) return '#f59e0b';
    return '#ef4444';
  }
  if (value <= green) return '#10b981';
  if (value <= yellow) return '#f59e0b';
  return '#ef4444';
}

interface MetricsCardProps {
  title: string;
  icon: string;
  value: string;
  color: string;
  trend?: string | null;
  trendUp?: boolean;
  context: string;
  sparklineData?: SparklinePoint[];
  sparklineColor?: string;
  tooltipText?: string;
  benchmarkBadge?: string;
  roiLine?: string;
  capacityLine?: string;
  onClick?: () => void;
  ariaLabel: string;
  isStale?: boolean;
}

export default function MetricsCard({
  title,
  icon,
  value,
  color,
  trend,
  trendUp,
  context,
  sparklineData,
  sparklineColor,
  tooltipText,
  benchmarkBadge,
  roiLine,
  capacityLine,
  onClick,
  ariaLabel,
  isStale,
}: MetricsCardProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && onClick) {
        e.preventDefault();
        onClick();
      }
    },
    [onClick]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className="relative bg-card rounded-xl p-6 shadow-sm border border-border min-h-[240px] cursor-pointer hover:shadow-lg hover:scale-[1.01] transition-all duration-300"
    >
      {/* Tooltip */}
      {showTooltip && tooltipText && (
        <div className="absolute z-10 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-slate-800 text-white text-xs rounded-lg p-3 shadow-lg pointer-events-none">
          {tooltipText}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{icon}</span>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {isStale && (
          <span className="text-amber-500 text-sm" title="Los datos pueden estar desactualizados">⚠️</span>
        )}
      </div>

      {/* Value */}
      <div className={`text-[2.5rem] lg:text-[3rem] font-bold leading-none mb-1 ${color}`}>
        {value}
      </div>

      {/* Trend */}
      {trend && (
        <div className={`text-sm font-medium mb-1 ${trendUp ? 'text-[var(--color-status-success)]' : 'text-[var(--color-status-error)]'}`}>
          {trend}
        </div>
      )}

      {/* Benchmark / ROI / Capacity */}
      {benchmarkBadge && (
        <div className="text-sm text-muted-foreground mb-1">{benchmarkBadge}</div>
      )}
      {roiLine && (
        <div className="text-sm text-muted-foreground mb-1">{roiLine}</div>
      )}
      {capacityLine && (
        <div className="text-sm text-muted-foreground mb-1">{capacityLine}</div>
      )}

      {/* Context */}
      <p className="text-sm text-muted-foreground mb-3">{context}</p>

      {/* Sparkline */}
      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-auto">
          <Sparkline data={sparklineData} color={sparklineColor ?? '#94a3b8'} />
        </div>
      )}
    </div>
  );
}
