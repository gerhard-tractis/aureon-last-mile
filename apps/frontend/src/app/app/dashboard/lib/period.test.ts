import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parsePeriodFromSearchParams,
  getPriorMonthPeriod,
  getPriorYearPeriod,
  getPeriodLabel,
} from './period';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sp(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

// ---------------------------------------------------------------------------
// parsePeriodFromSearchParams
// ---------------------------------------------------------------------------
describe('parsePeriodFromSearchParams', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses a month param', () => {
    const result = parsePeriodFromSearchParams(sp('period=2026-03'));
    expect(result.preset).toBe('month');
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.start).toEqual(new Date(2026, 2, 1));       // Mar 1
    expect(result.end).toEqual(new Date(2026, 2, 31, 23, 59, 59));
  });

  it('parses Q1', () => {
    const result = parsePeriodFromSearchParams(sp('period=2026-Q1'));
    expect(result.preset).toBe('quarter');
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
    expect(result.start).toEqual(new Date(2026, 0, 1));       // Jan 1
    expect(result.end).toEqual(new Date(2026, 2, 31, 23, 59, 59));
  });

  it('parses Q2', () => {
    const result = parsePeriodFromSearchParams(sp('period=2026-Q2'));
    expect(result.preset).toBe('quarter');
    expect(result.month).toBe(6);
    expect(result.start).toEqual(new Date(2026, 3, 1));       // Apr 1
    expect(result.end).toEqual(new Date(2026, 5, 30, 23, 59, 59));
  });

  it('parses Q3', () => {
    const result = parsePeriodFromSearchParams(sp('period=2026-Q3'));
    expect(result.preset).toBe('quarter');
    expect(result.month).toBe(9);
    expect(result.start).toEqual(new Date(2026, 6, 1));       // Jul 1
    expect(result.end).toEqual(new Date(2026, 8, 30, 23, 59, 59));
  });

  it('parses Q4', () => {
    const result = parsePeriodFromSearchParams(sp('period=2026-Q4'));
    expect(result.preset).toBe('quarter');
    expect(result.month).toBe(12);
    expect(result.start).toEqual(new Date(2026, 9, 1));       // Oct 1
    expect(result.end).toEqual(new Date(2026, 11, 31, 23, 59, 59));
  });

  it('parses ytd — uses current year and current month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 9)); // April 9 2026
    const result = parsePeriodFromSearchParams(sp('period=ytd'));
    expect(result.preset).toBe('ytd');
    expect(result.year).toBe(2026);
    expect(result.month).toBe(4);
    expect(result.start).toEqual(new Date(2026, 0, 1));       // Jan 1
    expect(result.end).toEqual(new Date(2026, 3, 30, 23, 59, 59)); // Apr 30
    vi.useRealTimers();
  });

  it('parses custom with from/to', () => {
    const result = parsePeriodFromSearchParams(
      sp('period=custom&from=2026-01-15&to=2026-02-28'),
    );
    expect(result.preset).toBe('custom');
    expect(result.start).toEqual(new Date(2026, 0, 15));
    expect(result.end).toEqual(new Date(2026, 1, 28, 23, 59, 59));
    // month should be end month
    expect(result.month).toBe(2);
    expect(result.year).toBe(2026);
  });

  it('falls back to current month on no param', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 9)); // April 9 2026
    const result = parsePeriodFromSearchParams(sp(''));
    expect(result.preset).toBe('month');
    expect(result.year).toBe(2026);
    expect(result.month).toBe(4);
    expect(result.start).toEqual(new Date(2026, 3, 1));
    expect(result.end).toEqual(new Date(2026, 3, 30, 23, 59, 59));
    vi.useRealTimers();
  });

  it('falls back to current month on invalid param', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 9));
    const result = parsePeriodFromSearchParams(sp('period=GARBAGE'));
    expect(result.preset).toBe('month');
    expect(result.year).toBe(2026);
    vi.useRealTimers();
  });

  it('handles February (28 days, non-leap)', () => {
    const result = parsePeriodFromSearchParams(sp('period=2025-02'));
    expect(result.end).toEqual(new Date(2025, 1, 28, 23, 59, 59));
  });

  it('handles February in leap year (29 days)', () => {
    const result = parsePeriodFromSearchParams(sp('period=2024-02'));
    expect(result.end).toEqual(new Date(2024, 1, 29, 23, 59, 59));
  });
});

