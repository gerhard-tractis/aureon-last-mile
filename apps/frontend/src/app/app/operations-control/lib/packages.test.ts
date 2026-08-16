import { describe, it, expect } from 'vitest';
import { countPackages, stagePackageCount } from './packages';

describe('countPackages', () => {
  it('sums the packages array across items', () => {
    expect(
      countPackages([{ packages: [{ id: 'p1' }, { id: 'p2' }] }, { packages: [{ id: 'p3' }] }]),
    ).toBe(3);
  });

  it('ignores items that carry no packages', () => {
    // The docks stage mixes orders (with packages) and routes (without).
    expect(countPackages([{ packages: [{ id: 'p1' }] }, { id: 'route-1' }])).toBe(1);
  });

  it('is not fooled by a non-array packages value', () => {
    expect(countPackages([{ packages: null }, { packages: 'nope' }])).toBe(0);
  });

  it('is zero for no items', () => {
    expect(countPackages([])).toBe(0);
  });
});

describe('stagePackageCount', () => {
  it('reports a count for the stages whose items carry packages', () => {
    expect(stagePackageCount('reception', [{ packages: [{ id: 'p1' }] }])).toBe(1);
    expect(stagePackageCount('pickup', [{ packages: [{ id: 'p1' }, { id: 'p2' }] }])).toBe(2);
  });

  it('reports 0 — not null — for an empty stage that would have packages', () => {
    // This is the whole point. An operator whose Recogida is empty should see
    // "0 paquetes", not a card with the line silently missing.
    expect(stagePackageCount('pickup', [])).toBe(0);
    expect(stagePackageCount('reception', [])).toBe(0);
    expect(stagePackageCount('consolidation', [])).toBe(0);
    expect(stagePackageCount('docks', [])).toBe(0);
    expect(stagePackageCount('returns', [])).toBe(0);
  });

  it('returns null for Reparto, which the snapshot gives as routes only', () => {
    // Routes carry no packages, so any number here would be invented.
    expect(stagePackageCount('delivery', [{ id: 'r1', total_stops: 20 }])).toBeNull();
    expect(stagePackageCount('delivery', [])).toBeNull();
  });

  it('returns null for the reverse stage, which is always empty by construction', () => {
    expect(stagePackageCount('reverse', [])).toBeNull();
  });

  it('counts only the orders half of the mixed docks stage', () => {
    expect(
      stagePackageCount('docks', [{ packages: [{ id: 'p1' }, { id: 'p2' }] }, { id: 'route-1' }]),
    ).toBe(2);
  });
});
