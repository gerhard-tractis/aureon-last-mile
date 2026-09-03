import { describe, it, expect, vi, afterEach } from 'vitest';
import { daysAgoISO } from './days-ago';

describe('daysAgoISO', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the ISO date n days before the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T10:00:00Z'));
    expect(daysAgoISO(7)).toBe('2026-04-17');
  });

  // The bug this replaces: a value computed once at module load and reused
  // for the life of a PWA tab left open across midnight. Calling the helper
  // again after the clock crosses midnight must shift the answer — proving
  // there is no frozen module-load snapshot to go stale.
  it('resolves independently on each call — no staleness across a simulated midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T23:59:00Z'));
    expect(daysAgoISO(7)).toBe('2026-04-17');

    vi.setSystemTime(new Date('2026-04-25T00:01:00Z'));
    expect(daysAgoISO(7)).toBe('2026-04-18');
  });
});
