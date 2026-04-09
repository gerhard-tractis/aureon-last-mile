'use client';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PERIOD_PRESET_LABELS } from '@/app/app/dashboard/lib/labels.es';
import type { DashboardPeriod, PeriodPreset } from '@/app/app/dashboard/lib/period';

interface PeriodSelectorProps {
  period: DashboardPeriod;
  onSetPreset: (p: PeriodPreset) => void;
  onSetCustomRange: (start: string, end: string) => void;
}

const PRESETS: PeriodPreset[] = ['month', 'quarter', 'ytd', 'custom'];

export function PeriodSelector({
  period,
  onSetPreset,
  onSetCustomRange,
}: PeriodSelectorProps) {
  const isMobile = useIsMobile();
  const isCustom = period.preset === 'custom';

  const customInputs = isCustom ? (
    <div className="flex items-center gap-2 mt-2">
      <label className="sr-only" htmlFor="period-from">Desde</label>
      <input
        id="period-from"
        aria-label="Desde"
        type="date"
        className="rounded border border-input bg-background px-2 py-1 text-sm"
        defaultValue={period.customFrom ?? ''}
        onChange={(e) => {
          if (period.customTo) onSetCustomRange(e.target.value, period.customTo);
        }}
      />
      <span className="text-muted-foreground text-sm">—</span>
      <label className="sr-only" htmlFor="period-to">Hasta</label>
      <input
        id="period-to"
        aria-label="Hasta"
        type="date"
        className="rounded border border-input bg-background px-2 py-1 text-sm"
        defaultValue={period.customTo ?? ''}
        onChange={(e) => {
          if (period.customFrom) onSetCustomRange(period.customFrom, e.target.value);
        }}
      />
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className="flex flex-col gap-2">
        <Select
          value={period.preset}
          onValueChange={(v) => onSetPreset(v as PeriodPreset)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_PRESET_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {customInputs}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {PRESETS.map((p) => {
          const isActive = period.preset === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onSetPreset(p)}
              className={
                isActive
                  ? 'rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm text-foreground'
                  : 'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {PERIOD_PRESET_LABELS[p]}
            </button>
          );
        })}
      </div>
      {customInputs}
    </div>
  );
}
