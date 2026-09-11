import { describe, it, expect } from 'vitest';
import { clientBreakdown, completedToday, pendingTotals } from './pickupSummary';
import type { CompletedManifest, PendingManifest } from './useManifests';
import type { RoutedManifest } from './useRoutedManifests';

function routed(over: Partial<RoutedManifest> = {}): RoutedManifest {
  return {
    id: 'r1',
    external_load_id: 'CARGA-94-DOCK',
    retailer_name: 'Easy',
    total_orders: 5,
    total_packages: 12,
    created_at: '2026-08-16T08:00:00Z',
    pickup_point: 'Easy Vespucio',
    labels_printed_at: null,
    labels_printed_by_name: null,
    route_code: 'PR-2026-0042',
    route_started_at: '2026-08-16T08:00:00Z',
    driver_name: 'Juan Pérez',
    route_status: 'in_progress',
    closed_at: null,
    missing_count: 0,
    verified_count: 3,
    ...over,
  };
}

function pending(over: Partial<PendingManifest> = {}): PendingManifest {
  return {
    id: 'm1',
    external_load_id: 'CARGA-99814',
    retailer_name: 'Falabella',
    order_count: 18,
    package_count: 42,
    created_at: '2026-08-16T09:00:00Z',
    pickup_point: 'Mall Plaza Vespucio',
    verified_count: 0,
    labels_printed_at: null,
    labels_printed_by_name: null,
    ...over,
  };
}

function completed(over: Partial<CompletedManifest> = {}): CompletedManifest {
  return {
    id: 'c1',
    external_load_id: 'CARGA-99790',
    retailer_name: 'Falabella',
    total_orders: 14,
    total_packages: 38,
    completed_at: '2026-08-16T13:12:00Z',
    created_at: '2026-08-16T08:00:00Z',
    pickup_point: 'Mall Plaza Vespucio',
    labels_printed_at: null,
    labels_printed_by_name: null,
    missing_count: 0,
    ...over,
  };
}

describe('pendingTotals', () => {
  it('totals manifests, orders and packages', () => {
    expect(pendingTotals([pending(), pending({ id: 'm2', order_count: 21, package_count: 57 })]))
      .toEqual({ manifests: 2, orders: 39, packages: 99 });
  });

  it('is all zeros for an empty list', () => {
    expect(pendingTotals([])).toEqual({ manifests: 0, orders: 0, packages: 0 });
  });
});

describe('clientBreakdown', () => {
  it('counts manifests per retailer, heaviest first', () => {
    const rows = [
      pending({ id: 'a', retailer_name: 'Falabella' }),
      pending({ id: 'b', retailer_name: 'Ripley' }),
      pending({ id: 'c', retailer_name: 'Falabella' }),
    ];
    expect(clientBreakdown(rows)).toEqual([
      { name: 'Falabella', count: 2 },
      { name: 'Ripley', count: 1 },
    ]);
  });

  it('groups manifests with no retailer under a single label', () => {
    // Dropping them would make the chips disagree with the table total.
    expect(clientBreakdown([pending({ retailer_name: null })])).toEqual([
      { name: 'Sin cliente', count: 1 },
    ]);
  });

  it('is empty for no manifests', () => {
    expect(clientBreakdown([])).toEqual([]);
  });
});

describe('completedToday', () => {
  const now = new Date('2026-08-16T15:00:00Z');

  it('counts only manifests completed on the current local day', () => {
    const rows = [
      completed({ id: 'a', completed_at: '2026-08-16T13:12:00Z' }),
      completed({ id: 'b', completed_at: '2026-08-15T13:12:00Z' }),
    ];
    expect(completedToday(rows, [], now)).toHaveLength(1);
    expect(completedToday(rows, [], now)[0].id).toBe('a');
  });

  it('sorts newest first, which is the order the panel reads in', () => {
    const rows = [
      completed({ id: 'early', completed_at: '2026-08-16T09:20:00Z' }),
      completed({ id: 'late', completed_at: '2026-08-16T13:12:00Z' }),
    ];
    expect(completedToday(rows, [], now).map((r) => r.id)).toEqual(['late', 'early']);
  });

  it('skips rows with no completion timestamp instead of throwing', () => {
    const rows = [completed({ id: 'x', completed_at: null as unknown as string })];
    expect(completedToday(rows, [], now)).toEqual([]);
  });

  // spec-94 fase 1 ("«Cierres de hoy» no puede quedarse colgando del cubo
  // 4"): a load closed at the dock (status='completed', route still
  // in_progress) no longer appears in get_completed_manifests at all — it
  // belongs to cubo 2. Without reading get_routed_manifests too, that
  // closure (and its missing_count) never appears in this panel, on any
  // day.
  it('includes a load closed at the dock (routed, closed_at set) today, with its missing_count', () => {
    const routedRows = [
      routed({ id: 'r-dock', external_load_id: 'CARGA-DOCK', closed_at: '2026-08-16T09:00:00Z', missing_count: 3 }),
    ];
    const rows = completedToday([], routedRows, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'r-dock', external_load_id: 'CARGA-DOCK', missing_count: 3 });
  });

  it('excludes a routed load that has not closed yet (closed_at NULL)', () => {
    const routedRows = [routed({ id: 'r-open', closed_at: null })];
    expect(completedToday([], routedRows, now)).toEqual([]);
  });

  it('excludes a routed closure from a previous day', () => {
    const routedRows = [routed({ id: 'r-yesterday', closed_at: '2026-08-15T09:00:00Z' })];
    expect(completedToday([], routedRows, now)).toEqual([]);
  });

  it('merges both sources, newest first, across cubo 2 and cubo 4', () => {
    const completedRows = [completed({ id: 'c1', completed_at: '2026-08-16T08:00:00Z' })];
    const routedRows = [routed({ id: 'r1', closed_at: '2026-08-16T10:00:00Z' })];
    expect(completedToday(completedRows, routedRows, now).map((r) => r.id)).toEqual(['r1', 'c1']);
  });
});
