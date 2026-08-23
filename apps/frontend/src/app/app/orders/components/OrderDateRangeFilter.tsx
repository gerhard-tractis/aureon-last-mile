'use client';

/**
 * OrderDateRangeFilter — the RANGO DE FECHAS section of `OrderFilterRail`
 * (spec-65, mock `3a`). Split out of the rail so that file stays under the
 * 300-line limit; this carries its own local UI state (whether "Rango" was
 * explicitly chosen) that composed naturally as a standalone component.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface DateRange {
  dateFrom: string | null;
  dateTo: string | null;
}

interface OrderDateRangeFilterProps extends DateRange {
  /** Injected like `resolvePreset`'s `today` param — testable, no clock disagreement. */
  today: string;
  onChange: (range: DateRange) => void;
}

/**
 * UTC-safe: computed entirely via `Date.UTC` so the result never depends on
 * the runner's local timezone. Parsing `${isoDate}T00:00:00` as LOCAL time
 * and then reading it back with `toISOString()` (which is always UTC) rolls
 * the date by one for any positive UTC offset — this avoids that local
 * round trip entirely.
 */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const DATE_PRESETS = [
  { key: 'hoy', label: 'Hoy', days: 0 },
  { key: '7d', label: '7d', days: -6 },
  { key: '30d', label: '30d', days: -29 },
] as const;

export function OrderDateRangeFilter({ dateFrom, dateTo, today, onChange }: OrderDateRangeFilterProps) {
  // Explicit user choice, not just "matches no quick preset" — else clicking
  // "Rango" while already on "Hoy" would be a same-value no-op.
  const [rangeModeChosen, setRangeModeChosen] = useState(false);

  const activeDatePresetKey = DATE_PRESETS.find(
    (p) => dateFrom === addDays(today, p.days) && dateTo === today,
  )?.key;
  const isCustomRange = rangeModeChosen || !activeDatePresetKey;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-mono text-[10px] font-semibold tracking-wider text-text-muted">RANGO DE FECHAS</h3>
      <div className="flex gap-1">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setRangeModeChosen(false);
              onChange({ dateFrom: addDays(today, p.days), dateTo: today });
            }}
            className={cn(
              'flex-1 rounded-sm py-1.5 text-center text-[10.5px] font-semibold',
              !isCustomRange && activeDatePresetKey === p.key
                ? 'bg-surface-raised text-text'
                : 'font-medium text-text-secondary',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRangeModeChosen(true)}
          className={cn(
            'flex-1 rounded-sm py-1.5 text-center text-[10.5px] font-semibold',
            isCustomRange ? 'bg-surface-raised text-text' : 'font-medium text-text-secondary',
          )}
        >
          Rango
        </button>
      </div>
      {isCustomRange && (
        <div className="flex gap-1.5">
          <label className="sr-only" htmlFor="orders-filter-date-from">Desde</label>
          <input
            id="orders-filter-date-from"
            type="date"
            value={dateFrom ?? ''}
            onChange={(e) => onChange({ dateFrom: e.target.value || null, dateTo })}
            className="w-full rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] text-text"
          />
          <label className="sr-only" htmlFor="orders-filter-date-to">Hasta</label>
          <input
            id="orders-filter-date-to"
            type="date"
            value={dateTo ?? ''}
            onChange={(e) => onChange({ dateFrom, dateTo: e.target.value || null })}
            className="w-full rounded-sm border border-border bg-background px-1.5 py-1 text-[10.5px] text-text"
          />
        </div>
      )}
    </section>
  );
}
