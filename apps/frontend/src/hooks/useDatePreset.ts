import { useMemo } from 'react';
import { format, subDays, startOfWeek, startOfMonth, startOfYear, differenceInCalendarDays, parse } from 'date-fns';

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'custom';

export interface DateRange {
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
}

const DATE_FMT = 'yyyy-MM-dd';

export function useDatePreset(
  preset: DatePreset,
  customStart?: string,
  customEnd?: string
): DateRange {
  return useMemo(() => {
    const today = new Date();
    let startDate: string;
    let endDate: string;

    switch (preset) {
      case 'today':
        startDate = format(today, DATE_FMT);
        endDate = startDate;
        break;
      case 'yesterday': {
        const y = subDays(today, 1);
        startDate = format(y, DATE_FMT);
        endDate = startDate;
        break;
      }
      case 'this_week':
        startDate = format(startOfWeek(today, { weekStartsOn: 1 }), DATE_FMT);
        endDate = format(today, DATE_FMT);
        break;
      case 'this_month':
        startDate = format(startOfMonth(today), DATE_FMT);
        endDate = format(today, DATE_FMT);
        break;
      case 'this_year':
        startDate = format(startOfYear(today), DATE_FMT);
        endDate = format(today, DATE_FMT);
        break;
      case 'custom':
        startDate = customStart ?? format(today, DATE_FMT);
        endDate = customEnd ?? format(today, DATE_FMT);
        break;
    }

    // Previous period: same number of days, ending day before startDate
    const start = parse(startDate, DATE_FMT, today);
    const end = parse(endDate, DATE_FMT, today);
    const days = differenceInCalendarDays(end, start) + 1;
    const prevEnd = subDays(start, 1);
    const prevStart = subDays(prevEnd, days - 1);

    return {
      startDate,
      endDate,
      prevStartDate: format(prevStart, DATE_FMT),
      prevEndDate: format(prevEnd, DATE_FMT),
    };
  }, [preset, customStart, customEnd]);
}
