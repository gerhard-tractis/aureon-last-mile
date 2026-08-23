import { describe, it, expect } from 'vitest';
import { formatDurationSince } from './duration';

describe('formatDurationSince', () => {
  it('formats a multi-hour span as "Xh Ym"', () => {
    const since = '2026-03-16T09:00:00Z';
    const now = new Date('2026-03-16T12:12:00Z');
    expect(formatDurationSince(since, now)).toBe('3h 12m');
  });

  it('formats a sub-hour span as "Ym" only', () => {
    const since = '2026-03-16T09:00:00Z';
    const now = new Date('2026-03-16T09:24:00Z');
    expect(formatDurationSince(since, now)).toBe('24m');
  });

  it('never goes negative when "since" is after "now"', () => {
    const since = '2026-03-16T12:00:00Z';
    const now = new Date('2026-03-16T09:00:00Z');
    expect(formatDurationSince(since, now)).toBe('0m');
  });
});
