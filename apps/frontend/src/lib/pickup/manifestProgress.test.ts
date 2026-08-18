import { describe, it, expect } from 'vitest';
import { isManifestComplete, expectedLabel, progressLabel, sumExpected } from './manifestProgress';

describe('isManifestComplete', () => {
  it('is true when verified reaches a known total', () => {
    expect(isManifestComplete({ verified_count: 2, total_packages: 2 })).toBe(true);
  });

  it('is false when verified is below a known total', () => {
    expect(isManifestComplete({ verified_count: 1, total_packages: 2 })).toBe(false);
  });

  // spec-54 phase 4.6 fix: null total_packages must read as UNKNOWN, not
  // zero — `verified_count < (total_packages ?? 0)` previously made every
  // manifest with a null total read as already complete.
  it('is false (unknown, never "complete") when total_packages is null', () => {
    expect(isManifestComplete({ verified_count: 0, total_packages: null })).toBe(false);
    expect(isManifestComplete({ verified_count: 5, total_packages: null })).toBe(false);
  });

  // Deliberate decision (spec-54 phase 4.6, review round 2): a total of 0 is
  // treated the same as null — not-complete — matching the pre-existing
  // `RouteManifestList` predicate (`expected > 0 && verified >= expected`)
  // this function replaces. A manifest never legitimately expects zero
  // packages; 0 means intake hasn't recorded a real count yet.
  it('is false when total_packages is 0, even though 0 verified >= 0 total', () => {
    expect(isManifestComplete({ verified_count: 0, total_packages: 0 })).toBe(false);
  });

  it('is true when verified overshoots a known positive total', () => {
    expect(isManifestComplete({ verified_count: 9, total_packages: 8 })).toBe(true);
  });
});

describe('expectedLabel', () => {
  it('renders the known total', () => {
    expect(expectedLabel(8)).toBe('8');
  });

  it('renders an em dash instead of fabricating a total', () => {
    expect(expectedLabel(null)).toBe('—');
  });
});

describe('progressLabel', () => {
  it('renders verified/total when the total is known', () => {
    expect(progressLabel({ verified_count: 3, total_packages: 8 })).toBe('3/8');
  });

  it('never renders a false "/0" for an unknown total', () => {
    expect(progressLabel({ verified_count: 5, total_packages: null })).toBe('5/—');
  });
});

describe('sumExpected', () => {
  it('sums known totals and flags no unknowns when every manifest has one', () => {
    const result = sumExpected([{ total_packages: 4 }, { total_packages: 8 }]);
    expect(result).toEqual({ knownExpectedSum: 12, hasUnknownExpected: false });
  });

  it('flags hasUnknownExpected when any manifest has a null total', () => {
    const result = sumExpected([{ total_packages: 4 }, { total_packages: null }]);
    expect(result.hasUnknownExpected).toBe(true);
    // The known partial sum is still returned for callers that want it, but
    // must never be presented as the route's real total on its own.
    expect(result.knownExpectedSum).toBe(4);
  });
});
