import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDatePreset } from './useDatePreset';

describe('useDatePreset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves "today"', () => {
    const { result } = renderHook(() => useDatePreset('today'));
    expect(result.current.startDate).toBe('2026-03-15');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "yesterday"', () => {
    const { result } = renderHook(() => useDatePreset('yesterday'));
    expect(result.current.startDate).toBe('2026-03-14');
    expect(result.current.endDate).toBe('2026-03-14');
  });

  it('resolves "last_7_days" as 7-day rolling window', () => {
    const { result } = renderHook(() => useDatePreset('last_7_days'));
    expect(result.current.startDate).toBe('2026-03-09');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "this_week" starting Monday', () => {
    const { result } = renderHook(() => useDatePreset('this_week'));
    expect(result.current.startDate).toBe('2026-03-09');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "this_month"', () => {
    const { result } = renderHook(() => useDatePreset('this_month'));
    expect(result.current.startDate).toBe('2026-03-01');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "this_year"', () => {
    const { result } = renderHook(() => useDatePreset('this_year'));
    expect(result.current.startDate).toBe('2026-01-01');
    expect(result.current.endDate).toBe('2026-03-15');
  });

  it('resolves "custom" with provided params', () => {
    const { result } = renderHook(() =>
      useDatePreset('custom', '2026-02-01', '2026-02-28')
    );
    expect(result.current.startDate).toBe('2026-02-01');
    expect(result.current.endDate).toBe('2026-02-28');
  });

  it('computes previous period correctly', () => {
    // March 1-15 = 15 days → prev = Feb 14-28
    const { result } = renderHook(() => useDatePreset('this_month'));
    expect(result.current.prevStartDate).toBe('2026-02-14');
    expect(result.current.prevEndDate).toBe('2026-02-28');
  });
});
