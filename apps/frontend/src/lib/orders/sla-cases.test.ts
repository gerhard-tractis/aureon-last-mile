import { describe, expect, it } from 'vitest';
import {
  classifyRisk,
  AT_RISK_HOURS as SLA_AT_RISK_HOURS,
} from '@/app/app/operations-control/lib/sla';
import { AT_RISK_HOURS, NOW_ISO, SLA_CASES } from './sla-cases';

describe('SLA case table parity with classifyRisk', () => {
  it('shares the same AT_RISK_HOURS boundary as the sla.ts authority', () => {
    expect(AT_RISK_HOURS).toBe(SLA_AT_RISK_HOURS);
  });

  const now = new Date(NOW_ISO);

  it.each(SLA_CASES)(
    '$name → status=$expectedStatus minutes=$expectedMinutesRemaining',
    (testCase) => {
      const result = classifyRisk(
        testCase.order as unknown as Parameters<typeof classifyRisk>[0],
        now,
      );

      expect(result.status).toBe(testCase.expectedStatus);
      expect(result.minutesRemaining).toBe(testCase.expectedMinutesRemaining);
    },
  );
});
