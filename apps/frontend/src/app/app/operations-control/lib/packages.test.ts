import { describe, it, expect } from 'vitest';
import { countPackages } from './packages';

describe('countPackages', () => {
  it('sums the packages array across items', () => {
    expect(
      countPackages([
        { packages: [{ id: 'p1' }, { id: 'p2' }] },
        { packages: [{ id: 'p3' }] },
      ]),
    ).toBe(3);
  });

  it('returns null when no item carries a packages array', () => {
    // Routes have no packages in the snapshot. Reporting 0 would say the
    // stage is empty; null says we do not know, and the line is hidden.
    expect(countPackages([{ id: 'r1', status: 'in_progress' }])).toBeNull();
  });

  it('returns null for an empty stage', () => {
    expect(countPackages([])).toBeNull();
  });

  it('counts a genuine zero when the array is present but empty', () => {
    expect(countPackages([{ packages: [] }])).toBe(0);
  });

  it('ignores items without packages when others have them', () => {
    // The docks stage mixes orders (with packages) and routes (without).
    expect(
      countPackages([{ packages: [{ id: 'p1' }] }, { id: 'route-1' }]),
    ).toBe(1);
  });

  it('is not fooled by a non-array packages value', () => {
    expect(countPackages([{ packages: null }, { packages: 'nope' }])).toBeNull();
  });
});
