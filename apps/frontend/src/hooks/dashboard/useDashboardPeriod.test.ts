import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
}));

import { useSearchParams, useRouter } from 'next/navigation';
import { useDashboardPeriod } from './useDashboardPeriod';

const mockReplace = vi.fn();

function makeSearchParams(init: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(init);
}

describe('useDashboardPeriod', () => {
  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as ReturnType<typeof useRouter>);
    mockReplace.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns current month period when no URL params (mocked date 2026-04-09)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T12:00:00'));

    vi.mocked(useSearchParams).mockReturnValue(makeSearchParams() as ReturnType<typeof useSearchParams>);

    const { result } = renderHook(() => useDashboardPeriod());

    expect(result.current.period.preset).toBe('month');
    expect(result.current.period.year).toBe(2026);
    expect(result.current.period.month).toBe(4);
  });

  it('returns March 2026 period when ?period=2026-03', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      makeSearchParams({ period: '2026-03' }) as ReturnType<typeof useSearchParams>,
    );

    const { result } = renderHook(() => useDashboardPeriod());

    expect(result.current.period.preset).toBe('month');
    expect(result.current.period.year).toBe(2026);
    expect(result.current.period.month).toBe(3);
  });

  it('returns Q1 2026 when ?period=2026-Q1', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      makeSearchParams({ period: '2026-Q1' }) as ReturnType<typeof useSearchParams>,
    );

    const { result } = renderHook(() => useDashboardPeriod());

    expect(result.current.period.preset).toBe('quarter');
    expect(result.current.period.year).toBe(2026);
    // Q1 ends in March (month 3)
    expect(result.current.period.month).toBe(3);
  });

  it('setPreset calls router.replace with scroll: false', () => {
    vi.mocked(useSearchParams).mockReturnValue(makeSearchParams() as ReturnType<typeof useSearchParams>);

    const { result } = renderHook(() => useDashboardPeriod());

    act(() => {
      result.current.setPreset('quarter');
    });

    expect(mockReplace).toHaveBeenCalledOnce();
    const [url, opts] = mockReplace.mock.calls[0];
    expect(url).toContain('period=quarter');
    expect(opts).toEqual({ scroll: false });
  });

  it('setCustomRange updates URL with from/to params', () => {
    vi.mocked(useSearchParams).mockReturnValue(makeSearchParams() as ReturnType<typeof useSearchParams>);

    const { result } = renderHook(() => useDashboardPeriod());

    act(() => {
      result.current.setCustomRange('2026-01-01', '2026-03-31');
    });

    expect(mockReplace).toHaveBeenCalledOnce();
    const [url, opts] = mockReplace.mock.calls[0];
    expect(url).toContain('period=custom');
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-03-31');
    expect(opts).toEqual({ scroll: false });
  });

  it('setCustomRange does NOT call replace when end <= start', () => {
    vi.mocked(useSearchParams).mockReturnValue(makeSearchParams() as ReturnType<typeof useSearchParams>);

    const { result } = renderHook(() => useDashboardPeriod());

    act(() => {
      result.current.setCustomRange('2026-03-31', '2026-01-01');
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('returns priorMonthPeriod derived from period', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      makeSearchParams({ period: '2026-03' }) as ReturnType<typeof useSearchParams>,
    );

    const { result } = renderHook(() => useDashboardPeriod());

    expect(result.current.priorMonthPeriod.preset).toBe('month');
    expect(result.current.priorMonthPeriod.year).toBe(2026);
    expect(result.current.priorMonthPeriod.month).toBe(2);
  });

  it('returns priorYearPeriod as null when year <= 2020 (year 2021 is fine, 2020 is boundary)', () => {
    // Prior year of 2021 = 2020 → still >= HISTORY_BOUNDARY_YEAR so not null
    // Prior year of 2020 = 2019 → null
    vi.mocked(useSearchParams).mockReturnValue(
      makeSearchParams({ period: '2020-04' }) as ReturnType<typeof useSearchParams>,
    );

    const { result } = renderHook(() => useDashboardPeriod());

    // 2020 - 1 = 2019, which is < 2020 HISTORY_BOUNDARY_YEAR → null
    expect(result.current.priorYearPeriod).toBeNull();
  });

  it('returns priorYearPeriod when year is 2026', () => {
    vi.mocked(useSearchParams).mockReturnValue(
      makeSearchParams({ period: '2026-04' }) as ReturnType<typeof useSearchParams>,
    );

    const { result } = renderHook(() => useDashboardPeriod());

    expect(result.current.priorYearPeriod).not.toBeNull();
    expect(result.current.priorYearPeriod?.year).toBe(2025);
    expect(result.current.priorYearPeriod?.month).toBe(4);
  });
});
