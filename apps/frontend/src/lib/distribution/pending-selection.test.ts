import { describe, it, expect } from 'vitest';
import { buildSelectionRequest, flattenOrders } from './pending-selection';
import type { ZoneGroup, OrderGroup } from '@/hooks/distribution/usePendingSectorization';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

function zone(overrides: Partial<DockZoneRecord> = {}): DockZoneRecord {
  return {
    id: 'zone-a1',
    name: 'Zona Norte',
    code: 'A1',
    is_consolidation: false,
    comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
    is_active: true,
    operator_id: 'op-1',
    capacity: null,
    ...overrides,
  };
}

const zoneA = zone();
const zoneB = zone({
  id: 'zone-a4',
  code: 'A4',
  name: 'Puente Alto',
  comunas: [{ id: 'c-2', nombre: 'Puente Alto' }],
});
const zoneCons = zone({
  id: 'zone-cons',
  code: 'CONS',
  name: 'Consolidación',
  is_consolidation: true,
  comunas: [],
});
const allZones = [zoneA, zoneB, zoneCons];

function order(id: string, comunaId: string | null = 'c-1'): OrderGroup {
  return {
    orderId: id,
    orderNumber: id,
    deliveryDate: '2026-08-24',
    comunaName: 'Quilicura',
    packages: [
      {
        id: `pkg-${id}`,
        label: `BULTO-${id}`,
        order_id: id,
        orderNumber: id,
        comunaId,
        comunaName: 'Quilicura',
        delivery_date: '2026-08-24',
        skuItems: [],
      },
    ],
  };
}

function groupWith(zoneRecord: DockZoneRecord, orders: OrderGroup[]): ZoneGroup {
  return {
    zone: zoneRecord,
    matchResult: {
      zone_id: zoneRecord.id,
      zone_name: zoneRecord.name,
      zone_code: zoneRecord.code,
      is_consolidation: zoneRecord.is_consolidation,
      reason: zoneRecord.is_consolidation ? 'unmapped' : 'matched',
      flagged: zoneRecord.is_consolidation,
    },
    orders,
  };
}

describe('mixedComunaBatch / suggestedZone (via buildSelectionRequest)', () => {
  it('is true when the selection spans two DIFFERENT actual andén matches', () => {
    const groups = [groupWith(zoneA, [order('1', 'c-1')]), groupWith(zoneB, [order('2', 'c-2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.mixedComunaBatch).toBe(true);
  });

  it('is false when one real andén match is combined with a SIN ANDÉN (consolidación) order', () => {
    const groups = [groupWith(zoneA, [order('1', 'c-1')]), groupWith(zoneCons, [order('2', null)])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.mixedComunaBatch).toBe(false);
  });

  it('is false when every selected order lands in consolidación (no real match at all)', () => {
    const groups = [groupWith(zoneCons, [order('1', null), order('2', null)])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.mixedComunaBatch).toBe(false);
  });

  it('is false for a single-zone selection', () => {
    const groups = [groupWith(zoneA, [order('1', 'c-1'), order('2', 'c-1')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.mixedComunaBatch).toBe(false);
  });

  // Round-2 review, must-fix 2 — `determineDockZone` (the bucket the
  // hook actually stores) is date-aware: a future-dated order whose
  // comuna matches a real andén still lands in the consolidación bucket.
  // A predicate that reads the BUCKET zone would drop this order from
  // both the mixed check and the suggested-zone search — exactly the
  // false-SUGERIDO the flag exists to prevent. `matchZoneByComuna` (what
  // `ConsolidationPageContent` uses) must see through the bucket to the
  // order's own comuna.
  it('counts a future-dated order (bucketed under consolidación) toward mixed, via its own comuna match — not its bucket', () => {
    // order-1: comuna matches zoneA, but bucketed under consolidación
    // (future-dated retention) — the bucket must not hide this match.
    const groups = [groupWith(zoneCons, [order('1', 'c-1')]), groupWith(zoneB, [order('2', 'c-2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.mixedComunaBatch).toBe(true);
  });

  it('suggests the first selected order\'s OWN comuna match, not its bucket zone, even when the bucket is consolidación', () => {
    // order-1 is bucketed under consolidación (future-dated) but its
    // comuna matches zoneA — the sheet must not pre-select and badge
    // consolidación SUGERIDO for a batch of real andén matches.
    const groups = [groupWith(zoneCons, [order('1', 'c-1')]), groupWith(zoneB, [order('2', 'c-2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.suggestedZone.id).toBe(zoneA.id);
  });

  it('falls back to consolidación when nothing in the selection matches a real andén', () => {
    const groups = [groupWith(zoneCons, [order('1', null), order('2', null)])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']), allZones);
    expect(request?.suggestedZone.id).toBe(zoneCons.id);
  });
});

describe('flattenOrders', () => {
  it('pairs every order with its own group zone', () => {
    const groups = [groupWith(zoneA, [order('1')]), groupWith(zoneB, [order('2')])];
    const flat = flattenOrders(groups);
    expect(flat).toEqual([
      { order: order('1'), zone: zoneA },
      { order: order('2'), zone: zoneB },
    ]);
  });
});
