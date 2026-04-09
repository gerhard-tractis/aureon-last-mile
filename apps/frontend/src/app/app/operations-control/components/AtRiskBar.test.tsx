import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AtRiskBar } from './AtRiskBar';
import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';

function makeOrder(id: string): AtRiskOrder {
  return {
    id,
    status: 'at_risk',
    minutesRemaining: 30,
    label: '30m',
    stage: 'delivery',
    retailer: 'Retailer',
    customer: 'Cliente',
    address: 'Calle 1',
    reasonFlag: '',
  };
}

describe('AtRiskBar', () => {
  it('renders count of at-risk orders', () => {
    const orders = [makeOrder('X1'), makeOrder('X2')];
    render(<AtRiskBar orders={orders} total={2} onSelect={vi.fn()} />);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('renders first 3 orders by id', () => {
    const orders = [makeOrder('ORD-1'), makeOrder('ORD-2'), makeOrder('ORD-3'), makeOrder('ORD-4')];
    render(<AtRiskBar orders={orders} total={4} onSelect={vi.fn()} />);
    expect(screen.getByText('ORD-1')).toBeDefined();
    expect(screen.getByText('ORD-2')).toBeDefined();
    expect(screen.getByText('ORD-3')).toBeDefined();
  });

  it('renders "+ N MÁS →" when total > 3', () => {
    const orders = [makeOrder('A'), makeOrder('B'), makeOrder('C'), makeOrder('D')];
    render(<AtRiskBar orders={orders} total={4} onSelect={vi.fn()} />);
    expect(screen.getByText(/\+ 1 MÁS →/)).toBeDefined();
  });

  it('does NOT render "+ N MÁS →" when total ≤ 3', () => {
    const orders = [makeOrder('A'), makeOrder('B'), makeOrder('C')];
    render(<AtRiskBar orders={orders} total={3} onSelect={vi.fn()} />);
    expect(screen.queryByText(/MÁS →/)).toBeNull();
  });

  it('clicking the bar triggers onSelect', () => {
    const onSelect = vi.fn();
    const orders = [makeOrder('A')];
    render(<AtRiskBar orders={orders} total={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
