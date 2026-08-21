import { describe, it, expect } from 'vitest';
import { receptionInitials, waitLabel, timeLabel, minutesSince } from './reception-mobile-helpers';

describe('receptionInitials', () => {
  it('takes the initial of the first and last name', () => {
    expect(receptionInitials('Paulina Valdés')).toBe('PV');
  });
  it('gives one letter for a single name', () => {
    expect(receptionInitials('Paulina')).toBe('P');
  });
  it('does not fabricate initials when there is no name', () => {
    expect(receptionInitials(null)).toBe('—');
  });
});

describe('waitLabel', () => {
  it('speaks in minutes under an hour', () => {
    expect(waitLabel(41)).toBe('41 min');
  });
  it('speaks in hours and minutes over an hour', () => {
    expect(waitLabel(95)).toBe('1 h 35 min');
  });
  it('has no wait to show without an arrival time', () => {
    expect(waitLabel(null)).toBeNull();
  });
});

describe('timeLabel', () => {
  it('returns null for an invalid date instead of "Invalid Date"', () => {
    expect(timeLabel('not-a-date')).toBeNull();
  });
});

describe('minutesSince', () => {
  const now = new Date('2026-08-20T13:00:00Z');
  it('counts the minutes since arrival', () => {
    expect(minutesSince('2026-08-20T12:19:00Z', now)).toBe(41);
  });
  it('has no wait without an arrival', () => {
    expect(minutesSince(null, now)).toBeNull();
  });
  it('never returns a negative wait for clock-skewed timestamps', () => {
    expect(minutesSince('2026-08-20T13:05:00Z', now)).toBe(0);
  });
});
