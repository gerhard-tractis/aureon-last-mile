import { describe, it, expect } from 'vitest';
import { todayLabel, matchesSearchTerm } from './pickupPageHelpers';
import type { ManifestRow } from '@/components/pickup/ManifestTable';

describe('todayLabel', () => {
  it('capitalises the weekday and formats in Spanish', () => {
    const date = new Date('2026-04-09T10:00:00Z');
    expect(todayLabel(date)).toMatch(/^[A-ZÁÉÍÓÚ]/);
  });
});

describe('matchesSearchTerm', () => {
  const row: ManifestRow = {
    id: 'm1',
    externalLoadId: 'CARGA-001',
    pickupPoint: 'Easy Vespucio',
    retailerName: 'Easy',
    orderCount: 5,
    packageCount: 12,
  };

  it('matches everything when the term is empty', () => {
    expect(matchesSearchTerm(row, '')).toBe(true);
  });

  it('matches by external load id, case-insensitively', () => {
    expect(matchesSearchTerm(row, 'carga-001')).toBe(true);
  });

  it('matches by retailer name', () => {
    expect(matchesSearchTerm(row, 'easy')).toBe(true);
  });

  it('matches by pickup point', () => {
    expect(matchesSearchTerm(row, 'vespucio')).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(matchesSearchTerm(row, 'sodimac')).toBe(false);
  });

  it('does not crash on a null retailer/pickup point', () => {
    const bare: ManifestRow = { ...row, retailerName: null, pickupPoint: null };
    expect(matchesSearchTerm(bare, 'anything')).toBe(false);
    expect(matchesSearchTerm(bare, '')).toBe(true);
  });
});
