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
    comunas: [],
    is_active: true,
    operator_id: 'op-1',
    capacity: null,
    ...overrides,
  };
}

const zoneA = zone();
const zoneB = zone({ id: 'zone-a4', code: 'A4', name: 'Puente Alto' });
const zoneCons = zone({ id: 'zone-cons', code: 'CONS', name: 'Consolidación', is_consolidation: true });

function order(id: string, comunaName: string | null = 'Quilicura'): OrderGroup {
  return {
    orderId: id,
    orderNumber: id,
    deliveryDate: '2026-08-24',
    comunaName,
    packages: [
      {
        id: `pkg-${id}`,
        label: `BULTO-${id}`,
        order_id: id,
        orderNumber: id,
        comunaId: 'c-1',
        comunaName,
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

describe('isMixedComunaBatch (via buildSelectionRequest.mixedComunaBatch)', () => {
  it('is true when the selection spans two DIFFERENT actual andén matches', () => {
    const groups = [groupWith(zoneA, [order('1')]), groupWith(zoneB, [order('2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']));
    expect(request?.mixedComunaBatch).toBe(true);
  });

  it('is false when one real andén match is combined with a SIN ANDÉN (consolidación) order', () => {
    const groups = [groupWith(zoneA, [order('1')]), groupWith(zoneCons, [order('2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']));
    expect(request?.mixedComunaBatch).toBe(false);
  });

  it('is false when every selected order lands in consolidación (no real match at all)', () => {
    const groups = [groupWith(zoneCons, [order('1'), order('2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']));
    expect(request?.mixedComunaBatch).toBe(false);
  });

  it('is false for a single-zone selection', () => {
    const groups = [groupWith(zoneA, [order('1'), order('2')])];
    const request = buildSelectionRequest(groups, new Set(['1', '2']));
    expect(request?.mixedComunaBatch).toBe(false);
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
