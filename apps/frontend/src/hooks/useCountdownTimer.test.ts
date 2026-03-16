import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdownTimer } from './useCountdownTimer';

describe('useCountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when deadlineISO is null', () => {
    const { result } = renderHook(() => useCountdownTimer(null));
    expect(result.current).toBeNull();
  });

  it('returns minutes remaining for a future deadline', () => {
    const future = new Date(Date.now() + 90 * 60_000).toISOString(); // 90 minutes from now
    const { result } = renderHook(() => useCountdownTimer(future));
    // Should be approximately 90 (Math.floor)
    expect(result.current).toBe(90);
  });

  it('returns negative minutes for a past deadline', () => {
    const past = new Date(Date.now() - 30 * 60_000).toISOString(); // 30 minutes ago
    const { result } = renderHook(() => useCountdownTimer(past));
    expect(result.current).toBe(-30);
  });

  it('updates every 60 seconds', () => {
    const future = new Date(Date.now() + 120 * 60_000).toISOString(); // 120 minutes from now
    const { result } = renderHook(() => useCountdownTimer(future));

    expect(result.current).toBe(120);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // After 60 seconds, should be 119
    expect(result.current).toBe(119);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // After another 60 seconds, should be 118
    expect(result.current).toBe(118);
  });

  it('returns 0 when deadline is exactly now', () => {
    const now = new Date(Date.now()).toISOString();
    const { result } = renderHook(() => useCountdownTimer(now));
    expect(result.current).toBe(0);
  });

  it('recalculates when deadline changes', () => {
    const future60 = new Date(Date.now() + 60 * 60_000).toISOString();
    const future120 = new Date(Date.now() + 120 * 60_000).toISOString();

    const { result, rerender } = renderHook(
      ({ deadline }) => useCountdownTimer(deadline),
      { initialProps: { deadline: future60 } },
    );

    expect(result.current).toBe(60);

    rerender({ deadline: future120 });
    expect(result.current).toBe(120);
  });
});
