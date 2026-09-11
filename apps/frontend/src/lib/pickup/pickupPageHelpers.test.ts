import { describe, it, expect } from 'vitest';
import {
  todayLabel,
  matchesClient,
  matchesSearchTerm,
  matchesSearchTermRouted,
  pendingToRows,
  totalsToRows,
  manifestsAvailability,
  rescueRowsFromCompleted,
  clientCountsForTab,
} from './pickupPageHelpers';
import type { ManifestRow } from '@/components/pickup/ManifestTable';
import type { PendingManifest, CompletedManifest, InTransitManifest } from '@/hooks/pickup/useManifests';
import type { RoutedManifest } from '@/hooks/pickup/useRoutedManifests';

describe('todayLabel', () => {
  it('capitalises the weekday and formats in Spanish', () => {
    const date = new Date('2026-04-09T10:00:00Z');
    expect(todayLabel(date)).toMatch(/^[A-ZÁÉÍÓÚ]/);
  });
});

describe('matchesClient', () => {
  it('matches everything when no client is selected', () => {
    expect(matchesClient('Easy', null)).toBe(true);
    expect(matchesClient(null, null)).toBe(true);
  });

  it('matches a real retailer name exactly', () => {
    expect(matchesClient('Easy', 'Easy')).toBe(true);
    expect(matchesClient('Easy', 'Ripley')).toBe(false);
  });

  // ronda 4 (review fase 2) — the actual bug: clientBreakdown labels a null
  // retailer_name 'Sin cliente' for the chip, but a bare `retailerName ===
  // selectedClient` comparison never matches null against that string, so
  // clicking the chip emptied the table.
  it('matches a null retailer against the "Sin cliente" chip', () => {
    expect(matchesClient(null, 'Sin cliente')).toBe(true);
  });

  it('does not match a null retailer against a real client name', () => {
    expect(matchesClient(null, 'Easy')).toBe(false);
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

  // spec-94 fase 1/2 review: arm2 (a manifest whose orders are ALL
  // soft-deleted) returns order_count/package_count as NULL, the honest
  // "unknown" from manifests.total_orders/total_packages — NOT 0. This
  // function must pass that NULL through unchanged; coalescing it here
  // would let handleRowOpen (page.tsx) write a fabricated zero back to the
  // database through openPendingManifest.
  it('passes order_count/package_count through as null, never coalesced to 0', () => {
    const [row] = pendingToRows([pending({ order_count: null, package_count: null })]);
    expect(row.orderCount).toBeNull();
    expect(row.packageCount).toBeNull();
  });
});

describe('totalsToRows', () => {
  function completedManifest(over: Partial<CompletedManifest> = {}): CompletedManifest {
    return {
      id: 'c1',
      external_load_id: 'CARGA-000',
      retailer_name: 'Easy',
      total_orders: 2,
      total_packages: 4,
      completed_at: '2026-09-10T09:00:00Z',
      created_at: '2026-09-10T08:00:00Z',
      pickup_point: 'Easy Vespucio',
      labels_printed_at: null,
      labels_printed_by_name: null,
      missing_count: 0,
      ...over,
    };
  }

  function inTransitManifest(over: Partial<InTransitManifest> = {}): InTransitManifest {
    return {
      id: 't1',
      external_load_id: 'CARGA-INT-1',
      retailer_name: 'Falabella',
      total_orders: 7,
      total_packages: 14,
      reception_status: 'awaiting_reception',
      updated_at: '2026-09-10T11:00:00Z',
      created_at: '2026-09-10T08:00:00Z',
      pickup_point: 'Bodega Norte',
      labels_printed_at: null,
      labels_printed_by_name: null,
      closed_at: null,
      missing_count: 0,
      ...over,
    };
  }

  it('carries real totals through unchanged', () => {
    const [row] = totalsToRows([completedManifest({ total_orders: 2, total_packages: 4 })]);
    expect(row.orderCount).toBe(2);
    expect(row.packageCount).toBe(4);
  });

  // ronda 4 (review fase 2) — THE bug: a load never opened (attached to a
  // route while still 'pending', total_orders/total_packages never
  // written) that later shows up on the in_transit or completed tab must
  // pass NULL through unchanged, exactly like pendingToRows above. `?? 0`
  // belongs in ManifestTable's render, never here — coalescing it in this
  // mapper is what let a click on such a row (page.tsx's handleRowOpen)
  // write a fabricated total_orders=0/total_packages=0 through
  // openPendingManifest, permanently, on the very tabs corrección 4 was
  // supposed to also protect.
  it('passes total_orders/total_packages through as null, never coalesced to 0 (in_transit tab)', () => {
    const [row] = totalsToRows([inTransitManifest({ total_orders: null, total_packages: null })]);
    expect(row.orderCount).toBeNull();
    expect(row.packageCount).toBeNull();
  });

  it('passes total_orders/total_packages through as null, never coalesced to 0 (completed tab)', () => {
    const [row] = totalsToRows([completedManifest({ total_orders: null, total_packages: null })]);
    expect(row.orderCount).toBeNull();
    expect(row.packageCount).toBeNull();
  });
});

describe('matchesSearchTermRouted', () => {
  function routedRow(over: Partial<RoutedManifest> = {}): RoutedManifest {
    return {
      id: 'r1',
      external_load_id: 'CARGA-94-DOCK',
      retailer_name: 'Easy',
      total_orders: 5,
      total_packages: 12,
      created_at: '2026-09-10T09:00:00Z',
      pickup_point: 'Easy Vespucio',
      labels_printed_at: null,
      labels_printed_by_name: null,
      route_code: 'PR-2026-0042',
      route_started_at: '2026-09-10T08:00:00Z',
      driver_name: 'Juan Pérez',
      route_status: 'in_progress',
      closed_at: null,
      missing_count: 0,
      verified_count: 3,
      ...over,
    };
  }

  it('matches everything when the term is empty', () => {
    expect(matchesSearchTermRouted(routedRow(), '')).toBe(true);
  });

  it('matches by external load id', () => {
    expect(matchesSearchTermRouted(routedRow(), 'carga-94-dock')).toBe(true);
  });

  it('matches by route code — the whole reason this is a separate matcher', () => {
    expect(matchesSearchTermRouted(routedRow(), 'pr-2026-0042')).toBe(true);
  });

  it('matches by driver name', () => {
    expect(matchesSearchTermRouted(routedRow(), 'juan')).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(matchesSearchTermRouted(routedRow(), 'sodimac')).toBe(false);
  });

  it('does not crash on a null driver/pickup point', () => {
    const bare = routedRow({ driver_name: null, pickup_point: null });
    expect(matchesSearchTermRouted(bare, 'anything')).toBe(false);
    expect(matchesSearchTermRouted(bare, '')).toBe(true);
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

// spec-95 fase 8, review round 1 (B1) — the chip count has to match the
// CUBE the operator is looking at. `clientBreakdown` over the union of all
// four cubes was correct while the chip only signalled existence
// (spec-94 fase 2: a retailer with everything already routed must not lose
// its chip) — hanging a COUNT off that union prints a number that
// disagrees with both the tab pill and the "Mostrando N de M" footer.
describe('clientCountsForTab', () => {
  const p = (retailer_name: string | null) => ({ retailer_name });

  it('counts only the rows of the active tab', () => {
    const counts = clientCountsForTab(
      'pending',
      [p('Falabella'), p('Falabella'), p('Ripley')],
      [p('Falabella')], // routed
      [], // in_transit
      [p('Falabella'), p('Falabella'), p('Falabella'), p('Falabella'), p('Falabella'), p('Falabella')], // completed
    );
    expect(counts).toEqual(
      expect.arrayContaining([
        { name: 'Falabella', count: 2 },
        { name: 'Ripley', count: 1 },
      ]),
    );
  });

  // spec-94 fase 2's own reason for the union: a retailer with every load
  // already routed must not lose its chip when Pendientes is the active
  // tab — it just reads zero there instead of disappearing.
  it('keeps a chip for a client with zero rows on the active tab, reading zero honestly', () => {
    const counts = clientCountsForTab('pending', [], [p('Falabella')], [], []);
    expect(counts).toEqual([{ name: 'Falabella', count: 0 }]);
  });

  it('sums to exactly the active tab\'s row count — the same figure the tab pill and footer show', () => {
    const pending = [p('Falabella'), p('Ripley'), p(null)];
    const counts = clientCountsForTab('pending', pending, [p('Sodimac')], [], []);
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(pending.length);
  });

  it('reads the routed cube for the routed tab, not pending', () => {
    const counts = clientCountsForTab(
      'routed',
      [p('Falabella'), p('Falabella')], // pending
      [p('Ripley')], // routed
      [],
      [],
    );
    expect(counts).toEqual(
      expect.arrayContaining([
        { name: 'Falabella', count: 0 },
        { name: 'Ripley', count: 1 },
      ]),
    );
  });
});
