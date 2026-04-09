/**
 * Dashboard period parsing and derivation utilities.
 * Pure functions — no I/O, no side effects.
 */

export type PeriodPreset = 'month' | 'quarter' | 'ytd' | 'custom';

export interface DashboardPeriod {
  preset: PeriodPreset;
  year: number;
  /** For month: that month (1-12). For quarter: last month of quarter. For ytd: current month. For custom: end month. */
  month: number;
  start: Date;
  end: Date;
  customFrom?: string;
  customTo?: string;
}

const HISTORY_BOUNDARY_YEAR = 2020;

/** Last day of month as a Date at 23:59:59 */
function endOfMonth(year: number, month: number): Date {
  // month is 1-based; new Date(year, month, 0) gives last day of that month
  const last = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, last, 23, 59, 59);
}

/** First day of month as a Date at 00:00:00 */
function startOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1);
}

/** Quarter number (1-4) for a given 1-based month */
function quarterOf(month: number): number {
  return Math.ceil(month / 3);
}

/** First month (1-based) of a given quarter */
function quarterStart(quarter: number): number {
  return (quarter - 1) * 3 + 1;
}

/** Last month (1-based) of a given quarter */
function quarterEnd(quarter: number): number {
  return quarter * 3;
}

function currentMonthPeriod(): DashboardPeriod {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return {
    preset: 'month',
    year,
    month,
    start: startOfMonth(year, month),
    end: endOfMonth(year, month),
  };
}

/**
 * Parse a URLSearchParams into a DashboardPeriod.
 *
 * Supported formats for the `period` param:
 *   - `YYYY-MM`   → monthly
 *   - `YYYY-Q1..Q4` → quarterly
 *   - `ytd`       → year-to-date (uses current date)
 *   - `custom`    → requires `from=YYYY-MM-DD` and `to=YYYY-MM-DD`
 *
 * Falls back to current month on missing or unrecognised param.
 */
export function parsePeriodFromSearchParams(sp: URLSearchParams): DashboardPeriod {
  const raw = sp.get('period') ?? '';

  // --- monthly: YYYY-MM ---
  const monthMatch = raw.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return {
        preset: 'month',
        year,
        month,
        start: startOfMonth(year, month),
        end: endOfMonth(year, month),
      };
    }
  }

  // --- quarterly: YYYY-Q{1-4} ---
  const quarterMatch = raw.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const year = parseInt(quarterMatch[1], 10);
    const q = parseInt(quarterMatch[2], 10);
    const firstMonth = quarterStart(q);
    const lastMonth = quarterEnd(q);
    return {
      preset: 'quarter',
      year,
      month: lastMonth,
      start: startOfMonth(year, firstMonth),
      end: endOfMonth(year, lastMonth),
    };
  }

  // --- year-to-date ---
  if (raw === 'ytd') {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return {
      preset: 'ytd',
      year,
      month,
      start: startOfMonth(year, 1),
      end: endOfMonth(year, month),
    };
  }

  // --- custom: period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD ---
  if (raw === 'custom') {
    const fromStr = sp.get('from') ?? '';
    const toStr = sp.get('to') ?? '';
    const fromMatch = fromStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const toMatch = toStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (fromMatch && toMatch) {
      const fromYear = parseInt(fromMatch[1], 10);
      const fromMonth = parseInt(fromMatch[2], 10);
      const fromDay = parseInt(fromMatch[3], 10);
      const toYear = parseInt(toMatch[1], 10);
      const toMonth = parseInt(toMatch[2], 10);
      const toDay = parseInt(toMatch[3], 10);
      return {
        preset: 'custom',
        year: toYear,
        month: toMonth,
        start: new Date(fromYear, fromMonth - 1, fromDay),
        end: new Date(toYear, toMonth - 1, toDay, 23, 59, 59),
        customFrom: fromStr,
        customTo: toStr,
      };
    }
  }

  // --- fallback ---
  return currentMonthPeriod();
}

