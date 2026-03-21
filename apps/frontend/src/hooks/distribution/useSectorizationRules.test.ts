import { describe, it, expect } from 'vitest';
import { getSectorizationResult } from './useSectorizationRules';

const zones = [
  { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes'], is_active: true },
  { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true },
];

describe('getSectorizationResult', () => {
  it('returns matched zone for known comuna with active delivery date', () => {
    const result = getSectorizationResult('las condes', '2026-03-18', zones, '2026-03-18');
    expect(result.zone_id).toBe('zone-1');
    expect(result.reason).toBe('matched');
  });

  it('returns consolidation for unknown comuna', () => {
    const result = getSectorizationResult('Peñalolén', '2026-03-18', zones, '2026-03-18');
    expect(result.zone_id).toBe('consol');
    expect(result.flagged).toBe(true);
  });
});
