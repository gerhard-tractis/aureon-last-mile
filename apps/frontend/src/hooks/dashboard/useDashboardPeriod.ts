'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';
import {
  parsePeriodFromSearchParams,
  getPriorMonthPeriod,
  getPriorYearPeriod,
  type DashboardPeriod,
} from '@/app/app/dashboard/lib/period';

export function useDashboardPeriod() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const period = parsePeriodFromSearchParams(searchParams);
  const priorMonthPeriod = getPriorMonthPeriod(period);
  const priorYearPeriod = getPriorYearPeriod(period);

  const setPreset = useCallback(
    (preset: DashboardPeriod['preset']) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('period', preset);
      if (preset !== 'custom') {
        params.delete('from');
        params.delete('to');
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const setCustomRange = useCallback(
    (start: string, end: string) => {
      if (end <= start) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('period', 'custom');
      params.set('from', start);
      params.set('to', end);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return { period, priorMonthPeriod, priorYearPeriod, setPreset, setCustomRange };
}
