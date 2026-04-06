import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDashboardDates } from './useDashboardDates';

describe('getDashboardDates', () => {
  afterEach(() => vi.useRealTimers());

  it('returns YYYY-MM-DD formatted date strings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    const { startDate, endDate, prevStartDate, prevEndDate } = getDashboardDates();

    expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prevStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prevEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('endDate is today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    const { endDate } = getDashboardDates();
    expect(endDate).toBe('2026-01-15');
  });

  it('startDate is 6 days before today (7-day window inclusive)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    const { startDate } = getDashboardDates();
    expect(startDate).toBe('2026-01-09');
  });

  it('prevEndDate is 7 days before today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    const { prevEndDate } = getDashboardDates();
    expect(prevEndDate).toBe('2026-01-08');
  });

  it('prevStartDate is 13 days before today (previous 7-day window)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

    const { prevStartDate } = getDashboardDates();
    expect(prevStartDate).toBe('2026-01-02');
  });

  it('current period and previous period do not overlap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-06T00:00:00Z'));

    const { startDate, prevEndDate } = getDashboardDates();

    // prevEndDate must be before startDate (no overlap)
    expect(new Date(prevEndDate).getTime()).toBeLessThan(new Date(startDate).getTime());
  });
});
