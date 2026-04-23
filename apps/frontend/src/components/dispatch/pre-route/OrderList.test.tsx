import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderList } from './OrderList';
import type { PreRouteOrder } from '@/lib/types';

function makeOrder(overrides: Partial<PreRouteOrder> = {}): PreRouteOrder {
  return {
    id: 'ord-1',
    order_number: 'ORD-001',
    customer_name: 'Cliente Test',
    delivery_address: 'Av. Principal 123',
    delivery_window_start: '09:00:00',
    delivery_window_end: '12:00:00',
    package_count: 2,
    has_split_dock_zone: false,
    ...overrides,
  };
}

describe('OrderList', () => {
  it('renders nothing when list is empty', () => {
    const { container } = render(<OrderList orders={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders order_number for each order', () => {
    render(<OrderList orders={[makeOrder({ order_number: 'ORD-100' }), makeOrder({ id: 'ord-2', order_number: 'ORD-101' })]} />);
    expect(screen.getByText('ORD-100')).toBeInTheDocument();
    expect(screen.getByText('ORD-101')).toBeInTheDocument();
  });

  it('renders customer_name', () => {
    render(<OrderList orders={[makeOrder({ customer_name: 'Juan García' })]} />);
    expect(screen.getByText('Juan García')).toBeInTheDocument();
  });

  it('renders delivery_address', () => {
    render(<OrderList orders={[makeOrder({ delivery_address: 'Calle Falsa 123' })]} />);
    expect(screen.getByText('Calle Falsa 123')).toBeInTheDocument();
  });

  it('renders package_count', () => {
    render(<OrderList orders={[makeOrder({ package_count: 4 })]} />);
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });

  it('renders delivery window when present', () => {
    render(<OrderList orders={[makeOrder({ delivery_window_start: '09:00:00', delivery_window_end: '12:00:00' })]} />);
    // Window is displayed in some form
    expect(screen.getByText(/09:00/)).toBeInTheDocument();
  });

  it('handles null delivery window gracefully', () => {
    render(<OrderList orders={[makeOrder({ delivery_window_start: null, delivery_window_end: null })]} />);
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
  });

  it('has no interactive action elements', () => {
    render(<OrderList orders={[makeOrder()]} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
