import { describe, it, expect } from 'vitest';
import { FORCE_SEAL_REASON_CODES, isForceSealReasonCode } from './force-seal-reasons';

/**
 * spec-77 — the force-seal exception to spec-70 decision 2 requires a
 * reason, and the reason has to come from a closed set or "reason" is just
 * decoration. This pins the vocabulary itself, isolated from `sealRoute`'s
 * own tests (`seal-route.test.ts`), which exercise how it is enforced.
 */
describe('FORCE_SEAL_REASON_CODES — spec-77 force-seal vocabulary', () => {
  it('is a small closed set', () => {
    expect(FORCE_SEAL_REASON_CODES.length).toBeGreaterThan(0);
    expect(FORCE_SEAL_REASON_CODES.length).toBeLessThanOrEqual(6);
  });

  it('includes the escape hatch', () => {
    expect(FORCE_SEAL_REASON_CODES).toContain('otro');
  });

  it('accepts every member of the set', () => {
    for (const code of FORCE_SEAL_REASON_CODES) {
      expect(isForceSealReasonCode(code)).toBe(true);
    }
  });

  it('rejects free text outside the set, and non-string input', () => {
    expect(isForceSealReasonCode('porque_si')).toBe(false);
    expect(isForceSealReasonCode('')).toBe(false);
    expect(isForceSealReasonCode(undefined)).toBe(false);
    expect(isForceSealReasonCode(null)).toBe(false);
    expect(isForceSealReasonCode(42)).toBe(false);
  });
});