// ---------------------------------------------------------------------------
// getPriorMonthPeriod
// ---------------------------------------------------------------------------
describe('getPriorMonthPeriod', () => {
  it('steps back one month in mid-year', () => {
    const base = parsePeriodFromSearchParams(sp('period=2026-03'));
    const prior = getPriorMonthPeriod(base);
    expect(prior.year).toBe(2026);
    expect(prior.month).toBe(2);
    expect(prior.preset).toBe('month');
    expect(prior.start).toEqual(new Date(2026, 1, 1));
    expect(prior.end).toEqual(new Date(2026, 1, 28, 23, 59, 59));
  });

  it('rolls over year when month is January', () => {
    const base = parsePeriodFromSearchParams(sp('period=2026-01'));
    const prior = getPriorMonthPeriod(base);
    expect(prior.year).toBe(2025);
    expect(prior.month).toBe(12);
    expect(prior.start).toEqual(new Date(2025, 11, 1));
    expect(prior.end).toEqual(new Date(2025, 11, 31, 23, 59, 59));
  });
});

// ---------------------------------------------------------------------------
// getPriorYearPeriod
// ---------------------------------------------------------------------------
describe('getPriorYearPeriod', () => {
  it('returns same month in prior year', () => {
    const base = parsePeriodFromSearchParams(sp('period=2026-03'));
    const prior = getPriorYearPeriod(base);
    expect(prior).not.toBeNull();
    expect(prior!.year).toBe(2025);
    expect(prior!.month).toBe(3);
  });

  it('returns null when prior year is before 2020', () => {
    const base = parsePeriodFromSearchParams(sp('period=2020-06'));
    const prior = getPriorYearPeriod(base);
    expect(prior).toBeNull();
  });

  it('returns period for exactly year 2021 (prior = 2020, allowed)', () => {
    const base = parsePeriodFromSearchParams(sp('period=2021-06'));
    const prior = getPriorYearPeriod(base);
    expect(prior).not.toBeNull();
    expect(prior!.year).toBe(2020);
  });
});

// ---------------------------------------------------------------------------
// getPeriodLabel
// ---------------------------------------------------------------------------
describe('getPeriodLabel', () => {
  it('formats a month label in Spanish', () => {
    const p = parsePeriodFromSearchParams(sp('period=2026-03'));
    expect(getPeriodLabel(p)).toBe('Marzo 2026');
  });

  it('formats January correctly', () => {
    const p = parsePeriodFromSearchParams(sp('period=2026-01'));
    expect(getPeriodLabel(p)).toBe('Enero 2026');
  });

  it('formats a Q1 label', () => {
    const p = parsePeriodFromSearchParams(sp('period=2026-Q1'));
    expect(getPeriodLabel(p)).toBe('Q1 2026');
  });

  it('formats Q4 label', () => {
    const p = parsePeriodFromSearchParams(sp('period=2026-Q4'));
    expect(getPeriodLabel(p)).toBe('Q4 2026');
  });

  it('formats ytd label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 9));
    const p = parsePeriodFromSearchParams(sp('period=ytd'));
    expect(getPeriodLabel(p)).toBe('2026 YTD');
    vi.useRealTimers();
  });

  it('formats custom label with abbreviated Spanish months same year', () => {
    const p = parsePeriodFromSearchParams(
      sp('period=custom&from=2026-01-15&to=2026-02-28'),
    );
    // '15 ene – 28 feb 2026'
    expect(getPeriodLabel(p)).toBe('15 ene – 28 feb 2026');
  });

  it('formats custom label cross-year', () => {
    const p = parsePeriodFromSearchParams(
      sp('period=custom&from=2025-12-20&to=2026-01-10'),
    );
    // '20 dic 2025 – 10 ene 2026'
    expect(getPeriodLabel(p)).toBe('20 dic 2025 – 10 ene 2026');
  });
});
