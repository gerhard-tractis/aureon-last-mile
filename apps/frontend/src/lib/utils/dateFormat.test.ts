import { describe, it, expect } from 'vitest';
import { todayISOInTimezone, formatRouteHeaderDate } from './dateFormat';

describe('todayISOInTimezone', () => {
  // spec-68 Fase 2 fixed this exact bug in DistributionMobileView's local
  // todayISOFrom (finding 3); Fase 3 review found it reintroduced in two
  // more places (PendingMobileOrderGroup, usePendingSectorization) via
  // `new Date().toISOString().split('T')[0]`. This is now the one shared
  // implementation both call.
  it('reads the Santiago civil date, not the UTC date', () => {
    // 2026-08-25T01:00:00Z is already "tomorrow" in UTC but still the
    // evening of 2026-08-24 in America/Santiago (UTC-3/-4).
    expect(todayISOInTimezone(new Date('2026-08-25T01:00:00.000Z'))).toBe('2026-08-24');
  });

  it('matches the UTC date away from the day boundary', () => {
    expect(todayISOInTimezone(new Date('2026-08-24T15:00:00.000Z'))).toBe('2026-08-24');
  });

  it('defaults to the current instant when no argument is given', () => {
    expect(todayISOInTimezone()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatRouteHeaderDate', () => {
  // spec-70 QA finding #1: a route dated 2026-08-26 (a Wednesday) rendered
  // "jue, 27 ago" (today, via `new Date()`) on live QA — the header answered
  // for the browser's clock, not for `routes.route_date`.
  it('renders the route\'s own date, not today', () => {
    expect(formatRouteHeaderDate('2026-08-26')).toBe('mié, 26 ago');
  });

  // The regression this guards against: `new Date('2026-08-26')` parses as
  // UTC midnight, and formatting that instant in a UTC-negative zone (Chile,
  // most viewers) would show 2026-08-25 instead — the same class of bug the
  // date itself was meant to fix, one day later.
  it('does not roll back a day when formatted in a UTC-negative zone', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'America/Santiago';
    try {
      expect(formatRouteHeaderDate('2026-08-26')).toBe('mié, 26 ago');
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});
