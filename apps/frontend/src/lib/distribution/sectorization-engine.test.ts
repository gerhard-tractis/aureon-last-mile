import { describe, it, expect } from 'vitest';
import { determineDockZone, type DockZone, type PackageOrder } from './sectorization-engine';

const TODAY = '2026-03-18';
const TOMORROW = '2026-03-19';
const FUTURE = '2026-03-25';

const zones: DockZone[] = [
  { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes', 'vitacura'], is_active: true },
  { id: 'zone-2', name: 'Andén 2', code: 'DOCK-002', is_consolidation: false, comunas: ['providencia', 'ñuñoa'], is_active: true },
  { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true },
];

describe('determineDockZone', () => {
  it('routes package to matching andén when delivery is today', () => {
    const pkg: PackageOrder = { comuna: 'Las Condes', delivery_date: TODAY };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('zone-1');
    expect(result.reason).toBe('matched');
  });

  it('routes package to matching andén when delivery is tomorrow', () => {
    const pkg: PackageOrder = { comuna: 'Providencia', delivery_date: TOMORROW };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('zone-2');
    expect(result.reason).toBe('matched');
  });

  it('routes to consolidation when delivery date is future', () => {
    const pkg: PackageOrder = { comuna: 'Las Condes', delivery_date: FUTURE };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('consol');
    expect(result.reason).toBe('future_date');
  });

  it('routes to consolidation when comuna is unmapped', () => {
    const pkg: PackageOrder = { comuna: 'Peñalolén', delivery_date: TODAY };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('consol');
    expect(result.reason).toBe('unmapped');
    expect(result.flagged).toBe(true);
  });

  it('matches comunas case-insensitively with trimming', () => {
    const pkg: PackageOrder = { comuna: '  LAS CONDES  ', delivery_date: TODAY };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('zone-1');
  });

  it('skips inactive zones', () => {
    const inactiveZones = zones.map(z =>
      z.id === 'zone-1' ? { ...z, is_active: false } : z
    );
    const pkg: PackageOrder = { comuna: 'Las Condes', delivery_date: TODAY };
    const result = determineDockZone(pkg, inactiveZones, TODAY);
    expect(result.zone_id).toBe('consol');
    expect(result.reason).toBe('unmapped');
  });
});
