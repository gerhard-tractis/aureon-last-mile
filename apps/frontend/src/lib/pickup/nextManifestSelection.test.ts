import { describe, it, expect } from 'vitest';
import { selectNextManifest } from './nextManifestSelection';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

function manifest(overrides: Partial<RouteManifestRow>): RouteManifestRow {
  return {
    id: overrides.id ?? 'm',
    external_load_id: overrides.external_load_id ?? 'LOAD',
    retailer_name: null,
    pickup_location: null,
    total_orders: null,
    total_packages: 2,
    verified_count: 0,
    ...overrides,
  };
}

describe('selectNextManifest', () => {
  it('picks the first genuinely incomplete manifest as next', () => {
    const complete = manifest({ id: 'm1', external_load_id: 'L1', total_packages: 2, verified_count: 2 });
    const incomplete = manifest({ id: 'm2', external_load_id: 'L2', total_packages: 2, verified_count: 1 });
    const result = selectNextManifest([complete, incomplete]);
    expect(result.nextManifest?.id).toBe('m2');
    expect(result.nextIndex).toBe(1);
  });

  it('treats a null or zero total_packages as incomplete, never as done', () => {
    const unknown = manifest({ id: 'm1', external_load_id: 'L1', total_packages: null, verified_count: 0 });
    const result = selectNextManifest([unknown]);
    expect(result.nextManifest?.id).toBe('m1');
  });

  it('reports routeComplete when every manifest is done, with no next manifest', () => {
    const complete = manifest({ id: 'm1', external_load_id: 'L1', total_packages: 2, verified_count: 2 });
    const result = selectNextManifest([complete]);
    expect(result.nextManifest).toBeNull();
    expect(result.routeComplete).toBe(true);
  });

  it('is not routeComplete on the empty-route edge case — nothing to complete yet', () => {
    const result = selectNextManifest([]);
    expect(result.nextManifest).toBeNull();
    expect(result.routeComplete).toBe(false);
  });

  it('upcoming is only what comes AFTER the highlighted manifest, not everything else', () => {
    const before = manifest({ id: 'm0', external_load_id: 'L0', total_packages: 2, verified_count: 2 });
    const next = manifest({ id: 'm1', external_load_id: 'L1', total_packages: 2, verified_count: 1 });
    const after = manifest({ id: 'm2', external_load_id: 'L2', total_packages: 2, verified_count: 2 });
    const result = selectNextManifest([before, next, after]);
    expect(result.upcoming.map((m) => m.id)).toEqual(['m2']);
  });

  it('upcoming is empty when there is no next manifest', () => {
    const complete = manifest({ id: 'm1', external_load_id: 'L1', total_packages: 2, verified_count: 2 });
    const result = selectNextManifest([complete]);
    expect(result.upcoming).toEqual([]);
  });

  it('upcoming caps at 3 manifests ahead', () => {
    const next = manifest({ id: 'm0', external_load_id: 'L0', total_packages: 2, verified_count: 1 });
    const rest = [1, 2, 3, 4].map((n) =>
      manifest({ id: `m${n}`, external_load_id: `L${n}`, total_packages: 2, verified_count: 2 }),
    );
    const result = selectNextManifest([next, ...rest]);
    expect(result.upcoming.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
