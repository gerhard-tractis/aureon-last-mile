import { describe, it, expect } from 'vitest';
import { todayLabel, matchesSearchTerm, pendingToRows } from './pickupPageHelpers';
import type { ManifestRow } from '@/components/pickup/ManifestTable';
import type { PendingManifest } from '@/hooks/pickup/useManifests';

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

describe('pendingToRows', () => {
  function pending(over: Partial<PendingManifest> = {}): PendingManifest {
    return {
      id: 'm1',
      external_load_id: 'CARGA-001',
      retailer_name: 'Easy',
      order_count: 5,
      package_count: 12,
      created_at: '2026-09-10T09:00:00Z',
      pickup_point: 'Easy Vespucio',
      verified_count: 0,
      labels_printed_at: null,
      labels_printed_by_name: null,
      pickup_window_start: null,
      pickup_window_end: null,
      pickup_cutoff_time: null,
      ...over,
    };
  }

  it('carries the pickup window fields through to the row, asymmetrically', () => {
    // Two rows with different shapes of "configured" — not two copies of the
    // same fixture — so a swap between window and cutoff would be visible.
    const [withWindow, withCutoffOnly] = pendingToRows([
      pending({ external_load_id: 'CARGA-001', pickup_window_start: '09:00', pickup_window_end: '13:00' }),
      pending({ external_load_id: 'CARGA-002', pickup_cutoff_time: '18:00' }),
    ]);

    expect(withWindow.pickupWindowStart).toBe('09:00');
    expect(withWindow.pickupWindowEnd).toBe('13:00');
    expect(withWindow.pickupCutoffTime).toBeNull();

    expect(withCutoffOnly.pickupWindowStart).toBeNull();
    expect(withCutoffOnly.pickupWindowEnd).toBeNull();
    expect(withCutoffOnly.pickupCutoffTime).toBe('18:00');
  });

  it('leaves the window fields null when the pickup point has none configured', () => {
    const [row] = pendingToRows([pending()]);
    expect(row.pickupWindowStart).toBeNull();
    expect(row.pickupWindowEnd).toBeNull();
    expect(row.pickupCutoffTime).toBeNull();
  });
});
