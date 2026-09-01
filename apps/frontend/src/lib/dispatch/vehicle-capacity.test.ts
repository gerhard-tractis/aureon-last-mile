// apps/frontend/src/lib/dispatch/vehicle-capacity.test.ts
import { describe, it, expect } from 'vitest';
import { getVehicleFillStatus, getMaxDropsStatus } from './vehicle-capacity';

describe('getVehicleFillStatus', () => {
  describe('unconfigured — must never become a number', () => {
    it('returns configured: false with no capacity set (null)', () => {
      const status = getVehicleFillStatus(25, null);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
      expect(status).not.toHaveProperty('tone');
      expect(status).not.toHaveProperty('remaining');
      expect(status).not.toHaveProperty('atCapacity');
      expect(status).not.toHaveProperty('overCapacity');
      expect(status).not.toHaveProperty('basis');
    });

    it('treats capacity 0 the same as not configured', () => {
      const status = getVehicleFillStatus(10, 0);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
    });

    it('treats negative capacity the same as not configured', () => {
      const status = getVehicleFillStatus(10, -5);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
    });

    it('treats NaN capacity the same as not configured — not a number to compute a fill from', () => {
      const status = getVehicleFillStatus(25, NaN);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
      expect(status.packageCount).toBe(25);
    });

    it('treats Infinity capacity the same as not configured', () => {
      const status = getVehicleFillStatus(25, Infinity);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
    });

    it('treats -Infinity capacity the same as not configured', () => {
      const status = getVehicleFillStatus(25, -Infinity);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
    });

    it('still carries the raw package count when unconfigured — a caller can show the count without a percentage', () => {
      const status = getVehicleFillStatus(40, null);
      expect(status.packageCount).toBe(40);
    });

    it('non-blocking property: an unconfigured vehicle with a full route produces a usable result — nothing throws, nothing defaults to a number', () => {
      expect(() => getVehicleFillStatus(500, null)).not.toThrow();
      const status = getVehicleFillStatus(500, null);
      expect(status.configured).toBe(false);
      // The type system (not just this assertion) makes fillPct
      // unreachable here: `status.fillPct` would not compile without
      // narrowing on `status.configured === true` first.
      expect(status).not.toHaveProperty('fillPct');
    });
  });

  describe('non-finite package count — configured capacity still produces a real, renderable result', () => {
    it('treats a NaN package count as zero, not NaN, against a valid capacity', () => {
      const status = getVehicleFillStatus(NaN, 25);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.packageCount).toBe(0);
      expect(status.fillPct).toBe(0);
      expect(Number.isNaN(status.fillPct)).toBe(false);
      expect(status.tone).toBe('warning');
    });

    it('treats an Infinity package count as zero, not Infinity, against a valid capacity', () => {
      const status = getVehicleFillStatus(Infinity, 25);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.packageCount).toBe(0);
      expect(status.fillPct).toBe(0);
      expect(Number.isFinite(status.fillPct)).toBe(true);
    });
  });

  describe('configured — real fill rate', () => {
    it('computes fill percentage, remaining capacity, basis, and neutral tone at 40/25... loaded example from the task', () => {
      // "this vehicle holds 40 and 25 are loaded"
      const status = getVehicleFillStatus(25, 40);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.fillPct).toBe(62.5);
      expect(status.remaining).toBe(15);
      expect(status.tone).toBe('neutral');
      expect(status.overCapacity).toBe(false);
      expect(status.atCapacity).toBe(false);
      expect(status.basis).toBe('packages');
    });

    it('is warning tone (under-filled) below 50%', () => {
      const status = getVehicleFillStatus(10, 100);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.fillPct).toBe(10);
      expect(status.tone).toBe('warning');
    });

    it('is warning tone at exactly 49%', () => {
      const status = getVehicleFillStatus(49, 100);
      if (!status.configured) throw new Error('unreachable');
      expect(status.tone).toBe('warning');
    });

    it('is neutral tone at exactly 50%', () => {
      const status = getVehicleFillStatus(50, 100);
      if (!status.configured) throw new Error('unreachable');
      expect(status.tone).toBe('neutral');
    });

    it('is neutral tone at 99%', () => {
      const status = getVehicleFillStatus(99, 100);
      if (!status.configured) throw new Error('unreachable');
      expect(status.tone).toBe('neutral');
    });
  });

  describe('label/tone agreement — tone and capacity flags are derived from the rounded percentage', () => {
    it('199/400 = 49.75%: rounds to 50, so it must NOT be the warning tone — the label and the tone must agree on "50%"', () => {
      const status = getVehicleFillStatus(199, 400);
      if (!status.configured) throw new Error('unreachable');
      expect(Math.round(status.fillPct)).toBe(50);
      expect(status.tone).toBe('neutral');
    });

    it('399/400 = 99.75%: rounds to 100, so it must be the error tone and atCapacity — not neutral labelled 100%', () => {
      const status = getVehicleFillStatus(399, 400);
      if (!status.configured) throw new Error('unreachable');
      expect(Math.round(status.fillPct)).toBe(100);
      expect(status.tone).toBe('error');
      expect(status.atCapacity).toBe(true);
      expect(status.overCapacity).toBe(false);
    });

    it('1004/1000 = 100.4%: rounds to 100, so overCapacity must be false — identical to 1000/1000 at the displayed number', () => {
      const status = getVehicleFillStatus(1004, 1000);
      if (!status.configured) throw new Error('unreachable');
      expect(Math.round(status.fillPct)).toBe(100);
      expect(status.atCapacity).toBe(true);
      expect(status.overCapacity).toBe(false);
    });

    it('1030/1000 = 103%: rounds to 103, over the boundary — overCapacity must be true', () => {
      const status = getVehicleFillStatus(1030, 1000);
      if (!status.configured) throw new Error('unreachable');
      expect(Math.round(status.fillPct)).toBe(103);
      expect(status.atCapacity).toBe(true);
      expect(status.overCapacity).toBe(true);
    });
  });

  describe('boundary cases', () => {
    it('0 loaded against a configured capacity is 0% fill, warning tone, full remaining — not "unknown", a real zero', () => {
      const status = getVehicleFillStatus(0, 100);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.fillPct).toBe(0);
      expect(status.tone).toBe('warning');
      expect(status.remaining).toBe(100);
      expect(status.overCapacity).toBe(false);
      expect(status.atCapacity).toBe(false);
    });

    it('exactly full (count === capacity) is 100% fill, error tone, 0 remaining, atCapacity true, overCapacity FALSE — finished, not illegal', () => {
      const status = getVehicleFillStatus(100, 100);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.fillPct).toBe(100);
      expect(status.tone).toBe('error');
      expect(status.remaining).toBe(0);
      expect(status.atCapacity).toBe(true);
      expect(status.overCapacity).toBe(false);
    });

    it('over-capacity does not throw, is not clamped to 100%, and is flagged both atCapacity and overCapacity — the UI needs to know it is over, not just "full"', () => {
      expect(() => getVehicleFillStatus(140, 100)).not.toThrow();
      const status = getVehicleFillStatus(140, 100);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.fillPct).toBe(140);
      expect(status.tone).toBe('error');
      expect(status.atCapacity).toBe(true);
      expect(status.overCapacity).toBe(true);
      // remaining clamps at 0 — there is no "-40 remaining" to show
      expect(status.remaining).toBe(0);
    });

    it('treats a negative package count as zero for fill purposes', () => {
      const status = getVehicleFillStatus(-10, 100);
      if (!status.configured) throw new Error('unreachable');
      expect(status.packageCount).toBe(0);
      expect(status.fillPct).toBe(0);
    });
  });

  describe('mutation-proving the non-blocking property', () => {
    // These two tests exist specifically to fail if "unknown" collapses
    // into a number. Each asserts a value that a 0-collapse or a
    // full-collapse mutant would get wrong.

    it('MUTATION GUARD (collapse to 0): unconfigured must not equal a configured 0%-fill result', () => {
      const unconfigured = getVehicleFillStatus(25, null);
      const zeroFilled = getVehicleFillStatus(0, 100);

      // A mutant that makes the unconfigured branch return
      // `{ configured: true, fillPct: 0, tone: 'warning', ... }` would
      // pass every "unconfigured" test above that only checks
      // `configured === false` in isolation, but this test catches it: the
      // discriminant must differ, and unconfigured must carry no fillPct.
      expect(unconfigured.configured).toBe(false);
      expect(zeroFilled.configured).toBe(true);
      expect(unconfigured).not.toHaveProperty('fillPct');
      if (zeroFilled.configured) {
        expect(zeroFilled.fillPct).toBe(0);
      }
    });

    it('MUTATION GUARD (collapse to full): unconfigured must not equal a configured 100%/over-capacity result', () => {
      const unconfigured = getVehicleFillStatus(999, null);

      // A mutant that makes an unconfigured capacity default to "treat as
      // full" (e.g. `capacityPackages ?? packageCount`, producing 100%
      // fill and an 'error' tone) is caught here: this must stay the
      // `configured: false` shape, with no tone at all — not 'error'.
      expect(unconfigured.configured).toBe(false);
      expect(unconfigured).not.toHaveProperty('tone');
      expect(unconfigured).not.toHaveProperty('overCapacity');
    });

    it('MUTATION GUARD (non-finite guard removed): a NaN capacity must not slip onto the configured side', () => {
      // This is the regression the review flagged: `capacityPackages <= 0`
      // alone lets `NaN` through, because `NaN <= 0` is false. A mutant
      // that drops the `!Number.isFinite(capacityPackages)` half of the
      // guard collapses this back to `configured: true, fillPct: NaN`.
      const status = getVehicleFillStatus(25, NaN);
      expect(status.configured).toBe(false);
      expect(status).not.toHaveProperty('fillPct');
    });
  });
});

