import { describe, it, expect } from 'vitest';
import { clientBreakdown, completedToday, pendingTotals } from './pickupSummary';
import type { CompletedManifest, PendingManifest } from './useManifests';

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
    expect(completedToday(rows, now)).toHaveLength(1);
    expect(completedToday(rows, now)[0].id).toBe('a');
  });

  it('sorts newest first, which is the order the panel reads in', () => {
    const rows = [
      completed({ id: 'early', completed_at: '2026-08-16T09:20:00Z' }),
      completed({ id: 'late', completed_at: '2026-08-16T13:12:00Z' }),
    ];
    expect(completedToday(rows, now).map((r) => r.id)).toEqual(['late', 'early']);
  });

  it('skips rows with no completion timestamp instead of throwing', () => {
    const rows = [completed({ id: 'x', completed_at: null as unknown as string })];
    expect(completedToday(rows, now)).toEqual([]);
  });
});
