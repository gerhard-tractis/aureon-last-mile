import { describe, it, expect } from 'vitest';
import {
  todayLabel,
  matchesSearchTerm,
  pendingToRows,
  manifestsAvailability,
  rescueRowsFromCompleted,
} from './pickupPageHelpers';
import type { ManifestRow } from '@/components/pickup/ManifestTable';
import type { PendingManifest, CompletedManifest } from '@/hooks/pickup/useManifests';

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

// spec-80 fase 2b (ronda 2) — replaces the round-1 `isManifestsUnknown`,
// which only distinguished pending/paused from resolved and so read a real
// `isError` (retries exhausted, `isPending: false`, `data: undefined`) as
// "known" — page.tsx's `?? []` would then have shown "nothing to rescue"
// after a genuine failure, not just a network pause. Also distinguishes an
// ORDINARY brief initial load (`fetchStatus: 'fetching'`) from a real
// network-pause "we don't know" (`fetchStatus: 'paused'`, this repo's
// `networkMode: 'online'` default) — collapsing those two made the rescue
// banner flash "revisa tu conexión" on every normal page open for the
// 200-800ms before the very first fetch resolves.
describe('manifestsAvailability', () => {
  it('is "error" once retries are exhausted, regardless of isPending/fetchStatus', () => {
    expect(
      manifestsAvailability({ isPending: false, isError: true, fetchStatus: 'idle' }),
    ).toBe('error');
  });

  it('is "unknown" when pending AND paused with no network', () => {
    expect(
      manifestsAvailability({ isPending: true, isError: false, fetchStatus: 'paused' }),
    ).toBe('unknown');
  });

  it('is "loading" when pending and actively fetching (an ordinary initial load)', () => {
    expect(
      manifestsAvailability({ isPending: true, isError: false, fetchStatus: 'fetching' }),
    ).toBe('loading');
  });

  it('is "known" once the query has resolved, even to an empty result', () => {
    expect(
      manifestsAvailability({ isPending: false, isError: false, fetchStatus: 'idle' }),
    ).toBe('known');
  });
});

// spec-80 fase 2b (ronda 2) — maps get_completed_manifests' operator-wide
// rows down to the ones that need a rescue signature (signature_operator
// IS NULL — trg_route_receptions_status_sync closed them without ever
// reaching Firma), in the RouteManifestRow shape PickupMobileCompactRow
// already knows how to render.
describe('rescueRowsFromCompleted', () => {
  function completed(overrides: Partial<CompletedManifest>): CompletedManifest {
    return {
      id: 'm1',
      external_load_id: 'CARGA-1',
      retailer_name: 'Falabella',
      total_orders: 10,
      total_packages: 20,
      completed_at: '2026-09-10T07:31:00.000Z',
      created_at: '2026-09-10T06:00:00.000Z',
      pickup_point: 'Mall Plaza Vespucio',
      labels_printed_at: null,
      labels_printed_by_name: null,
      missing_count: 0,
      signature_operator: null,
      ...overrides,
    };
  }

  // Asymmetric fixture (one rescue, one signed, one signed-with-a-real-
  // string-that-looks-empty) so a filter that's inverted or falsy-based
  // cannot pass by coincidence.
  it('keeps only rows with signature_operator === null, dropping signed ones', () => {
    const rescue = completed({ id: 'a', external_load_id: 'CARGA-RESCUE', signature_operator: null });
    const signed = completed({ id: 'b', external_load_id: 'CARGA-SIGNED', signature_operator: 'M. Rojas' });
    const rows = rescueRowsFromCompleted([rescue, signed]);
    expect(rows.map((r) => r.external_load_id)).toEqual(['CARGA-RESCUE']);
  });

  it('maps pickup_point to pickup_location and marks status completed', () => {
    const rescue = completed({ pickup_point: 'Bodega Norte', signature_operator: null });
    const [row] = rescueRowsFromCompleted([rescue]);
    expect(row.pickup_location).toBe('Bodega Norte');
    expect(row.status).toBe('completed');
  });

  it('never fabricates a discrepancy_count — get_completed_manifests does not fetch discrepancy_notes', () => {
    const rescue = completed({ signature_operator: null, missing_count: 3 });
    const [row] = rescueRowsFromCompleted([rescue]);
    expect(row.discrepancy_count).toBeUndefined();
  });
});
