import { describe, it, expect } from 'vitest';
import { countNoDockIncidents } from './no-dock-incident-count';
import type { DockZone } from './sectorization-engine';

const consolidation: DockZone = {
  id: 'consol',
  name: 'Consolidación',
  code: 'CONSOL',
  is_consolidation: true,
  comunas: [],
  is_active: true,
};

const zoneA: DockZone = {
  id: 'z-a',
  name: 'A',
  code: 'A1',
  is_consolidation: false,
  comunas: [{ id: 'c-known', nombre: 'Conocida' }],
  is_active: true,
};

const today = '2026-09-12';

describe('countNoDockIncidents', () => {
  it('counts an order whose comuna resolves but no dock zone covers it', () => {
    const count = countNoDockIncidents(
      [{ comunaId: 'c-unmapped', delivery_date: today }],
      [consolidation, zoneA],
      today,
    );
    expect(count).toBe(1);
  });

  it('does not count an order whose comuna matches an active zone', () => {
    const count = countNoDockIncidents(
      [{ comunaId: 'c-known', delivery_date: today }],
      [consolidation, zoneA],
      today,
    );
    expect(count).toBe(0);
  });

  it('does not count a future-dated retention as a no-dock incident', () => {
    const count = countNoDockIncidents(
      [{ comunaId: null, delivery_date: '2026-12-25' }],
      [consolidation, zoneA],
      today,
    );
    expect(count).toBe(0);
  });

  it('does not count an order with no comuna at all (unmatched comuna, not no-dock)', () => {
    const count = countNoDockIncidents(
      [{ comunaId: null, delivery_date: today }],
      [consolidation, zoneA],
      today,
    );
    expect(count).toBe(0);
  });

  it('counts multiple flagged orders independently of matched ones', () => {
    const count = countNoDockIncidents(
      [
        { comunaId: 'c-unmapped', delivery_date: today },
        { comunaId: 'c-unmapped-2', delivery_date: today },
        { comunaId: 'c-known', delivery_date: today },
      ],
      [consolidation, zoneA],
      today,
    );
    expect(count).toBe(2);
  });

  it('returns 0 without throwing when no consolidation zone is configured yet', () => {
    const count = countNoDockIncidents([{ comunaId: 'c-unmapped', delivery_date: today }], [zoneA], today);
    expect(count).toBe(0);
  });
});
