import { describe, it, expect } from 'vitest';
import { buildRetryChecklist } from './dispatch-retry-checklist';

const STOP = (hasPhone: boolean) => ({ hasAddress: true, hasPhone });

describe('buildRetryChecklist — item 15, decision 6\'s "Antes de reintentar" checklist', () => {
  it('separates verified from warning — everything complete stays a warning-free list', () => {
    const result = buildRetryChecklist({
      vehicleAssigned: true,
      driverAssigned: true,
      stops: [STOP(true), STOP(true)],
    });
    expect(result.verified).toContain('Camión y conductor asignados');
    expect(result.verified.some((v) => /2 paradas con direcci[oó]n y tel[eé]fono/i.test(v))).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('a stop missing the phone becomes a warning, named with the real count — decision 6\'s own example', () => {
    const result = buildRetryChecklist({
      vehicleAssigned: true,
      driverAssigned: true,
      stops: [STOP(true), STOP(true), STOP(false), STOP(false)],
    });
    expect(result.warnings).toContain('2 paradas sin teléfono del receptor');
    // The verified stop count only counts complete stops (address + phone).
    expect(result.verified.some((v) => /2 paradas con direcci[oó]n y tel[eé]fono/i.test(v))).toBe(true);
  });

  it('no vehicle or driver assigned is its own warning, not silently dropped', () => {
    const result = buildRetryChecklist({ vehicleAssigned: false, driverAssigned: false, stops: [] });
    expect(result.verified).not.toContain('Camión y conductor asignados');
    expect(result.warnings.some((w) => /cami[oó]n|conductor/i.test(w))).toBe(true);
  });

  it('singularises a single missing-phone stop', () => {
    const result = buildRetryChecklist({
      vehicleAssigned: true,
      driverAssigned: true,
      stops: [STOP(true), STOP(false)],
    });
    expect(result.warnings).toContain('1 parada sin teléfono del receptor');
  });
});