describe('getMaxDropsStatus', () => {
  it('returns configured: false with no cap set', () => {
    const status = getMaxDropsStatus(12, null);
    expect(status.configured).toBe(false);
    expect(status).not.toHaveProperty('atCap');
    expect(status).not.toHaveProperty('remaining');
  });

  it('treats max_drops 0 the same as not configured', () => {
    const status = getMaxDropsStatus(5, 0);
    expect(status.configured).toBe(false);
  });

  it('treats negative max_drops the same as not configured', () => {
    const status = getMaxDropsStatus(5, -3);
    expect(status.configured).toBe(false);
  });

  it('treats NaN max_drops the same as not configured', () => {
    const status = getMaxDropsStatus(5, NaN);
    expect(status.configured).toBe(false);
    expect(status).not.toHaveProperty('atCap');
  });

  it('treats Infinity max_drops the same as not configured', () => {
    const status = getMaxDropsStatus(5, Infinity);
    expect(status.configured).toBe(false);
    expect(status).not.toHaveProperty('atCap');
  });

  it('is not at cap below the limit', () => {
    const status = getMaxDropsStatus(8, 20);
    expect(status.configured).toBe(true);
    if (!status.configured) throw new Error('unreachable');
    expect(status.atCap).toBe(false);
    expect(status.remaining).toBe(12);
  });

  it('is at cap exactly at the limit', () => {
    const status = getMaxDropsStatus(20, 20);
    if (!status.configured) throw new Error('unreachable');
    expect(status.atCap).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it('is at cap over the limit, does not throw, remaining clamps at 0', () => {
    expect(() => getMaxDropsStatus(25, 20)).not.toThrow();
    const status = getMaxDropsStatus(25, 20);
    if (!status.configured) throw new Error('unreachable');
    expect(status.atCap).toBe(true);
    expect(status.remaining).toBe(0);
  });

  it('treats a negative drop count as zero, not at cap, full remaining — symmetric with getVehicleFillStatus', () => {
    const status = getMaxDropsStatus(-5, 20);
    if (!status.configured) throw new Error('unreachable');
    expect(status.dropCount).toBe(0);
    expect(status.atCap).toBe(false);
    expect(status.remaining).toBe(20);
  });

  it('is evaluated independently of capacity — a route can be at drop cap with plenty of package room', () => {
    const fill = getVehicleFillStatus(10, 200); // way under package capacity
    const drops = getMaxDropsStatus(20, 20); // at drop cap
    if (!fill.configured || !drops.configured) throw new Error('unreachable');
    expect(fill.tone).toBe('warning'); // under-filled by package count
    expect(drops.atCap).toBe(true); // but the route is done for other reasons
  });

  describe('non-finite drop count — hard constraint fails CLOSED, never open', () => {
    it('a NaN drop count against a configured cap must not report atCap: false — that would offer a top-up on an unknown count', () => {
      const status = getMaxDropsStatus(NaN, 10);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.atCap).toBe(true);
      expect(status.remaining).toBe(0);
    });

    it('an Infinity drop count against a configured cap also fails closed', () => {
      const status = getMaxDropsStatus(Infinity, 10);
      expect(status.configured).toBe(true);
      if (!status.configured) throw new Error('unreachable');
      expect(status.atCap).toBe(true);
      expect(status.remaining).toBe(0);
    });
  });

  describe('independence from getVehicleFillStatus — must diverge from a delegating implementation', () => {
    // The reviewer's rewrite delegated getMaxDropsStatus to
    // getVehicleFillStatus (treating dropCount as packageCount and
    // maxDrops as capacityPackages) and every then-existing test still
    // passed, because dropCount >= maxDrops is mathematically identical to
    // (dropCount / maxDrops * 100) >= 100 for whole numbers. It is NOT
    // identical once the fill side rounds before deciding atCapacity
    // (finding 2's fix): 99.6 drops of 100 rounds to a 100% fill
    // (atCapacity: true) but is genuinely not at the drop cap yet
    // (99.6 < 100). A correct, independent getMaxDropsStatus must say
    // atCap: false here; a delegating one built on the rounded fill
    // percentage would wrongly say true.
    it('99.6/100 drops: raw comparison says not at cap, even though the equivalent rounded fill percentage would say atCapacity', () => {
      const drops = getMaxDropsStatus(99.6, 100);
      if (!drops.configured) throw new Error('unreachable');
      expect(drops.atCap).toBe(false);

      const fillEquivalent = getVehicleFillStatus(99.6, 100);
      if (!fillEquivalent.configured) throw new Error('unreachable');
      // Same two numbers, interpreted as a fill: rounds to 100% and reads
      // as at-capacity. Proves the two functions genuinely disagree here.
      expect(fillEquivalent.atCapacity).toBe(true);
    });
  });
});
