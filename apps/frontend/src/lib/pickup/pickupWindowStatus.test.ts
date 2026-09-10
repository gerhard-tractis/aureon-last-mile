import { describe, it, expect } from 'vitest';
import { getPickupWindowStatus, formatPickupWindowLabel } from './pickupWindowStatus';

describe('getPickupWindowStatus', () => {
  it('is "sin_datos" when the pickup point has no window and no cutoff configured', () => {
    // spec-83 fase 2: today NO pickup point has this configured. "I don't
    // know" must not be painted as "plenty of time" (green).
    const now = new Date('2026-09-10T14:00:00');
    const status = getPickupWindowStatus({ pickupWindowEnd: null, pickupCutoffTime: null }, now);
    expect(status).toBe('sin_datos');
  });

  it('is "sin_datos" when only the window start is set but not the end', () => {
    // A half-filled window cannot anchor a threshold either.
    const now = new Date('2026-09-10T14:00:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: null, pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('sin_datos');
  });

  it('is "dentro_de_plazo" well before the window end', () => {
    const now = new Date('2026-09-10T09:30:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '13:00', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('dentro_de_plazo');
  });

  it('is "cerca_del_cierre" within the closing threshold', () => {
    const now = new Date('2026-09-10T12:30:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '13:00', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('cerca_del_cierre');
  });

  it('is "cerca_del_cierre" at exactly the closing threshold (boundary is inclusive)', () => {
    const now = new Date('2026-09-10T12:00:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '13:00', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('cerca_del_cierre');
  });

  it('is "dentro_de_plazo" one minute above the closing threshold', () => {
    const now = new Date('2026-09-10T11:58:59');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '13:00', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('dentro_de_plazo');
  });

  it('is "cerca_del_cierre" once the close time has already passed', () => {
    const now = new Date('2026-09-10T13:05:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '13:00', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('cerca_del_cierre');
  });

  it('prefers pickup_cutoff_time over the window end when both are present', () => {
    // The cutoff is the operator-wide "no more pickups after this" line —
    // stricter than a single point's own window, so it wins the comparison.
    const now = new Date('2026-09-10T13:05:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '20:00', pickupCutoffTime: '13:00' },
      now,
    );
    expect(status).toBe('cerca_del_cierre');
  });

  it('is "sin_datos" on an unparsable time string rather than crashing or guessing', () => {
    const now = new Date('2026-09-10T09:30:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: 'not-a-time', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('sin_datos');
  });

  it('is "sin_datos" on an out-of-range hour rather than accepting garbage input', () => {
    const now = new Date('2026-09-10T09:30:00');
    const status = getPickupWindowStatus(
      { pickupWindowStart: '09:00', pickupWindowEnd: '25:00', pickupCutoffTime: null },
      now,
    );
    expect(status).toBe('sin_datos');
  });
});

describe('formatPickupWindowLabel', () => {
  it('shows the full window when start and end are both set', () => {
    expect(
      formatPickupWindowLabel({ pickupWindowStart: '09:00', pickupWindowEnd: '13:00', pickupCutoffTime: null }),
    ).toBe('09:00–13:00');
  });

  it('shows the cutoff alone when there is no window', () => {
    expect(
      formatPickupWindowLabel({ pickupWindowStart: null, pickupWindowEnd: null, pickupCutoffTime: '18:00' }),
    ).toBe('Cierra 18:00');
  });

  it('shows "Sin datos" for a half-filled window (start with no end), not a broken range', () => {
    expect(
      formatPickupWindowLabel({ pickupWindowStart: '09:00', pickupWindowEnd: null, pickupCutoffTime: null }),
    ).toBe('Sin datos');
  });

  it('shows "Sin datos" when nothing is configured', () => {
    expect(
      formatPickupWindowLabel({ pickupWindowStart: null, pickupWindowEnd: null, pickupCutoffTime: null }),
    ).toBe('Sin datos');
  });
});
