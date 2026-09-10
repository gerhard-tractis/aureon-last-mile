import { describe, it, expect } from 'vitest';
import { pickupPointSchema } from './pickupPointFormSchema';

/**
 * Review round 2 — no layer validated the shape of a time string before
 * this. A real `<input type="time">` refuses garbage at the DOM level (so
 * this could not be reproduced by typing into the rendered form — jsdom
 * matches real browsers here), but the schema itself is what the resolver
 * runs, and it is also what a non-picker client (a future bulk-edit script,
 * a direct call bypassing the UI) would go through. This is that unit.
 */
function baseValues(overrides: Record<string, unknown> = {}) {
  return {
    is_active: true,
    ...overrides,
  };
}

describe('pickupPointSchema — time fields', () => {
  it('accepts a blank cutoff (untouched field)', () => {
    const result = pickupPointSchema.safeParse(baseValues({ sla_pickup_cutoff_time: '' }));
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed HH:MM cutoff', () => {
    const result = pickupPointSchema.safeParse(baseValues({ sla_pickup_cutoff_time: '18:00' }));
    expect(result.success).toBe(true);
  });

  it('rejects a non-time cutoff', () => {
    const result = pickupPointSchema.safeParse(baseValues({ sla_pickup_cutoff_time: 'banana' }));
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range hour', () => {
    const result = pickupPointSchema.safeParse(baseValues({ sla_pickup_cutoff_time: '25:00' }));
    expect(result.success).toBe(false);
  });

  it('rejects HH:MM:SS at the write path — the form always saves seconds-free', () => {
    const result = pickupPointSchema.safeParse(baseValues({ location_window_start: '09:00:00' }));
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only value rather than accepting it as blank', () => {
    const result = pickupPointSchema.safeParse(baseValues({ location_window_end: '   ' }));
    expect(result.success).toBe(false);
  });
});
