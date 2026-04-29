import { describe, it, expect } from 'vitest';
import { formatRelativeDeliveryDate } from './relative-date';

describe('formatRelativeDeliveryDate', () => {
  it('returns "hoy" when delivery date matches today', () => {
    expect(formatRelativeDeliveryDate('2026-04-29', '2026-04-29')).toEqual({
      label: 'hoy',
      tone: 'urgent',
    });
  });

  it('returns "mañana" when delivery date is one day after today', () => {
    expect(formatRelativeDeliveryDate('2026-04-30', '2026-04-29')).toEqual({
      label: 'mañana',
      tone: 'soon',
    });
  });

  it('returns "ayer" when delivery date is one day before today (overdue)', () => {
    expect(formatRelativeDeliveryDate('2026-04-28', '2026-04-29')).toEqual({
      label: 'ayer',
      tone: 'overdue',
    });
  });

  it('formats dates further in the future as "DD MMM" in Spanish', () => {
    expect(formatRelativeDeliveryDate('2026-05-03', '2026-04-29').label).toBe('03 may');
    expect(formatRelativeDeliveryDate('2026-12-25', '2026-04-29').label).toBe('25 dic');
  });

  it('formats older overdue dates as "DD MMM" with overdue tone', () => {
    const result = formatRelativeDeliveryDate('2026-04-20', '2026-04-29');
    expect(result.label).toBe('20 abr');
    expect(result.tone).toBe('overdue');
  });

  it('uses neutral tone for dates >= 2 days in the future', () => {
    expect(formatRelativeDeliveryDate('2026-05-15', '2026-04-29').tone).toBe('neutral');
  });

  it('handles month boundary correctly', () => {
    expect(formatRelativeDeliveryDate('2026-05-01', '2026-04-30')).toEqual({
      label: 'mañana',
      tone: 'soon',
    });
  });
});
