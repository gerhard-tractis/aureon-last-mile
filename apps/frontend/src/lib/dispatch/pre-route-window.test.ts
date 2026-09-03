import { describe, it, expect } from 'vitest';
import { resolvePreRouteWindow } from './pre-route-window';

describe('resolvePreRouteWindow', () => {
  it('returns null when neither window_start nor window_end is set', () => {
    expect(resolvePreRouteWindow(new URLSearchParams())).toBeNull();
  });

  it('returns both bounds when both params are set', () => {
    expect(resolvePreRouteWindow(new URLSearchParams('window_start=08:00&window_end=12:00'))).toEqual({
      start: '08:00',
      end: '12:00',
    });
  });

  it('defaults the missing bound to the start of day when only window_end is set', () => {
    expect(resolvePreRouteWindow(new URLSearchParams('window_end=12:00'))).toEqual({
      start: '00:00',
      end: '12:00',
    });
  });

  it('defaults the missing bound to the last instant of the day (with seconds, M13) when only window_start is set', () => {
    // '23:59' (no seconds) would exclude an order whose window closes in
    // that final minute — delivery_window_end carries seconds.
    expect(resolvePreRouteWindow(new URLSearchParams('window_start=17:00'))).toEqual({
      start: '17:00',
      end: '23:59:59',
    });
  });
});
