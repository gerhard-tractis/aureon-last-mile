import { describe, it, expect } from 'vitest';
import { computePriority } from './priority';
import type { OperationsOrder } from '@/hooks/useOperationsOrders';

function makeOrder(overrides: Partial<OperationsOrder> = {}): OperationsOrder {
  return {
    id: 'ord-1',
    order_number: 'ORD-001',
    retailer_name: 'Falabella',
    customer_name: 'Juan Perez',
    comuna: 'Las Condes',
    delivery_date: '2026-03-16',
    delivery_window_start: null,
    delivery_window_end: null,
    status: 'en_bodega',
    leading_status: 'en_bodega',
    status_updated_at: null,
    operator_id: 'op-1',
    deleted_at: null,
    ...overrides,
  };
}

describe('computePriority', () => {
  it('returns "ok" when delivery_window_end is null', () => {
    expect(computePriority(makeOrder({ delivery_window_end: null }))).toBe('ok');
  });

  it('returns "late" when delivery_window_end is in the past', () => {
    const past = new Date(Date.now() - 60 * 60000).toISOString(); // 60 min ago
    expect(computePriority(makeOrder({ delivery_window_end: past }))).toBe('late');
  });

  it('returns "urgent" when <= 45 min remaining', () => {
    const soon = new Date(Date.now() + 30 * 60000).toISOString(); // 30 min from now
    expect(computePriority(makeOrder({ delivery_window_end: soon }))).toBe('urgent');
  });

  it('returns "alert" when 45 < minutes <= 120 remaining', () => {
    const mid = new Date(Date.now() + 90 * 60000).toISOString(); // 90 min from now
    expect(computePriority(makeOrder({ delivery_window_end: mid }))).toBe('alert');
  });

  it('returns "ok" when > 120 min remaining', () => {
    const far = new Date(Date.now() + 180 * 60000).toISOString(); // 180 min from now
    expect(computePriority(makeOrder({ delivery_window_end: far }))).toBe('ok');
  });
});
