import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNowTick } from './useNowTick';

describe('useNowTick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current time at mount', () => {
    const { result } = renderHook(() => useNowTick());
    expect(result.current).toBe(new Date('2026-09-03T12:00:00Z').getTime());
  });

  it('advances on the default 1s interval — this is the entire point of a live freshness monitor (rule 9)', () => {
    const { result } = renderHook(() => useNowTick());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(new Date('2026-09-03T12:00:01Z').getTime());
  });

  it('accepts a custom interval', () => {
    const { result } = renderHook(() => useNowTick(5000));
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current).toBe(new Date('2026-09-03T12:00:00Z').getTime());
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(new Date('2026-09-03T12:00:05Z').getTime());
  });

  it('clears its interval on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = renderHook(() => useNowTick());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
