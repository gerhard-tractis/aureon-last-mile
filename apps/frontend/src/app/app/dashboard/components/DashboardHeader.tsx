'use client';
import { getPeriodLabel, type DashboardPeriod, type PeriodPreset } from '@/app/app/dashboard/lib/period';
import { PeriodSelector } from './PeriodSelector';

interface DashboardHeaderProps {
  period: DashboardPeriod;
  onSetPreset: (p: PeriodPreset) => void;
  onSetCustomRange: (start: string, end: string) => void;
}

export function DashboardHeader({
  period,
  onSetPreset,
  onSetCustomRange,
}: DashboardHeaderProps) {
  const periodLabel = getPeriodLabel(period);

  return (
    <header className="flex flex-col gap-3 py-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold">Dashboard ejecutivo</h1>
          <p className="text-sm text-muted-foreground">
            {periodLabel}
          </p>
        </div>
        <PeriodSelector
          period={period}
          onSetPreset={onSetPreset}
          onSetCustomRange={onSetCustomRange}
        />
      </div>
    </header>
  );
}
