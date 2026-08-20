import { describe, it, expect } from 'vitest';
import {
  groupPendingManifests,
  clientSelectionState,
} from './pickupStartRouteGrouping';
import type { ManifestRow } from '@/components/pickup/ManifestTable';

const rows: ManifestRow[] = [
  {
    id: 'm1',
    externalLoadId: 'CARGA-99814',
    pickupPoint: 'Mall Plaza Vespucio',
    retailerName: 'Falabella',
    orderCount: 18,
    packageCount: 42,
    verifiedCount: 0,
  },
  {
    id: 'm2',
    externalLoadId: 'CARGA-99815',
    pickupPoint: 'Mall Plaza Vespucio',
    retailerName: 'Falabella',
    orderCount: 4,
    packageCount: 25,
    verifiedCount: 0,
  },
  {
    id: 'm3',
    externalLoadId: 'CARGA-99817',
    pickupPoint: 'Parque Arauco',
    retailerName: 'Falabella',
    orderCount: 10,
    packageCount: 25,
    verifiedCount: 0,
  },
  {
    id: 'm4',
    externalLoadId: 'CARGA-77001',
    pickupPoint: 'Ripley Costanera',
    retailerName: 'Ripley',
    orderCount: 8,
    packageCount: 25,
    verifiedCount: 0,
  },
];

describe('groupPendingManifests', () => {
  it('groups by client, then by pickup point, preserving first-seen order', () => {
    const groups = groupPendingManifests(rows);
    expect(groups.map((g) => g.client)).toEqual(['Falabella', 'Ripley']);

    const falabella = groups[0];
    expect(falabella.points.map((p) => p.point)).toEqual([
      'Mall Plaza Vespucio',
      'Parque Arauco',
    ]);
    expect(falabella.points[0].manifests).toHaveLength(2);
  });

  it('computes real point counts and package sums from the SQL-aggregated counts', () => {
    const groups = groupPendingManifests(rows);
    const falabella = groups[0];
    expect(falabella.pointCount).toBe(2);
    expect(falabella.packageCount).toBe(42 + 25 + 25);

    const ripley = groups[1];
    expect(ripley.pointCount).toBe(1);
    expect(ripley.packageCount).toBe(25);
  });

  it('falls back to honest placeholders for a missing client or point, never fabricating a name', () => {
    const groups = groupPendingManifests([
      { ...rows[0], retailerName: null, pickupPoint: null },
    ]);
    expect(groups[0].client).toBe('Sin cliente');
    expect(groups[0].points[0].point).toBe('Sin punto de recogida');
  });

  it('excludes manifests with no id from selectableIds (nothing to select yet)', () => {
    const groups = groupPendingManifests([{ ...rows[0], id: null }]);
    expect(groups[0].selectableIds).toEqual([]);
  });
});

describe('clientSelectionState', () => {
  const groups = groupPendingManifests(rows);
  const falabellaIds = groups[0].selectableIds; // m1, m2, m3

  it('is "none" when nothing under the client is selected', () => {
    expect(clientSelectionState(falabellaIds, new Set())).toBe('none');
  });

  it('is "some" when a subset is selected', () => {
    expect(clientSelectionState(falabellaIds, new Set(['m1']))).toBe('some');
  });

  it('is "all" when every selectable manifest under the client is selected', () => {
    expect(clientSelectionState(falabellaIds, new Set(['m1', 'm2', 'm3']))).toBe('all');
  });

  it('is "none", never "all", for a client with zero selectable manifests', () => {
    expect(clientSelectionState([], new Set())).toBe('none');
  });

  // Review fix — the whole reason this takes a plain id array: a filtered
  // group's `selectableIds` must never be the source, only the client's
  // FULL membership, or "all" can lie about manifests hidden by a search.
  it('reads the ids it is given, not anything derived from a filtered group', () => {
    // Only 2 of the client's 3 real manifests are "visible" here, but both
    // of the visible ones are selected — passing the full id list (not the
    // 2-id visible subset) correctly reports "some", not "all".
    const fullIds = falabellaIds; // ['m1', 'm2', 'm3']
    expect(clientSelectionState(fullIds, new Set(['m1', 'm2']))).toBe('some');
  });
});
