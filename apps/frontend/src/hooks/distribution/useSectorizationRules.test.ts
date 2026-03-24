import { describe, it, expect } from 'vitest';
import { getSectorizationResult } from './useSectorizationRules';

const LC_ID = 'comuna-las-condes';

const zones = [
  {
    id: 'zone-1', name: 'Andén 1', code: 'DOCK-001',
    is_consolidation: false, is_active: true,
    comunas: [{ id: LC_ID, nombre: 'Las Condes' }],
  },
  {
    id: 'consol', name: 'Consolidación', code: 'CONSOL',
    is_consolidation: true, is_active: true,
    comunas: [],
  },
];

describe('getSectorizationResult', () => {
  it('returns matched zone for known comunaId with active delivery date', () => {
    const result = getSectorizationResult(LC_ID, '2026-03-18', zones, '2026-03-18');
    expect(result.zone_id).toBe('zone-1');
    expect(result.reason).toBe('matched');
  });

  it('returns consolidation for unknown comunaId', () => {
    const result = getSectorizationResult('unknown-id', '2026-03-18', zones, '2026-03-18');
    expect(result.zone_id).toBe('consol');
    expect(result.flagged).toBe(true);
  });
});
