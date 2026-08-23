import { describe, expect, it } from 'vitest';
import {
  classifyRisk,
  AT_RISK_HOURS as SLA_AT_RISK_HOURS,
} from '@/app/app/operations-control/lib/sla';
import { AT_RISK_HOURS, NOW_ISO, SLA_CASES, type SlaCaseOrder } from './sla-cases';

// `classifyRisk`'s own order-window parameter type is not exported from
// sla.ts, but `Parameters<typeof classifyRisk>[0]` recovers it structurally.
// Building the input this way (spread + narrow only the fields that differ)
// keeps the compiler checking every field name against the real parameter
// type — a blanket `as unknown as ...` cast would silently accept a renamed
// or misspelled key in `SlaCaseOrder` and feed `undefined` into `classifyRisk`
// without ever failing to compile.
type ClassifyRiskOrder = Parameters<typeof classifyRisk>[0];

function toClassifyRiskInput(order: SlaCaseOrder): ClassifyRiskOrder {
  return {
    ...order,
    // These three are required (non-null) strings on classifyRisk's side;
    // several cases deliberately set them null to exercise the "no window"
    // path, so only these need narrowing.
    delivery_date: order.delivery_date as string,
    delivery_window_start: order.delivery_window_start as string,
    delivery_window_end: order.delivery_window_end as string,
  };
}

describe('SLA case table parity with classifyRisk', () => {
  it('shares the same AT_RISK_HOURS boundary as the sla.ts authority', () => {
    expect(AT_RISK_HOURS).toBe(SLA_AT_RISK_HOURS);
  });

  it.each(SLA_CASES)(
    '$name → status=$expectedStatus minutes=$expectedMinutesRemaining',
    (testCase) => {
      const now = new Date(testCase.nowISO ?? NOW_ISO);
      const result = classifyRisk(toClassifyRiskInput(testCase.order), now);

      expect(result.status).toBe(testCase.expectedStatus);
      expect(result.minutesRemaining).toBe(testCase.expectedMinutesRemaining);
    },
  );
});
