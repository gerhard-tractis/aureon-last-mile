import { describe, it, expect } from 'vitest';
import { effectiveWindow, classifyRisk, AT_RISK_HOURS } from './sla';

const baseOrder = {
  id: 'o1',
  delivery_date: '2026-04-06',
  delivery_window_start: '14:00',
  delivery_window_end: '18:00',
  rescheduled_delivery_date: null as string | null,
  rescheduled_window_start: null as string | null,
  rescheduled_window_end: null as string | null,
  delivered_at: null as string | null,
};

describe('effectiveWindow', () => {
  it('uses original window when no reschedule fields', () => {
    const w = effectiveWindow(baseOrder);
    expect(w.startISO).toBe('2026-04-06T14:00:00');
    expect(w.endISO).toBe('2026-04-06T18:00:00');
  });

  it('uses rescheduled window when all reschedule fields present', () => {
    const w = effectiveWindow({
      ...baseOrder,
      rescheduled_delivery_date: '2026-04-07',
      rescheduled_window_start: '09:00',
      rescheduled_window_end: '13:00',
    });
    expect(w.startISO).toBe('2026-04-07T09:00:00');
    expect(w.endISO).toBe('2026-04-07T13:00:00');
  });
});

describe('classifyRisk', () => {
  it('classifies LATE when now > effective window end', () => {
    const r = classifyRisk(baseOrder, new Date('2026-04-06T19:00:00'));
    expect(r.status).toBe('late');
  });

  it('classifies AT_RISK at exactly 6h boundary', () => {
    // window end = 18:00, now = 12:00 → exactly 6h remaining → at_risk
    const r = classifyRisk(baseOrder, new Date('2026-04-06T12:00:00'));
    expect(r.status).toBe('at_risk');
  });

  it('classifies OK when more than 6h remain', () => {
    // now = 11:59 → 6h 1min remaining → ok
    const r = classifyRisk(baseOrder, new Date('2026-04-06T11:59:00'));
    expect(r.status).toBe('ok');
  });

  it('delivered orders return none regardless of time', () => {
    const r = classifyRisk(
      { ...baseOrder, delivered_at: '2026-04-06T15:00:00' },
      new Date('2026-04-06T19:00:00'),
    );
    expect(r.status).toBe('none');
  });

  it('AT_RISK_HOURS constant is 6', () => {
    expect(AT_RISK_HOURS).toBe(6);
  });

  it('label for late order contains "ATRASADO"', () => {
    const r = classifyRisk(baseOrder, new Date('2026-04-06T19:00:00'));
    expect(r.label).toContain('ATRASADO');
  });

  it('label for at-risk order contains "restantes"', () => {
    const r = classifyRisk(baseOrder, new Date('2026-04-06T12:00:00'));
    expect(r.label).toContain('restantes');
  });
});
