import { describe, it, expect } from 'vitest';
import { matchZoneByComuna } from './consolidation-zone-match';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

function zone(overrides: Partial<DockZoneRecord> = {}): DockZoneRecord {
  return {
    id: 'zone-a1',
    name: 'Zona Norte',
    code: 'A3',
    is_consolidation: false,
    comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
    is_active: true,
    operator_id: 'op-1',
    capacity: 180,
    ...overrides,
  };
}

describe('matchZoneByComuna', () => {
  it('returns the active non-consolidation zone whose comunas include the id', () => {
    const zoneA = zone();
    expect(matchZoneByComuna('c-1', [zoneA])).toBe(zoneA);
  });

  it('returns null for a null comunaId', () => {
    expect(matchZoneByComuna(null, [zone()])).toBeNull();
  });

  it('returns null when no zone claims the comuna', () => {
    expect(matchZoneByComuna('c-999', [zone()])).toBeNull();
  });

  it('ignores an inactive zone even if its comunas match', () => {
    expect(matchZoneByComuna('c-1', [zone({ is_active: false })])).toBeNull();
  });

  it('ignores the consolidation zone even if it somehow lists the comuna', () => {
    const cons = zone({ id: 'zone-cons', is_consolidation: true, comunas: [{ id: 'c-1', nombre: 'Quilicura' }] });
    expect(matchZoneByComuna('c-1', [cons])).toBeNull();
  });

  it('picks the first matching zone when more than one claims the same comuna', () => {
    const first = zone({ id: 'zone-a1' });
    const second = zone({ id: 'zone-a2', code: 'A7' });
    expect(matchZoneByComuna('c-1', [first, second])).toBe(first);
  });
});
