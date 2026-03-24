import { describe, it, expect } from 'vitest';
import { determineDockZone, type DockZone, type PackageOrder } from './sectorization-engine';

const TODAY    = '2026-03-21';
const TOMORROW = '2026-03-22';
const FUTURE   = '2026-03-30';

const LC_ID   = 'comuna-las-condes';
const PROV_ID = 'comuna-providencia';
const NUN_ID  = 'comuna-nunoa';
const VIT_ID  = 'comuna-vitacura';

const zones: DockZone[] = [
  {
    id: 'zone-1', name: 'Andén 1', code: 'DOCK-001',
    is_consolidation: false, is_active: true,
    comunas: [{ id: LC_ID, nombre: 'Las Condes' }, { id: VIT_ID, nombre: 'Vitacura' }],
  },
  {
    id: 'zone-2', name: 'Andén 2', code: 'DOCK-002',
    is_consolidation: false, is_active: true,
    comunas: [{ id: PROV_ID, nombre: 'Providencia' }, { id: NUN_ID, nombre: 'Ñuñoa' }],
  },
  {
    id: 'consol', name: 'Consolidación', code: 'CONSOL',
    is_consolidation: true, is_active: true, comunas: [],
  },
];

describe('determineDockZone (ID-based)', () => {
  it('routes package to matching andén when comunaId matches', () => {
    const pkg: PackageOrder = { comunaId: LC_ID, delivery_date: TODAY };
    expect(determineDockZone(pkg, zones, TODAY)).toMatchObject({ zone_id: 'zone-1', reason: 'matched' });
  });

  it('routes to matching andén when delivery is tomorrow', () => {
    const pkg: PackageOrder = { comunaId: PROV_ID, delivery_date: TOMORROW };
    expect(determineDockZone(pkg, zones, TODAY)).toMatchObject({ zone_id: 'zone-2', reason: 'matched' });
  });

  it('routes to consolidation when delivery date is future', () => {
    const pkg: PackageOrder = { comunaId: LC_ID, delivery_date: FUTURE };
    expect(determineDockZone(pkg, zones, TODAY)).toMatchObject({ zone_id: 'consol', reason: 'future_date' });
  });

  it('routes to consolidation with flagged=true when comunaId not in any zone', () => {
    const pkg: PackageOrder = { comunaId: 'unknown-id', delivery_date: TODAY };
    const r = determineDockZone(pkg, zones, TODAY);
    expect(r).toMatchObject({ zone_id: 'consol', reason: 'unmapped', flagged: true });
  });

  it('routes to consolidation with flagged=false when comunaId is null', () => {
    const pkg: PackageOrder = { comunaId: null, delivery_date: TODAY };
    const r = determineDockZone(pkg, zones, TODAY);
    expect(r).toMatchObject({ zone_id: 'consol', reason: 'unmapped', flagged: false });
  });

  it('skips inactive zones', () => {
    const inactive = zones.map(z => z.id === 'zone-1' ? { ...z, is_active: false } : z);
    const pkg: PackageOrder = { comunaId: LC_ID, delivery_date: TODAY };
    expect(determineDockZone(pkg, inactive, TODAY)).toMatchObject({ zone_id: 'consol', reason: 'unmapped' });
  });

  it('throws when no consolidation zone configured', () => {
    const noConsol = zones.filter(z => !z.is_consolidation);
    expect(() => determineDockZone({ comunaId: LC_ID, delivery_date: TODAY }, noConsol, TODAY))
      .toThrow('No consolidation zone');
  });
});