/** Step back one month (handles January → December year rollover). Always returns a 'month' preset period. */
export function getPriorMonthPeriod(period: DashboardPeriod): DashboardPeriod {
  let year = period.year;
  // For quarters/ytd, step back from the last month; for month/custom use period.month
  let month = period.month;

  // For quarter, step back from the first month of the quarter
  if (period.preset === 'quarter') {
    month = quarterStart(quarterOf(period.month));
  }

  if (month === 1) {
    year -= 1;
    month = 12;
  } else {
    month -= 1;
  }

  return {
    preset: 'month',
    year,
    month,
    start: startOfMonth(year, month),
    end: endOfMonth(year, month),
  };
}

/**
 * Return a period one year prior (same preset + same month offset).
 * Returns null if the prior year is before HISTORY_BOUNDARY_YEAR (2020).
 */
export function getPriorYearPeriod(period: DashboardPeriod): DashboardPeriod | null {
  const priorYear = period.year - 1;
  if (priorYear < HISTORY_BOUNDARY_YEAR) return null;

  if (period.preset === 'month') {
    return {
      preset: 'month',
      year: priorYear,
      month: period.month,
      start: startOfMonth(priorYear, period.month),
      end: endOfMonth(priorYear, period.month),
    };
  }

  if (period.preset === 'quarter') {
    const q = quarterOf(period.month);
    const firstMonth = quarterStart(q);
    const lastMonth = quarterEnd(q);
    return {
      preset: 'quarter',
      year: priorYear,
      month: lastMonth,
      start: startOfMonth(priorYear, firstMonth),
      end: endOfMonth(priorYear, lastMonth),
    };
  }

  if (period.preset === 'ytd') {
    return {
      preset: 'ytd',
      year: priorYear,
      month: period.month,
      start: startOfMonth(priorYear, 1),
      end: endOfMonth(priorYear, period.month),
    };
  }

  // custom — shift both dates by 1 year
  if (period.preset === 'custom' && period.customFrom && period.customTo) {
    const shiftDate = (iso: string, delta: number): string => {
      const [y, m, d] = iso.split('-');
      return `${parseInt(y, 10) + delta}-${m}-${d}`;
    };
    const newFrom = shiftDate(period.customFrom, -1);
    const newTo = shiftDate(period.customTo, -1);
    return parsePeriodFromSearchParams(
      new URLSearchParams(`period=custom&from=${newFrom}&to=${newTo}`),
    );
  }

  return null;
}

const SPANISH_MONTHS_LONG: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

const SPANISH_MONTHS_SHORT: Record<number, string> = {
  1: 'ene', 2: 'feb', 3: 'mar', 4: 'abr',
  5: 'may', 6: 'jun', 7: 'jul', 8: 'ago',
  9: 'sep', 10: 'oct', 11: 'nov', 12: 'dic',
};

/**
 * Human-readable Spanish label for a period.
 *
 * - month:   'Marzo 2026'
 * - quarter: 'Q1 2026'
 * - ytd:     '2026 YTD'
 * - custom (same year): '15 ene – 28 feb 2026'
 * - custom (cross-year): '20 dic 2025 – 10 ene 2026'
 */
export function getPeriodLabel(period: DashboardPeriod): string {
  if (period.preset === 'month') {
    return `${SPANISH_MONTHS_LONG[period.month]} ${period.year}`;
  }

  if (period.preset === 'quarter') {
    const q = quarterOf(period.month);
    return `Q${q} ${period.year}`;
  }

  if (period.preset === 'ytd') {
    return `${period.year} YTD`;
  }

  // custom
  if (period.preset === 'custom') {
    const fromYear = period.start.getFullYear();
    const fromMonth = period.start.getMonth() + 1;
    const fromDay = period.start.getDate();
    const toYear = period.end.getFullYear();
    const toMonth = period.end.getMonth() + 1;
    const toDay = period.end.getDate();

    const pad = (n: number) => String(n).padStart(2, '0');

    if (fromYear === toYear) {
      return `${pad(fromDay)} ${SPANISH_MONTHS_SHORT[fromMonth]} – ${pad(toDay)} ${SPANISH_MONTHS_SHORT[toMonth]} ${toYear}`;
    }
    return `${pad(fromDay)} ${SPANISH_MONTHS_SHORT[fromMonth]} ${fromYear} – ${pad(toDay)} ${SPANISH_MONTHS_SHORT[toMonth]} ${toYear}`;
  }

  return '';
}
